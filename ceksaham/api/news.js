// Vercel Function: berita terbaru untuk saham-saham di watchlist.
// Dipanggil halaman lewat: /api/news?l=ID~BBCA~Bank%20Central%20Asia,US~NVDA~NVIDIA
//
// Sumber: Google News RSS (publik). Saham BEI dicari dengan bahasa Indonesia,
// bursa lain dengan bahasa Inggris. "Nada" tiap judul ditentukan dari kata kunci
// sederhana, sehingga hanya gambaran kasar dan dapat keliru.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL = 30 * 60 * 1000;
const memo = new Map();

const POS = ['naik', 'melonjak', 'melesat', 'menguat', 'terbang', 'meroket', 'rekor', 'tertinggi', 'borong', 'akumulasi', 'buyback', 'dividen', 'laba naik', 'laba tumbuh', 'tumbuh', 'untung', 'cuan', 'inflow', 'net buy', 'top buy', 'upgrade', 'target harga naik', 'ekspansi', 'kontrak baru', 'akuisisi',
  'surge', 'soar', 'jump', 'rally', 'rallies', 'gain', 'gains', 'record', 'beat', 'beats', 'upgrade', 'upgraded', 'raise', 'raises', 'raised', 'bullish', 'outperform', 'buy rating', 'strong demand', 'growth', 'profit rises', 'tops estimates', 'skyrocket'];
const NEG = ['turun', 'anjlok', 'merosot', 'melemah', 'ambruk', 'jeblok', 'tertekan', 'longsor', 'terendah', 'rugi', 'merugi', 'dilepas', 'net sell', 'outflow', 'jual asing', 'gugatan', 'digugat', 'skandal', 'korupsi', 'suspensi', 'disuspensi', 'pkpu', 'pailit', 'gagal bayar', 'downgrade', 'diturunkan', 'phk', 'denda', 'sanksi', 'investigasi', 'diperiksa', 'tersangka', 'kasus',
  'plunge', 'plunges', 'slump', 'slumps', 'fall', 'falls', 'drop', 'drops', 'dive', 'dives', 'tumble', 'sink', 'miss', 'misses', 'downgrade', 'downgraded', 'cut', 'cuts', 'lawsuit', 'class action', 'probe', 'investigation', 'fraud', 'scandal', 'allegation', 'allegations', 'recall', 'bearish', 'sell-off', 'selloff', 'layoff', 'layoffs', 'fine', 'fined', 'warning', 'loss', 'losses', 'resign', 'resigns'];
const rx = (list) => new RegExp('(?:^|[^a-z])(' + list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=$|[^a-z])', 'gi');
const RX_POS = rx(POS), RX_NEG = rx(NEG);
function tone(title) {
  const t = ' ' + title.toLowerCase() + ' ';
  const p = (t.match(RX_POS) || []).length, n = (t.match(RX_NEG) || []).length;
  return p > n ? 1 : n > p ? -1 : 0;
}

const unesc = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function fetchOne(mk, code, name) {
  const key = `${mk}:${code}`, hit = memo.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const id = mk === 'ID';
  const crypto = mk === 'CS' || mk === 'CF';
  let q;
  if (id) q = `"${code}" saham`;
  else if (mk === 'US') q = `"${code}" stock`;
  else if (crypto) q = `${name && name !== code ? `"${name}"` : `"${code}"`} crypto`;
  else q = `${name && name !== code ? `"${name.replace(/\b(Inc|Corp|Co|Ltd|Holdings?|Group|Corporation|Company|Limited)\.?$/i, '').trim()}"` : `"${code}"`} stock`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:7d')}&${id ? 'hl=id&gl=ID&ceid=ID:id' : 'hl=en-US&gl=US&ceid=US:en'}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml,text/xml' } });
  if (!r.ok) throw new Error('RSS ' + r.status);
  const xml = await r.text();
  const seen = new Set(), items = [];
  for (const chunk of xml.split('<item>').slice(1)) {
    const get = (tag) => unesc((chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);
    const source = get('source');
    let title = get('title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const link = get('link'), at = Date.parse(get('pubDate'));
    if (!title || !link || !Number.isFinite(at)) continue;
    const k = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 60);
    if (seen.has(k)) continue; seen.add(k);
    items.push({ title, source, link, at, tone: tone(title) });
  }
  items.sort((a, b) => b.at - a.at);
  const top = items.slice(0, 8);
  const v = { mk, code, name: name || code, items: top, pos: top.filter((x) => x.tone > 0).length, neg: top.filter((x) => x.tone < 0).length };
  memo.set(key, { t: Date.now(), v });
  return v;
}

export async function GET(req) {
  const u = new URL(req.url);
  const list = (u.searchParams.get('l') || '').split(',').map((s) => s.split('~')).filter((p) => p.length >= 2)
    .map(([mk, code, name]) => ({ mk: String(mk).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2), code: String(code).toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12), name: String(name || '').replace(/["<>]/g, '').slice(0, 60) }))
    .filter((x) => x.mk && x.code).slice(0, 12);
  if (!list.length) return json({ error: 'Daftar saham kosong' }, 400);
  const out = await Promise.all(list.map((x) => fetchOne(x.mk, x.code, x.name).catch((e) => ({ mk: x.mk, code: x.code, name: x.name || x.code, items: [], error: e.message }))));
  return json({ at: new Date().toISOString(), stocks: out }, 200, 1800);
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=600, s-maxage=${maxAge}, stale-while-revalidate=900` : 'no-store' },
  });
}
