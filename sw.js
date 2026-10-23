// Service Worker for Manager Dashboard Desktop Push Notifications
const SW_VERSION = 'v1.2.0';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming Web Push event from server / FCM / Supabase
self.addEventListener('push', (event) => {
  let payload = {
    title: 'WMD Query Portal',
    body: 'New notification received',
    icon: './portal-icon.svg',
    badge: './portal-icon.svg',
    tag: 'wmd-alert-' + Date.now(),
    data: { url: './' },
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const notificationOptions = {
    body: payload.body || '',
    icon: payload.icon || './portal-icon.svg',
    badge: payload.badge || './portal-icon.svg',
    tag: payload.tag || ('wmd-alert-' + Date.now()),
    data: payload.data || { url: './' },
    vibrate: [250, 100, 250, 100, 250],
    requireInteraction: true,
    renotify: true,
    silent: false,
    sound: './notification-sound.mp3',
    actions: [
      { action: 'open', title: 'Open Portal' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      payload.title || 'WMD Query Portal',
      notificationOptions
    )
  );
});

// Click event: Focus or open dashboard window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl =
    (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If portal tab is already open, focus it and broadcast event
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({
              type: 'PUSH_NOTIFICATION_CLICKED',
              data: event.notification.data,
            });
            return client.focus();
          }
        }
        // If tab was completely closed, open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// Handle local broadcast messages from active window
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const notificationOptions = {
      icon: './portal-icon.svg',
      badge: './portal-icon.svg',
      vibrate: [200, 100, 200],
      sound: './notification-sound.mp3',
      requireInteraction: true,
      ...options,
    };
    event.waitUntil(
      self.registration.showNotification(title, notificationOptions)
    );
  }
});
