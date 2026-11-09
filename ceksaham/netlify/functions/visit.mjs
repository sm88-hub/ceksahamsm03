// Netlify Function: penghitung pengunjung SM-Crestboard.
// Dipanggil halaman lewat POST /api/visit dengan {d,m,y} = apakah browser ini
// belum tercatat hari ini / bulan ini / tahun ini. Tidak menyimpan IP atau
// data pribadi: hanya jumlah per periode dan kode negara (dari Netlify geo).
import { getStore } from '@netlify/blobs';

const TZ = 'Asia/Jakarta';
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios/i;

export function periodKeys(now = new Date()) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { d, m: d.slice(0, 7), y: d.slice(0, 4) };
}

const top = (c = {}, n = 12) => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n);

export async function record(store, flags, cc, now = new Date()) {
  const k = periodKeys(now);
  const keys = { d: `d/${k.d}`, m: `m/${k.m}`, y: `y/${k.y}` };
  const docs = {};
  await Promise.all(['d', 'm', 'y'].map(async (p) => {
    const doc = (await store.get(keys[p], { type: 'json' })) || { n: 0, c: {} };
    if (flags[p]) {
      doc.n += 1;
      doc.c[cc] = (doc.c[cc] || 0) + 1;
      await store.setJSON(keys[p], doc);
    }
    docs[p] = doc;
  }));
  return {
    period: k,
    today: docs.d.n, month: docs.m.n, year: docs.y.n,
    countries: { month: top(docs.m.c), year: top(docs.y.c), monthTotal: Object.keys(docs.m.c).length, yearTotal: Object.keys(docs.y.c).length },
  };
}

export default async (req, context) => {
  try {
    const store = getStore({ name: 'visits', consistency: 'strong' });
    let flags = { d: false, m: false, y: false };
    const ua = req.headers.get('user-agent') || '';
    const prod = !context?.deploy?.context || context.deploy.context === 'production';
    if (req.method === 'POST' && prod && !BOTS.test(ua)) {
      const body = await req.json().catch(() => ({}));
      flags = { d: body.d === true, m: body.m === true, y: body.y === true };
    }
    const raw = (context?.geo?.country?.code || '').toUpperCase();
    const cc = /^[A-Z]{2}$/.test(raw) ? raw : 'XX';
    const out = await record(store, flags, cc);
    return new Response(JSON.stringify(out), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Penghitung belum aktif' }), {
      status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
};

export const config = { path: '/api/visit' };
