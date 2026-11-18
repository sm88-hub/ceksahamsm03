// Vercel Function: penghapusan akun SM-Crestboard oleh pemilik akun sendiri.
// Dipanggil dari menu akun: POST /api/delete-account  (header Authorization: Bearer <Firebase ID token>)
//
// Urutan:
//   1. Verifikasi ID token dan pastikan pengguna baru saja masuk ulang (maks. 10 menit).
//   2. Hapus data Crestboard: dokumen users/{uid} dan seluruh catatan access_log miliknya.
//   3. Hapus akun login (Firebase Authentication).
//   4. Kirim email konfirmasi ke pengguna, lalu laporan ke admin (smcrestboard@gmail.com).
//
// Variabel lingkungan yang wajib diisi di Vercel (Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  isi JSON kunci service account Firebase (satu baris)
//   GMAIL_USER                smcrestboard@gmail.com
//   GMAIL_APP_PASSWORD        App Password 16 karakter dari akun Google tersebut

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

const ADMIN_EMAIL = 'smcrestboard@gmail.com';
const MAX_AUTH_AGE = 10 * 60; // detik sejak login ulang

function admin() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT belum diatur');
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(sa) });
  }
  return { auth: getAuth(), db: getFirestore() };
}

const wib = (d) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Asia/Jakarta' }).format(d);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function userMail({ email, name, when, ref }) {
  const hi = name ? `Yth. ${name},` : 'Yth. Pengguna SM-Crestboard,';
  const text = `${hi}

Melalui surat elektronik ini kami mengonfirmasi bahwa permintaan penghapusan akun yang Anda ajukan sendiri melalui menu akun SM-Crestboard telah selesai diproses.

Rincian
- Akun        : ${email}
- Waktu       : ${when}
- Nomor rujukan: ${ref}

Data yang telah dihapus secara permanen dari sistem SM-Crestboard:
1. Akun login (Firebase Authentication) yang terhubung dengan alamat email di atas.
2. Profil akun, yaitu nama panggilan dan avatar.
3. Watchlist, jurnal trading, modal jurnal, daftar aturan checklist, dan catatan pribadi.
4. Catatan riwayat akses (waktu, halaman, dan jenis perangkat).

Data yang tersimpan di browser perangkat yang Anda gunakan saat menghapus akun turut dibersihkan. Data di browser atau perangkat lain yang pernah Anda gunakan tidak dapat kami jangkau; Anda dapat menghapusnya melalui pengaturan browser masing-masing.

Pengelola tidak lagi menyimpan, memproses, maupun membagikan data pribadi Anda dalam bentuk apa pun, kecuali salinan surat elektronik konfirmasi ini, yang disimpan semata-mata sebagai bukti telah dipenuhinya permintaan Anda sebagaimana dimungkinkan oleh Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi. Data yang telah dihapus tidak dapat dipulihkan.

Apabila Anda tidak merasa mengajukan permintaan ini, atau memiliki pertanyaan, silakan membalas surat elektronik ini atau menghubungi ${ADMIN_EMAIL} dengan menyertakan nomor rujukan di atas.

Terima kasih telah menggunakan SM-Crestboard.

Hormat kami,
Pengelola SM-Crestboard
${ADMIN_EMAIL}

Surat elektronik ini dikirim secara otomatis.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:620px">
${text.split('\n\n').map((p) => p.startsWith('Rincian') || p.startsWith('Data yang telah dihapus')
    ? `<p>${p.split('\n').map(esc).join('<br>')}</p>`
    : `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
</div>`;
  return { text, html };
}

export async function POST(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!m) return json({ error: 'Token tidak ditemukan' }, 401);

  let A;
  try { A = admin(); } catch (e) { return json({ error: 'Server belum dikonfigurasi: ' + e.message }, 500); }

  let tok;
  try { tok = await A.auth.verifyIdToken(m[1], true); }
  catch { return json({ error: 'Sesi tidak valid. Silakan masuk ulang lalu coba lagi.' }, 401); }
  if (!tok.auth_time || Date.now() / 1000 - tok.auth_time > MAX_AUTH_AGE) {
    return json({ error: 'reauth', detail: 'Demi keamanan, masuk ulang terlebih dahulu sebelum menghapus akun.' }, 403);
  }

  const uid = tok.uid;
  let email = tok.email || null, name = '';
  try { const u = await A.auth.getUser(uid); email = u.email || email; name = (u.displayName || '').split(' ')[0]; } catch {}
  try { const d = await A.db.doc(`users/${uid}`).get(); if (d.exists && d.data().nick) name = d.data().nick; } catch {}

  const when = new Date(), ref = 'SMCB-' + when.getTime().toString(36).toUpperCase() + '-' + uid.slice(0, 4).toUpperCase();
  const done = { profile: false, logs: 0, auth: false };

  try {
    // 1) data Crestboard
    await A.db.recursiveDelete(A.db.doc(`users/${uid}`));
    done.profile = true;
    const qs = [A.db.collection('access_log').where('uid', '==', uid)];
    if (email) qs.push(A.db.collection('access_log').where('email', '==', email));
    for (const q of qs) {
      for (;;) {
        const snap = await q.limit(400).get();
        if (snap.empty) break;
        const b = A.db.batch(); snap.docs.forEach((d) => b.delete(d.ref)); await b.commit();
        done.logs += snap.size;
      }
    }
    // 2) akun login
    await A.auth.deleteUser(uid);
    done.auth = true;
  } catch (e) {
    console.error('[delete-account] gagal', e);
    return json({ error: 'Penghapusan belum selesai. Silakan coba lagi atau hubungi ' + ADMIN_EMAIL + '.', done }, 500);
  }

  // 3) email konfirmasi
  let sent = null, adminSent = false;
  if (email && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    const tx = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    const mail = userMail({ email, name, when: wib(when), ref });
    try {
      const info = await tx.sendMail({
        from: `"SM-Crestboard" <${process.env.GMAIL_USER}>`, to: email, replyTo: ADMIN_EMAIL,
        subject: `Konfirmasi Penghapusan Akun SM-Crestboard (${ref})`, text: mail.text, html: mail.html,
      });
      sent = { accepted: info.accepted || [], rejected: info.rejected || [], response: info.response || '', messageId: info.messageId || '' };
    } catch (e) { sent = { error: String(e.message || e) }; }
    try {
      const ok = sent && !sent.error && sent.accepted.length;
      await tx.sendMail({
        from: `"SM-Crestboard (sistem)" <${process.env.GMAIL_USER}>`, to: ADMIN_EMAIL,
        subject: `[Admin] Akun dihapus: ${email} · ${ok ? 'konfirmasi TERKIRIM' : 'konfirmasi GAGAL'} (${ref})`,
        text: `Laporan otomatis penghapusan akun SM-Crestboard

Akun           : ${email}
UID            : ${uid}
Waktu          : ${wib(when)}
Nomor rujukan  : ${ref}

Yang dihapus
- Profil & data Ruang Pribadi (users/${uid}) : ${done.profile ? 'ya' : 'tidak'}
- Catatan riwayat akses                     : ${done.logs} catatan
- Akun login Firebase Authentication        : ${done.auth ? 'ya' : 'tidak'}

Email konfirmasi ke pengguna
- Status        : ${ok ? 'DITERIMA server email Gmail untuk dikirim' : 'GAGAL'}
- Diterima oleh : ${sent?.accepted?.join(', ') || '-'}
- Ditolak       : ${sent?.rejected?.join(', ') || '-'}
- Respons server: ${sent?.response || sent?.error || '-'}
- Message-ID    : ${sent?.messageId || '-'}

Catatan: "diterima server email" berarti email telah diserahkan ke Gmail untuk dikirim ke alamat pengguna. Bukti pengirimannya juga tersimpan di folder "Terkirim" akun ${ADMIN_EMAIL}. Sistem email tidak dapat memastikan pengguna telah membuka atau membacanya.
${ok ? '' : '\nTINDAKAN: kirim ulang konfirmasi secara manual ke alamat di atas dengan nomor rujukan yang sama.'}`,
      });
      adminSent = true;
    } catch (e) { console.error('[delete-account] laporan admin gagal', e); }
  }

  return json({ ok: true, ref, emailSent: !!(sent && !sent.error && sent.accepted?.length), adminSent, done });
}

export async function GET() { return json({ error: 'Gunakan POST' }, 405); }

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
