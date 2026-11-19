/* Keeps the Judge Log working with no signal.
 * App files are served from the phone's cache and refreshed in the background
 * whenever there is signal. Bump VERSION when files are added or removed.
 * 'judge-log-ref' holds the latest Beyond the Sniff for Search (see reference-sync.js) and is kept between versions. */
const VERSION = 'judge-log-v19';
const APP_FILES = [
  './', 'index.html', 'report.html', 'reference.html', 'reference-data.js', 'reference-sync.js', 'privacy.html', 'styles.css', 'app.js', 'training-ui.js', 'forms.js', 'judges.js', 'training.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'judge-log-fonts' && k !== 'judge-log-ref').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: keep a copy once seen.
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') {
    event.respondWith(caches.open('judge-log-fonts').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }
      catch (e) { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Only our own files are cached. Google sign-in and Sheets always go to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(caches.open(VERSION).then(async (c) => {
    const key = req.mode === 'navigate' ? new Request(new URL(url.pathname, url).href) : req;
    const hit = await c.match(key, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => { if (res.ok) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { event.waitUntil(fresh); return hit; }
    const res = await fresh;
    return res || (req.mode === 'navigate' ? c.match('index.html') : new Response('', { status: 504 }));
  }));
});
