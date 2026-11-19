// SM-Crestboard: sumber data utama + cadangan.
// File berawalan "_" tidak dijadikan Vercel Function, jadi tidak menambah jumlah fungsi.
//
// Urutan sumber untuk data harga (/api/chart):
//   1. Yahoo Finance, server query1
//   2. Yahoo Finance, server query2 (sumber sama, server lain; dipakai saat query1 gangguan/membatasi)
//   3. Cadangan khusus jenis aset:
//      - Kurs (XXXIDR=X, IDR=X, EURUSD=X, dst.): kurs referensi bank sentral via Frankfurter
//        (api.frankfurter.dev, gratis termasuk untuk penggunaan komersial; data ECB bersifat informasi).
//      - Kripto spot (BTC-USD, dst.): harga pasar dari API publik Hyperliquid (sama dengan /api/perp).
//      - Saham, indeks, emas/perak: belum ada sumber gratis yang izinnya jelas → tidak memakai sumber lain;
//        browser memakai salinan terakhir (service worker) dan menampilkan pemberitahuan gangguan.
// Setiap jawaban cadangan diberi meta.dataSource supaya halaman bisa mencantumkan sumbernya.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const RETRY = (s) => s === 429 || s >= 500;

/** fetch ke Yahoo dengan cadangan server query2 bila query1 gagal/dibatasi. */
export async function yfetch(url, opt = {}) {
  const urls = [url];
  if (url.includes('://query1.finance.yahoo.com')) urls.push(url.replace('://query1.', '://query2.'));
  let last;
  for (const u of urls) {
    try {
      const r = await fetch(u, { ...opt, headers: { 'User-Agent': UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || 8000) });
      if (!RETRY(r.status)) return r;
      last = r;
    } catch (e) { last = e; }
  }
  if (last instanceof Response) return last;
  throw last || new Error('Yahoo tidak dapat dihubungi');
}

const DAYS = { '1d': 7, '5d': 10, '1mo': 31, '3mo': 93, '6mo': 186, '1y': 366, '2y': 731, '5y': 1827 };
const iso = (d) => new Date(d).toISOString().slice(0, 10);

function chartOf(symbol, rows, meta) {
  // rows: [{t (detik), o,h,l,c,v}]
  return {
    chart: {
      result: [{
        meta: { symbol, currency: meta.currency, exchangeName: meta.exchangeName, regularMarketPrice: rows.length ? rows[rows.length - 1].c : null,
          regularMarketTime: rows.length ? rows[rows.length - 1].t : null, dataSource: meta.dataSource, dataSourceUrl: meta.dataSourceUrl, dataNote: meta.dataNote },
        timestamp: rows.map((r) => r.t),
        indicators: { quote: [{ open: rows.map((r) => r.o), high: rows.map((r) => r.h), low: rows.map((r) => r.l), close: rows.map((r) => r.c), volume: rows.map((r) => r.v || 0) }] },
      }],
      error: null,
    },
  };
}

/** Kurs harian referensi bank sentral (ECB dkk.) via Frankfurter. Hanya data harian. */
export async function fxBackup(symbol, range) {
  const m = /^([A-Z]{3})?([A-Z]{3})=X$/.exec(symbol);
  if (!m) return null;
  const base = m[1] || 'USD', quote = m[2];
  const end = Date.now(), start = end - (DAYS[range] || 31) * 864e5;
  const r = await fetch(`https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=${base}&symbols=${quote}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json();
  const rows = Object.entries(j.rates || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([d, v]) => { const c = v[quote]; return { t: Math.floor(Date.parse(d + 'T15:00:00Z') / 1000), o: c, h: c, l: c, c, v: 0 }; })
    .filter((x) => x.c > 0);
  if (!rows.length) return null;
  return chartOf(symbol, rows, { currency: quote, exchangeName: 'ECB', dataSource: 'Kurs referensi bank sentral (ECB) via Frankfurter', dataSourceUrl: 'https://frankfurter.dev', dataNote: 'Kurs harian, diperbarui sekali per hari kerja.' });
}

/** Harga kripto dari API publik Hyperliquid (dipakai bila Yahoo gagal untuk simbol XXX-USD). */
export async function cryptoBackup(symbol, range, interval) {
  const m = /^([A-Z0-9]{2,12})-USDT?$/.exec(symbol);
  if (!m) return null;
  const iv = ['5m', '15m', '1h', '1d'].includes(interval) ? interval : '1d';
  const end = Date.now(), start = end - (DAYS[range] || 366) * 864e5;
  const post = (body) => fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const r = await post({ type: 'candleSnapshot', req: { coin: m[1], interval: iv, startTime: start, endTime: end } });
  if (!r.ok) return null;
  const k = await r.json();
  if (!Array.isArray(k) || !k.length) return null;
  const rows = k.map((x) => ({ t: Math.floor(x.t / 1000), o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v * +x.c }));
  return chartOf(symbol, rows, { currency: 'USD', exchangeName: 'Hyperliquid', dataSource: 'Hyperliquid (API publik)', dataSourceUrl: 'https://hyperliquid.xyz', dataNote: 'Harga pasar perpetual sebagai pengganti harga spot.' });
}
