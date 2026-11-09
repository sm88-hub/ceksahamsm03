/* =====================================================================
   KONFIGURASI AKUN (Firebase)
   Isi dari Firebase Console → ⚙ Project settings → General →
   "Your apps" → aplikasi Web → "SDK setup and configuration" → Config.
   Biarkan apiKey kosong untuk mematikan fitur akun.

   Catatan keamanan: nilai di bawah ini memang publik (bukan rahasia).
   Yang menjaga data tiap pengguna adalah Firestore Security Rules.
   ===================================================================== */
window.SMCB_FIREBASE = {
  apiKey: "AIzaSyD_QlzdvkJ6jMO0UzmBGaUtzIn2L60sMwM",
  authDomain: "sm-crestboard.firebaseapp.com",
  projectId: "sm-crestboard",
  storageBucket: "sm-crestboard.firebasestorage.app",
  messagingSenderId: "805038034139",
  appId: "1:805038034139:web:482374e57bb8a9736410fe",
};

/* true = pengunjung wajib masuk sebelum memakai situs.
   false = situs tetap terbuka; akun hanya untuk menyimpan watchlist & jurnal. */
window.SMCB_REQUIRE_LOGIN = false;
