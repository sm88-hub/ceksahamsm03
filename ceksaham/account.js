/* =====================================================================
   SM-Crestboard — akun pengguna (Firebase Auth + Firestore)
   - Masuk dengan Google atau email & password.
   - Data pribadi (watchlist, jurnal) disimpan di users/{uid} dan
     tersinkron otomatis antarperangkat.
   - Halaman berkomunikasi lewat event:
       smcb:auth  → { user, reason }    (masuk / keluar)
       smcb:data  → { data, first }     (data dari akun)
     dan memanggil window.SMCB_ACCOUNT.save({...}) untuk menyimpan.
   ===================================================================== */
(function(){
  const FB_VERSION = '13.2.0';
  const raw = window.SMCB_FIREBASE || {};
  const cfg = { apiKey:raw.apiKey, authDomain:raw.authDomain, projectId:raw.projectId, appId:raw.appId, storageBucket:raw.storageBucket, messagingSenderId:raw.messagingSenderId };
  const enabled = !!(cfg.apiKey && cfg.projectId);
  const required = enabled && window.SMCB_REQUIRE_LOGIN === true;
  const A = window.SMCB_ACCOUNT = { enabled, required, user:null, ready:false, save:()=>{}, open:()=>{}, signOut:()=>{} };
  const slot = document.getElementById('acct');
  if(!enabled){ if(slot) slot.hidden = true; return; }

  /* ---------- gaya ---------- */
  const css = `
  .acct{position:relative;display:inline-flex}
  .acct-btn{height:34px;display:inline-flex;align-items:center;gap:7px;border-radius:10px;border:1px solid var(--rule);background:var(--surface);cursor:pointer;color:var(--ink);font:700 12.5px 'Plus Jakarta Sans',sans-serif;padding:0 11px}
  .acct-btn:hover{border-color:var(--ink3)}
  .acct-av{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#C6F135;color:#0B1220;font:800 11.5px 'Plus Jakarta Sans',sans-serif;overflow:hidden;flex:none}
  .acct-av img{width:100%;height:100%;object-fit:cover}
  .acct-btn.in{padding:0 8px 0 5px}
  .acct-dot{width:7px;height:7px;border-radius:50%;background:#3FD18F;box-shadow:0 0 0 2px var(--surface)}
  .acct-dot.sync{background:#FFC83D;animation:acctBlink 1s infinite}
  @keyframes acctBlink{50%{opacity:.3}}
  .acct-menu{position:absolute;right:0;top:calc(100% + 8px);width:250px;background:var(--surface);border:1px solid var(--rule2);border-radius:14px;box-shadow:0 18px 40px rgba(2,15,41,.18);padding:12px;z-index:60;animation:acctIn .18s ease both}
  .acct-menu[hidden]{display:none}
  .acct-menu .who{display:flex;gap:10px;align-items:center;padding-bottom:10px;border-bottom:1px solid var(--rule);margin-bottom:8px;min-width:0}
  .acct-menu .who b{display:block;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .acct-menu .who span{display:block;font-size:12px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .acct-menu .who > div{min-width:0}
  .acct-menu .st{font-size:12px;color:var(--ink2);display:flex;align-items:center;gap:7px;padding:4px 2px 10px}
  .acct-menu button{width:100%;text-align:left;border:0;background:none;padding:9px 8px;border-radius:9px;font:700 13px 'Plus Jakarta Sans',sans-serif;color:var(--ink);cursor:pointer}
  .acct-menu button:hover{background:var(--sunk)}
  .acct-menu button.out{color:var(--down)}
  @media(max-width:1440px){.acct-btn .lbl{display:none}.acct-btn{padding:0;width:34px;justify-content:center}.acct-btn.in{width:auto;padding:0 6px}}
  .au{position:fixed;inset:0;z-index:150;display:grid;place-items:center;padding:18px;background:rgba(2,8,22,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);overflow-y:auto;animation:acctFade .25s ease both}
  .au[hidden]{display:none}
  @keyframes acctFade{from{opacity:0}}
  @keyframes acctIn{from{opacity:0;transform:translateY(8px)}}
  .au-card{position:relative;width:min(900px,100%);display:grid;grid-template-columns:1fr 1.05fr;border-radius:26px;overflow:hidden;background:var(--surface);box-shadow:0 30px 80px rgba(0,0,0,.4);animation:acctIn .4s cubic-bezier(.2,.8,.2,1) both;margin:auto}
  .au-side{position:relative;padding:38px 34px;color:#fff;background:radial-gradient(420px 260px at 0% 100%,rgba(198,241,53,.22),transparent 60%),linear-gradient(160deg,#0B1A3A,#020F29);display:flex;flex-direction:column;gap:20px;overflow:hidden}
  .au-side::after{content:'';position:absolute;right:-60px;top:-60px;width:220px;height:220px;border-radius:50%;border:1px solid rgba(198,241,53,.25);box-shadow:0 0 0 30px rgba(198,241,53,.04),0 0 0 60px rgba(198,241,53,.03)}
  .au-brand{display:flex;align-items:center;gap:10px;font:800 16px 'Montserrat','Plus Jakarta Sans',sans-serif}
  .au-brand img{width:34px;height:34px;border-radius:9px}
  .au-brand b{color:#C6F135}
  .au-side h2{font:800 34px/1.08 'Montserrat','Plus Jakarta Sans',sans-serif;letter-spacing:-.02em;margin:18px 0 0}
  .au-side p{margin:0;color:rgba(255,255,255,.72);font-size:14.5px;line-height:1.6}
  .au-pts{list-style:none;margin:auto 0 0;padding:18px 0 0;border-top:1px solid rgba(255,255,255,.12);display:grid;gap:12px}
  .au-pts li{display:flex;gap:11px;font-size:13.5px;color:rgba(255,255,255,.85);line-height:1.5}
  .au-pts i{flex:none;width:22px;height:22px;border-radius:7px;background:rgba(198,241,53,.16);color:#C6F135;display:grid;place-items:center;font-style:normal;font-weight:900;font-size:12px}
  .au-main{padding:34px 36px;display:flex;flex-direction:column;min-width:0}
  .au-x{position:absolute;right:14px;top:14px;width:34px;height:34px;border-radius:10px;border:0;background:var(--sunk);color:var(--ink2);cursor:pointer;font-size:16px;z-index:2}
  .au-tabs{display:grid;grid-template-columns:1fr 1fr;background:var(--sunk);border-radius:14px;padding:4px;margin-bottom:22px}
  .au-tabs button{border:0;background:none;padding:11px;border-radius:11px;font:700 14.5px 'Plus Jakarta Sans',sans-serif;color:var(--ink3);cursor:pointer}
  .au-tabs .on{background:var(--surface);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .au-main h3{font:800 23px 'Montserrat','Plus Jakarta Sans',sans-serif;margin:0 0 4px;letter-spacing:-.01em}
  .au-main .sub{margin:0 0 18px;color:var(--ink3);font-size:13.5px}
  .au-g{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:1px solid var(--rule2);background:var(--surface);border-radius:12px;padding:11px;font:700 14px 'Plus Jakarta Sans',sans-serif;color:var(--ink);cursor:pointer}
  .au-g:hover{border-color:var(--ink3)}
  .au-or{display:flex;align-items:center;gap:10px;color:var(--ink3);font-size:12px;margin:16px 0}
  .au-or::before,.au-or::after{content:'';flex:1;height:1px;background:var(--rule)}
  .au-f{display:grid;gap:12px}
  .au-f label{display:grid;gap:5px;font-size:13px;font-weight:700;color:var(--ink2)}
  .au-f input{border:1px solid var(--rule2);border-radius:12px;padding:12px 13px;font:600 14.5px 'Plus Jakarta Sans',sans-serif;background:var(--surface);color:var(--ink)}
  .au-f input:focus{outline:0;border-color:var(--ink);box-shadow:0 0 0 4px var(--acc-soft,rgba(198,241,53,.3))}
  .au-f [hidden]{display:none}
  .au-go{margin-top:4px;border:0;border-radius:12px;padding:13px;font:800 15px 'Plus Jakarta Sans',sans-serif;background:#020F29;color:#fff;cursor:pointer}
  [data-theme="dark"] .au-go{background:#C6F135;color:#0B1220}
  .au-go:disabled{opacity:.5;cursor:wait}
  .au-msg{min-height:18px;font-size:12.5px;font-weight:600;margin-top:10px}
  .au-msg.err{color:var(--down)}.au-msg.ok{color:var(--up)}
  .au-forgot{align-self:center;margin-top:8px;border:0;background:none;font:700 13px 'Plus Jakarta Sans',sans-serif;color:var(--ink);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
  .au-note{margin-top:auto;padding-top:14px;font-size:11.5px;color:var(--ink3);line-height:1.5}
  @media(max-width:760px){.au-card{grid-template-columns:1fr}.au-side{padding:24px 22px;gap:10px}.au-side h2{font-size:24px;margin-top:6px}.au-pts{display:none}.au-main{padding:24px 22px}}
  body.au-open{overflow:hidden}
  .acct-av svg{width:100%;height:100%;display:block}
  .acct-menu .hi{display:block;font-size:11.5px;font-weight:700;color:var(--up);letter-spacing:.02em}
  .acct-menu .who b{font-size:14.5px}
  .hi-toast{position:fixed;right:18px;top:calc(var(--barH,64px) + 14px);z-index:140;display:flex;align-items:flex-start;gap:13px;max-width:min(420px,calc(100vw - 28px));padding:13px 42px 13px 13px;border-radius:18px;color:#fff;
    background:radial-gradient(240px 120px at 0% 0%,rgba(198,241,53,.28),transparent 70%),linear-gradient(150deg,#13254A,#020F29);box-shadow:0 22px 50px -12px rgba(2,15,41,.55),inset 0 0 0 1px rgba(255,255,255,.08);
    animation:hiIn .55s cubic-bezier(.2,.9,.2,1.15) both}
  .hi-toast.out{animation:hiOut .35s ease forwards}
  @keyframes hiIn{from{opacity:0;transform:translateY(-14px) scale(.96)}}
  @keyframes hiOut{to{opacity:0;transform:translateY(-10px) scale(.97)}}
  .hi-toast .acct-av{width:46px;height:46px;font-size:18px;box-shadow:0 0 0 3px rgba(198,241,53,.35)}
  .hi-toast .hi-sum b{display:inline;font:700 12.5px 'Space Grotesk','Plus Jakarta Sans',sans-serif}
  .hi-toast small{display:block;font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#C6F135}
  .hi-toast .hi-txt > b{display:block;font:800 18px 'Space Grotesk','Plus Jakarta Sans',sans-serif;letter-spacing:-.01em;line-height:1.2}
  .hi-toast div > span{display:block;font-size:12.5px;color:rgba(255,255,255,.7);margin-top:2px}
  .hi-toast:hover .bar i{animation-play-state:paused}
  .hi-toast .hi-txt{min-width:0;flex:1}
  .hi-toast .hi-x{position:absolute;right:10px;top:10px;width:26px;height:26px;border:0;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;cursor:pointer}
  .hi-toast .bar{position:absolute;left:14px;right:14px;bottom:6px;height:2px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}
  .hi-toast .bar i{display:block;height:100%;background:#C6F135;animation:hiBar 6s linear forwards}
  @keyframes hiBar{from{width:100%}to{width:0}}
  @media(max-width:600px){.hi-toast{left:14px;right:14px;top:auto;bottom:16px;max-width:none}}
  .avp-card{position:relative;width:min(640px,100%);background:var(--surface);border-radius:24px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.4);animation:acctIn .35s cubic-bezier(.2,.8,.2,1) both}
  .avp-card h3{font:800 22px 'Space Grotesk','Plus Jakarta Sans',sans-serif;margin:0 0 4px;letter-spacing:-.01em}
  .avp-card > p{margin:0 0 16px;color:var(--ink3);font-size:13.5px}
  .avp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px;max-height:min(58vh,470px);overflow-y:auto;padding:3px}
  .avp-grid button{display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 6px 10px;border-radius:16px;border:1px solid var(--rule);background:var(--sunk);cursor:pointer;color:var(--ink2);font:700 12px 'Plus Jakarta Sans',sans-serif;transition:transform .2s,border-color .2s,box-shadow .2s}
  .avp-grid button:hover{transform:translateY(-3px);border-color:var(--ink3)}
  .avp-grid button .acct-av{width:58px;height:58px;font-size:22px;transition:transform .3s}
  .avp-grid button:hover .acct-av{transform:rotate(-6deg) scale(1.06)}
  .avp-grid button.on{border-color:#84CC16;box-shadow:0 0 0 3px rgba(132,204,22,.3);color:var(--ink);background:var(--surface)}
  .avp-nick{display:grid;gap:5px;margin:16px 0 0;font-size:13px;font-weight:700;color:var(--ink2)}
  .avp-nick input{border:1px solid var(--rule2);border-radius:12px;padding:11px 13px;font:600 14.5px 'Plus Jakarta Sans',sans-serif;background:var(--surface);color:var(--ink)}
  .avp-nick input:focus{outline:0;border-color:var(--ink);box-shadow:0 0 0 4px var(--acc-soft,rgba(198,241,53,.3))}
  .avp-act{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
  .avp-act button{border:0;border-radius:12px;padding:11px 18px;font:800 14px 'Plus Jakarta Sans',sans-serif;cursor:pointer}
  .avp-act .no{background:var(--sunk);color:var(--ink2)}
  .avp-act .ok{background:#020F29;color:#fff}
  [data-theme="dark"] .avp-act .ok{background:#C6F135;color:#0B1220}
`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

  /* ---------- tampilan ---------- */
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const wrap=document.createElement('div');
  wrap.innerHTML=`
  <div class="au" id="au" role="dialog" aria-modal="true" aria-labelledby="auT" hidden>
    <div class="au-card">
      ${required?'':'<button type="button" class="au-x" id="auX" aria-label="Tutup">✕</button>'}
      <aside class="au-side">
        <div class="au-brand"><img src="logo-mark.png" alt=""><span>SM-<b>Crestboard</b></span></div>
        <h2>Satu akun untuk seluruh analisis Anda.</h2>
        <p>Masuk untuk mengakses watchlist dan jurnal trading Anda secara tersinkron di setiap perangkat.</p>
        <ul class="au-pts">
          <li><i>✓</i><span>Watchlist, Price to Watch, dan jurnal trading tersimpan aman pada akun Anda.</span></li>
          <li><i>✓</i><span>Akses berkelanjutan dari perangkat mana pun tanpa pencadangan manual.</span></li>
          <li><i>✓</i><span>Data bersifat pribadi dan hanya dapat diakses oleh pemilik akun.</span></li>
        </ul>
      </aside>
      <section class="au-main">
        <div class="au-tabs" role="tablist"><button type="button" data-m="in" class="on">Masuk</button><button type="button" data-m="up">Buat Akun</button></div>
        <h3 id="auT">Selamat Datang</h3>
        <p class="sub" id="auSub">Silakan masuk untuk melanjutkan ke akun Anda.</p>
        <button type="button" class="au-g" id="auG"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg><span id="auGT">Masuk dengan Google</span></button>
        <div class="au-or">atau gunakan email</div>
        <form class="au-f" id="auF" novalidate>
          <label id="auNameL" hidden>Nama Lengkap<input id="auName" autocomplete="name" placeholder="Nama Anda"></label>
          <label>Alamat Email<input id="auEmail" type="email" autocomplete="email" placeholder="nama@domain.com" required></label>
          <label>Kata Sandi<input id="auPw" type="password" autocomplete="current-password" placeholder="Minimal 6 karakter" required></label>
          <button type="submit" class="au-go" id="auGo">Masuk</button>
        </form>
        <div class="au-msg" id="auMsg" role="status"></div>
        <button type="button" class="au-forgot" id="auForgot">Lupa kata sandi?</button>
        <p class="au-note">Dengan melanjutkan, Anda memahami bahwa seluruh informasi pada SM-Crestboard disediakan semata-mata untuk keperluan analisis dan bukan merupakan rekomendasi investasi.</p>
      </section>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
  const $=id=>document.getElementById(id);
  let mode='in';
  const setMode=m=>{ mode=m; document.querySelectorAll('.au-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
    $('auT').textContent = m==='in' ? 'Selamat Datang' : 'Buat Akun Baru';
    $('auSub').textContent = m==='in' ? 'Silakan masuk untuk melanjutkan ke akun Anda.' : 'Pendaftaran tidak dipungut biaya. Watchlist dan jurnal pada perangkat ini akan dipindahkan ke akun Anda.';
    $('auGo').textContent = m==='in' ? 'Masuk' : 'Buat Akun';
    $('auGT').textContent = m==='in' ? 'Masuk dengan Google' : 'Daftar dengan Google';
    $('auNameL').hidden = m==='in'; $('auPw').autocomplete = m==='in' ? 'current-password' : 'new-password';
    $('auForgot').hidden = m!=='in'; msg(''); };
  const msg=(t,kind='err')=>{ const e=$('auMsg'); e.textContent=t; e.className='au-msg '+(t?kind:''); };
  const openModal=(m='in')=>{ setMode(m); $('au').hidden=false; document.body.classList.add('au-open'); setTimeout(()=>$('auEmail').focus(),80); };
  const closeModal=()=>{ if(required && !A.user) return; $('au').hidden=true; document.body.classList.remove('au-open'); };
  A.open=openModal;
  document.querySelectorAll('.au-tabs button').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.m)));
  $('auX')?.addEventListener('click',closeModal);
  $('au').addEventListener('click',e=>{ if(e.target.id==='au') closeModal(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('au').hidden) closeModal(); });

  const ERR={ 'auth/invalid-credential':'Alamat email atau kata sandi tidak sesuai.', 'auth/wrong-password':'Alamat email atau kata sandi tidak sesuai.', 'auth/user-not-found':'Alamat email ini belum terdaftar.',
    'auth/email-already-in-use':'Alamat email ini telah terdaftar. Silakan masuk.', 'auth/weak-password':'Kata sandi minimal terdiri dari 6 karakter.', 'auth/invalid-email':'Format alamat email tidak valid.',
    'auth/missing-password':'Mohon isi kata sandi.', 'auth/too-many-requests':'Terlalu banyak percobaan. Silakan coba kembali dalam beberapa menit.', 'auth/network-request-failed':'Koneksi internet terganggu. Silakan coba kembali.',
    'auth/unauthorized-domain':'Domain situs ini belum diizinkan di Firebase (Authentication → Settings → Authorized domains).', 'auth/operation-not-allowed':'Metode masuk ini belum diaktifkan di Firebase Console.',
    'auth/popup-blocked':'Peramban memblokir jendela masuk. Mohon izinkan pop-up, lalu coba kembali.' };
  const errText=e=>ERR[e?.code] || 'Terjadi kendala: '+(e?.message||'silakan coba kembali.');


  /* ---------- avatar & sapaan ---------- */
  const AVS=[
    ['bull','Banteng','#15803D','#C6F135','<path d="M13 21c1 9 7 12 13 12M51 21c-1 9-7 12-13 12"/><path d="M24 31h16l-2.5 13a5.5 5.5 0 0 1-11 0z"/><circle cx="28.5" cy="44" r="1.3" fill="#fff"/><circle cx="35.5" cy="44" r="1.3" fill="#fff"/><path d="M27 36.5h.01M37 36.5h.01"/>'],
    ['bear','Beruang','#B91C1C','#FB923C','<circle cx="21" cy="22" r="5"/><circle cx="43" cy="22" r="5"/><circle cx="32" cy="35" r="13"/><ellipse cx="32" cy="40" rx="5.5" ry="4"/><path d="M27 31h.01M37 31h.01"/>'],
    ['rocket','Roket','#4338CA','#22D3EE','<path d="M32 10c8 6 10.5 16 8.5 27h-17C21.5 26 24 16 32 10z"/><circle cx="32" cy="24" r="3.5"/><path d="M23.5 33 17 42l7.5-1.5M40.5 33 47 42l-7.5-1.5"/><path d="M28.5 44 32 53l3.5-9"/>'],
    ['candle','Lilin','#0F766E','#34D399','<path d="M20 14v8M20 40v8M32 20v6M32 46v6M44 12v6M44 34v8"/><rect x="16" y="22" width="8" height="18" rx="2"/><rect x="28" y="26" width="8" height="20" rx="2"/><rect x="40" y="18" width="8" height="16" rx="2"/>'],
    ['gem','Berlian','#0369A1','#A78BFA','<path d="M19 25l6.5-9h13l6.5 9L32 48z"/><path d="M19 25h26M25.5 16 29 25l3 23M38.5 16 35 25l-3 23"/>'],
    ['eagle','Elang','#92400E','#FBBF24','<path d="M8 27c9-1 16 3 24 12 8-9 15-13 24-12-6 3-10 8-13 14l-11 6-11-6c-3-6-7-11-13-14z"/><path d="M32 39v-8M29 28l3-6 3 6"/>'],
    ['owl','Burung Hantu','#6D28D9','#F472B6','<path d="M18 18l5 6M46 18l-5 6"/><rect x="17" y="21" width="30" height="31" rx="15"/><circle cx="25.5" cy="32" r="5"/><circle cx="38.5" cy="32" r="5"/><path d="M30 39l2 3 2-3"/>'],
    ['whale','Paus','#1E3A8A','#38BDF8','<path d="M9 34c3 9 12 14 24 13 10-1 17-7 19-15-3 1.5-7 1.5-9-1-2 5-7 7-12 7-8 0-14-2-22-4z"/><path d="M52 32l5-6M52 32l6 2"/><path d="M27 23c0-4 2-7 2-10M27 19c-2-1-4-1-5 0M29 15c2-1 4-1 5 0"/><path d="M19 38h.01"/>'],
    ['gold','Emas','#A16207','#FDE047','<path d="M14 46l4-10h12l4 10zM30 46l4-10h12l4 10zM22 34l4-10h12l4 10z"/>'],
    ['compass','Kompas','#0F172A','#64748B','<circle cx="32" cy="32" r="18"/><path d="M38.5 25.5 35 35l-9.5 3.5L29 29z"/><path d="M32 10v4M32 50v4M10 32h4M50 32h4"/>'],
    ['crown','Mahkota','#9A3412','#FBBF24','<path d="M15 44l-3-21 11 9 9-14 9 14 11-9-3 21z"/><path d="M16 50h32"/><circle cx="32" cy="35" r="2.2" fill="#fff"/>'],
    ['bolt','Petir','#B45309','#EF4444','<path d="M36 9 18 36h12l-4 19 20-29H34z"/>'],
    ['trend','Tren Naik','#065F46','#A3E635','<path d="M12 50h40M12 50V14"/><path d="M18 42l9-10 7 6 13-15"/><path d="M40 23h7v7"/>'],
    ['shield','Perisai','#1D4ED8','#22D3EE','<path d="M32 10l17 6v12c0 12-7.5 21-17 26-9.5-5-17-14-17-26V16z"/><path d="M24.5 32l5.5 5.5 10-11"/>'],
    ['target','Sasaran','#BE123C','#FB7185','<circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="11"/><circle cx="32" cy="32" r="4"/><path d="M45 19l8-8M47 11h6v6"/>'],
    ['globe','Global','#155E75','#2DD4BF','<circle cx="32" cy="32" r="19"/><path d="M13 32h38M32 13c6 6 8 12 8 19s-2 13-8 19c-6-6-8-12-8-19s2-13 8-19z"/>'],
  ];
  const AVMAP=Object.fromEntries(AVS.map(a=>[a[0],a]));
  const avSVG=id=>{ const a=AVMAP[id]; if(!a) return ''; return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="avg-${a[0]}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a[2]}"/><stop offset="1" stop-color="${a[3]}"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#avg-${a[0]})"/><circle cx="32" cy="32" r="31" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${a[4]}</g></svg>`; };
  const prof={ avatar:null, nick:null };
  const profKey=u=>'smcb_prof_'+(u&&u.uid||'');
  function profLoad(u){ try{ const c=JSON.parse(localStorage.getItem(profKey(u))||'null'); prof.avatar=c&&c.avatar||null; prof.nick=c&&c.nick||null; }catch{ prof.avatar=prof.nick=null; } }
  function profStore(u){ try{ localStorage.setItem(profKey(u),JSON.stringify(prof)); }catch{} }
  function nameOf(u){
    if(prof.nick) return prof.nick;
    const d=(u&&u.displayName||'').trim(); if(d) return d.split(/\s+/)[0];
    const l=((u&&u.email)||'').split('@')[0].replace(/[._\-+]+/g,' ').replace(/\d+/g,' ').trim().split(/\s+/)[0]||'Investor';
    return l.charAt(0).toUpperCase()+l.slice(1).toLowerCase();
  }
  function greet(){ const h=new Date().getHours(); return h>=4&&h<11?'Selamat pagi':h>=11&&h<15?'Selamat siang':h>=15&&h<18?'Selamat sore':'Selamat malam'; }
  function avHTML(u,big){
    if(prof.avatar && AVMAP[prof.avatar]) return avSVG(prof.avatar);
    if(u&&u.photoURL && prof.avatar!=='initial') return `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`;
    return esc((nameOf(u).trim()[0]||'A').toUpperCase());
  }
  function hiToast(u){
    document.querySelector('.hi-toast')?.remove();
    const t=document.createElement('div'); t.className='hi-toast'; t.setAttribute('role','status');
    const hasSum=typeof window.SMCB_SUMMARY==='function';
    t.innerHTML=`<span class="acct-av">${avHTML(u)}</span><div class="hi-txt"><small>${greet()}</small><b>${esc(nameOf(u))} 👋</b><span>${hasSum?'Ringkasan hari ini untuk Anda:':'Watchlist dan jurnal Anda siap digunakan.'}</span>${hasSum?'<div class="hi-sum"><div class="ld">Menyiapkan ringkasan…</div></div>':''}</div><button type="button" class="hi-x" aria-label="Tutup">✕</button><div class="bar"><i style="animation-duration:${hasSum?14:6}s"></i></div>`;
    document.body.appendChild(t);
    let gone=false; const bye=()=>{ if(gone) return; gone=true; t.classList.add('out'); setTimeout(()=>t.remove(),360); };
    t.querySelector('.hi-x').onclick=bye;
    t.querySelector('.bar i').addEventListener('animationend',bye);
    if(hasSum){
      const box=t.querySelector('.hi-sum');
      Promise.resolve().then(()=>window.SMCB_SUMMARY()).then(items=>{
        if(gone) return;
        if(!items||!items.length){ box.hidden=true; return; }
        box.innerHTML=''; items.forEach(it=>{ const b=document.createElement('button'); b.type='button'; b.innerHTML=`<i>${it.ico||''}</i>${it.html}`; b.onclick=()=>{ try{ it.go&&it.go(); }catch{} bye(); }; box.appendChild(b); });
      }).catch(()=>{ box.hidden=true; });
    }
  }
  function openPicker(){
    const u=A.user; if(!u) return;
    document.getElementById('avp')?.remove();
    let pick=prof.avatar || (u.photoURL?'photo':'initial');
    const box=document.createElement('div'); box.className='au'; box.id='avp';
    const opts=[...(u.photoURL?[['photo','Foto Google']]:[]), ['initial','Inisial'], ...AVS.map(a=>[a[0],a[1]])];
    const face=id=> id==='photo'?`<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`: id==='initial'?esc((nameOf(u)[0]||'A').toUpperCase()) : avSVG(id);
    box.innerHTML=`<div class="avp-card" role="dialog" aria-modal="true" aria-labelledby="avpT"><button type="button" class="au-x" data-x aria-label="Tutup">✕</button>
      <h3 id="avpT">Pilih avatar Anda</h3><p>Avatar dan nama panggilan tersimpan di akun, sehingga ikut tampil di setiap perangkat.</p>
      <div class="avp-grid">${opts.map(([id,l])=>`<button type="button" data-av="${id}" class="${id===pick?'on':''}"><span class="acct-av">${face(id)}</span>${esc(l)}</button>`).join('')}</div>
      <label class="avp-nick">Nama panggilan <input id="avpNick" maxlength="24" placeholder="${esc(nameOf({...u}))}" value="${esc(prof.nick||'')}"></label>
      <div class="avp-act"><button type="button" class="no" data-x>Batal</button><button type="button" class="ok" id="avpOk">Simpan</button></div></div>`;
    document.body.appendChild(box); document.body.classList.add('au-open');
    const close=()=>{ box.remove(); if($('au').hidden) document.body.classList.remove('au-open'); };
    box.addEventListener('click',e=>{ if(e.target===box||e.target.closest('[data-x]')) close(); const b=e.target.closest('[data-av]'); if(b){ pick=b.dataset.av; box.querySelectorAll('[data-av]').forEach(x=>x.classList.toggle('on',x===b)); } });
    box.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });
    $('avpOk').onclick=()=>{
      prof.avatar = pick==='photo' ? null : pick;
      const n=$('avpNick').value.trim().replace(/\s+/g,' ').slice(0,24); prof.nick=n||null;
      profStore(u); A.save({ avatar:prof.avatar, nick:prof.nick }); renderSlot(); close();
    };
    setTimeout(()=>box.querySelector('.on')?.focus(),60);
  }

  /* ---------- tombol akun di header ---------- */
  let syncing=false;
  function renderSlot(){
    if(!slot) return;
    const u=A.user;
    if(!u){ slot.innerHTML=`<button type="button" class="acct-btn" id="acctIn" aria-label="Masuk"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span class="lbl">Masuk</span></button>`; $('acctIn').onclick=()=>openModal('in'); return; }
    const av=avHTML(u);
    slot.innerHTML=`<button type="button" class="acct-btn in" id="acctBtn" aria-haspopup="menu" aria-expanded="false" title="${greet()}, ${esc(nameOf(u))}"><span class="acct-av">${av}</span><span class="lbl">${esc(nameOf(u))}</span><i class="acct-dot ${syncing?'sync':''}" aria-hidden="true"></i></button>
      <div class="acct-menu" id="acctMenu" role="menu" hidden>
        <div class="who"><span class="acct-av" style="width:40px;height:40px;font-size:15px">${av}</span><div><span class="hi">${greet()},</span><b>${esc(nameOf(u))}</b><span>${esc(u.email||'')}</span></div></div>
        <div class="st"><i class="acct-dot ${syncing?'sync':''}"></i>${syncing?'Menyimpan perubahan…':'Watchlist dan jurnal telah tersinkron'}</div>
        <button type="button" id="acctAv" role="menuitem">Ganti avatar &amp; nama panggilan</button>
        <button type="button" class="out" id="acctOut" role="menuitem">Keluar dari akun</button>
      </div>`;
    const btn=$('acctBtn'), menu=$('acctMenu');
    btn.onclick=e=>{ e.stopPropagation(); menu.hidden=!menu.hidden; btn.setAttribute('aria-expanded',String(!menu.hidden)); };
    $('acctOut').onclick=()=>A.signOut();
    $('acctAv').onclick=()=>{ menu.hidden=true; openPicker(); };
  }
  document.addEventListener('click',e=>{ const m=$('acctMenu'); if(m && !m.hidden && !e.target.closest('.acct')) m.hidden=true; });
  if(slot){ slot.hidden=false; slot.innerHTML='<button type="button" class="acct-btn" disabled aria-label="Memuat akun"><span class="lbl">…</span></button>'; }

  /* ---------- Firebase ---------- */
  const base=`https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  Promise.all([import(base+'firebase-app.js'), import(base+'firebase-auth.js'), import(base+'firebase-firestore.js')]).then(([fa,fu,fs])=>{
    const app=fa.initializeApp(cfg), auth=fu.getAuth(app), db=fs.getFirestore(app);
    auth.languageCode='id';
    let unsub=null, first=true, timer=null, pending=null, reason='init';
    const fire=(n,d)=>document.dispatchEvent(new CustomEvent(n,{detail:d}));

    A.save=(partial)=>{
      if(!A.user) return;
      pending={...(pending||{}), ...partial};
      syncing=true; renderSlot();
      clearTimeout(timer);
      timer=setTimeout(async()=>{
        const data=pending; pending=null;
        try{ await fs.setDoc(fs.doc(db,'users',A.user.uid), {...JSON.parse(JSON.stringify(data)), email:A.user.email||null, updatedAt:fs.serverTimestamp()}, {merge:true}); }
        catch(e){ console.error('[SM-Crestboard] gagal menyimpan ke akun', e); }
        if(!pending){ syncing=false; renderSlot(); }
      },400);
    };
    A.signOut=async()=>{ reason='signout'; await fu.signOut(auth); };

    fu.onAuthStateChanged(auth,u=>{
      A.user=u; A.ready=true; if(u) profLoad(u); renderSlot();
      const wantHi = u && (reason==='signin' || (()=>{ try{ return sessionStorage.getItem('smcb_hi')!==u.uid; }catch{ return false; } })());
      if(unsub){ unsub(); unsub=null; }
      if(u){
        if(!$('au').hidden){ $('au').hidden=true; document.body.classList.remove('au-open'); }
        first=true;
        unsub=fs.onSnapshot(fs.doc(db,'users',u.uid), snap=>{
          if(snap.metadata.hasPendingWrites) return;
          const data=snap.exists()?snap.data():{};
          if(('avatar' in data) || ('nick' in data)){ prof.avatar=data.avatar||null; prof.nick=data.nick||null; profStore(u); renderSlot(); }
          if(first && wantHi){ hiToast(u); try{ sessionStorage.setItem('smcb_hi',u.uid); }catch{} }
          fire('smcb:data',{data, first}); first=false;
        }, err=>console.error('[SM-Crestboard] gagal membaca akun', err));
        fire('smcb:auth',{user:u, reason:reason==='init'?'restore':'signin'});
      } else {
        fire('smcb:auth',{user:null, reason});
        if(required) openModal('in');
      }
      reason='change';
    });

    $('auG').onclick=async()=>{
      msg(''); reason='signin';
      const p=new fu.GoogleAuthProvider(); p.setCustomParameters({prompt:'select_account'});
      try{ await fu.signInWithPopup(auth,p); }
      catch(e){ if(e?.code==='auth/popup-closed-by-user'||e?.code==='auth/cancelled-popup-request') return;
        if(e?.code==='auth/popup-blocked'){ try{ await fu.signInWithRedirect(auth,p); return; }catch(e2){ msg(errText(e2)); return; } }
        msg(errText(e)); }
    };
    $('auF').onsubmit=async e=>{
      e.preventDefault(); msg(''); reason='signin';
      const email=$('auEmail').value.trim(), pw=$('auPw').value, go=$('auGo');
      if(!email){ msg('Mohon isi alamat email.'); return; } if(pw.length<6){ msg('Kata sandi minimal terdiri dari 6 karakter.'); return; }
      go.disabled=true;
      try{
        if(mode==='in') await fu.signInWithEmailAndPassword(auth,email,pw);
        else { const c=await fu.createUserWithEmailAndPassword(auth,email,pw); const nm=$('auName').value.trim(); if(nm){ await fu.updateProfile(c.user,{displayName:nm}); A.user=c.user; renderSlot(); } }
      }catch(err){ msg(errText(err)); }
      go.disabled=false;
    };
    $('auForgot').onclick=async()=>{
      const email=$('auEmail').value.trim(); if(!email){ msg('Mohon isi alamat email terlebih dahulu, lalu pilih "Lupa kata sandi?" kembali.'); $('auEmail').focus(); return; }
      try{ await fu.sendPasswordResetEmail(auth,email); msg('Tautan pengaturan ulang kata sandi telah dikirim ke '+email+'. Mohon periksa juga folder spam.','ok'); }
      catch(err){ msg(errText(err)); }
    };
  }).catch(e=>{
    console.error('[SM-Crestboard] Firebase gagal dimuat', e);
    if(slot) slot.hidden=true;
  });
})();
