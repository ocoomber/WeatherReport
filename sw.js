const CACHE = 'weather-tool-b041';

const STATIC = [
  '/WeatherReport/',
  '/WeatherReport/index.html',
  '/WeatherReport/style.css',
  '/WeatherReport/script.js',
  '/WeatherReport/manifest.json',
  '/WeatherReport/icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC).then(() => self.skipWaiting()).catch(err => console.error('SW cache fill failed:', err)))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => { if (k !== CACHE) return caches.delete(k); }))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  /* never cache API calls */
  if (url.hostname === 'api.open-meteo.com' || url.hostname === 'api.postcodes.io') {
    return;
  }

  /* static assets — stale-while-revalidate */
  if (STATIC.includes(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fetchPromise = fetch(e.request).then(res => {
          const r = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, r));
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* everything else — network-first, fallback to cache */
  e.respondWith(
    fetch(e.request).then(res => { const r = res.clone(); caches.open(CACHE).then(c => c.put(e.request, r)); return res; }).catch(() => caches.match(e.request))
  );
});
