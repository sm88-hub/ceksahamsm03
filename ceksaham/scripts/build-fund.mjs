// SM-Crestboard: data Penyaring "Seluruh bursa".
// Dijalankan GitHub Actions setiap pagi (lihat .github/workflows/data-penyaring.yml).
// 1. Ambil daftar SEMUA saham tiap bursa + harga, MA50/MA200, PER, kapitalisasi (mesin penyaring Yahoo, murah).
// 2. Ambil data laporan keuangan per saham, mulai dari yang belum punya data atau datanya paling lama.
//    Data laporan keuangan diperbarui paling lama tiap 7 hari, karena laporan hanya berubah per kuartal.
// 3. Tulis public/data/fs-<BURSA>.json. Kalau proses berhenti di tengah, data lama tetap dipakai.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const BUDGET = (+process.env.BUDGET_MIN || 300) * 60e3;
const CONC = +process.env.CONC || 4;
const STALE_DAYS = 7;
const T0 = Date.now();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MK = {
  ID: { region: 'id', sfx: ['.JK'] },
  US: { region: 'us', exch: ['NMS', 'NYQ', 'ASE', 'NGM', 'NCM'], sfx: [''] },
  JP: { region: 'jp', sfx: ['.T'] },
  KR: { region: 'kr', sfx: ['.KS', '.KQ'] },
  HK: { region: 'hk', sfx: ['.HK'] },
};
const ONLY = (process.env.MARKETS || Object.keys(MK).join(',')).split(',').map((s) => s.trim().toUpperCase()).filter((m) => MK[m]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${((Date.now() - T0) / 60e3).toFixed(1)}m]`, ...a);

/* ---------- Yahoo: cookie + crumb, permintaan dengan jeda dan coba ulang ---------- */
let auth = null;
async function getAuth(force) {
  if (auth && !force && Date.now() - auth.t < 1800e3) return auth;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
  const cookie = raw.flatMap((c) => c.split(/,(?=\s*[A-Za-z0-9_]+=)/)).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, cookie } });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) throw new Error('crumb Yahoo gagal (' + r2.status + ')');
  auth = { cookie, crumb, t: Date.now() };
  return auth;
}
let blocked = 0; // jumlah kegagalan beruntun karena dibatasi Yahoo
async function yget(url, opt = {}) {
  for (let i = 0; i < 6; i++) {
    let a;
    try { a = await getAuth(i > 0 && i % 2 === 0); } catch (e) { await sleep(5000 * (i + 1)); continue; }
    const u = url + (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(a.crumb);
    let r;
    try { r = await fetch(u, { ...opt, headers: { 'User-Agent': UA, cookie: a.cookie, ...(opt.headers || {}) } }); }
    catch { await sleep(2000 * 2 ** i); continue; }
    if (r.status === 401 || r.status === 403) { auth = null; await sleep(1000); continue; }
    if (r.status === 429 || r.status >= 500) { blocked++; await sleep(Math.min(60e3, 3000 * 2 ** i)); continue; }
    blocked = 0;
    if (r.status === 404) return null;
    return r.json().catch(() => null);
  }
  return undefined; // gagal setelah semua percobaan
}

/* ---------- Tahap 1: daftar semua saham + data harga ---------- */
async function listMarket(mk) {
  const M = MK[mk];
  const ops = [{ operator: 'eq', operands: ['region', M.region] }];
  if (M.exch) ops.push({ operator: 'or', operands: M.exch.map((e) => ({ operator: 'eq', operands: ['exchange', e] })) });
  const rows = new Map(); let total = Infinity;
  for (let off = 0; off < total && off < 20000; off += 250) {
    const j = await yget('https://query1.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offset: off, size: 250, sortField: 'intradaymarketcap', sortType: 'DESC', quoteType: 'EQUITY', query: { operator: 'AND', operands: ops }, userId: '', userIdType: 'guid' }),
    });
    const res = j?.finance?.result?.[0];
    if (!res) throw new Error(`daftar ${mk} gagal di offset ${off}`);
    total = res.total || 0;
    for (const q of res.quotes || []) {
      const sym = String(q.symbol || '').toUpperCase(); if (!sym) continue;
      let code = null;
      for (const s of M.sfx) { if (!s) { if (!sym.includes('.')) code = sym; } else if (sym.endsWith(s)) code = sym.slice(0, -s.length); if (code) break; }
      if (!code || rows.has(code) || q.regularMarketPrice == null) continue;
      rows.set(code, { code, sym, name: q.longName || q.shortName || code, price: q.regularMarketPrice, chg: q.regularMarketChangePercent ?? null,
        mcap: q.marketCap ?? null, pe: q.trailingPE ?? null, fpe: q.forwardPE ?? null, ma50: q.fiftyDayAverage ?? null, ma200: q.twoHundredDayAverage ?? null });
    }
    if (!res.quotes || res.quotes.length < 250) break;
    await sleep(400);
  }
  log(mk, 'daftar:', rows.size, 'saham (total Yahoo', total + ')');
  return [...rows.values()];
}

/* ---------- Tahap 2: laporan keuangan per saham ---------- */
const TS = ['annualDilutedEPS', 'annualTotalRevenue', 'annualOperatingIncome', 'annualEBIT', 'annualTaxRateForCalcs', 'annualInvestedCapital'];
const num = (v) => (Number.isFinite(v?.raw) ? v.raw : Number.isFinite(v) ? v : null);
const cagr = (arr, yrs) => { if (!arr || arr.length < yrs + 1) return null; const a = arr[arr.length - 1 - yrs].v, b = arr[arr.length - 1].v; return a > 0 && b > 0 ? Math.pow(b / a, 1 / yrs) - 1 : null; };
async function fund(sym) {
  const e = encodeURIComponent(sym);
  const j = await yget(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${e}?modules=assetProfile,financialData,defaultKeyStatistics,earningsTrend,summaryDetail`);
  if (j === undefined) return undefined;
  const x = j?.quoteSummary?.result?.[0];
  if (!x) return null;
  const now = Math.floor(Date.now() / 1000);
  const t = await yget(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${e}?symbol=${e}&type=${TS.join(',')}&period1=${now - 7 * 365 * 86400}&period2=${now}&merge=false&padTimeSeries=false`);
  if (t === undefined) return undefined;
  const S = {};
  for (const r of t?.timeseries?.result || []) { const k = r.meta?.type?.[0]; if (!k) continue;
    S[k] = (r[k] || []).filter(Boolean).map((v) => ({ d: v.asOfDate, v: v.reportedValue?.raw })).filter((v) => Number.isFinite(v.v)).sort((p, q) => p.d.localeCompare(q.d)); }
  const fd = x.financialData || {}, ks = x.defaultKeyStatistics || {}, tr = x.earningsTrend?.trend || [];
  const g = (p) => num(tr.find((z) => z.period === p)?.growth);
  const rev = S.annualTotalRevenue, eps = S.annualDilutedEPS, oi = S.annualOperatingIncome;
  const last = (a) => (a && a.length ? a[a.length - 1].v : null);
  let opmUp = null;
  if (oi && rev && oi.length >= 2) {
    const m = (i) => { const d = oi[oi.length - 1 - i]?.d, r = rev.find((z) => z.d === d)?.v; return r ? oi[oi.length - 1 - i].v / r : null; };
    const m0 = m(0), m1 = m(1); if (m0 != null && m1 != null) opmUp = m0 > 0 && m0 > m1;
  }
  const ebit = last(S.annualEBIT), tax = last(S.annualTaxRateForCalcs), ic = last(S.annualInvestedCapital), de = num(fd.debtToEquity), peg = num(ks.pegRatio);
  return {
    sector: x.assetProfile?.sector || null,
    eps0y: g('0y'), eps1y: g('+1y'), eps3y: cagr(eps, 3), rev3y: cagr(rev, 3),
    epsY: eps && eps.length >= 2 && eps[eps.length - 2].v > 0 ? eps[eps.length - 1].v / eps[eps.length - 2].v - 1 : null,
    salesQ: num(fd.revenueGrowth), salesY: rev && rev.length >= 2 && rev[rev.length - 2].v > 0 ? rev[rev.length - 1].v / rev[rev.length - 2].v - 1 : null,
    roe: num(fd.returnOnEquity), roic: ebit != null && ic > 0 ? (ebit * (1 - (Number.isFinite(tax) ? tax : 0))) / ic : null,
    opm: num(fd.operatingMargins), opmUp, npm: num(fd.profitMargins),
    cr: num(fd.currentRatio), qr: num(fd.quickRatio), de: de == null ? null : de / 100, peg: peg || null,
  };
}

/* ---------- File data ---------- */
const COLS = ['code', 'name', 'sector', 'price', 'chg', 'mcap', 'pe', 'fpe', 'ma50', 'ma200', 'eps0y', 'eps1y', 'epsY', 'eps3y', 'salesQ', 'salesY', 'rev3y', 'roe', 'roic', 'opm', 'opmUp', 'npm', 'cr', 'qr', 'de', 'peg', 'fu'];
const DEEP = ['sector', 'eps0y', 'eps1y', 'epsY', 'eps3y', 'salesQ', 'salesY', 'rev3y', 'roe', 'roic', 'opm', 'opmUp', 'npm', 'cr', 'qr', 'de', 'peg'];
const rnd = (v, k) => {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'number') return v;
  if (!Number.isFinite(v)) return null;
  if (k === 'mcap') return Math.round(v);
  const a = Math.abs(v), d = a >= 1000 ? 1 : a >= 1 ? 3 : 4;
  return +v.toFixed(d);
};
async function readOld(mk) {
  try { const j = JSON.parse(await readFile(path.join(OUT, `fs-${mk}.json`), 'utf8')); const m = new Map();
    for (const r of j.rows || []) { const o = {}; j.cols.forEach((c, i) => { o[c] = r[i]; }); m.set(o.code, o); } return m; }
  catch { return new Map(); }
}
async function writeMk(mk, list, old) {
  const rows = list.map((r) => { const o = old.get(r.code) || {}; const z = { ...o, ...r };
    return COLS.map((c) => rnd(z[c], c)); });
  const withFund = rows.filter((r) => r[COLS.indexOf('fu')]).length;
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, `fs-${mk}.json`), JSON.stringify({ v: 1, mk, at: new Date().toISOString(), n: rows.length, fund: withFund, cols: COLS, rows }));
  return withFund;
}

/* ---------- Jalankan ---------- */
const today = new Date().toISOString().slice(0, 10);
const staleAt = new Date(Date.now() - STALE_DAYS * 864e5).toISOString().slice(0, 10);
const M = {};
for (const mk of ONLY) {
  try { const old = await readOld(mk); const list = await listMarket(mk); M[mk] = { old, list }; await writeMk(mk, list, old); }
  catch (e) { log(mk, 'GAGAL daftar:', e.message, '→ data lama dipertahankan'); }
}
// antrean laporan keuangan: bergiliran antar-bursa, yang belum punya data dulu, lalu yang paling lama
const Q = {};
for (const [mk, { old, list }] of Object.entries(M)) {
  Q[mk] = list.filter((r) => { const fu = old.get(r.code)?.fu; return !fu || fu < staleAt; })
    .sort((a, b) => (old.get(a.code)?.fu || '').localeCompare(old.get(b.code)?.fu || '') || (b.mcap || 0) - (a.mcap || 0));
  log(mk, 'perlu diperbarui:', Q[mk].length);
}
const queue = []; for (let i = 0, more = true; more; i++) { more = false; for (const mk of Object.keys(Q)) if (Q[mk][i]) { queue.push([mk, Q[mk][i]]); more = true; } }
let done = 0, fail = 0, stop = '', lastSave = Date.now();
const saveAll = async () => { for (const [mk, { list, old }] of Object.entries(M)) await writeMk(mk, list, old); lastSave = Date.now(); };
let qi = 0;
async function worker() {
  while (qi < queue.length && !stop) {
    if (Date.now() - T0 > BUDGET) { stop = 'batas waktu'; break; }
    if (blocked > 40) { log('Yahoo membatasi, jeda 5 menit'); blocked = 0; await sleep(300e3); if (blocked > 20) { stop = 'dibatasi Yahoo'; break; } }
    const [mk, r] = queue[qi++];
    const f = await fund(r.sym).catch(() => undefined);
    const o = M[mk].old.get(r.code) || { code: r.code };
    if (f === undefined) fail++;
    else { if (f) DEEP.forEach((k) => { o[k] = f[k]; }); o.fu = today; M[mk].old.set(r.code, o); done++; }
    if ((done + fail) % 200 === 0) log(`laporan keuangan: ${done} selesai, ${fail} gagal, sisa ${queue.length - qi}`);
    if (Date.now() - lastSave > 10 * 60e3) { lastSave = Date.now(); await saveAll(); }
    await sleep(150);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
await saveAll();
for (const [mk, { list, old }] of Object.entries(M)) log(mk, `${list.length} saham, ${list.filter((r) => old.get(r.code)?.fu).length} punya data laporan keuangan`);
log(`Selesai. ${done} diperbarui, ${fail} gagal${stop ? ', berhenti: ' + stop : ''}.`);
