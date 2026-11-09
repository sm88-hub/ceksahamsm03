// Netlify Function: bahan peringkat kekuatan relatif (RS) per bursa.
// GET /api/rs?market=ID → skor kinerja tertimbang 12 bulan untuk saham-saham
// utama di bursa itu + indeksnya. Halaman memakai sebaran skor ini untuk
// menghitung RS 1–99 saham mana pun. Hasil disimpan 6 jam di Netlify Blobs
// supaya Yahoo tidak dipanggil berulang-ulang.
import { getStore } from '@netlify/blobs';

const TTL = 6 * 3600 * 1000;
export const UNIVERSE = {
  ID: { index: '^JKSE', sfx: ['.JK'], list: 'BBCA BBRI BMRI BBNI TLKM ASII UNVR ICBP INDF KLBF ADRO PTBA ITMG ANTM INCO MDKA PGAS UNTR CPIN AMRT GOTO BRIS SMGR INTP EXCL ISAT TOWR MEDC AKRA BBTN ARTO MAPI HRUM ACES TPIA' },
  US: { index: '^GSPC', sfx: [''], list: 'AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO AMD NFLX COST JPM V MA LLY UNH XOM WMT ORCL CRM ADBE INTC QCOM PEP KO DIS BA NKE PLTR UBER' },
  JP: { index: '^N225', sfx: ['.T'], list: '7203 6758 9984 8306 6861 9983 7974 8035 6098 4063 9432 8316 6501 7267 6367 4502 8058 8001 6954 7741 6902 4568 6273 8411 9433 6981 7751 4519 6702 8766' },
  KR: { index: '^KS11', sfx: ['.KS', '.KQ'], list: '005930 000660 373220 207940 005380 000270 035420 035720 051910 006400 068270 105560 055550 012330 028260 066570 003670 005490 032830 096770 017670 030200 034730 015760 086790 010130 009150 018260 011200 247540' },
  HK: { index: '^HSI', sfx: ['.HK'], list: '0700 9988 0005 1299 0941 3690 1810 2318 0388 0939 1398 3988 0883 0001 0016 0011 0002 0003 0027 1928 9618 9999 1211 2020 0669 2269 0175 0857 0386 0066' },
};

// Kinerja tertimbang ala peringkat RS: 3 bulan terakhir dihitung dua kali lipat.
export function rsWeighted(closes) {
  const n = closes.length, c = closes[n - 1];
  let s = 0, w = 0;
  for (const [k, wt] of [[63, 0.4], [126, 0.2], [189, 0.2], [252, 0.2]]) {
    if (n > k && closes[n - 1 - k] > 0) { s += (c / closes[n - 1 - k] - 1) * wt; w += wt; }
  }
  return w >= 0.4 ? s / w : null;
}

async function closesOf(symbol, fetchImpl = fetch) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
  const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SM-Crestboard)' } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const q = j?.chart?.result?.[0]?.indicators?.quote?.[0];
  return q?.close ? q.close.filter((x) => x != null && x > 0) : null;
}

export async function compute(market, fetchImpl = fetch) {
  const u = UNIVERSE[market], codes = u.list.split(' '), scores = {};
  let i = 0;
  async function worker() {
    while (i < codes.length) {
      const code = codes[i++];
      for (const s of u.sfx) {
        const cl = await closesOf(code + s, fetchImpl).catch(() => null);
        if (cl && cl.length > 70) { const v = rsWeighted(cl); if (v != null) scores[code] = +v.toFixed(5); break; }
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const ic = await closesOf(u.index, fetchImpl).catch(() => null);
  return { market, updated: Date.now(), index: ic ? rsWeighted(ic) : null, scores };
}

export default async (req) => {
  const market = (new URL(req.url).searchParams.get('market') || '').toUpperCase();
  if (!UNIVERSE[market]) return json({ error: 'Bursa tidak dikenal' }, 400);
  let store = null, cached = null;
  try { store = getStore({ name: 'rs', consistency: 'strong' }); cached = await store.get(market, { type: 'json' }); } catch { store = null; }
  if (cached && Date.now() - cached.updated < TTL && Object.keys(cached.scores || {}).length >= 10) return json(cached);
  const fresh = await compute(market);
  if (Object.keys(fresh.scores).length < 10) return cached ? json(cached) : json({ error: 'Data belum cukup' }, 503);
  if (store) await store.setJSON(market, fresh).catch(() => {});
  return json(fresh);
};

function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=1800' : 'no-store' },
  });
}

export const config = { path: '/api/rs' };
