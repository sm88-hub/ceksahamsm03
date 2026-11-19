// Vercel Function: sektor & industri untuk beberapa saham sekaligus.
// Dipanggil halaman Scanner lewat: /api/sector?market=ID&codes=BBCA,TLKM (maks. 12 kode)
//
// Sumber: Yahoo Finance quoteSummary modul assetProfile (tidak resmi).
// Sektor jarang berubah, jadi hasilnya disimpan lama di cache (7 hari).

import { UNIVERSE } from './rs.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 7 * 24 * 3600 * 1000;
const memo = new Map(); // symbol → { t, v }
let auth = null;

async function getAuth(force) {
  if (auth && !force && Date.now() - auth.t < 3600e3) return auth;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
  const cookie = raw.flatMap((c) => c.split(/,(?=\s*[A-Za-z0-9_]+=)/)).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, cookie } });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) throw new Error('Gagal mengambil crumb Yahoo');
  auth = { cookie, crumb, t: Date.now() };
  return auth;
}

async function profile(symbol, modules = 'assetProfile', whole = false) {
  const go = async (a) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(a.crumb)}`,
      { headers: { 'User-Agent': UA, cookie: a.cookie } });
    if (r.status === 401 || r.status === 403) return { retry: true };
    const j = await r.json().catch(() => null);
    const x = j?.quoteSummary?.result?.[0] || null;
    return { res: whole ? x : (x?.assetProfile || null) };
  };
  let out = await go(await getAuth(false));
  if (out.retry) out = await go(await getAuth(true));
  return out.res || null;
}

async function one(code, sfxList) {
  for (const sfx of sfxList) {
    const symbol = (code + sfx).toUpperCase();
    const hit = memo.get(symbol);
    if (hit && Date.now() - hit.t < TTL) return hit.v;
    const p = await profile(symbol);
    if (!p) continue;
    const v = { code, sector: p.sector || null, industry: p.industry || null };
    memo.set(symbol, { t: Date.now(), v });
    return v;
  }
  return { code, sector: null, industry: null };
}

/* ---------- Mode fund: metrik untuk Penyaring fundamental ---------- */
const TS = ['annualDilutedEPS', 'annualTotalRevenue', 'annualOperatingIncome', 'annualEBIT', 'annualTaxRateForCalcs', 'annualInvestedCapital'];
const memoF = new Map(); const TTL_F = 12 * 3600 * 1000;
async function series(symbol) {
  const go = async (a) => {
    const now = Math.floor(Date.now() / 1000), p1 = now - 7 * 365 * 86400;
    const r = await fetch(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?symbol=${encodeURIComponent(symbol)}&type=${TS.join(',')}&period1=${p1}&period2=${now}&merge=false&padTimeSeries=false&crumb=${encodeURIComponent(a.crumb)}`,
      { headers: { 'User-Agent': UA, cookie: a.cookie } });
    if (r.status === 401 || r.status === 403) return { retry: true };
    const j = await r.json().catch(() => null);
    const out = {};
    for (const x of j?.timeseries?.result || []) { const t = x.meta?.type?.[0]; if (!t) continue;
      out[t] = (x[t] || []).filter(Boolean).map((v) => ({ d: v.asOfDate, v: v.reportedValue?.raw })).filter((v) => Number.isFinite(v.v)).sort((p, q) => p.d.localeCompare(q.d)); }
    return { res: out };
  };
  let o = await go(await getAuth(false));
  if (o.retry) o = await go(await getAuth(true));
  return o.res || {};
}
const num = (v) => (Number.isFinite(v?.raw) ? v.raw : Number.isFinite(v) ? v : null);
const cagr = (arr, yrs) => { if (!arr || arr.length < yrs + 1) return null; const a = arr[arr.length - 1 - yrs].v, b = arr[arr.length - 1].v; return a > 0 && b > 0 ? Math.pow(b / a, 1 / yrs) - 1 : null; };
async function fundOne(code, sfxList) {
  for (const sfx of sfxList) {
    const symbol = (code + sfx).toUpperCase(), hit = memoF.get(symbol);
    if (hit && Date.now() - hit.t < TTL_F) return hit.v;
    const x = await profile(symbol, 'assetProfile,financialData,defaultKeyStatistics,earningsTrend,summaryDetail,price', true);
    if (!x) continue;
    const S = await series(symbol).catch(() => ({}));
    const fd = x.financialData || {}, ks = x.defaultKeyStatistics || {}, sd = x.summaryDetail || {}, tr = x.earningsTrend?.trend || [];
    const g = (p) => num(tr.find((t) => t.period === p)?.growth);
    const rev = S.annualTotalRevenue, eps = S.annualDilutedEPS, oi = S.annualOperatingIncome;
    const last = (a) => (a && a.length ? a[a.length - 1].v : null);
    let opmUp = null;
    if (oi && rev && oi.length >= 2) {
      const m = (i) => { const d = oi[oi.length - 1 - i]?.d, r = rev.find((z) => z.d === d)?.v; return r ? oi[oi.length - 1 - i].v / r : null; };
      const m0 = m(0), m1 = m(1); if (m0 != null && m1 != null) opmUp = m0 > 0 && m0 > m1;
    }
    const ebit = last(S.annualEBIT), tax = last(S.annualTaxRateForCalcs), ic = last(S.annualInvestedCapital);
    const de = num(fd.debtToEquity), peg = num(ks.pegRatio);
    const v = {
      code, sector: x.assetProfile?.sector || null,
      eps0y: g('0y'), eps1y: g('+1y'), eps3y: cagr(eps, 3), rev3y: cagr(rev, 3),
      salesQ: num(fd.revenueGrowth), salesY: rev && rev.length >= 2 && rev[rev.length - 2].v > 0 ? rev[rev.length - 1].v / rev[rev.length - 2].v - 1 : null,
      roe: num(fd.returnOnEquity), roic: ebit != null && ic > 0 ? (ebit * (1 - (Number.isFinite(tax) ? tax : 0))) / ic : null,
      opm: num(fd.operatingMargins), opmUp, npm: num(fd.profitMargins),
      cr: num(fd.currentRatio), qr: num(fd.quickRatio), de: de == null ? null : de / 100,
      epsY: eps && eps.length >= 2 && eps[eps.length - 2].v > 0 ? eps[eps.length - 1].v / eps[eps.length - 2].v - 1 : null,
      mcap: num(sd.marketCap) ?? num(x.price?.marketCap),
      pe: num(sd.trailingPE), fpe: num(ks.forwardPE), peg: peg ? peg : null,
      fy: eps && eps.length ? eps[eps.length - 1].d : null,
    };
    memoF.set(symbol, { t: Date.now(), v });
    return v;
  }
  return { code, missing: true };
}

export async function GET(req) {
  const u = new URL(req.url);
  const market = (u.searchParams.get('market') || 'ID').toUpperCase();
  const U = UNIVERSE[market];
  if (!U || market === 'CS') return json({ error: 'Sektor hanya tersedia untuk saham' }, 400);
  const codes = [...new Set((u.searchParams.get('codes') || '').toUpperCase().split(',').map((c) => c.replace(/[^A-Z0-9.\-]/g, '')).filter(Boolean))].slice(0, 12);
  if (!codes.length) return json({ error: 'Parameter codes kosong' }, 400);
  if (u.searchParams.get('mode') === 'fund') {
    const out = new Array(codes.length); let k = 0;
    const w = async () => { while (k < codes.length) { const i = k++; out[i] = await fundOne(codes[i], U.sfx).catch((e) => ({ code: codes[i], error: String(e.message || e) })); } };
    try { await getAuth(false); } catch (e) { return json({ error: 'Gagal terhubung ke sumber data: ' + e.message }, 502); }
    await Promise.all([w(), w(), w(), w()]);
    return json({ market, items: out }, 200, 43200);
  }
  try {
    const items = await Promise.all(codes.map((c) => one(c, U.sfx).catch(() => ({ code: c, sector: null, industry: null }))));
    return json({ market, items }, 200, 604800);
  } catch (err) {
    return json({ error: 'Gagal mengambil data sektor: ' + err.message }, 502);
  }
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=86400, s-maxage=${maxAge}, stale-while-revalidate=86400` : 'no-store' },
  });
}
