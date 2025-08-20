// contract_script.js — Bordpagina
// - Leerkracht ingelogd verplicht (geen browserprompts); anders terug naar start.
// - Kindmodus: anoniem; UID van leerkracht in ?lid=… (uit QR / localStorage).
// - Sticky kop (2 rijen), kleurenstatus wit/oranje/groen + long-press=reset.
// - Leerlingfoto per klasnummer uit: contract_afbeeldingen/<UID>/01.png (fallback naar contract_afbeeldingen/01.png).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7KxXMvZ4dzBQDut3CMyWUblLte2tFzoQ",
  authDomain: "huiswerkapp-a311e.firebaseapp.com",
  projectId: "huiswerkapp-a311e",
  storageBucket: "huiswerkapp-a311e.appspot.com",
  messagingSenderId: "797169941164",
  appId: "1:797169941164:web:511d9618079f1378d0fd09"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const params = new URLSearchParams(location.search);
const rol = params.get('rol') || 'kind';

// UI refs
const actiesLeerkracht = document.getElementById('actiesLeerkracht');
const btnKolomPlus = document.getElementById('btnKolomPlus');
const btnRijPlus = document.getElementById('btnRijPlus');
const btnPdf = document.getElementById('btnPdf');
const btnReset = document.getElementById('btnReset');
const btnUitloggen = document.getElementById('btnUitloggen');
const btnToonQR = document.getElementById('btnToonQR');
const headerRij = document.getElementById('headerRij');
const headerAfbeeldingen = document.getElementById('headerAfbeeldingen');
const bodyRijen = document.getElementById('bodyRijen');

const activiteiten = [
  { key: null, label: "—" },
  { key: "rekenen", label: "Rekenen" },
  { key: "taal", label: "Taal" },
  { key: "lezen", label: "Lezen" },
  { key: "knutselen", label: "Knutselen" },
  { key: "meten", label: "Meten" },
  { key: "kloklezen", label: "Kloklezen" },
  { key: "schrijven", label: "Schrijven" },
  { key: "tekenen", label: "Tekenen" },
  { key: "bouwen", label: "Bouwen" },
  { key: "muziek", label: "Muziek" }
];

const MAX_INIT_RIJ = 25;
const INIT_KOLOMMEN = 6;

let gebruikerId = null;      // UID van de leerkracht
const bordDocId = "contractbord";
let bord = { kolommen: [], rijen: [], cellen: {} };

// Helpers
function transparentDataURL(){
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABJ4nYbQAAAABJRU5ErkJggg==";
}
function imageSrcFor(key){ return key ? `contract_afbeeldingen/${key}.png` : transparentDataURL(); }
function leerlingPrimairPad(nr){ return `contract_afbeeldingen/${gebruikerId}/${String(nr).padStart(2,'0')}.png`; }
function leerlingFallbackPad(nr){ return `contract_afbeeldingen/${String(nr).padStart(2,'0')}.png`; }

function ensureMinimumStructure(){
  if(!Array.isArray(bord.kolommen)) bord.kolommen = [];
  if(bord.kolommen.length < INIT_KOLOMMEN){
    const start = bord.kolommen.length;
    for(let i=start;i<INIT_KOLOMMEN;i++){ bord.kolommen.push({id:`k${i+1}`, activiteitKey:null}); }
  }
  if(!Array.isArray(bord.rijen) || bord.rijen.length < MAX_INIT_RIJ){
    const s = new Set(bord.rijen || []);
    for(let n=1;n<=MAX_INIT_RIJ;n++) s.add(n);
    bord.rijen = Array.from(s).sort((a,b)=>a-b);
  }
  if(!bord.cellen) bord.cellen = {};
}
function applyDefaultBoard(){
  bord.kolommen = Array.from({length:INIT_KOLOMMEN},(_,i)=>({id:`k${i+1}`, activiteitKey:null}));
  bord.rijen = Array.from({length:MAX_INIT_RIJ},(_,i)=>i+1);
  bord.cellen = {};
}

// AUTH
async function initAuth(){
  if(rol === 'leerkracht'){
    actiesLeerkracht.hidden = false;
    const kindBtn = document.createElement('button');
    kindBtn.className = 'sec';
    kindBtn.textContent = 'Kindmodus';
    kindBtn.id = 'btnKindmodus';
    actiesLeerkracht?.insertBefore(kindBtn, btnUitloggen);

    onAuthStateChanged(auth, async (user)=>{
      if(!user){ location.href = 'contract_index.html'; return; }
      gebruikerId = user.uid;
      await laadOfMaakBord();
      render();
      kindBtn.onclick = ()=>window.open(`contract_board.html?rol=kind&lid=${gebruikerId}`, '_blank', 'noopener');
    });

    btnUitloggen?.addEventListener('click', ()=>signOut(auth).then(()=>location.href='contract_index.html'));
  } else {
    await signInAnonymously(auth).catch(()=>{});
    gebruikerId = params.get('lid') || localStorage.getItem('contract_leerkracht_uid');
    if(!gebruikerId){ location.href = 'contract_index.html'; return; }
    voegKindSluitKnopToe();
    await laadOfMaakBord(false);
    render();
  }
}

// FIRESTORE
function getBordRef(){ return doc(db, "leerkrachten", gebruikerId, "borden", bordDocId); }
async function laadOfMaakBord(magAanmaken=true){
  try{
    const ref = getBordRef(); const snap = await getDoc(ref);
    if(snap.exists()){
      bord = snap.data(); ensureMinimumStructure();
      await setDoc(ref, bord, {merge:true});
    } else if(magAanmaken){
      applyDefaultBoard(); ensureMinimumStructure();
      await setDoc(ref, bord);
    } else {
      applyDefaultBoard(); ensureMinimumStructure();
    }
  }catch{
    applyDefaultBoard(); ensureMinimumStructure();
  }
}
async function bewaarBord(patch){
  Object.assign(bord, patch);
  try{ await updateDoc(getBordRef(), patch); }
  catch{ await setDoc(getBordRef(), bord, {merge:true}); }
}

// UI
function render(){
  ensureMinimumStructure();

  // Kop rij 1 (dropdowns)
  headerRij.innerHTML = '';
  const thLabel = document.createElement('th');
  thLabel.className = 'sticky-left sticky-top cel-label';
  thLabel.textContent = 'Nr.';
  headerRij.appendChild(thLabel);

  for(const kol of bord.kolommen) headerRij.appendChild(maakKolomKop(kol));

  const thPlus = document.createElement('th');
  thPlus.className = 'sticky-top cel-plus';
  const plusBtn = document.createElement('button');
  plusBtn.id = 'kolomPlusTop'; plusBtn.textContent = '+';
  plusBtn.title = 'Kolom toevoegen';
  plusBtn.onclick = ()=>kolomToevoegen();
  thPlus.appendChild(plusBtn);
  headerRij.appendChild(thPlus);

  // Kop rij 2 (pictogrammen)
  headerAfbeeldingen.innerHTML = '';
  const leeg = document.createElement('th');
  leeg.className = 'sticky-left sticky-top-2 subheader';
  headerAfbeeldingen.appendChild(leeg);
  for(const kol of bord.kolommen){
    const th = document.createElement('th');
    th.className = 'sticky-top-2 subheader';
    const img = document.createElement('img');
    img.className = 'kolom-afb';
    img.alt = ""; img.src = imageSrcFor(kol.activiteitKey);
    th.appendChild(img);
    headerAfbeeldingen.appendChild(th);
  }
  const leeg2 = document.createElement('th');
  leeg2.className = 'sticky-top-2 subheader';
  headerAfbeeldingen.appendChild(leeg2);

  // Body
  bodyRijen.innerHTML = '';
  for(const r of bord.rijen){
    const tr = document.createElement('tr');

    // Rijlabel met leerlingafbeelding + nummer
    const th = document.createElement('th');
    th.className = 'sticky-left rij-label';
    const wrap = document.createElement('div');
    wrap.className = 'leerling-label';
    const foto = document.createElement('img');
    foto.className = 'leerling-foto';
    foto.alt = "";

    // primair: per-leerkracht map
    foto.src = leerlingPrimairPad(r);
    // fallback: algemene 01.png → anders verbergen
    foto.onerror = () => {
      foto.onerror = () => { foto.style.visibility = 'hidden'; };
      foto.src = leerlingFallbackPad(r);
    };

    const nr = document.createElement('div');
    nr.className = 'leerling-nummer';
    nr.textContent = r;

    wrap.append(foto, nr);
    th.appendChild(wrap);
    tr.appendChild(th);

    for(const kol of bord.kolommen){
      const status = bord.cellen?.[r]?.[kol.id] || 'leeg';
      tr.appendChild(maakStatusCel(r, kol.id, status));
    }
    tr.appendChild(document.createElement('td'));
    bodyRijen.appendChild(tr);
  }
}

function maakKolomKop(kol){
  const th = document.createElement('th');
  th.className = 'sticky-top kolomkop';
  if(rol === 'leerkracht'){
    const sel = document.createElement('select');
    sel.className = 'kolom-select';
    for(const a of activiteiten){
      const opt = document.createElement('option');
      opt.value = a.key; opt.textContent = a.label;
      if((a.key||null)===(kol.activiteitKey||null)) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = async (e)=>{
      kol.activiteitKey = e.target.value || null;
      render();
      try{ await bewaarBord({ kolommen:[...bord.kolommen] }); } catch {}
    };
    th.appendChild(sel);

    const del = document.createElement('button');
    del.className = 'kolom-verwijder'; del.title = 'Verwijder kolom'; del.textContent = '✕';
    del.onclick = ()=>kolomVerwijderen(kol.id);
    th.appendChild(del);
  } else {
    th.appendChild(document.createElement('div')).style.height='38px';
  }
  return th;
}

// long-press → wit
function addLongPress(el, cb, ms=600){
  let t=null; const start=()=>{t=setTimeout(cb,ms)}; const clear=()=>{if(t){clearTimeout(t);t=null}};
  el.addEventListener('mousedown', start);
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('mouseup', clear);
  el.addEventListener('mouseleave', clear);
  el.addEventListener('touchend', clear);
  el.addEventListener('touchcancel', clear);
}

function maakStatusCel(rij, kolId, status){
  const td = document.createElement('td'); td.className='status-cel';

  const bol = document.createElement('button');
  bol.className = 'bolletje ' + (status==='klaar'?'klaar':status==='bezig'?'bezig':'leeg');
  bol.onclick = ()=>cycleStatusOptimistic(rij, kolId);
  addLongPress(bol, ()=>setStatusOptimistic(rij, kolId, 'leeg'));
  td.appendChild(bol);

  const k = document.createElement('div'); k.className='kleur-choices';
  const bW = document.createElement('div'); bW.className='kleur-btn wit';    bW.onclick=()=>setStatusOptimistic(rij,kolId,'leeg');
  const bO = document.createElement('div'); bO.className='kleur-btn oranje'; bO.onclick=()=>setStatusOptimistic(rij,kolId,'bezig');
  const bG = document.createElement('div'); bG.className='kleur-btn groen';  bG.onclick=()=>setStatusOptimistic(rij,kolId,'klaar');
  k.append(bW,bO,bG); td.appendChild(k);
  return td;
}

// acties
async function kolomToevoegen(){
  if(rol!=='leerkracht') return;
  const nieuwId = `k${(bord.kolommen[bord.kolommen.length-1]?.id?.slice(1)|0)+1}`;
  const nieuw   = { id: nieuwId, activiteitKey:null };
  bord.kolommen = [...bord.kolommen, nieuw]; render();
  try{ await bewaarBord({ kolommen: bord.kolommen }); }catch{}
}
async function kolomVerwijderen(kolId){
  if(rol!=='leerkracht') return;
  const kolommen = bord.kolommen.filter(k=>k.id!==kolId);
  for(const r of bord.rijen){ if(bord.cellen?.[r]?.[kolId]) delete bord.cellen[r][kolId]; }
  bord.kolommen = kolommen; render();
  try{ await bewaarBord({ kolommen, cellen: bord.cellen }); }catch{}
}

function nextState(s){ return s==='leeg'?'bezig':(s==='bezig'?'klaar':'leeg'); }
function cycleStatusOptimistic(rij, kolId){
  const huidig = (bord.cellen?.[rij]?.[kolId]) || 'leeg';
  setStatusOptimistic(rij, kolId, nextState(huidig));
}
async function setStatusOptimistic(rij, kolId, nieuw){
  bord.cellen[rij] = bord.cellen[rij] || {};
  bord.cellen[rij][kolId] = nieuw; render();
  try{ await bewaarBord({ cellen: bord.cellen }); }catch{}
}

// PDF
btnPdf?.addEventListener('click', async ()=>{
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('l','pt','a4');
  const node = document.getElementById('tabelWrapper');
  const canvas = await html2canvas(node,{ scale:2, backgroundColor:'#ffffff' });
  const img = canvas.toDataURL('image/png');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const ratio = pageWidth / canvas.width;
  pdf.addImage(img,'PNG',0,20,pageWidth,canvas.height*ratio);
  pdf.save('contractbord.pdf');
});

// QR
btnToonQR?.addEventListener('click', ()=>{
  const dlg = document.getElementById('qrDialog');
  const canvas = document.getElementById('qrCanvas');
  const url = `${location.origin}${location.pathname.replace('contract_board.html','contract_board.html')}?rol=kind&lid=${gebruikerId}`;
  window.QRCode.toCanvas(canvas, url, {width:256}, (err)=>{ if(err)console.error(err); dlg.showModal(); });
});

// Kindmodus: rode sluitknop → terug naar start
function voegKindSluitKnopToe(){
  const btn = document.createElement('button');
  btn.className = 'kind-exit'; btn.title='Sluiten';
  btn.onclick = ()=>{ location.href = 'contract_index.html'; };
  document.body.appendChild(btn);
}

btnRijPlus?.addEventListener('click', ()=>{
  const max = Math.max(...bord.rijen, 0);
  bord.rijen = [...bord.rijen, max+1]; render();
  bewaarBord({ rijen: bord.rijen }).catch(()=>{});
});
btnKolomPlus?.addEventListener('click', kolomToevoegen);
document.getElementById('kolomPlusTop')?.addEventListener('click', kolomToevoegen);
btnReset?.addEventListener('click', async ()=>{
  if(rol!=='leerkracht') return;
  if(!confirm('Alles terug op WIT zetten voor alle kinderen?')) return;
  for(const r of bord.rijen){ for(const k of bord.kolommen){
    bord.cellen[r] = bord.cellen[r] || {}; bord.cellen[r][k.id] = 'leeg';
  }}
  render(); try{ await bewaarBord({ cellen: bord.cellen }); }catch{}
});

initAuth();
