// Service Worker for Manager Dashboard Web Push & System Notifications
const SW_VERSION = 'v1.0.1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for message from main thread to show notifications
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const notificationOptions = {
      icon: './portal-icon.svg',
      badge: './portal-icon.svg',
      vibrate: [200, 100, 200],
      ...options,
    };
    event.waitUntil(
      self.registration.showNotification(title, notificationOptions)
    );
  }
});

// Listen for native push events from server / FCM
self.addEventListener('push', (event) => {
  let data = {
    title: 'WMD Query Portal',
    body: 'New update received',
  };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data.body = event.data.text();
    }
  }

  const title = data.title || 'WMD Query Portal';
  const options = {
    body: data.body || '',
    icon: data.icon || './portal-icon.svg',
    badge: data.badge || './portal-icon.svg',
    tag: data.tag || 'wmd-notification',
    data: data.data || {},
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click event: Focus or open dashboard window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow('./');
        }
      })
  );
});
