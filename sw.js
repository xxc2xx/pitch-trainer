const CACHE = 'pt-v36';
// Both apps (live AND staging) share Cache Storage on xxc2xx.github.io: only
// ever delete OUR caches (same prefix). The old 'pitch-vN' names are still
// LIVE Pitch Trainer's current cache until go-live — never touch them.
const PREFIX = CACHE.replace(/v\d+$/, '');

const STATIC = ['./icon-192.png', './icon-512.png', './manifest.json', './pixel-avatar.js', './songs.js', './hear.js', './sound.js', './midi.js', './songfile.js', './addsong.js', './studio.js',
                './music-core.js', './piano.js', './echo.js', './today.js', './notes.js', './progress.js', './garden.js'];

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith(PREFIX)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Revalidate with the server every time (cheap ETag check): the HTTP
  // cache (Pages: max-age 600) would otherwise serve a stale module for up
  // to 10 min after a deploy, and old JS against new HTML breaks.
  // (A navigate-mode Request can't be re-inited — refetch those by URL.)
  // Always fetch HTML and JS fresh so app updates are picked up immediately
  // (JS modules ship in lockstep with index.html — a stale piano.js against a
  // new index.html breaks). Cache is only the offline fallback.
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') ||
      url.pathname.endsWith('/') || url.pathname === '') {
    e.respondWith(
      fetch(e.request.mode === 'navigate' ? e.request.url : e.request, { cache: 'no-cache' }).then(r => {
        // keep the latest modules as the offline copy — never the HTML: an
        // old cached page booting newer scripts is worse than no offline page
        if (r.ok && url.pathname.endsWith('.js')) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  // Cache-first for static assets (icons, manifest)
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
