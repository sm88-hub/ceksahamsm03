// Netlify Function: data fundamental (EPS, pendapatan, laba bersih, ekuitas) dari Yahoo Finance.
// Dipanggil oleh halaman lewat: /api/fundamentals?symbol=AAPL
// Endpoint Yahoo ini tidak resmi. Kalau Yahoo meminta "crumb", fungsi ini mengambilnya otomatis.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TYPES = [
  'quarterlyDilutedEPS', 'quarterlyBasicEPS', 'quarterlyTotalRevenue', 'quarterlyNetIncome', 'quarterlyStockholdersEquity',
  'annualDilutedEPS', 'annualBasicEPS', 'annualTotalRevenue', 'annualNetIncome', 'annualStockholdersEquity',
];

let auth = null; // { cookie, crumb, t } disimpan selama fungsi masih "hangat"

async function getAuth(force) {
  if (auth && !force && Date.now() - auth.t < 3600e3) return auth;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie') || ''];
  const cookie = raw.flatMap(c => c.split(/,(?=\s*[A-Za-z0-9_]+=)/)).map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, cookie } });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) throw new Error('Gagal mengambil crumb Yahoo');
  auth = { cookie, crumb, t: Date.now() };
  return auth;
}

async function fetchSeries(symbol, a) {
  const now = Math.floor(Date.now() / 1000), p1 = now - 6 * 365 * 86400;
  let url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}`
    + `?symbol=${encodeURIComponent(symbol)}&type=${TYPES.join(',')}&period1=${p1}&period2=${now}&merge=false&padTimeSeries=false`;
  const headers = { 'User-Agent': UA };
  if (a) { url += `&crumb=${encodeURIComponent(a.crumb)}`; headers.cookie = a.cookie; }
  const r = await fetch(url, { headers });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j };
}

export function normalize(symbol, j) {
  const out = { symbol, currency: null, q: {}, a: {} };
  const results = j?.timeseries?.result || [];
  for (const res of results) {
    const type = res?.meta?.type?.[0];
    const arr = type && res[type];
    if (!Array.isArray(arr)) continue;
    const pts = arr
      .filter(x => x && x.reportedValue && Number.isFinite(x.reportedValue.raw) && x.asOfDate)
      .map(x => ({ d: x.asOfDate, v: x.reportedValue.raw, cur: x.currencyCode }))
      .sort((a, b) => (a.d < b.d ? -1 : 1));
    if (!pts.length) continue;
    out.currency = out.currency || pts[pts.length - 1].cur || null;
    const key = type.replace(/^(quarterly|annual)/, '');
    (type.startsWith('quarterly') ? out.q : out.a)[key] = pts.map(({ d, v }) => ({ d, v }));
  }
  out.empty = !Object.keys(out.q).length && !Object.keys(out.a).length;
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  if (!symbol) return json({ error: 'Parameter symbol kosong' }, 400);
  try {
    let { status, j } = await fetchSeries(symbol, null);
    if (status === 401 || status === 403 || !j?.timeseries) {
      ({ status, j } = await fetchSeries(symbol, await getAuth(false)));
      if (status === 401 || status === 403 || !j?.timeseries) ({ status, j } = await fetchSeries(symbol, await getAuth(true)));
    }
    if (!j?.timeseries) return json({ error: 'Sumber data fundamental tidak merespons', status }, 502);
    return json(normalize(symbol, j), 200, 21600);
  } catch (err) {
    return json({ error: 'Gagal mengambil data fundamental: ' + err.message }, 502);
  }
};

function json(obj, status, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
  });
}

export const config = { path: '/api/fundamentals' };
