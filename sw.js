// sw.js: mette in cache app ed EmulatorJS (con i 2 core) per giocare offline.
// ROM e salvataggi non passano mai di qui: stanno in IndexedDB.

const CACHE = 'giochi-v1'; // cambiarlo a ogni pubblicazione per aggiornare i file

const FILE = [
  './',
  'index.html',
  'app.js',
  'style.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/emulatorjs/emulator.css',
  'vendor/emulatorjs/src/emulator.js',
  'vendor/emulatorjs/src/nipplejs.js',
  'vendor/emulatorjs/src/shaders.js',
  'vendor/emulatorjs/src/storage.js',
  'vendor/emulatorjs/src/gamepad.js',
  'vendor/emulatorjs/src/GameManager.js',
  'vendor/emulatorjs/src/compression.js',
  'vendor/emulatorjs/compression/extract7z.js',
  'vendor/emulatorjs/compression/extractzip.js',
  'vendor/emulatorjs/localization/it-IT.json',
  'vendor/emulatorjs/cores/reports/gambatte.json',
  'vendor/emulatorjs/cores/reports/mgba.json',
  'vendor/emulatorjs/cores/gambatte-legacy-wasm.data',
  'vendor/emulatorjs/cores/mgba-legacy-wasm.data',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith('giochi-v')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
