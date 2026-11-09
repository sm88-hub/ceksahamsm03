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
  body.au-open{overflow:hidden}`;
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
        <h2>Analisis di mana saja. Datamu ikut.</h2>
        <p>Satu akun untuk watchlist dan jurnal tradingmu. Buka di HP atau laptop, semuanya langsung tersinkron.</p>
        <ul class="au-pts">
          <li><i>✓</i><span>Watchlist, Price to Watch, dan jurnal tersimpan di akunmu, bukan hanya di browser.</span></li>
          <li><i>✓</i><span>Ganti perangkat kapan saja tanpa backup manual.</span></li>
          <li><i>✓</i><span>Data pribadi: hanya kamu yang bisa membaca dan mengubahnya.</span></li>
        </ul>
      </aside>
      <section class="au-main">
        <div class="au-tabs" role="tablist"><button type="button" data-m="in" class="on">Masuk</button><button type="button" data-m="up">Daftar</button></div>
        <h3 id="auT">Selamat datang kembali</h3>
        <p class="sub" id="auSub">Masuk untuk membuka watchlist dan jurnalmu.</p>
        <button type="button" class="au-g" id="auG"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Lanjutkan dengan Google</button>
        <div class="au-or">atau dengan email</div>
        <form class="au-f" id="auF" novalidate>
          <label id="auNameL" hidden>Nama<input id="auName" autocomplete="name" placeholder="Nama panggilan"></label>
          <label>Email<input id="auEmail" type="email" autocomplete="email" placeholder="nama@email.com" required></label>
          <label>Password<input id="auPw" type="password" autocomplete="current-password" placeholder="Minimal 6 karakter" required></label>
          <button type="submit" class="au-go" id="auGo">Masuk</button>
        </form>
        <div class="au-msg" id="auMsg" role="status"></div>
        <button type="button" class="au-forgot" id="auForgot">Lupa password?</button>
        <p class="au-note">Dengan masuk, kamu tetap tunduk pada ketentuan situs: semua informasi hanya untuk analisis, bukan rekomendasi investasi.</p>
      </section>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
  const $=id=>document.getElementById(id);
  let mode='in';
  const setMode=m=>{ mode=m; document.querySelectorAll('.au-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));
    $('auT').textContent = m==='in' ? 'Selamat datang kembali' : 'Buat akun baru';
    $('auSub').textContent = m==='in' ? 'Masuk untuk membuka watchlist dan jurnalmu.' : 'Gratis. Watchlist dan jurnal di perangkat ini ikut dipindahkan ke akunmu.';
    $('auGo').textContent = m==='in' ? 'Masuk' : 'Daftar';
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

  const ERR={ 'auth/invalid-credential':'Email atau password salah.', 'auth/wrong-password':'Email atau password salah.', 'auth/user-not-found':'Akun dengan email ini belum terdaftar.',
    'auth/email-already-in-use':'Email ini sudah terdaftar. Silakan masuk.', 'auth/weak-password':'Password minimal 6 karakter.', 'auth/invalid-email':'Format email tidak valid.',
    'auth/missing-password':'Isi password.', 'auth/too-many-requests':'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.', 'auth/network-request-failed':'Koneksi internet bermasalah. Coba lagi.',
    'auth/unauthorized-domain':'Domain situs ini belum diizinkan di Firebase (Authentication → Settings → Authorized domains).', 'auth/operation-not-allowed':'Metode masuk ini belum diaktifkan di Firebase Console.',
    'auth/popup-blocked':'Browser memblokir jendela login. Izinkan pop-up lalu coba lagi.' };
  const errText=e=>ERR[e?.code] || 'Gagal: '+(e?.message||'coba lagi');

  /* ---------- tombol akun di header ---------- */
  let syncing=false;
  function renderSlot(){
    if(!slot) return;
    const u=A.user;
    if(!u){ slot.innerHTML=`<button type="button" class="acct-btn" id="acctIn" aria-label="Masuk"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span class="lbl">Masuk</span></button>`; $('acctIn').onclick=()=>openModal('in'); return; }
    const name=u.displayName||u.email||'Akun', ini=esc((name.trim()[0]||'A').toUpperCase());
    slot.innerHTML=`<button type="button" class="acct-btn in" id="acctBtn" aria-haspopup="menu" aria-expanded="false" title="${esc(u.email||'')}"><span class="acct-av">${u.photoURL?`<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`:ini}</span><i class="acct-dot ${syncing?'sync':''}" aria-hidden="true"></i></button>
      <div class="acct-menu" id="acctMenu" role="menu" hidden>
        <div class="who"><span class="acct-av" style="width:34px;height:34px;font-size:14px">${u.photoURL?`<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">`:ini}</span><div><b>${esc(u.displayName||'Akun saya')}</b><span>${esc(u.email||'')}</span></div></div>
        <div class="st"><i class="acct-dot ${syncing?'sync':''}"></i>${syncing?'Menyimpan…':'Watchlist & jurnal tersinkron'}</div>
        <button type="button" class="out" id="acctOut" role="menuitem">Keluar</button>
      </div>`;
    const btn=$('acctBtn'), menu=$('acctMenu');
    btn.onclick=e=>{ e.stopPropagation(); menu.hidden=!menu.hidden; btn.setAttribute('aria-expanded',String(!menu.hidden)); };
    $('acctOut').onclick=()=>A.signOut();
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
      A.user=u; A.ready=true; renderSlot();
      if(unsub){ unsub(); unsub=null; }
      if(u){
        if(!$('au').hidden){ $('au').hidden=true; document.body.classList.remove('au-open'); }
        first=true;
        unsub=fs.onSnapshot(fs.doc(db,'users',u.uid), snap=>{
          if(snap.metadata.hasPendingWrites) return;
          const data=snap.exists()?snap.data():{};
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
      if(!email){ msg('Isi email.'); return; } if(pw.length<6){ msg('Password minimal 6 karakter.'); return; }
      go.disabled=true;
      try{
        if(mode==='in') await fu.signInWithEmailAndPassword(auth,email,pw);
        else { const c=await fu.createUserWithEmailAndPassword(auth,email,pw); const nm=$('auName').value.trim(); if(nm){ await fu.updateProfile(c.user,{displayName:nm}); A.user=c.user; renderSlot(); } }
      }catch(err){ msg(errText(err)); }
      go.disabled=false;
    };
    $('auForgot').onclick=async()=>{
      const email=$('auEmail').value.trim(); if(!email){ msg('Isi email dulu, lalu tekan "Lupa password?" lagi.'); $('auEmail').focus(); return; }
      try{ await fu.sendPasswordResetEmail(auth,email); msg('Tautan reset password sudah dikirim ke '+email+'. Cek juga folder spam.','ok'); }
      catch(err){ msg(errText(err)); }
    };
  }).catch(e=>{
    console.error('[SM-Crestboard] Firebase gagal dimuat', e);
    if(slot) slot.hidden=true;
  });
})();
