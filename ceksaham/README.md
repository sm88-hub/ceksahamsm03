# Cek Saham

Web app untuk cek OHLCV saham BEI, Buy Trigger / Stop Loss / Target, dan volume per sesi.

## Isi folder

```
public/index.html            ← seluruh tampilan + rumus (file yang paling sering diubah)
netlify/functions/chart.mjs  ← perantara data ke Yahoo Finance
netlify.toml                 ← pengaturan Netlify
```

## Cara online-kan (gratis, ±10 menit, tanpa coding)

1. Buat akun di **github.com**. Klik **New repository** dan beri nama `ceksaham`.
2. Di halaman repo baru, klik **uploading an existing file**. Ekstrak zip ini, lalu
   seret **isi** foldernya (`public`, `netlify`, `netlify.toml`, `README.md`) ke sana, lalu klik **Commit**.
3. Buat akun di **netlify.com** (login pakai GitHub). Klik **Add new site → Import an existing project → GitHub**,
   pilih repo `ceksaham`, lalu klik **Deploy**. Pengaturan lain biarkan kosong karena sudah dibaca dari `netlify.toml`.
4. Selesai. Netlify memberi alamat seperti `nama-acak.netlify.app`. Nama ini bisa diganti di
   **Site configuration → Change site name**.

## Cara mengubah kapan saja

Buka file di GitHub, klik ikon pensil (✏️), edit, lalu **Commit**. Netlify otomatis memperbarui situs dalam ±1 menit.

Yang paling sering diubah ada di bagian atas `<script>` di `public/index.html`:

| Ingin mengubah… | Ubah ini |
|---|---|
| Saham default saat dibuka | `defaultTicker` |
| Tombol saham cepat | `quickTickers` |
| Pengali range (0,4 di sheet) | `k` |
| Syarat volume (1,4× rata-rata 50 hari) | `volumeMultiplier`, `avgVolumeDays` |
| Jarak target | `minRewardRisk` |
| Interval auto-refresh | `refreshSeconds` |
| Rumus lengkap | fungsi `computePlan(ref)` |

Tip: bisa juga minta Claude, "ubah rumus Buy Trigger jadi …", lalu tempel file barunya ke GitHub.

## Catatan penting

- Data berasal dari API Yahoo Finance yang **tidak resmi** dan bisa tertunda ±15 menit.
  Kalau suatu hari Yahoo mengubah API-nya, cukup ganti `chart.mjs`.
- Bisa dibagikan langsung per saham, contoh: `situsmu.netlify.app/#TLKM`
- Bukan rekomendasi investasi.
