const CACHE = 'pt-v22';
// Both apps live on xxc2xx.github.io and share Cache Storage: only ever
// delete OUR caches (same prefix) plus the old shared 'pitch-vN' names both
// apps used before they had their own prefixes.
const PREFIX = CACHE.replace(/v\d+$/, '');

const STATIC = ['./icon-192.png', './icon-512.png', './manifest.json', './pixel-avatar.js', './songs.js', './hear.js', './sound.js', './midi.js', './songfile.js', './addsong.js', './studio.js',
                './music-core.js', './piano.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && (k.startsWith(PREFIX) || /^(staging-)?pitch-v\d+$/.test(k))).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always fetch HTML and JS fresh so app updates are picked up immediately
  // (JS modules ship in lockstep with index.html — a stale piano.js against a
  // new index.html breaks). Cache is only the offline fallback.
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') ||
      url.pathname.endsWith('/') || url.pathname === '') {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r.ok && url.pathname.endsWith('.js')) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest)
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
