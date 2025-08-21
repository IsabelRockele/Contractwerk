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
const actiesLeerkracht   = document.getElementById('actiesLeerkracht');
const btnKolomPlus       = document.getElementById('btnKolomPlus');
const btnRijPlus         = document.getElementById('btnRijPlus');
const btnPdf             = document.getElementById('btnPdf');
const btnReset           = document.getElementById('btnReset');
const btnUitloggen       = document.getElementById('btnUitloggen');
const btnToonQR          = document.getElementById('btnToonQR');
const headerRij          = document.getElementById('headerRij');
const headerAfbeeldingen = document.getElementById('headerAfbeeldingen');
const bodyRijen          = document.getElementById('bodyRijen');
const tabelWrapper       = document.getElementById('tabelWrapper');
const tabelEl            = tabelWrapper ? tabelWrapper.querySelector('table') : null;

const activiteiten = [
  { key: null,        label: "—" },
  { key: "rekenen",   label: "Rekenen" },
  { key: "taal",      label: "Taal" },
  { key: "lezen",     label: "Lezen" },
  { key: "knutselen", label: "Knutselen" },
  { key: "meten",     label: "Meten" },
  { key: "kloklezen", label: "Kloklezen" },
  { key: "schrijven", label: "Schrijven" },
  { key: "tekenen",   label: "Tekenen" },
  { key: "bouwen",    label: "Bouwen" },
  { key: "muziek",    label: "Muziek" }
];

const MAX_INIT_RIJ   = 25;
const INIT_KOLOMMEN  = 6;

let gebruikerId = null;
const bordDocId = "contractbord";
let bord = { kolommen: [], rijen: [], cellen: {} };

/* Helpers */
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
  // GECORRIGEERD: Deze check zorgde ervoor dat verwijderde rijen meteen weer werden aangevuld.
  // Nu wordt de rij-array enkel aangemaakt als hij nog niet bestaat.
  if(!Array.isArray(bord.rijen)){
    bord.rijen = Array.from({length:MAX_INIT_RIJ},(_,i)=>i+1);
  }
  if(!bord.cellen) bord.cellen = {};
}
function applyDefaultBoard(){
  bord.kolommen = Array.from({length:INIT_KOLOMMEN},(_,i)=>({id:`k${i+1}`, activiteitKey:null}));
  bord.rijen    = Array.from({length:MAX_INIT_RIJ},(_,i)=>i+1);
  bord.cellen   = {};
}

/* Acties */
async function kolomToevoegen(){
  if(rol!=='leerkracht') return;
  const lastNum = (bord.kolommen[bord.kolommen.length-1]?.id?.replace(/^k/,'')|0);
  const nieuwId = `k${lastNum+1}`;
  const nieuw   = { id: nieuwId, activiteitKey:null };
  bord.kolommen = [...bord.kolommen, nieuw];
  render();
  try{ await bewaarBord({ kolommen: bord.kolommen }); }catch{}
}
async function kolomVerwijderen(kolId){
  if(rol!=='leerkracht') return;
  const kolommen = bord.kolommen.filter(k=>k.id!==kolId);
  for(const r of bord.rijen){ if(bord.cellen?.[r]?.[kolId]) delete bord.cellen[r][kolId]; }
  bord.kolommen = kolommen;
  render();
  try{ await bewaarBord({ kolommen, cellen: bord.cellen }); }catch{}
}
function nextState(s){ return s==='leeg'?'bezig':(s==='bezig'?'klaar':'leeg'); }
function addLongPress(el, cb, ms=600){
  let t=null; const start=()=>{t=setTimeout(cb,ms)}; const clear=()=>{if(t){clearTimeout(t);t=null}};
  el.addEventListener('mousedown', start);
  el.addEventListener('touchstart', start, {passive:true});
  el.addEventListener('mouseup', clear);
  el.addEventListener('mouseleave', clear);
  el.addEventListener('touchend', clear);
  el.addEventListener('touchcancel', clear);
}
function cycleStatusOptimistic(rij, kolId){
  const huidig = (bord.cellen?.[rij]?.[kolId]) || 'leeg';
  setStatusOptimistic(rij, kolId, nextState(huidig));
}
async function setStatusOptimistic(rij, kolId, nieuw){
  bord.cellen[rij] = bord.cellen[rij] || {};
  bord.cellen[rij][kolId] = nieuw; render();
  try{ await bewaarBord({ cellen: bord.cellen }); }catch{}
}

/* Auth */
async function initAuth(){
  if(rol === 'leerkracht'){
    actiesLeerkracht.hidden = false;
    const kindBtn = document.createElement('button');
    kindBtn.className = 'sec';
    kindBtn.textContent = 'Kindmodus';
    kindBtn.id = 'btnKindmodus';
    actiesLeerkracht?.insertBefore(kindBtn, btnUitloggen);

    onAuthStateChanged(auth, async (user)=>{
      if(!user){ location.href = 'index.html'; return; }
      gebruikerId = user.uid;
      await laadOfMaakBord();
      render();
      kindBtn.onclick = ()=>window.open(`contract_board.html?rol=kind&lid=${gebruikerId}`, '_blank', 'noopener');
    });

    btnUitloggen?.addEventListener('click', ()=>signOut(auth).then(()=>location.href='index.html'));
  } else {
    document.body.classList.add('kind-only-icons');
    await signInAnonymously(auth).catch(()=>{});
    gebruikerId = params.get('lid') || localStorage.getItem('contract_leerkracht_uid');
    if(!gebruikerId){ location.href = 'index.html'; return; }
    voegKindSluitKnopToe();
    await laadOfMaakBord(false);
    render();
  }
}

/* Firestore */
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

/* UI */
function render(){
  ensureMinimumStructure();

  // --- Kop rij 1 (selects) ---
  headerRij.innerHTML = '';
  if(rol === 'leerkracht'){
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
    plusBtn.addEventListener('click', kolomToevoegen);
    thPlus.appendChild(plusBtn);
    headerRij.appendChild(thPlus);

    headerRij.style.display = '';
  } else {
    headerRij.style.display = 'none';
  }

  // --- Kop rij 2 (pictogrammen) ---
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

  // --- Body ---
  bodyRijen.innerHTML = '';
  for(const r of bord.rijen){
    const tr = document.createElement('tr');

    const th = document.createElement('th');
    th.className = 'sticky-left rij-label';
    const wrap = document.createElement('div');
    wrap.className = 'leerling-label';
    const foto = document.createElement('img');
    foto.className = 'leerling-foto';
    foto.alt = "";

    foto.src = leerlingPrimairPad(r);
    foto.onerror = () => {
      foto.onerror = () => { foto.style.visibility = 'hidden'; };
      foto.src = leerlingFallbackPad(r);
    };

    const nr = document.createElement('div');
    nr.className = 'leerling-nummer';
    nr.textContent = r;

    wrap.append(foto, nr);

    if (rol === 'leerkracht') {
      const delBtn = document.createElement('button');
      delBtn.className = 'rij-verwijder';
      delBtn.textContent = '✕';
      delBtn.title = `Rij ${r} verwijderen`;
      delBtn.onclick = async () => {
        if (confirm(`Weet je zeker dat je rij ${r} wilt verwijderen?`)) {
          bord.rijen = bord.rijen.filter(rijNummer => rijNummer !== r);
          if (bord.cellen && bord.cellen[r]) {
            delete bord.cellen[r];
          }
          render();
          try {
            await bewaarBord({ rijen: bord.rijen, cellen: bord.cellen });
          } catch(err) {
            console.error("Fout bij opslaan na rij verwijderen:", err);
          }
        }
      };
      wrap.appendChild(delBtn);
    }

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

/* PDF */
btnPdf?.addEventListener('click', async ()=>{ await downloadContractbordPdf(); });

async function downloadContractbordPdf(){
  try{
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l','pt','a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const marginTop = 18, marginBottom = 18;

    const kleurBlocks = Array.from(document.querySelectorAll('.kleur-choices'));
    const prevDisplays = kleurBlocks.map(el => el.style.display);
    kleurBlocks.forEach(el => { el.style.display = 'none'; });

    const tmpWrap  = document.createElement('div');
    tmpWrap.style.position='fixed'; tmpWrap.style.left='-99999px'; tmpWrap.style.top='0';
    const tmpTable = tabelEl.cloneNode(false);
    const tmpThead = document.createElement('thead');
    if (rol === 'kind') {
      if (headerAfbeeldingen) tmpThead.appendChild(headerAfbeeldingen.cloneNode(true));
    } else {
      if (headerRij)          tmpThead.appendChild(headerRij.cloneNode(true));
      if (headerAfbeeldingen) tmpThead.appendChild(headerAfbeeldingen.cloneNode(true));
    }
    tmpTable.appendChild(tmpThead); tmpWrap.appendChild(tmpTable); document.body.appendChild(tmpWrap);
    const headerCanvas = await html2canvas(tmpTable, { scale: 2, backgroundColor: '#FFFFFF' });
    tmpWrap.remove();

    const headerRatio     = pageWidth / headerCanvas.width;
    const headerHeightPt  = headerCanvas.height * headerRatio;
    const usableBodyPt    = pageHeight - marginTop - headerHeightPt - marginBottom;

    let wasHidden=false, prevDisplay='';
    const realThead = tabelEl.querySelector('thead');
    if (realThead){ prevDisplay=realThead.style.display; realThead.style.display='none'; wasHidden=true; }
    else { if (headerRij) headerRij.style.display='none'; if (headerAfbeeldingen) headerAfbeeldingen.style.display='none'; wasHidden=true; }

    const tableRect = tabelEl.getBoundingClientRect();
    const rows = Array.from(bodyRijen.querySelectorAll('tr'));
    const rowsTopCss = [], rowsBottomCss = [];
    rows.forEach(tr=>{
      const r = tr.getBoundingClientRect();
      rowsTopCss.push(r.top - tableRect.top);
      rowsBottomCss.push(r.bottom - tableRect.top);
    });

    const bodyCanvas = await html2canvas(tabelEl, { scale: 2, backgroundColor: '#FFFFFF' });

    if (wasHidden){
      if (realThead) realThead.style.display = prevDisplay;
      else { if (headerRij) headerRij.style.display=''; if (headerAfbeeldingen) headerAfbeeldingen.style.display=''; }
    }

    kleurBlocks.forEach((el, i) => { el.style.display = prevDisplays[i]; });

    const cssWidth = tableRect.width || tabelEl.offsetWidth || 1;
    const scale    = bodyCanvas.width / cssWidth;
    const rowsTopPx    = rowsTopCss.map(v => Math.round(v * scale));
    const rowsBottomPx = rowsBottomCss.map(v => Math.round(v * scale));

    const bodyRatio      = pageWidth / bodyCanvas.width;
    const bodyPxPerPage  = Math.floor(usableBodyPt / bodyRatio);

    let startRow = 0, pageIndex = 0;
    while (startRow < rows.length) {
      let endRow = startRow;
      while (endRow < rows.length) {
        const sliceTop    = rowsTopPx[startRow];
        const sliceBottom = rowsBottomPx[endRow];
        const sliceHeight = sliceBottom - sliceTop;
        if (sliceHeight <= bodyPxPerPage) endRow++;
        else break;
      }
      if (endRow === startRow) endRow = startRow + 1;

      const sliceTopPx    = rowsTopPx[startRow];
      const sliceBottomPx = rowsBottomPx[endRow-1];
      const sliceHeightPx = sliceBottomPx - sliceTopPx;

      if (pageIndex > 0) pdf.addPage();

      pdf.addImage(headerCanvas.toDataURL('image/png'),'PNG',0,marginTop,pageWidth,headerHeightPt);

      const bodyStartPt = marginTop + headerHeightPt;
      const sliceData   = canvasSliceToPng(bodyCanvas, 0, sliceTopPx, bodyCanvas.width, sliceHeightPx);
      pdf.addImage(sliceData,'PNG',0,bodyStartPt,pageWidth,sliceHeightPx * bodyRatio);

      pageIndex++; startRow = endRow;
    }

    pdf.save('contractbord.pdf');
  }catch(err){
    console.error(err);
    alert('PDF genereren is mislukt. Probeer opnieuw.');
  }
}

function canvasSliceToPng(sourceCanvas, sx, sy, sw, sh){
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const ctx = c.getContext('2d'); ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

/* QR */
btnToonQR?.addEventListener('click', ()=>{
  const dlg = document.getElementById('qrDialog');
  const canvas = document.getElementById('qrCanvas');
  const url = `${location.origin}${location.pathname.replace('contract_board.html','contract_board.html')}?rol=kind&lid=${gebruikerId}`;
  window.QRCode.toCanvas(canvas, url, {width:256}, (err)=>{ if(err)console.error(err); dlg.showModal(); });
});

/* Kindmodus: rode sluitknop */
function voegKindSluitKnopToe(){
  const btn = document.createElement('button');
  btn.className = 'kind-exit'; btn.title='Sluiten';
  btn.onclick = ()=>{ location.href = 'index.html'; };
  document.body.appendChild(btn);
}

/* Extra knoppen */
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

/* Start */
initAuth();

