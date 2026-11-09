// Vercel Function: data kripto futures (perpetual) dari Hyperliquid.
// Dipakai halaman lewat:
//   /api/perp?symbol=BTC.PERP&range=2y&interval=1d   → format sama dengan /api/chart (Yahoo)
//   /api/perp?list=30                                 → koin futures dengan volume terbesar
// Hyperliquid dipakai karena API publiknya tidak memblokir server cloud
// (Binance Futures menolak permintaan dari banyak pusat data, termasuk Vercel).
const HL = 'https://api.hyperliquid.xyz/info';
const RANGE_DAYS = { '1d': 1, '5d': 5, '1mo': 31, '3mo': 93, '6mo': 186, '1y': 366, '2y': 731 };
const INTERVALS = new Set(['5m', '15m', '1h', '1d']);

async function hl(body, fetchImpl = fetch) {
  const r = await fetchImpl(HL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Hyperliquid ' + r.status);
  return r.json();
}

let metaCache = null;
export async function universe(fetchImpl = fetch) {
  if (metaCache && Date.now() - metaCache.t < 60e3) return metaCache.v;
  const [meta, ctx] = await hl({ type: 'metaAndAssetCtxs' }, fetchImpl);
  const v = meta.universe.map((u, i) => ({ coin: u.name, maxLev: u.maxLeverage, delisted: !!u.isDelisted, ctx: ctx[i] || {} }))
    .filter((x) => !x.delisted && x.ctx.markPx);
  metaCache = { t: Date.now(), v };
  return v;
}

export function toChart(coin, candles, ctx, maxLev) {
  const ts = [], o = [], h = [], l = [], c = [], v = [];
  for (const k of candles || []) { ts.push(Math.floor(k.t / 1000)); o.push(+k.o); h.push(+k.h); l.push(+k.l); c.push(+k.c); v.push(+k.v); }
  const mark = +ctx.markPx, fund = +ctx.funding, oi = +ctx.openInterest;
  return {
    chart: {
      result: [{
        meta: {
          symbol: coin + '.PERP', longName: `${coin} Perpetual · Hyperliquid`, currency: 'USD', exchangeName: 'Hyperliquid',
          perp: { funding: fund, fundingAnn: fund * 24 * 365, oi, oiUsd: oi * mark, markPx: mark, oraclePx: +ctx.oraclePx, premium: +ctx.premium, dayNtlVlm: +ctx.dayNtlVlm, maxLev },
        },
        timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] },
      }],
      error: null,
    },
  };
}

export async function GET(req) {
  const u = new URL(req.url);
  try {
    const list = u.searchParams.get('list');
    if (list) {
      const n = Math.min(60, Math.max(5, +list || 30));
      const L = (await universe()).map((x) => ({ coin: x.coin, price: +x.ctx.markPx, vol: +x.ctx.dayNtlVlm, funding: +x.ctx.funding, oiUsd: +x.ctx.openInterest * +x.ctx.markPx, maxLev: x.maxLev }))
        .sort((a, b) => b.vol - a.vol).slice(0, n);
      return json({ list: L }, 200, 120);
    }
    const raw = (u.searchParams.get('symbol') || '').replace(/\.PERP$/i, '').replace(/[^A-Za-z0-9]/g, '');
    const range = u.searchParams.get('range') || '1y', interval = u.searchParams.get('interval') || '1d';
    if (!raw || !RANGE_DAYS[range] || !INTERVALS.has(interval)) return json({ error: 'Parameter tidak valid' }, 400);
    const uni = await universe();
    const hit = uni.find((x) => x.coin.toUpperCase() === raw.toUpperCase()) || uni.find((x) => x.coin.toUpperCase() === 'K' + raw.toUpperCase());
    if (!hit) return json({ chart: { result: null, error: { code: 'Not Found', description: 'Koin tidak tersedia di pasar futures' } } }, 404);
    const end = Date.now(), start = end - RANGE_DAYS[range] * 864e5;
    const candles = await hl({ type: 'candleSnapshot', req: { coin: hit.coin, interval, startTime: start, endTime: end } });
    return json(toChart(hit.coin, candles, hit.ctx, hit.maxLev), 200, interval === '1d' ? 60 : 30);
  } catch (err) {
    return json({ error: 'Gagal mengambil data futures: ' + err.message }, 502);
  }
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=30` : 'no-store' },
  });
}
