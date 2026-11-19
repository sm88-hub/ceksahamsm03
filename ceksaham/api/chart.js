// Vercel Function: perantara ke Yahoo Finance supaya browser tidak diblokir (CORS).
// Bila Yahoo gangguan: server Yahoo cadangan, lalu sumber cadangan per jenis aset (lihat _sources.js).
import { yfetch, fxBackup, cryptoBackup } from './_sources.js';
// Dipanggil oleh halaman lewat: /api/chart?symbol=BBCA.JK&range=1y&interval=1d

const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y']);
const INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '1d', '1wk']);

export async function GET(req) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9.^=\-]/g, '');
  const range = url.searchParams.get('range') || '1y';
  const interval = url.searchParams.get('interval') || '1d';

  if (!symbol || !RANGES.has(range) || !INTERVALS.has(interval)) {
    return json({ error: 'Parameter tidak valid' }, 400);
  }

  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=${interval}&includePrePost=false`;

  let res = null, body = '';
  try {
    res = await yfetch(target);
    body = await res.text();
    if (res.ok) {
      if (interval === '1d') body = fillLastClose(body);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-data-source': 'yahoo',
          // simpan di cache 60 detik supaya hemat kuota & cepat
          'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=30',
        },
      });
    }
    // 404 dari Yahoo = kode memang tidak ada; jangan cari ke sumber lain
    if (res.status === 404) return new Response(body, { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch { /* lanjut ke cadangan */ }

  // Sumber cadangan (hanya yang izinnya jelas untuk ditampilkan)
  try {
    const alt = (await fxBackup(symbol, range)) || (await cryptoBackup(symbol, range, interval));
    if (alt) return new Response(JSON.stringify(alt), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-data-source': 'backup', 'cache-control': 'public, max-age=60, s-maxage=120' },
    });
  } catch { /* abaikan */ }
  return json({ error: 'Sumber data utama sedang gangguan. Coba lagi beberapa menit lagi.', down: true }, 503);
}

// Setelah bursa tutup, Yahoo kerap mengirim candle harian terakhir dengan close = null
// (open/high/low/volume sudah ada) hingga datanya difinalkan. Tanpa perbaikan ini,
// candle hari itu terbuang dan grafik tertinggal satu hari. Close diisi dari
// regularMarketPrice, yaitu harga penutupan resmi hari tersebut.
function fillLastClose(body) {
  try {
    const j = JSON.parse(body);
    const r = j?.chart?.result?.[0], ts = r?.timestamp, q = r?.indicators?.quote?.[0], m = r?.meta;
    if (!ts?.length || !q || !m) return body;
    const n = ts.length - 1, px = m.regularMarketPrice;
    if (q.close?.[n] != null || !(px > 0) || !(m.regularMarketTime >= ts[n])) return body;
    q.close[n] = px;
    if (q.open?.[n] == null) q.open[n] = px;
    if (q.high?.[n] == null) q.high[n] = Math.max(px, m.regularMarketDayHigh || px);
    if (q.low?.[n] == null) q.low[n] = Math.min(px, m.regularMarketDayLow || px);
    if (q.volume?.[n] == null && m.regularMarketVolume != null) q.volume[n] = m.regularMarketVolume;
    const adj = r.indicators.adjclose?.[0]?.adjclose; if (adj && adj[n] == null) adj[n] = px;
    return JSON.stringify(j);
  } catch { return body; }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

