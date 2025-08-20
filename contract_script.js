// contract_script.js — Contractwerkbord
// Verbeteringen:
// - Kop-rijen sticky met vaste hoogtes (geen “overschuiven” effect)
// - Leerkrachtknop “Kindmodus” (opent kindweergave in nieuw tabblad)
// - Kindmodus: rode sluitknop (wit kruisje) → terug naar contract_index.html
// - Status: wit/oranje/groen met 3 kleurvlakken; klik bolletje = cyclen; long-press = reset wit
// - Optimistic UI (kleurt meteen), daarna Firestore-opslag

// ==== Firebase ====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

// ==== UI Refs ====
const params = new URLSearchParams(location.search);
const rol = params.get('rol') || 'kind';
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

// ==== Activiteiten (eerste = leeg) ====
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

// ==== Borddata ====
let gebruikerId = null;
const bordDocId = "contractbord";
let bord = { kolommen: [], rijen: [], cellen: {} };

// ==== Helpers ====
function transparentDataURL(){
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABJ4nYbQAAAABJRU5ErkJggg==";
}
function imageSrcFor(key){ return key ? `contract_afbeeldingen/${key}.png` : transparentDataURL(); }
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

// ==== AUTH ====
async function initAuth(){
  if(rol === 'leerkracht'){
    actiesLeerkracht.hidden = false;

    // Voeg "Kindmodus" knop toe (nieuw tabblad)
    const kindBtn = document.createElement('button');
    kindBtn.className = 'sec';
    kindBtn.textContent = 'Kindmodus';
    kindBtn.id = 'btnKindmodus';
    actiesLeerkracht?.insertBefore(kindBtn, btnUitloggen);

    onAuthStateChanged(auth, async (user)=>{
      if(!user){
        const email = prompt('E-mail (leerkracht):');
        const wachtwoord = prompt('Wachtwoord:');
        if(!email || !wachtwoord) return alert('Inloggen vereist.');
        await signInWithEmailAndPassword(auth, email, wachtwoord).catch(e=>alert(e.message));
        return;
      }
      gebruikerId = user.uid;
      await laadOfMaakBord();
      render();

      // nu we de UID kennen, hang actie aan Kindmodus
      kindBtn.onclick = ()=>{
        const url = `contract_board.html?rol=kind&lid=${gebruikerId}`;
        window.open(url, '_blank', 'noopener');
      };
    });

    btnUitloggen?.addEventListener('click', ()=>signOut(auth).then(()=>location.href='contract_index.html'));
  } else {
    // Kindmodus: anonieme login + rode sluitknop tonen
    await signInAnonymously(auth).catch(console.error);
    gebruikerId = params.get('lid') || localStorage.getItem('contract_leerkracht_uid');
    if(!gebruikerId){
      const ingevuld = prompt('Geef leerkracht-ID (1x via QR):');
      if(!ingevuld) return alert('Geen leerkracht-ID. Vraag de QR aan je leerkracht.');
      gebruikerId = ingevuld.trim();
      localStorage.setItem('contract_leerkracht_uid', gebruikerId);
    }
    // Sluitknop
    voegKindSluitKnopToe();
    await laadOfMaakBord(false);
    render();
  }
}

// ==== FIRESTORE ====
function getBordRef(){ return doc(db, "leerkrachten", gebruikerId, "borden", bordDocId); }
async function laadOfMaakBord(magAanmaken=true){
  try{
    const ref = getBordRef();
    const snap = await getDoc(ref);
    if(snap.exists()){
      bord = snap.data();
      ensureMinimumStructure();
      await setDoc(ref, bord, {merge:true});
    } else if(magAanmaken){
      applyDefaultBoard(); ensureMinimumStructure();
      await setDoc(ref, bord);
    } else {
      console.warn('Geen Firestore-doc; lokaal bord.');
      applyDefaultBoard(); ensureMinimumStructure();
    }
  }catch(e){
    console.warn('Firestore niet bereikbaar/regelfout:', e);
    applyDefaultBoard(); ensureMinimumStructure();
  }
}
async function bewaarBord(patch){
  Object.assign(bord, patch);
  try{ await updateDoc(getBordRef(), patch); }
  catch{ await setDoc(getBordRef(), bord, {merge:true}); }
}

// ==== UI ====
function render(){
  ensureMinimumStructure();

  // Rij 1: dropdown + verwijder
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

  // Rij 2: ENKEL afbeelding (sticky onder rij 1)
  headerAfbeeldingen.innerHTML = '';
  const leeg = document.createElement('th');
  leeg.className = 'sticky-left sticky-top-2 subheader';
  headerAfbeeldingen.appendChild(leeg);

  for(const kol of bord.kolommen){
    const th = document.createElement('th');
    th.className = 'sticky-top-2 subheader';
    const img = document.createElement('img');
    img.className = 'kolom-afb';
    img.alt = "";
    img.src = imageSrcFor(kol.activiteitKey);
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

    const label = document.createElement('th');
    label.textContent = r;
    label.className = 'sticky-left rij-label';
    tr.appendChild(label);

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
      opt.value = a.key;
      opt.textContent = a.label;
      if((a.key || null) === (kol.activiteitKey || null)) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = async (e)=>{
      kol.activiteitKey = e.target.value || null; // optimistic
      render();
      try{ await bewaarBord({ kolommen:[...bord.kolommen] }); }catch(err){ console.warn('Bewaren mislukt', err); }
    };
    th.appendChild(sel);

    const del = document.createElement('button');
    del.className = 'kolom-verwijder'; del.title = 'Verwijder kolom'; del.textContent = '✕';
    del.onclick = ()=>kolomVerwijderen(kol.id);
    th.appendChild(del);
  } else {
    const plak = document.createElement('div'); plak.style.height = '34px'; th.appendChild(plak);
  }
  return th;
}

// Long-press helper (0.6s) → callback
function addLongPress(el, cb, ms=600){
  let t=null;
  const start = ()=>{ t=setTimeout(()=>cb(), ms); };
  const clear = ()=>{ if(t){clearTimeout(t); t=null;} };
  el.addEventListener('mousedown', start);
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('mouseup', clear);
  el.addEventListener('mouseleave', clear);
  el.addEventListener('touchend', clear);
  el.addEventListener('touchcancel', clear);
}

function maakStatusCel(rij, kolId, status){
  const td = document.createElement('td');
  td.className = 'status-cel';

  // Bolletje (klik = cyclen; lang indrukken = wit)
  const bol = document.createElement('button');
  bol.className = 'bolletje ' + (status==='klaar'?'klaar':status==='bezig'?'bezig':'leeg');
  bol.setAttribute('aria-pressed', status==='klaar'?'true':'false');
  bol.onclick = ()=>cycleStatusOptimistic(rij, kolId);
  addLongPress(bol, ()=>setStatusOptimistic(rij, kolId, 'leeg'));

  // 3 kleurvlakken
  const knoppen = document.createElement('div');
  knoppen.className = 'kleur-choices';

  const wit = document.createElement('div');
  wit.className = 'kleur-btn wit';
  wit.setAttribute('role','button');
  wit.title = 'Wit (niet begonnen)';
  wit.onclick = ()=>setStatusOptimistic(rij, kolId, 'leeg');

  const oranje = document.createElement('div');
  oranje.className = 'kleur-btn oranje';
  oranje.setAttribute('role','button');
  oranje.title = 'Verder werken (oranje)';
  oranje.onclick = ()=>setStatusOptimistic(rij, kolId, 'bezig');

  const groen = document.createElement('div');
  groen.className = 'kleur-btn groen';
  groen.setAttribute('role','button');
  groen.title = 'Klaar (groen)';
  groen.onclick = ()=>setStatusOptimistic(rij, kolId, 'klaar');

  knoppen.append(wit, oranje, groen);

  td.appendChild(bol);
  td.appendChild(knoppen);
  return td;
}

// Acties
async function kolomToevoegen(){
  if(rol !== 'leerkracht') return;
  const nieuwId = `k${(bord.kolommen[bord.kolommen.length-1]?.id?.slice(1)|0)+1}`;
  const nieuw = { id: nieuwId, activiteitKey: null };
  bord.kolommen = [...bord.kolommen, nieuw]; render();
  try{ await bewaarBord({ kolommen: bord.kolommen }); }catch(e){ console.warn(e); }
}
async function kolomVerwijderen(kolId){
  if(rol !== 'leerkracht') return;
  const kolommen = bord.kolommen.filter(k=>k.id!==kolId);
  for(const r of bord.rijen){ if(bord.cellen?.[r]?.[kolId]) delete bord.cellen[r][kolId]; }
  bord.kolommen = kolommen; render();
  try{ await bewaarBord({ kolommen, cellen: bord.cellen }); }catch(e){ console.warn(e); }
}

function nextState(s){ return s==='leeg'?'bezig':(s==='bezig'?'klaar':'leeg'); }
function cycleStatusOptimistic(rij, kolId){
  const huidig = (bord.cellen?.[rij]?.[kolId]) || 'leeg';
  setStatusOptimistic(rij, kolId, nextState(huidig));
}
async function setStatusOptimistic(rij, kolId, nieuw){
  bord.cellen[rij] = bord.cellen[rij] || {};
  bord.cellen[rij][kolId] = nieuw; render();
  try{ await bewaarBord({ cellen: bord.cellen }); }catch(e){ console.warn(e); }
}

btnRijPlus?.addEventListener('click', ()=>{
  const max = Math.max(...bord.rijen, 0);
  bord.rijen = [...bord.rijen, max+1]; render();
  bewaarBord({ rijen: bord.rijen }).catch(console.warn);
});
btnKolomPlus?.addEventListener('click', kolomToevoegen);
document.getElementById('kolomPlusTop')?.addEventListener('click', kolomToevoegen);

btnReset?.addEventListener('click', async ()=>{
  if(rol !== 'leerkracht') return;
  if(!confirm('Alles terug op WIT zetten voor alle kinderen?')) return;
  for(const r of bord.rijen){
    for(const k of bord.kolommen){
      bord.cellen[r] = bord.cellen[r] || {};
      bord.cellen[r][k.id] = 'leeg';
    }
  }
  render();
  try{ await bewaarBord({ cellen: bord.cellen }); }catch(e){ console.warn(e); }
});

// PDF
btnPdf?.addEventListener('click', async ()=>{
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('l','pt','a4');
  const node = document.getElementById('tabelWrapper');
  const canvas = await html2canvas(node,{ scale:2, backgroundColor:'#ffffff' });
  const img = canvas.toDataURL('image/png');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const ratio = pageWidth / canvas.width;
  const height = canvas.height * ratio;
  pdf.addImage(img,'PNG',0,20,pageWidth,height);
  pdf.save('contractbord.pdf');
});

// QR (bestaat al)
btnToonQR?.addEventListener('click', ()=>{
  const dlg = document.getElementById('qrDialog');
  const canvas = document.getElementById('qrCanvas');
  const url = `${location.origin}${location.pathname.replace('contract_board.html','contract_board.html')}?rol=kind&lid=${gebruikerId}`;
  window.QRCode.toCanvas(canvas, url, {width:256}, (err)=>{ if(err) console.error(err); dlg.showModal(); });
});

// Kindmodus: rode sluitknop → terug naar start
function voegKindSluitKnopToe(){
  const btn = document.createElement('button');
  btn.className = 'kind-exit';
  btn.title = 'Sluiten';
  btn.onclick = ()=>{ location.href = 'contract_index.html'; };
  document.body.appendChild(btn);
}

// Uitloggen
btnUitloggen?.addEventListener('click', ()=>signOut(auth).then(()=>location.href='contract_index.html'));

// Start
initAuth();

