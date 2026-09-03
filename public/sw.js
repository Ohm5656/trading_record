const CACHE = 'trade-rise-v6'
const APP_SHELL = ['/index.html', '/manifest.webmanifest', '/trade-rise-logo.png', '/trade-rise-icon-192.png', '/trade-rise-icon-512.png']

async function precacheApp() {
  const cache = await caches.open(CACHE)
  const indexResponse = await fetch('/')
  const markup = await indexResponse.clone().text()
  const builtAssets = [...markup.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1])
  await cache.put('/', indexResponse)
  await cache.addAll([...APP_SHELL, ...new Set(builtAssets)])
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheApp())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const requestUrl = new URL(event.request.url)
  if (requestUrl.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request)
      if (cached) return cached

      try {
        const response = await fetch(event.request)
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(event.request, response.clone())
        }
        return response
      } catch {
        if (event.request.mode === 'navigate') return caches.match('/index.html')
        return new Response('', { status: 503, statusText: 'Offline' })
      }
    })(),
  )
})
