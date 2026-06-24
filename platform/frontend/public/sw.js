/* Internovus Creative Builder service worker — minimal, dependency-free.
 *
 * Goals: satisfy PWA installability (a fetch handler) and make the installed
 * app shell load fast / survive a brief offline blip. It deliberately NEVER
 * touches /api/* — those calls (auth, runs, generation) must always hit the
 * network. Static assets are content-hashed by Vite, so cache-first is safe;
 * navigations are network-first so a redeploy shows up immediately.
 *
 * Bump CACHE to invalidate old shells on a breaking change.
 */
const CACHE = 'internovus-v1'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return // never intercept API writes
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // only our own origin
  if (url.pathname.startsWith('/api/')) return // never cache the API

  if (request.mode === 'navigate') {
    // App shell: network-first, fall back to the cached SPA when offline.
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')))
    return
  }

  // Static assets: cache-first (Vite filenames are content-hashed).
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        }),
    ),
  )
})
