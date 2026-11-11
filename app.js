// Giochi: PWA per giocare sul telefono con EmulatorJS (versione fissa in vendor/emulatorjs).
// ROM e salvataggi stanno solo in IndexedDB su questo dispositivo: l'app non li manda in rete.
//
// Salvataggi:
// - il salvataggio vero è quello del gioco (.srm, più .rtc per l'orologio di Argento): RetroArch lo
//   tiene in /data/saves/<Core>/ (IndexedDB di EmulatorJS) e qui lo copiamo nel nostro database
//   ogni 10 secondi se cambia e quando l'app va in background;
// - l'istantanea automatica (stato completo dell'emulatore) si fa quando l'app va in background
//   o si torna alla libreria, e serve per "Riprendi".
'use strict';

const SISTEMI = {
  gb: { nome: 'Game Boy Color', est: 'gbc', core: 'Gambatte', aspetto: 10 / 9 },
  gba: { nome: 'Game Boy Advance', est: 'gba', core: 'mGBA', aspetto: 3 / 2 },
};
// Giochi riconosciuti dal CRC32 della ROM: nome della scheda e dimensione del salvataggio.
const NOTI = {
  cba6d2d4: { id: 'argento', nome: 'Pokémon Argento', sistema: 'gb', srm: 0x8000 },
  '73a72167': { id: 'rossofuoco', nome: 'Pokémon Rosso Fuoco', sistema: 'gba', srm: 0x20000 },
};
const TASTI = { B: 0, SELECT: 2, START: 3, SU: 4, GIU: 5, SX: 6, DX: 7, A: 8, L: 10, R: 11 };
const EJS = 'vendor/emulatorjs/';
const SCRIPT_EJS = ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'compression.js'];

const $ = sel => document.querySelector(sel);
const attesa = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ database

let dbPromessa;
function db() {
  dbPromessa ||= new Promise((ok, ko) => {
    const r = indexedDB.open('giochi-app', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('giochi', { keyPath: 'id' });   // {id, nome, sistema, crc, romNome, rom: Blob}
      r.result.createObjectStore('file', { keyPath: 'chiave' }); // {chiave: 'id/tipo', gioco, tipo, dati, quando}
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  return dbPromessa;
}
async function tx(store, modo, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const t = d.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => ok(req ? req.result : undefined);
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error);
  });
}
const dbGet = (store, k) => tx(store, 'readonly', s => s.get(k));
const dbAll = store => tx(store, 'readonly', s => s.getAll());
const dbPut = (store, v) => tx(store, 'readwrite', s => s.put(v));
const dbDel = (store, k) => tx(store, 'readwrite', s => s.delete(k));

// tipi: srm (salvataggio di gioco), rtc (orologio), autostato (per Riprendi), statoDaCaricare (importato)
const leggiFile = (id, tipo) => dbGet('file', id + '/' + tipo);
const scriviFile = (id, tipo, dati, quando = Date.now()) =>
  dbPut('file', { chiave: id + '/' + tipo, gioco: id, tipo, dati, quando });
const cancellaFile = (id, tipo) => dbDel('file', id + '/' + tipo);

// ------------------------------------------------------------------ utilità

const TAB_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = TAB_CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

// Primo file dello zip con una delle estensioni date (zip "stored" o "deflate").
async function estraiDaZip(buf, estensioni) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fine = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { fine = i; break; }
  }
  if (fine < 0) throw new Error('lo zip non è valido');
  let p = dv.getUint32(fine + 16, true);
  for (let k = dv.getUint16(fine + 10, true); k > 0; k--) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('lo zip non è valido');
    const metodo = dv.getUint16(p + 10, true);
    const compressi = dv.getUint32(p + 20, true);
    const originali = dv.getUint32(p + 24, true);
    const lnome = dv.getUint16(p + 28, true);
    const locale = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + lnome));
    p += 46 + lnome + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (!estensioni.some(e => nome.toLowerCase().endsWith(e))) continue;
    const inizio = locale + 30 + dv.getUint16(locale + 26, true) + dv.getUint16(locale + 28, true);
    const dati = buf.subarray(inizio, inizio + compressi);
    let out;
    if (metodo === 0) out = dati.slice();
    else if (metodo === 8) {
      const flusso = new Blob([dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out = new Uint8Array(await new Response(flusso).arrayBuffer());
    } else throw new Error('compressione dello zip non supportata');
    if (out.length !== originali) throw new Error('lo zip è danneggiato');
    return { nome: nome.split('/').pop(), dati: out };
  }
  throw new Error('nello zip non c\'è un gioco (' + estensioni.join(', ') + ')');
}

const vuoto = u8 => u8.every(x => x === 0xFF) || u8.every(x => x === 0);
function uguali(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const quandoTesto = ms => new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(ms);
const oggi = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

let timerAvviso;
function avviso(msg, ms = 4000) {
  const el = $('#avviso');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => { el.hidden = true; }, ms);
}

function scarica(nome, dati) {
  const url = URL.createObjectURL(new Blob([dati], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function chiediPersistenza() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* non supportato */ }
}

// ------------------------------------------------------------------ libreria

function infoGioco(id, rec) {
  const noto = Object.values(NOTI).find(n => n.id === id);
  const sistema = rec ? rec.sistema : noto.sistema;
  return { id, nome: rec ? rec.nome : noto.nome, sistema, srm: noto ? noto.srm : null, rec };
}

function elemento(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo !== undefined) el.textContent = testo;
  return el;
}

function tasto(testo, azione, classe = 'tasto') {
  const b = elemento('button', classe, testo);
  b.type = 'button';
  b.addEventListener('click', azione);
  return b;
}

async function mostraLibreria() {
  const giochi = await dbAll('giochi');
  const perId = {};
  for (const f of await dbAll('file')) (perId[f.gioco] ||= {})[f.tipo] = f;
  const ids = Object.values(NOTI).map(n => n.id);
  for (const g of giochi) if (!ids.includes(g.id)) ids.push(g.id);

  const box = $('#schede');
  box.replaceChildren();
  for (const id of ids) {
    const g = infoGioco(id, giochi.find(x => x.id === id));
    const f = perId[id] || {};
    const scheda = elemento('article', 'scheda');
    const titolo = elemento('div', 'scheda-titolo');
    titolo.append(elemento('h2', '', g.nome), elemento('span', 'sistema', SISTEMI[g.sistema].nome));
    scheda.append(titolo);

    const righe = elemento('ul', 'righe');
    const riga = (testo, stato = '') => righe.append(elemento('li', stato, testo));
    if (!g.rec) riga('Gioco da importare (file .zip, .gbc o .gba)', 'manca');
    if (f.srm) riga('Salvataggio di gioco: ' + quandoTesto(f.srm.quando), 'ok');
    else riga('Nessun salvataggio di gioco', g.rec ? 'manca' : '');
    if (f.statoDaCaricare) riga('Istantanea importata: si carica al prossimo avvio', 'ok');
    else if (f.autostato) riga('Da riprendere: ' + quandoTesto(f.autostato.quando));
    scheda.append(righe);

    const azioni = elemento('div', 'azioni');
    if (!g.rec) azioni.append(tasto('Importa gioco', () => $('#file-gioco').click()));
    else if (f.autostato && !f.statoDaCaricare) {
      azioni.append(tasto('Riprendi', () => avviaGioco(id, 'riprendi')));
      azioni.append(tasto('Dal salvataggio', () => avviaGioco(id, 'salvataggio'), 'tasto secondario'));
    } else azioni.append(tasto('Gioca', () => avviaGioco(id, 'salvataggio')));
    azioni.append(tasto('Importa salvataggio', () => sceltaSalvataggio(id), 'tasto secondario'));
    if (f.srm || f.autostato) azioni.append(tasto('Esporta backup', () => esportaBackup(id), 'tasto secondario'));
    scheda.append(azioni);
    box.append(scheda);
  }
  mostraMemoria();
}

async function mostraMemoria() {
  try {
    const stima = await navigator.storage.estimate();
    const persistente = await navigator.storage.persisted();
    $('#memoria').textContent = 'Spazio usato: ' + (stima.usage / 1048576).toFixed(0) + ' MB · memoria '
      + (persistente ? 'protetta dalla pulizia automatica' : 'non ancora protetta (si chiede al primo import)');
  } catch (e) { $('#memoria').textContent = ''; }
}

// ------------------------------------------------------------------ import

async function importaGioco(file) {
  let dati = new Uint8Array(await file.arrayBuffer());
  let nome = file.name;
  if (dati[0] === 0x50 && dati[1] === 0x4b) ({ nome, dati } = await estraiDaZip(dati, ['.gbc', '.gb', '.gba']));
  const crc = crc32(dati);
  const noto = NOTI[crc];
  const sistema = noto ? noto.sistema : /\.gba$/i.test(nome) ? 'gba' : /\.gbc?$/i.test(nome) ? 'gb' : null;
  if (!sistema) throw new Error('non riconosco il tipo di gioco: ' + nome);
  const id = noto ? noto.id : 'g' + crc;
  const titolo = noto ? noto.nome : nome.replace(/\.[^.]+$/, '').replace(/\s*\([^)]*\)/g, '').trim();
  await dbPut('giochi', { id, nome: titolo, sistema, crc, romNome: nome, rom: new Blob([dati]), importato: Date.now() });
  await chiediPersistenza();
  avviso('Importato: ' + titolo);
}

let destinazioneSalvataggio = null;
function sceltaSalvataggio(id) {
  destinazioneSalvataggio = id;
  $('#file-salvataggio').value = '';
  $('#file-salvataggio').click();
}

async function importaSalvataggi(id, files) {
  const g = infoGioco(id, await dbGet('giochi', id));
  const fatti = [];
  for (const file of files) {
    const est = file.name.split('.').pop().toLowerCase();
    const dati = new Uint8Array(await file.arrayBuffer());
    if (est === 'srm' || est === 'sav') {
      if (g.srm && dati.length < g.srm) throw new Error(file.name + ': è troppo piccolo per ' + g.nome);
      if (vuoto(dati)) throw new Error(file.name + ': il salvataggio è vuoto');
      await scriviFile(id, 'srm', dati);
      await cancellaFile(id, 'autostato'); // l'istantanea vecchia sovrascriverebbe il salvataggio importato
      fatti.push('salvataggio');
    } else if (est === 'rtc') {
      await scriviFile(id, 'rtc', dati);
      fatti.push('orologio');
    } else if (est === 'state') {
      if (new TextDecoder().decode(dati.subarray(0, 7)) !== 'RASTATE') throw new Error(file.name + ': non è un\'istantanea di EmulatorJS');
      await scriviFile(id, 'statoDaCaricare', dati);
      await cancellaFile(id, 'autostato');
      fatti.push('istantanea');
    } else throw new Error(file.name + ': tipo di file non riconosciuto');
  }
  await chiediPersistenza();
  avviso(g.nome + ': importato ' + fatti.join(', '));
}

// ------------------------------------------------------------------ gioco

let partita = null; // { id, sistema, ejs, cartella, ultimoSrm, ultimoRtc, velocita, wakeLock }

function caricaScript(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error('non riesco a caricare ' + src));
    document.head.appendChild(s);
  });
}
async function caricaMotore() {
  if (window.EmulatorJS) return;
  for (const f of SCRIPT_EJS) await caricaScript(EJS + 'src/' + f);
}

async function avviaGioco(id, modo) {
  const rec = await dbGet('giochi', id);
  const sis = SISTEMI[rec.sistema];
  $('#libreria').hidden = true;
  $('#gioco').hidden = false;
  $('#gioco').style.setProperty('--aspetto', sis.aspetto);
  $('#comandi').dataset.sistema = rec.sistema;

  const [srm, rtc, auto, importato] = await Promise.all(
    ['srm', 'rtc', 'autostato', 'statoDaCaricare'].map(t => leggiFile(id, t)));
  const stato = importato || (modo === 'riprendi' ? auto : null);
  await caricaMotore();
  const lingua = await (await fetch(EJS + 'localization/it-IT.json')).json();
  const cartella = '/data/saves/' + sis.core + '/';
  const ejs = new EmulatorJS('#schermo', {
    gameUrl: new File([rec.rom], id + '.' + sis.est), // nome fisso: i salvataggi si chiamano <id>.srm
    dataPath: EJS,
    system: rec.sistema,
    startOnLoad: true,
    forceLegacyCores: true,
    language: 'it-IT',
    langJson: lingua,
    backgroundColor: '#000',
    defaultOptions: { 'virtual-gamepad': 'disabled' }, // i comandi touch sono i nostri (#comandi)
    buttonOpts: {
      playPause: false, restart: false, mute: false, settings: false, fullscreen: false, saveState: false,
      loadState: false, screenRecord: false, gamepad: false, cheat: false, volumeSlider: false,
      saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false, screenshot: false,
      cacheManager: false, exitEmulation: false, netplay: false, diskButton: false,
    },
  });
  partita = { id, sistema: rec.sistema, ejs, cartella, ultimoSrm: srm && srm.dati, ultimoRtc: rtc && rtc.dati, velocita: 1 };
  window.EJS_emulator = ejs;

  // Prima che parta il core: in /data/saves va il salvataggio più recente tra il nostro e quello di EmulatorJS.
  ejs.on('saveDatabaseLoaded', FS => {
    try { FS.mkdir(cartella); } catch (e) { /* esiste già */ }
    for (const [tipo, nostro] of [['srm', srm], ['rtc', rtc]]) {
      const p = cartella + id + '.' + tipo;
      let suo = 0;
      try { suo = +FS.stat(p).mtime; } catch (e) { /* non c'è */ }
      if (nostro && nostro.quando >= suo) FS.writeFile(p, nostro.dati);
    }
  });
  ejs.on('start', async () => {
    if (stato) {
      await attesa(300);
      ejs.gameManager.loadState(stato.dati);
      if (importato) await cancellaFile(id, 'statoDaCaricare');
    }
    partita.timer = setInterval(() => sincronizza().catch(console.error), 10000);
    tieniAcceso();
  });
}

function leggiFS(percorso) {
  try { return partita.ejs.gameManager.FS.readFile(percorso); } catch (e) { return null; }
}

// Copia nel nostro database .srm e .rtc se sono cambiati. Non sovrascrive mai un salvataggio con uno vuoto.
async function sincronizza() {
  if (!partita || !partita.ejs.started) return;
  const gm = partita.ejs.gameManager;
  gm.saveSaveFiles(); // RetroArch scrive ora .srm e .rtc
  const base = partita.cartella + partita.id;
  const srm = leggiFS(base + '.srm');
  const rtc = leggiFS(base + '.rtc');
  if (srm && !uguali(srm, partita.ultimoSrm) && !(vuoto(srm) && partita.ultimoSrm && !vuoto(partita.ultimoSrm))) {
    await scriviFile(partita.id, 'srm', srm.slice());
    partita.ultimoSrm = srm.slice();
  }
  if (rtc && !uguali(rtc, partita.ultimoRtc)) {
    await scriviFile(partita.id, 'rtc', rtc.slice());
    partita.ultimoRtc = rtc.slice();
  }
}

async function salvaAutostato() {
  if (!partita || !partita.ejs.started) return;
  try {
    await scriviFile(partita.id, 'autostato', partita.ejs.gameManager.getState().slice());
  } catch (e) { console.error('istantanea automatica non riuscita', e); }
}

async function tieniAcceso() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      partita.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* negato o non supportato */ }
}

document.addEventListener('visibilitychange', () => {
  if (!partita) return;
  if (document.visibilityState === 'hidden') {
    sincronizza().then(salvaAutostato).catch(console.error);
  } else tieniAcceso();
});

async function tornaAllaLibreria() {
  if (partita) {
    clearInterval(partita.timer);
    await sincronizza();
    await salvaAutostato();
  }
  location.reload(); // EmulatorJS non si smonta: ricaricare libera la memoria
}

function cambiaVelocita() {
  if (!partita || !partita.ejs.started) return;
  const prossima = { 1: 2, 2: 4, 4: 1 }[partita.velocita];
  const gm = partita.ejs.gameManager;
  if (prossima > 1) gm.setFastForwardRatio(prossima);
  gm.toggleFastForward(prossima > 1 ? 1 : 0);
  partita.ejs.isFastForward = prossima > 1;
  partita.velocita = prossima;
  $('#veloce').textContent = prossima + '×';
}

async function schermoIntero() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation.lock('portrait').catch(() => {});
    }
  } catch (e) { avviso('Schermo intero non disponibile'); }
}

async function esportaBackup(id) {
  if (partita && partita.id === id) {
    await sincronizza();
    await salvaAutostato();
  }
  const usciti = [];
  for (const [tipo, est] of [['srm', 'srm'], ['rtc', 'rtc'], ['autostato', 'state']]) {
    const f = await leggiFile(id, tipo);
    if (!f) continue;
    scarica(oggi() + '-' + id + '.' + est, f.dati);
    usciti.push(est);
    await attesa(600);
  }
  avviso(usciti.length ? 'Backup in Download: ' + usciti.join(', ') : 'Niente da esportare');
}

// ------------------------------------------------------------------ comandi touch

function premi(nome, giu) {
  if (!partita || !partita.ejs.started) return;
  partita.ejs.gameManager.simulateInput(0, TASTI[nome], giu ? 1 : 0);
}
const vibra = () => {
  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(12);
};

function collegaPulsanti() {
  for (const b of document.querySelectorAll('#comandi [data-tasto]')) {
    const giu = e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('premuto');
      premi(b.dataset.tasto, true);
      vibra();
    };
    const su = () => {
      if (!b.classList.contains('premuto')) return;
      b.classList.remove('premuto');
      premi(b.dataset.tasto, false);
    };
    b.addEventListener('pointerdown', giu);
    b.addEventListener('pointerup', su);
    b.addEventListener('pointercancel', su);
    b.addEventListener('lostpointercapture', su);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Croce: una zona sola, la direzione si calcola dall'angolo (diagonali strette, 30°).
  const croce = $('#croce');
  let attive = new Set();
  const aggiorna = nuove => {
    for (const d of attive) if (!nuove.has(d)) premi(d, false);
    let nuova = false;
    for (const d of nuove) if (!attive.has(d)) { premi(d, true); nuova = true; }
    if (nuova) vibra();
    attive = nuove;
    croce.dataset.dir = [...nuove].join(' ');
  };
  const direzioni = e => {
    const r = croce.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 2 - 1;
    const y = (e.clientY - r.top) / r.height * 2 - 1;
    const s = new Set();
    if (Math.hypot(x, y) < 0.22) return s;
    const a = Math.atan2(y, x) * 180 / Math.PI; // 0 = destra, 90 = giù
    if (a > -60 && a < 60) s.add('DX');
    if (a > 30 && a < 150) s.add('GIU');
    if (a > 120 || a < -120) s.add('SX');
    if (a > -150 && a < -30) s.add('SU');
    return s;
  };
  croce.addEventListener('pointerdown', e => { e.preventDefault(); croce.setPointerCapture(e.pointerId); aggiorna(direzioni(e)); });
  croce.addEventListener('pointermove', e => { if (croce.hasPointerCapture(e.pointerId)) aggiorna(direzioni(e)); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) croce.addEventListener(ev, () => aggiorna(new Set()));
  croce.addEventListener('contextmenu', e => e.preventDefault());
}

// ------------------------------------------------------------------ avvio

$('#importa-gioco').addEventListener('click', () => { $('#file-gioco').value = ''; $('#file-gioco').click(); });
$('#file-gioco').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try { avviso('Importo ' + f.name + '…', 60000); await importaGioco(f); } catch (err) { avviso('Errore: ' + err.message, 8000); }
  mostraLibreria();
});
$('#file-salvataggio').addEventListener('change', async e => {
  const files = [...e.target.files];
  if (!files.length || !destinazioneSalvataggio) return;
  try { await importaSalvataggi(destinazioneSalvataggio, files); } catch (err) { avviso('Errore: ' + err.message, 8000); }
  mostraLibreria();
});
$('#esci').addEventListener('click', tornaAllaLibreria);
$('#veloce').addEventListener('click', cambiaVelocita);
$('#backup').addEventListener('click', () => partita && esportaBackup(partita.id));
$('#schermo-intero').addEventListener('click', schermoIntero);
collegaPulsanti();
mostraLibreria();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker', e));
}
