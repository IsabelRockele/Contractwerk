/* =================== Firebase =================== */
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

/* =================== Params & UI refs =================== */
const params = new URLSearchParams(location.search);
const rol = params.get('rol') || 'kind';

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
const loadingOverlay     = document.getElementById('loadingOverlay');

/* =================== Activiteiten (nieuwe namen) =================== */
const activiteiten = [
  { key: null,          label: "—" },
  { key: "bouwhoek",     label: "Bouwhoek" },
  { key: "creahoek",     label: "Creahoek" },
  { key: "meethoek",     label: "Meethoek" },
  { key: "motoriekhoek", label: "Motoriekhoek" },
  { key: "rekenhoek",    label: "Rekenhoek" },
  { key: "schrijfhoek",  label: "Schrijfhoek" },
  { key: "taalhoek",     label: "Taalhoek" },
  { key: "WO_hoek",      label: "WO-hoek" },
  { key: "concentratiehoek",      label: "Concentratiehoek" }
];

/* =================== Basisinstellingen =================== */
const MAX_INIT_RIJ   = 25;
const INIT_KOLOMMEN  = 6;

/* Lazy loader voor kolomiconen & foto's (met default) */
const io = ('IntersectionObserver' in window)
  ? new IntersectionObserver((entries)=>{
      for (const e of entries) {
        if (e.isIntersecting) {
          const img = e.target;
          io.unobserve(img);
          const p = img.dataset.srcPrimair;
          const f = img.dataset.srcFallback;
          const d = img.dataset.srcDefault;
          if (p) {
            img.src = p;
            img.onerror = () => {
              if (f) {
                img.onerror = () => { if (d){ img.onerror=null; img.src=d; } else { img.style.visibility='hidden'; } };
                img.src = f;
              } else if (d) {
                img.onerror = null; img.src = d;
              } else {
                img.style.visibility = 'hidden';
              }
            };
          } else if (f) {
            img.src = f;
            img.onerror = () => { if (d){ img.onerror=null; img.src=d; } else { img.style.visibility='hidden'; } };
          } else if (d) {
            img.src = d;
          }
        }
      }
    }, { root: document.querySelector('#tabelWrapper'), rootMargin: '200px 0px', threshold: 0.01 })
  : null;

/* On-demand script loader (voor PDF) */
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

/* =================== State =================== */
let gebruikerId = null;
const bordDocId = "contractbord";
let bord = { kolommen: [], rijen: [], cellen: {} };

function transparentDataURL(){
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABJ4nYbQAAAABJRU5ErkJggg==";
}
function imageSrcFor(key){ return key ? `contract_afbeeldingen/${key}.png` : transparentDataURL(); }
function leerlingPrimairPad(nr){ return `contract_afbeeldingen/${gebruikerId}/${String(nr).padStart(2,'0')}.png`; }
function leerlingFallbackPad(nr){ return `contract_afbeeldingen/${String(nr).padStart(2,'0')}.png`; }
function leerlingDefaultPad(){ return `contract_afbeeldingen/bibi_default.png`; } // algemene fallback

/* =================== Structuur-borging =================== */
function ensureMinimumStructure(){
  if(!Array.isArray(bord.kolommen)) bord.kolommen = [];
  if(bord.kolommen.length < INIT_KOLOMMEN){
    const start = bord.kolommen.length;
    for(let i=start;i<INIT_KOLOMMEN;i++){ bord.kolommen.push({id:`k${i+1}`, activiteitKey:null}); }
  }
  if(!Array.isArray(bord.rijen) || bord.rijen.length < MAX_INIT_RIJ){
    bord.rijen = Array.from({length:MAX_INIT_RIJ},(_,i)=>i+1);
  }
  if(!bord.cellen) bord.cellen = {};
}
function applyDefaultBoard(){
  bord.kolommen = Array.from({length:INIT_KOLOMMEN},(_,i)=>({id:`k${i+1}`, activiteitKey:null}));
  bord.rijen    = Array.from({length:MAX_INIT_RIJ},(_,i)=>i+1);
  bord.cellen   = {};
}
function normalizeKolommenEnCellen() {
  if (!Array.isArray(bord.kolommen)) return;

  const idMap = {};
  const seen  = new Set();

  // Zorg voor unieke kolom-id's en bouw een map van oude -> nieuwe id's
  bord.kolommen.forEach((kol, index) => {
    const oldId = kol.id || `k${index + 1}`;
    let newId   = oldId;

    if (!newId || seen.has(newId)) {
      newId = `k${index + 1}`;
    }

    kol.id = newId;
    idMap[oldId] = newId;
    seen.add(newId);
  });

  // Herschrijf bord.cellen zodat alles naar de nieuwe id's verwijst
  if (bord.cellen && typeof bord.cellen === 'object') {
    const nieuweCellen = {};

    for (const [rij, kolObj] of Object.entries(bord.cellen)) {
      const nieuweKolObj = {};
      if (kolObj && typeof kolObj === 'object') {
        for (const [kolId, waarde] of Object.entries(kolObj)) {
          const mappedId = idMap[kolId] || kolId;
          nieuweKolObj[mappedId] = waarde;
        }
      }
      nieuweCellen[rij] = nieuweKolObj;
    }

    bord.cellen = nieuweCellen;
  }
}

/* =================== Helpers zichtbare kolommen =================== */
function getVisibleKolommen(){
  // In kindmodus: enkel kolommen met activiteit; in leerkracht: alle
  return (rol === 'kind')
    ? bord.kolommen.filter(k => !!k.activiteitKey)
    : bord.kolommen;
}
function getInvisibleKolomIndexes(){
  // indexes (0-based binnen kolommen-array) die leeg zijn
  const res = [];
  bord.kolommen.forEach((k,i)=>{ if(!k.activiteitKey) res.push(i); });
  return res;
}

/* =================== Acties =================== */
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

/* =================== Auth =================== */
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

/* =================== Firestore =================== */
function getBordRef(){ return doc(db, "leerkrachten", gebruikerId, "borden", bordDocId); }
async function laadOfMaakBord(magAanmaken=true){
  try{
    const ref = getBordRef(); const snap = await getDoc(ref);
    if(snap.exists()){
      bord = snap.data();
      ensureMinimumStructure();
      normalizeKolommenEnCellen();
      await setDoc(ref, bord, {merge:true});
    } else if(magAanmaken){
      applyDefaultBoard();
      ensureMinimumStructure();
      normalizeKolommenEnCellen();
      await setDoc(ref, bord);
    } else {
      applyDefaultBoard();
      ensureMinimumStructure();
      normalizeKolommenEnCellen();
    }
  }catch{
    applyDefaultBoard();
    ensureMinimumStructure();
    normalizeKolommenEnCellen();
  }
}

async function bewaarBord(patch){
  Object.assign(bord, patch);
  try{ await updateDoc(getBordRef(), patch); }
  catch{ await setDoc(getBordRef(), bord, {merge:true}); }
}
window.bewaarBord = bewaarBord;

/* =================== Rendering =================== */
function render(){
  ensureMinimumStructure();
  normalizeKolommenEnCellen();
  window.bord = bord;
  const kolommenZichtbaar = getVisibleKolommen();

  // KOP rij 1 (selects) — enkel voor leerkracht
  headerRij.innerHTML = '';
  if(rol === 'leerkracht'){
    const thLabel = document.createElement('th');
    thLabel.className = 'sticky-left sticky-top cel-label';
    thLabel.textContent = 'Nr.';
    headerRij.appendChild(thLabel);

    for(const kol of bord.kolommen) headerRij.appendChild(maakKolomKop(kol));

    // + kolom (alleen leerkracht)
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
    headerRij.style.display = 'none'; // in kindmodus geen kop met selects (en dus geen +)
  }

  // KOP rij 2 (pictogrammen)
  headerAfbeeldingen.innerHTML = '';
  const leeg = document.createElement('th');
  leeg.className = 'sticky-left sticky-top-2 subheader';
  headerAfbeeldingen.appendChild(leeg);

  for(const kol of kolommenZichtbaar){
    const th = document.createElement('th');
    th.className = 'sticky-top-2 subheader';

    const img = document.createElement('img');
    img.className = 'kolom-afb';
    img.alt = "";
    img.decoding = 'async';
    img.loading = 'lazy';
    img.style.width = '64px';
    img.style.height = '64px';
    img.style.objectFit = 'contain';

    const bron = imageSrcFor(kol.activiteitKey);
    img.dataset.srcFallback = bron;
    if (io) io.observe(img); else img.src = bron;

    th.appendChild(img);
    headerAfbeeldingen.appendChild(th);
  }
  // GEEN lege trailing header in kindmodus:
  if (rol === 'leerkracht') {
    const leeg2 = document.createElement('th');
    leeg2.className = 'sticky-top-2 subheader';
    headerAfbeeldingen.appendChild(leeg2);
  }

  // BODY – ALLE rijen in één keer (altijd minstens 25)
  bodyRijen.innerHTML = '';
  const frag = document.createDocumentFragment();
  for(const r of bord.rijen){
    frag.appendChild(maakRijElement(r, kolommenZichtbaar));
  }
  bodyRijen.appendChild(frag);
  window.render = render;
}

function maakRijElement(r, kolommenZichtbaar){
  const tr = document.createElement('tr');

  const th = document.createElement('th');
  th.className = 'sticky-left rij-label';
  const wrap = document.createElement('div');
  wrap.className = 'leerling-label';

  const foto = document.createElement('img');
  foto.className = 'leerling-foto';
  foto.alt = "";
  foto.decoding = 'async';
  foto.loading = 'lazy';
  foto.width = 48;
  foto.height = 48;
  foto.style.objectFit = 'contain';

  const prim = leerlingPrimairPad(r);
  const fall = leerlingFallbackPad(r);
  const def  = leerlingDefaultPad();

  if (io) {
    foto.dataset.srcPrimair  = prim;
    foto.dataset.srcFallback = fall;
    foto.dataset.srcDefault  = def;
    io.observe(foto);
  } else {
    foto.src = prim;
    foto.onerror = () => { foto.onerror = () => { foto.onerror = null; foto.src = def; }; foto.src = fall; };
  }

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
        bord.rijen = bord.rijen.filter(n => n !== r);
        if (bord.cellen && bord.cellen[r]) delete bord.cellen[r];
        render();
        try { await bewaarBord({ rijen: bord.rijen, cellen: bord.cellen }); } catch {}
      }
    };
    wrap.appendChild(delBtn);
  }

  th.appendChild(wrap);
  tr.appendChild(th);

  for(const kol of kolommenZichtbaar){
    const status = bord.cellen?.[r]?.[kol.id] || 'leeg';
    tr.appendChild(maakStatusCel(r, kol.id, status));
  }

  // GEEN lege trailing cel in kindmodus:
  if (rol === 'leerkracht') {
    tr.appendChild(document.createElement('td'));
  }

  return tr;
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

/* =================== PDF: header op elke pagina + enkel bolletjes; lege & plus-kolom weg =================== */
btnPdf?.addEventListener('click', async ()=>{ await downloadContractbordPdf(); });

// hulpfunctie: verwijder kolommen op absolute posities (0-based)
function removeColumnsByPositions(tableEl, positionsAbs){
  if (!positionsAbs?.length) return;
  const positions = [...positionsAbs].sort((a,b)=>b-a); // van hoog naar laag verwijderen
  const sections = [
    ...(tableEl.tHead ? Array.from(tableEl.tHead.rows) : []),
    ...(tableEl.tBodies[0] ? Array.from(tableEl.tBodies[0].rows) : [])
  ];
  for(const row of sections){
    for(const pos of positions){
      if (row.children[pos]) row.removeChild(row.children[pos]);
    }
  }
}

async function downloadContractbordPdf(){
  loadingOverlay?.classList.add('show');
  try{
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;

    // 1) Kloon tabel buiten beeld
    const off = document.createElement('div');
    off.style.position = 'fixed'; off.style.left = '-99999px'; off.style.top = '0';

    const clone = tabelEl.cloneNode(true);
    clone.style.tableLayout = 'fixed';
    clone.style.borderCollapse = 'collapse';

    // verwijder sticky
    clone.querySelectorAll('.sticky-left,.sticky-top,.sticky-top-2')
         .forEach(el=>el.classList.remove('sticky-left','sticky-top','sticky-top-2'));

    // Verwijder ALLE knoppen behalve de statusbolletjes
    clone.querySelectorAll('button:not(.bolletje)').forEach(b=>b.remove());
    // Verwijder de 3 keuzekleuren volledig
    clone.querySelectorAll('.kleur-choices').forEach(div=>div.remove());
    // Vervang selects door platte tekst
    clone.querySelectorAll('select').forEach(sel=>{
      const txt = document.createElement('div');
      txt.textContent = sel.options[sel.selectedIndex]?.text || '';
      txt.style.padding = '6px 8px';
      sel.replaceWith(txt);
    });
    // vaste afmetingen voor afbeeldingen in de kloon (geen uitrekken)
    clone.querySelectorAll('img.kolom-afb').forEach(img=>{
      img.style.width='64px'; img.style.height='64px'; img.style.objectFit='contain';
    });
    clone.querySelectorAll('img.leerling-foto').forEach(img=>{
      img.style.width='48px'; img.style.height='48px'; img.style.objectFit='contain';
    });

    // 1b) Lege kolommen verwijderen (zoals in kindmodus)
    const leegIdx = getInvisibleKolomIndexes(); // 0-based binnen kolommen-array
    // map naar absolute posities in de tabel: +1 wegens eerste "Nr."-kolom
    const absPositions = leegIdx.map(i => 1 + i);

    // 1c) Verwijder ook de PLUS-kolom (indien aanwezig in clone)
    const plusTh = clone.querySelector('thead tr#headerRij th.cel-plus');
    if (plusTh) {
      absPositions.push(plusTh.cellIndex); // absolute positie in de rij
    }
    // Er staat in de tweede header-rij vaak ook een trailing leeg TH dat bij de plus-kolom hoort; die valt automatisch weg doordat we dezelfde index verwijderen in alle rijen.

    removeColumnsByPositions(clone, absPositions);

    // 2) Kolombreedtes vastleggen met colgroup — op basis van de KLOON (na verwijderen)
    const cloneFirstBodyRow = clone.querySelector('tbody tr');
    if (cloneFirstBodyRow){
      const srcCells = [...cloneFirstBodyRow.children];
      const colgroup = document.createElement('colgroup');
      for(let i=0;i<srcCells.length;i++){
        const w = srcCells[i].getBoundingClientRect().width || 100;
        const col = document.createElement('col');
        col.style.width = Math.round(w) + 'px';
        colgroup.appendChild(col);
      }
      clone.insertBefore(colgroup, clone.firstChild);
    }

    off.appendChild(clone);
    document.body.appendChild(off);

    const thead = clone.querySelector('thead');
    const tbody = clone.querySelector('tbody');

    // 3) Render aparte canvassen
    const headerCanvas = await window.html2canvas(thead, { scale: 2, backgroundColor: '#FFFFFF' });
    const bodyCanvas   = await window.html2canvas(tbody, { scale: 2, backgroundColor: '#FFFFFF' });

    // Rijomzetten css->canvas px
    const bodyRect = tbody.getBoundingClientRect();
    const rowEls   = Array.from(tbody.querySelectorAll('tr'));
    const cssTop   = rowEls.map(tr => tr.getBoundingClientRect().top - bodyRect.top);
    const cssBot   = rowEls.map(tr => tr.getBoundingClientRect().bottom - bodyRect.top);
    const scale    = bodyCanvas.width / bodyRect.width;
    const rowsTopPx = cssTop.map(v => Math.round(v * scale));
    const rowsBotPx = cssBot.map(v => Math.round(v * scale));

    off.remove();

    // 4) Pagineren (header op elke pagina)
    const pdf = new jsPDF('l','pt','a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 18;

    const headerRatio    = pageW / headerCanvas.width;
    const headerHeightPt = headerCanvas.height * headerRatio;

    const bodyRatio      = pageW / bodyCanvas.width;
    const usableBodyPt   = pageH - margin*2 - headerHeightPt;
    const bodyPxPerPage  = Math.floor(usableBodyPt / bodyRatio);

    let startRow = 0, page = 0;
    while (startRow < rowsTopPx.length) {
      let endRow = startRow;
      while (endRow < rowsTopPx.length) {
        const sliceTop    = rowsTopPx[startRow];
        const sliceBottom = rowsBotPx[endRow];
        const sliceHeight = sliceBottom - sliceTop;
        if (sliceHeight <= bodyPxPerPage) endRow++;
        else break;
      }
      if (endRow === startRow) endRow = startRow + 1;

      const sliceTopPx    = rowsTopPx[startRow];
      const sliceBottomPx = rowsBotPx[endRow-1];
      const sliceHeightPx = sliceBottomPx - sliceTopPx;

      if (page > 0) pdf.addPage();
      pdf.addImage(headerCanvas.toDataURL('image/png'), 'PNG', 0, margin, pageW, headerHeightPt);

      const png = canvasSliceToPng(bodyCanvas, 0, sliceTopPx, bodyCanvas.width, sliceHeightPx);
      pdf.addImage(png, 'PNG', 0, margin + headerHeightPt, pageW, sliceHeightPx * bodyRatio);

      page++; startRow = endRow;
    }

    pdf.save('contractbord.pdf');
  }catch(err){
    console.error(err);
    alert('PDF genereren is mislukt. Probeer opnieuw.');
  } finally {
    loadingOverlay?.classList.remove('show');
  }
}

function canvasSliceToPng(sourceCanvas, sx, sy, sw, sh){
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const ctx = c.getContext('2d'); ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return c.toDataURL('image/png');
}

/* =================== QR =================== */
btnToonQR?.addEventListener('click', ()=>{
  const dlg = document.getElementById('qrDialog');
  const canvas = document.getElementById('qrCanvas');
  const url = `${location.origin}${location.pathname.replace('contract_board.html','contract_board.html')}?rol=kind&lid=${gebruikerId}`;
  window.QRCode.toCanvas(canvas, url, {width:256}, (err)=>{ if(err)console.error(err); dlg.showModal(); });
});

/* =================== Kindmodus: sluitknop =================== */
function voegKindSluitKnopToe(){
  const btn = document.createElement('button');
  btn.className = 'kind-exit'; btn.title='Sluiten';
  btn.onclick = ()=>{ location.href = 'index.html'; };
  document.body.appendChild(btn);
}

/* =================== Extra knoppen =================== */
btnRijPlus?.addEventListener('click', ()=>{
  const max = Math.max(...bord.rijen, 0);
  const nieuw = max + 1;
  bord.rijen = [...bord.rijen, nieuw];
  render();
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

function ensureUniqueKolomIds() {
  const seen = new Set();
  bord.kolommen.forEach((k, i) => {
    if (!k.id || seen.has(k.id)) {
      k.id = `k${i + 1}`;
    }
    seen.add(k.id);
  });
}

/* =================== Start =================== */
initAuth();








