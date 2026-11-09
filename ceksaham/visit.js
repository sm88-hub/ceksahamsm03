// Vercel Function: penghitung pengunjung SM-Crestboard.
// POST /api/visit dengan {d,m,y} = apakah browser ini belum tercatat hari ini / bulan ini / tahun ini.
// Tidak menyimpan IP atau data pribadi: hanya jumlah per periode dan kode negara.
// Butuh database Upstash Redis (Vercel → Storage). Tanpa itu, fungsi menjawab 503
// dan baris pengunjung di halaman otomatis disembunyikan.
const TZ = 'Asia/Jakarta';
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios/i;
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function periodKeys(now = new Date()) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { d, m: d.slice(0, 7), y: d.slice(0, 4) };
}
async function redis(cmds, fetchImpl = fetch) {
  const r = await fetchImpl(`${URL_}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return (await r.json()).map((x) => x.result);
}
const toObj = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = +arr[i + 1]; return o; };
const top = (c, n = 12) => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n);

export async function record(flags, cc, now = new Date(), run = redis) {
  const k = periodKeys(now), keys = { d: `v:d:${k.d}`, m: `v:m:${k.m}`, y: `v:y:${k.y}` }, ttl = { d: 400 * 86400, m: 800 * 86400, y: 3000 * 86400 };
  const cmds = [];
  for (const p of ['d', 'm', 'y']) if (flags[p]) cmds.push(['HINCRBY', keys[p], '_', 1], ['HINCRBY', keys[p], cc, 1], ['EXPIRE', keys[p], ttl[p]]);
  cmds.push(['HGETALL', keys.d], ['HGETALL', keys.m], ['HGETALL', keys.y]);
  const res = await run(cmds), [D, M, Y] = res.slice(-3).map(toObj);
  const strip = (o) => { const c = { ...o }; delete c._; return c; };
  const cm = strip(M), cy = strip(Y);
  return { period: k, today: D._ || 0, month: M._ || 0, year: Y._ || 0,
    countries: { month: top(cm), year: top(cy), monthTotal: Object.keys(cm).length, yearTotal: Object.keys(cy).length } };
}

async function handle(req) {
  if (!URL_ || !TOKEN) return json({ error: 'Penghitung belum aktif' }, 503);
  try {
    let flags = { d: false, m: false, y: false };
    const ua = req.headers.get('user-agent') || '';
    if (req.method === 'POST' && !BOTS.test(ua) && process.env.VERCEL_ENV !== 'preview') {
      const body = await req.json().catch(() => ({}));
      flags = { d: body.d === true, m: body.m === true, y: body.y === true };
    }
    const raw = (req.headers.get('x-vercel-ip-country') || '').toUpperCase();
    return json(await record(flags, /^[A-Z]{2}$/.test(raw) ? raw : 'XX'));
  } catch {
    return json({ error: 'Penghitung belum aktif' }, 503);
  }
}
export const GET = handle;
export const POST = handle;

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
