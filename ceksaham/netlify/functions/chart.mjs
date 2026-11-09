// Netlify Function: perantara ke Yahoo Finance supaya browser tidak diblokir (CORS).
// Dipanggil oleh halaman lewat: /api/chart?symbol=BBCA.JK&range=1y&interval=1d

const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y']);
const INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '1d', '1wk']);

export default async (req) => {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9.^\-]/g, '');
  const range = url.searchParams.get('range') || '1y';
  const interval = url.searchParams.get('interval') || '1d';

  if (!symbol || !RANGES.has(range) || !INTERVALS.has(interval)) {
    return json({ error: 'Parameter tidak valid' }, 400);
  }

  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${range}&interval=${interval}&includePrePost=false`;

  try {
    const res = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (CekSaham)' } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // simpan di cache 60 detik supaya hemat kuota & cepat
        'cache-control': 'public, max-age=60',
      },
    });
  } catch (err) {
    return json({ error: 'Gagal menghubungi sumber data: ' + err.message }, 502);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const config = { path: '/api/chart' };
