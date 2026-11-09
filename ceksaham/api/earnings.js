// Vercel Function: kalender laporan keuangan (earnings) per bursa untuk satu tahun.
// Dipanggil halaman lewat: /api/earnings?market=ID&year=2026
//
// Sumber utama: endpoint kalender earnings Yahoo Finance (dipakai halaman kalender
// Yahoo sendiri), berisi tanggal rilis lampau dan mendatang beserta EPS estimasi,
// EPS aktual, dan selisihnya. Bila endpoint itu tidak merespons, jadwal rilis
// berikutnya diambil dari data kuotasi Yahoo (earningsTimestamp).
// Keduanya tidak resmi; hasil disimpan 6 jam di CDN Vercel.

import { UNIVERSE } from './rs.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 6 * 3600 * 1000;
const memo = new Map();
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

// Peta simbol Yahoo → kode tampilan
function symbols(market) {
  const u = UNIVERSE[market];
  const map = new Map();
  for (const code of u.list.split(' ')) for (const s of u.sfx) map.set((code + s).toUpperCase(), code);
  return map;
}

function colIndex(cols, ...names) {
  for (const n of names) {
    const i = cols.findIndex((c) => [c?.id, c?.label].some((x) => String(x || '').toLowerCase() === n.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
function toISO(v) {
  if (v == null) return null;
  const d = typeof v === 'number' ? new Date(v > 1e12 ? v : v * 1000) : new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

async function fromCalendar(market, year, map) {
  const tickers = [...map.keys()];
  const body = {
    sortType: 'ASC', sortField: 'startdatetime', entityIdType: 'sp_earnings', offset: 0, size: 100,
    includeFields: ['ticker', 'companyshortname', 'startdatetime', 'startdatetimetype', 'epsestimate', 'epsactual', 'epssurprisepct', 'eventtype'],
    query: {
      operator: 'and',
      operands: [
        // EAD = jadwal rilis (mendatang), ERA = rilis yang sudah terjadi
        { operator: 'or', operands: [{ operator: 'eq', operands: ['eventtype', 'EAD'] }, { operator: 'eq', operands: ['eventtype', 'ERA'] }] },
        { operator: 'gte', operands: ['startdatetime', `${year}-01-01`] },
        { operator: 'lt', operands: ['startdatetime', `${year + 1}-01-01`] },
        { operator: 'or', operands: tickers.map((t) => ({ operator: 'eq', operands: ['ticker', t] })) },
      ],
    },
  };
  const call = async (a, offset) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/visualization?lang=en-US&region=US&crumb=${encodeURIComponent(a.crumb)}`, {
      method: 'POST', headers: { 'User-Agent': UA, cookie: a.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, offset }),
    });
    if (r.status === 401 || r.status === 403) return null;
    const j = await r.json().catch(() => null);
    const res = j?.finance?.result?.[0];
    return res?.documents?.[0] ? { doc: res.documents[0], total: +res.total || 0 } : null;
  };
  let a = await getAuth(false), page = await call(a, 0);
  if (!page) { a = await getAuth(true); page = await call(a, 0); }
  if (!page || !Array.isArray(page.doc.rows)) throw new Error('Kalender earnings tidak merespons');
  const doc = page.doc, rowsAll = [...doc.rows];
  // Yahoo membatasi 100 baris per permintaan
  for (let off = 100; off < Math.min(page.total, 500) && rowsAll.length >= off; off += 100) {
    const p = await call(a, off); if (!p || !p.doc.rows?.length) break; rowsAll.push(...p.doc.rows);
  }
  const c = doc.columns || [];
  const I = {
    t: colIndex(c, 'ticker', 'Symbol'), n: colIndex(c, 'companyshortname', 'Company'), d: colIndex(c, 'startdatetime', 'Event Start Date', 'Earnings Date'),
    tt: colIndex(c, 'startdatetimetype', 'Event Start Time'), e: colIndex(c, 'epsestimate', 'EPS Estimate'), a: colIndex(c, 'epsactual', 'Reported EPS'),
    s: colIndex(c, 'epssurprisepct', 'Surprise (%)', 'Surprise(%)'), ty: colIndex(c, 'eventtype', 'Event Type'),
  };
  const out = [];
  for (const r of rowsAll) {
    const sym = String(r[I.t] || '').toUpperCase(), code = map.get(sym), d = toISO(r[I.d]);
    if (!code || !d) continue;
    const nz = (v) => { const x = num(v); return x === 0 ? null : x; }; // Yahoo memakai 0 untuk data kosong
    out.push({ code, sym, name: r[I.n] || null, d, time: r[I.tt] || null, est: nz(r[I.e]), act: nz(r[I.a]), sur: nz(r[I.s]), type: I.ty >= 0 ? r[I.ty] : null });
  }
  // Jadwal (EAD) yang berdekatan dengan rilis aktual (ERA) dari emiten yang sama dianggap peristiwa yang sama
  return out.filter((e) => e.type !== 'EAD' || !out.some((x) => x.type === 'ERA' && x.code === e.code && Math.abs(new Date(x.d) - new Date(e.d)) < 21 * 864e5));
}

async function fromQuote(market, year, map) {
  const syms = [...map.keys()].join(',');
  const call = async (a) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}&crumb=${encodeURIComponent(a.crumb)}`, { headers: { 'User-Agent': UA, cookie: a.cookie } });
    if (r.status === 401 || r.status === 403) return null;
    return (await r.json().catch(() => null))?.quoteResponse?.result || null;
  };
  let res = await call(await getAuth(false));
  if (!res) res = await call(await getAuth(true));
  if (!res) throw new Error('Data kuotasi tidak merespons');
  const out = [], names = {};
  for (const q of res) {
    const code = map.get(String(q.symbol || '').toUpperCase()); if (!code) continue;
    names[code] = q.longName || q.shortName || null;
    const ts = [q.earningsTimestamp, q.earningsTimestampStart].filter((x) => Number.isFinite(x));
    for (const t of new Set(ts)) {
      const d = toISO(t); if (!d || +d.slice(0, 4) !== year) continue;
      out.push({ code, sym: q.symbol, name: names[code], d, time: null, est: null, act: null, sur: null, est_date: q.isEarningsDateEstimate ?? null, src: 'quote' });
    }
  }
  return { out, names };
}

export async function build(market, year) {
  const map = symbols(market);
  let events = [], names = {}, source = 'calendar', note = null;
  try { events = await fromCalendar(market, year, map); }
  catch (e) { note = e.message; source = 'quote'; }
  // Lengkapi nama & jadwal mendatang dari data kuotasi (juga sebagai cadangan)
  try {
    const q = await fromQuote(market, year, map); names = q.names;
    const now = Date.now();
    for (const e of q.out) {
      const dup = events.some((x) => x.code === e.code && Math.abs(new Date(x.d) - new Date(e.d)) < 4 * 864e5);
      if (!dup && (source === 'quote' || new Date(e.d) > now)) events.push(e);
    }
  } catch (e) { if (source === 'quote') throw e; }
  // satu kode per hari, utamakan baris yang punya data EPS
  const seen = new Map();
  for (const e of events) {
    const k = e.code + '|' + e.d.slice(0, 10), o = seen.get(k);
    if (!o || (o.act == null && e.act != null) || (o.est == null && e.est != null)) seen.set(k, { ...e, name: e.name || names[e.code] || null });
  }
  events = [...seen.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  for (const e of events) if (!names[e.code] && e.name) names[e.code] = e.name;
  return { market, year, source, note, at: new Date().toISOString(), count: events.length, events, names };
}

export async function GET(req) {
  const u = new URL(req.url);
  const market = (u.searchParams.get('market') || 'ID').toUpperCase();
  const year = Math.min(2100, Math.max(2000, +(u.searchParams.get('year') || new Date().getUTCFullYear())));
  if (!UNIVERSE[market] || market === 'CS') return json({ error: 'Kalender laporan keuangan hanya tersedia untuk bursa saham' }, 400);
  const key = market + year, hit = memo.get(key);
  if (hit && Date.now() - hit.t < TTL) return json(hit.v, 200, 21600);
  try {
    const v = await build(market, year);
    memo.set(key, { t: Date.now(), v });
    return json(v, 200, 21600);
  } catch (err) {
    return json({ error: 'Gagal mengambil kalender laporan keuangan: ' + err.message }, 502);
  }
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=1800, s-maxage=${maxAge}, stale-while-revalidate=3600` : 'no-store' },
  });
}
