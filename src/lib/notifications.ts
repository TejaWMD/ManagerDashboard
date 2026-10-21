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

// Service worker reference
let swRegistration: ServiceWorkerRegistration | null = null;

// Register service worker for system tray & mobile notifications
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    swRegistration = reg;
    return reg;
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
    return null;
  }
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
        'You will now receive alerts whenever complaints or remarks are updated!'
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
export function showWebNotification(
  title: string,
  body: string,
  tag = 'wmd-complaint-alert'
): void {
  playNotificationChime();

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  // 1. Try displaying via Service Worker registration (native system tray on mobile & desktop)
  if (swRegistration && swRegistration.showNotification) {
    swRegistration.showNotification(title, {
      body,
      icon: './vite.svg',
      badge: './vite.svg',
      tag,
      vibrate: [200, 100, 200],
    } as any);
    return;
  }

  // 2. Fallback to standard Window Notification
  try {
    new Notification(title, {
      body,
      icon: './vite.svg',
      tag,
    });
  } catch (err) {
    console.warn('[Notification] Could not display notification:', err);
  }
}
