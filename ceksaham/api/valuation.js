// Vercel Function: rasio valuasi & kesehatan keuangan untuk 1–8 saham sekaligus.
// Dipanggil halaman lewat: /api/valuation?market=ID&codes=BBCA,TLKM
//
// Sumber: Yahoo Finance quoteSummary (tidak resmi). Beberapa emiten melaporkan
// keuangannya dalam mata uang lain (misalnya PTRO/ADRO dalam USD), sehingga
// nilai buku per saham dikonversi ke mata uang harga sebelum PBV dihitung.

import { UNIVERSE } from './rs.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 6 * 3600 * 1000;
const memo = new Map();   // symbol → { t, v }
const fxMemo = new Map(); // 'USDIDR' → { t, v }
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

const val = (x) => {
  const v = x && typeof x === 'object' ? x.raw : x;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

async function summary(symbol) {
  const go = async (a) => {
    const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=summaryDetail,defaultKeyStatistics,financialData,price&crumb=${encodeURIComponent(a.crumb)}`,
      { headers: { 'User-Agent': UA, cookie: a.cookie } });
    if (r.status === 401 || r.status === 403) return { retry: true };
    const j = await r.json().catch(() => null);
    return { res: j?.quoteSummary?.result?.[0] || null };
  };
  let out = await go(await getAuth(false));
  if (out.retry) out = await go(await getAuth(true));
  return out.res || null;
}

async function fxRate(from, to) {
  if (!from || !to || from === to) return 1;
  const k = from + to, hit = fxMemo.get(k);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${k}=X?range=5d&interval=1d`, { headers: { 'User-Agent': UA } });
  const j = await r.json().catch(() => null);
  const v = val(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
  if (!v) return null;
  fxMemo.set(k, { t: Date.now(), v });
  return v;
}

async function one(code, sfxList) {
  for (const sfx of sfxList) {
    const symbol = (code + sfx).toUpperCase();
    const hit = memo.get(symbol);
    if (hit && Date.now() - hit.t < TTL) return hit.v;
    const x = await summary(symbol);
    if (!x || !x.price) continue;
    const sd = x.summaryDetail || {}, ks = x.defaultKeyStatistics || {}, fd = x.financialData || {}, pr = x.price || {};
    const cur = pr.currency || sd.currency || null, fc = fd.financialCurrency || cur;
    const price = val(fd.currentPrice) ?? val(pr.regularMarketPrice);
    const eps = val(ks.trailingEps); // Yahoo sudah menyajikannya dalam mata uang harga
    const fx = fc && cur && fc !== cur ? await fxRate(fc, cur) : 1;
    let bvps = val(ks.bookValue); if (bvps != null) bvps = fx ? bvps * fx : null;
    const shares = val(ks.sharesOutstanding) ?? val(ks.impliedSharesOutstanding);
    const flt = val(ks.floatShares);
    const pe = val(sd.trailingPE) ?? (price && eps > 0 ? price / eps : null);
    const pb = price && bvps > 0 ? price / bvps : null;
    const derRaw = val(fd.debtToEquity);
    const v = {
      code, symbol, name: pr.longName || pr.shortName || code, cur, fc, price,
      pe: pe && pe > 0 && pe < 2000 ? pe : null,
      fpe: (() => { const f = val(sd.forwardPE); return f && f > 0 && f < 2000 ? f : null; })(),
      pb: pb && pb < 500 ? pb : null,
      roe: val(fd.returnOnEquity),
      der: derRaw != null ? derRaw / 100 : null,
      dy: val(sd.trailingAnnualDividendYield) ?? null,
      dps: val(sd.trailingAnnualDividendRate),
      payout: val(sd.payoutRatio),
      eps, feps: val(ks.forwardEps), bvps,
      margin: val(fd.profitMargins),
      float: shares && flt ? Math.min(1, flt / shares) : null,
      insiders: val(ks.heldPercentInsiders),
      mcap: val(sd.marketCap) ?? val(pr.marketCap),
      shares,
      exDiv: val(sd.exDividendDate),
      fxNote: fc && cur && fc !== cur ? `Laporan keuangan dalam ${fc}; nilai buku dikonversi ke ${cur}` : null,
    };
    memo.set(symbol, { t: Date.now(), v });
    return v;
  }
  return { code, error: 'Data tidak ditemukan' };
}

export async function GET(req) {
  const u = new URL(req.url);
  const market = (u.searchParams.get('market') || 'ID').toUpperCase();
  const U = UNIVERSE[market];
  if (!U || market === 'CS') return json({ error: 'Valuasi hanya tersedia untuk saham' }, 400);
  const codes = [...new Set((u.searchParams.get('codes') || '').toUpperCase().split(',').map((c) => c.replace(/[^A-Z0-9.\-]/g, '')).filter(Boolean))].slice(0, 8);
  if (!codes.length) return json({ error: 'Parameter codes kosong' }, 400);
  try {
    const items = await Promise.all(codes.map((c) => one(c, U.sfx).catch((e) => ({ code: c, error: e.message }))));
    return json({ market, at: new Date().toISOString(), items }, 200, 21600);
  } catch (err) {
    return json({ error: 'Gagal mengambil data valuasi: ' + err.message }, 502);
  }
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=1800, s-maxage=${maxAge}, stale-while-revalidate=3600` : 'no-store' },
  });
}
