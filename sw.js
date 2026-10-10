// Offline cache for the app shell. Bump CACHE (and js/version.js) on every release.
const CACHE = 'lexis-v1.1.1';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/app.js', 'js/store.js', 'js/srs.js', 'js/util.js', 'js/dict.js', 'js/tts.js', 'js/prompts.js', 'js/version.js',
  'js/vendor/ts-fsrs.mjs',
  'js/data/constants.js', 'js/data/phrases.js', 'js/data/topics.js', 'js/data/errors.js',
  'js/views/today.js', 'js/views/study.js', 'js/views/add.js', 'js/views/list.js', 'js/views/note.js',
  'js/views/enrich.js', 'js/views/write.js', 'js/views/profile.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('lexis-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Same-origin: cache first (fast + offline). Cross-origin (dictionary APIs, audio): network only.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match('index.html'))),
  );
});
