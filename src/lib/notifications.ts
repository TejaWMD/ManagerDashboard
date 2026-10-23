// Web Notifications & Service Worker System Alert Service
const WEB_NOTIFICATION_SOUND_KEY = 'wm_notification_sound_enabled';

// Play a lightweight, pleasant audio chime using Web Audio API
export function playNotificationChime(): void {
  try {
    const isSoundEnabled = localStorage.getItem(WEB_NOTIFICATION_SOUND_KEY) !== 'false';
    if (!isSoundEnabled) return;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.35); // D6
    gain2.gain.setValueAtTime(0.18, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);
  } catch {
    // Autoplay restrictions before first user gesture
  }
}

// Compute the exact absolute path to sw.js regardless of whether we're on localhost,
// custom domain, or GitHub Pages subpath (e.g. /ManagerDashboard/)
export function getServiceWorkerConfig(): { scriptUrl: string; scope: string } {
  if (typeof window === 'undefined') {
    return { scriptUrl: './sw.js', scope: './' };
  }
  const loc = window.location;
  let dir = loc.pathname;
  if (!dir.endsWith('/')) {
    if (dir.includes('.')) {
      dir = dir.substring(0, dir.lastIndexOf('/') + 1);
    } else {
      dir = dir + '/';
    }
  }
  return {
    scriptUrl: `${loc.origin}${dir}sw.js`,
    scope: `${loc.origin}${dir}`,
  };
}

// Service worker reference
let swRegistration: ServiceWorkerRegistration | null = null;

// Register service worker for system tray & mobile notifications
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const { scriptUrl, scope } = getServiceWorkerConfig();
    const reg = await navigator.serviceWorker.register(scriptUrl, { scope });
    swRegistration = reg;
    return reg;
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
    try {
      // Fallback relative register
      const regFallback = await navigator.serviceWorker.register('./sw.js');
      swRegistration = regFallback;
      return regFallback;
    } catch {
      return null;
    }
  }
}

// Check if current context is secure (HTTPS or localhost)
export function isSecureContextEnvironment(): boolean {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext ?? (window.location.protocol === 'https:' || window.location.hostname === 'localhost');
}

// Check current browser notification permission
export function getNotificationPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

// Request permission to send browser / system notifications
export async function requestWebNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      showWebNotification(
        '🔔 Notifications Enabled',
        'You will now receive alerts whenever queries or remarks are updated!'
      );
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to request notification permission:', err);
    return false;
  }
}

// Trigger a native system / lock-screen notification banner
export async function showWebNotification(
  title: string,
  body: string,
  tag = 'wmd-query-alert'
): Promise<void> {
  playNotificationChime();

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  const { scriptUrl } = getServiceWorkerConfig();
  const iconUrl = scriptUrl.replace(/sw\.js$/, 'portal-icon.svg');

  const notificationOptions = {
    body,
    icon: iconUrl,
    badge: iconUrl,
    tag,
    vibrate: [200, 100, 200],
  };

  // 1. Try displaying via Service Worker registration (required for Android / mobile & system tray)
  let activeRegistration = swRegistration;
  if (!activeRegistration && 'serviceWorker' in navigator) {
    try {
      activeRegistration =
        (await navigator.serviceWorker.getRegistration()) ||
        (await navigator.serviceWorker.ready);
    } catch {
      // Ignore
    }
  }

  if (activeRegistration && typeof activeRegistration.showNotification === 'function') {
    try {
      await activeRegistration.showNotification(title, notificationOptions);
      return;
    } catch (err) {
      console.warn('[SW] showNotification error:', err);
    }
  }

  // 2. Fallback to standard Window Notification (for desktop browsers without SW active)
  try {
    new Notification(title, {
      body,
      icon: iconUrl,
      tag,
    });
  } catch (err) {
    console.warn('[Notification] Window notification error:', err);
  }
}
