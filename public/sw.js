/* Benchmark push notifications — push-only service worker.
   Deliberately no fetch handler and no caching, so it can never interfere
   with page loads or serve stale assets. It only shows pushes and handles
   taps. */

self.addEventListener('install', () => {
  // Activate this worker as soon as it's installed.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Take control of open pages right away.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Benchmark'
  const options = {
    body: data.body || '',
    icon: '/favicon-192x192.png',
    badge: '/favicon-192x192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window if one is open; otherwise open a new one.
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) {
              try {
                client.navigate(target)
              } catch {
                /* cross-origin or not allowed — just focus */
              }
            }
            return client.focus()
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target)
      }),
  )
})
