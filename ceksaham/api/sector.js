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

async function profile(symbol) {
  const go = async (a) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile&crumb=${encodeURIComponent(a.crumb)}`,
      { headers: { 'User-Agent': UA, cookie: a.cookie } });
    if (r.status === 401 || r.status === 403) return { retry: true };
    const j = await r.json().catch(() => null);
    return { res: j?.quoteSummary?.result?.[0]?.assetProfile || null };
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

export async function GET(req) {
  const u = new URL(req.url);
  const market = (u.searchParams.get('market') || 'ID').toUpperCase();
  const U = UNIVERSE[market];
  if (!U || market === 'CS') return json({ error: 'Sektor hanya tersedia untuk saham' }, 400);
  const codes = [...new Set((u.searchParams.get('codes') || '').toUpperCase().split(',').map((c) => c.replace(/[^A-Z0-9.\-]/g, '')).filter(Boolean))].slice(0, 12);
  if (!codes.length) return json({ error: 'Parameter codes kosong' }, 400);
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
