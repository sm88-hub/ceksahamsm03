// Vercel Function: aliran dana asing harian per saham di BEI, beberapa hari terakhir.
// Dipanggil halaman lewat: /api/foreign?days=5
//
// Sumber: Ringkasan Saham di situs resmi BEI (idx.co.id), kolom ForeignBuy dan
// ForeignSell (dalam lembar saham). Nilai bersih dihitung dengan harga penutupan
// hari tersebut, sehingga merupakan perkiraan. Situs BEI dapat sewaktu-waktu
// membatasi akses otomatis; bila itu terjadi, fungsi ini mengembalikan galat.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://www.idx.co.id/primary/TradingSummary/GetStockSummary';
const dayMemo = new Map(); // 'YYYYMMDD' → { t, rows }

function ymdWIB(d) { return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); }

async function fetchDay(ymd, isToday) {
  const hit = dayMemo.get(ymd), ttl = isToday ? 20 * 60e3 : 24 * 3600e3;
  if (hit && Date.now() - hit.t < ttl) return hit.rows;
  const r = await fetch(`${BASE}?length=9999&start=0&date=${ymd}`, {
    headers: {
      'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      'Referer': 'https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/', 'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!r.ok) { const e = new Error('BEI ' + r.status); e.status = r.status; throw e; }
  const j = await r.json().catch(() => null);
  if (!j || !Array.isArray(j.data)) { const e = new Error('Format data BEI tidak dikenali'); e.status = 502; throw e; }
  const rows = j.data.filter((x) => x && x.StockCode).map((x) => ({
    c: String(x.StockCode).trim(), n: x.StockName || '', p: +x.Previous || 0, cl: +x.Close || 0,
    v: +x.Volume || 0, val: +x.Value || 0, fb: +x.ForeignBuy || 0, fs: +x.ForeignSell || 0,
  }));
  const traded = rows.some((x) => x.v > 0);
  const out = traded ? rows : [];
  dayMemo.set(ymd, { t: Date.now(), rows: out });
  return out;
}

export async function GET(req) {
  const u = new URL(req.url);
  const days = Math.min(10, Math.max(1, +(u.searchParams.get('days') || 5)));
  const dates = [], perDay = [];
  const now = new Date(), todayYmd = ymdWIB(now);
  try {
    for (let back = 0; back < 16 && dates.length < days; back++) {
      const d = new Date(now.getTime() - back * 864e5), ymd = ymdWIB(d);
      const wd = new Date(ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6) + 'T00:00:00Z').getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const rows = await fetchDay(ymd, ymd === todayYmd);
      if (rows.length) { dates.push(ymd); perDay.push(rows); }
    }
  } catch (e) {
    return json({ error: e.status === 403 || e.status === 401 ? 'blocked' : 'unavailable', detail: e.message }, 502);
  }
  if (!dates.length) return json({ error: 'empty' }, 502);
  // perDay[0] = hari terbaru
  const agg = new Map();
  perDay.slice().reverse().forEach((rows, i) => {
    for (const x of rows) {
      let a = agg.get(x.c);
      if (!a) { a = { c: x.c, n: x.n, nv: 0, nl: 0, bd: 0, sd: 0, val: 0, fval: 0, first: x.p || x.cl, last: x.cl, k: 0 }; agg.set(x.c, a); }
      const net = x.fb - x.fs;
      a.nl += net; a.nv += net * x.cl; a.val += x.val; a.fval += (x.fb + x.fs) * x.cl; a.k++;
      if (net > 0) a.bd++; else if (net < 0) a.sd++;
      if (x.cl > 0) a.last = x.cl;
      a.n = x.n || a.n;
    }
  });
  const stocks = [...agg.values()].filter((a) => a.val > 0).map((a) => ({
    c: a.c, n: a.n, nv: Math.round(a.nv), nl: Math.round(a.nl), bd: a.bd, sd: a.sd,
    av: Math.round(a.val / Math.max(1, a.k)), fs: a.val ? +(a.fval / (2 * a.val)).toFixed(3) : 0,
    ch: a.first > 0 ? +((a.last / a.first - 1) * 100).toFixed(2) : null, px: a.last,
  }));
  const fmt = (y) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6)}`;
  return json({ days: dates.length, dates: dates.map(fmt).reverse(), at: new Date().toISOString(), stocks }, 200, 1800);
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=600, s-maxage=${maxAge}, stale-while-revalidate=1800` : 'no-store' },
  });
}
