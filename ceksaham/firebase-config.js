/* =====================================================================
   KONFIGURASI AKUN (Firebase)
   Isi dari Firebase Console → ⚙ Project settings → General →
   "Your apps" → aplikasi Web → "SDK setup and configuration" → Config.
   Biarkan apiKey kosong untuk mematikan fitur akun.

   Catatan keamanan: nilai di bawah ini memang publik (bukan rahasia).
   Yang menjaga data tiap pengguna adalah Firestore Security Rules.
   ===================================================================== */
window.SMCB_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};

/* true = pengunjung wajib masuk sebelum memakai situs.
   false = situs tetap terbuka; akun hanya untuk menyimpan watchlist & jurnal. */
window.SMCB_REQUIRE_LOGIN = false;
