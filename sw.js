// Service Worker for Manager Dashboard Desktop Push Notifications
const SW_VERSION = 'v1.3.0';
const SUPABASE_URL = 'https://mjrqamakqqsqqmuvaqpw.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnFhbWFrcXFzcXFtdXZhcXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjQyOTgsImV4cCI6MjEwODA0MDI5OH0.5VWlGTl87khT4JHlLLoT8IAwmceToyNZcN2EjfDohKg';

// Verify against live Supabase DB whether an urgent reminder notification is for an already-completed query
async function shouldSuppressUrgentNotification(title, tag, data) {
  try {
    const titleStr = String(title || '');
    const tagStr = String(tag || '').toLowerCase();
    const eventStr = String((data && data.event) || '').toUpperCase();

    const isUrgentReminder =
      eventStr === 'URGENT_REMINDER' ||
      tagStr.includes('urgent_reminder') ||
      titleStr.includes('Urgent Query Alert') ||
      titleStr.includes('URGENT Warning');

    if (!isUrgentReminder) {
      return false;
    }

    const rawQueryId =
      (data && data.queryId) ||
      (titleStr.match(/QRY-\d+/i) && titleStr.match(/QRY-\d+/i)[0]) ||
      (tagStr.match(/qry-\d+/i) && tagStr.match(/qry-\d+/i)[0]);

    if (!rawQueryId) {
      return false;
    }

    const normId = String(rawQueryId).trim().toUpperCase();
    const url = `${SUPABASE_URL}/rest/v1/queries?query_id=ilike.${encodeURIComponent(
      normId
    )}&select=query_id,status,manager_done,account_manager_done,completed_at,completed_at_ms,is_urgent`;

    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      cache: 'no-store',
    });

    if (res.ok) {
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) {
        const statusLower = String(row.status || '').trim().toLowerCase();
        const isResolved =
          Boolean(row.manager_done) ||
          Boolean(row.account_manager_done) ||
          statusLower === 'completed' ||
          statusLower === 'done' ||
          Boolean(row.completed_at) ||
          Boolean(row.completed_at_ms) ||
          row.is_urgent === false;

        if (isResolved) {
          console.log(`[SW] Suppressed urgent reminder for resolved query ${normId}`);
          return true;
        }
      }
    }
  } catch (err) {
    // Non-blocking fallback
  }
  return false;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
    (async () => {
      const suppress = await shouldSuppressUrgentNotification(
        payload.title,
        notificationOptions.tag,
        notificationOptions.data
      );
      if (suppress) return;

      await Promise.all([
        self.registration.showNotification(
          payload.title || 'WMD Query Portal',
          notificationOptions
        ),
        self.clients
          .matchAll({ type: 'window', includeUncontrolled: true })
          .then((clientList) => {
            for (const client of clientList) {
              client.postMessage({
                type: 'SW_NOTIFICATION_RECEIVED',
                tag: notificationOptions.tag,
              });
            }
          }),
      ]);
    })()
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
      (async () => {
        const suppress = await shouldSuppressUrgentNotification(
          title,
          notificationOptions.tag,
          notificationOptions.data
        );
        if (suppress) return;
        await self.registration.showNotification(title, notificationOptions);
      })()
    );
  }
});
