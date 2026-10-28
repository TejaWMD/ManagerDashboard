// Web Notifications & Service Worker System Alert Service
const WEB_NOTIFICATION_SOUND_KEY = 'wm_notification_sound_enabled';

// Browser Tab Notification Dot State
let unreadTabNotificationCount = 0;
let baseFaviconHref: string | null = null;
let baseDocumentTitle: string | null = null;
let cachedFaviconImg: HTMLImageElement | null = null;
let lastDotTriggeredAt = 0;
let tabDotListenersInitialized = false;

function getFaviconLinkElement(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (!baseFaviconHref && link.href) {
    baseFaviconHref = link.href;
  }
  return link;
}

function drawFaviconWithDot(img: HTMLImageElement | null, count: number): string {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return baseFaviconHref || '/wmd-logo.jpg';

  // Draw base icon or fallback background
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#4f46e5';
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('W', size / 2, size / 2);
  }

  // Draw prominent red notification dot in top-right corner
  const dotRadius = 18;
  const centerX = size - dotRadius - 2;
  const centerY = dotRadius + 2;

  // White outer ring for contrast on any tab theme
  ctx.beginPath();
  ctx.arc(centerX, centerY, dotRadius + 3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Bright red notification dot
  ctx.beginPath();
  ctx.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = '#ff2b2b';
  ctx.fill();

  // Draw count inside dot if 1-9
  if (count > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count > 9 ? '9+' : String(count), centerX, centerY + 1);
  }

  return canvas.toDataURL('image/png');
}

function applyTabNotificationDot(): void {
  if (typeof document === 'undefined') return;

  if (!baseDocumentTitle) {
    baseDocumentTitle = document.title.replace(/^🔴\s*(\(\d+\+?\)\s*)?/, '');
  }

  const countLabel =
    unreadTabNotificationCount > 1 ? `(${unreadTabNotificationCount}) ` : '';
  document.title = `🔴 ${countLabel}${baseDocumentTitle}`;

  // Update app badge if supported by browser
  if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
    try {
      (navigator as Navigator & { setAppBadge: (n?: number) => Promise<void> })
        .setAppBadge(unreadTabNotificationCount)
        .catch(() => {});
    } catch {
      // Ignore
    }
  }

  const link = getFaviconLinkElement();
  if (!link) return;

  const iconSrc = baseFaviconHref || link.href || '/wmd-logo.jpg';

  if (cachedFaviconImg && cachedFaviconImg.complete && cachedFaviconImg.naturalWidth > 0) {
    link.href = drawFaviconWithDot(cachedFaviconImg, unreadTabNotificationCount);
    return;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    cachedFaviconImg = img;
    if (unreadTabNotificationCount > 0) {
      link.href = drawFaviconWithDot(img, unreadTabNotificationCount);
    }
  };
  img.onerror = () => {
    if (unreadTabNotificationCount > 0) {
      link.href = drawFaviconWithDot(null, unreadTabNotificationCount);
    }
  };
  img.src = iconSrc;

  // Immediately draw fallback dot while image loads
  link.href = drawFaviconWithDot(null, unreadTabNotificationCount);
}

export function clearTabNotificationDot(): void {
  if (typeof document === 'undefined') return;
  if (unreadTabNotificationCount === 0) return;

  // Avoid clearing immediately from the same click that triggered a test alert
  if (Date.now() - lastDotTriggeredAt < 600) return;

  unreadTabNotificationCount = 0;

  if (baseDocumentTitle) {
    document.title = baseDocumentTitle;
  }

  const link = getFaviconLinkElement();
  if (link && baseFaviconHref) {
    link.href = baseFaviconHref;
  }

  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    try {
      (navigator as Navigator & { clearAppBadge: () => Promise<void> })
        .clearAppBadge()
        .catch(() => {});
    } catch {
      // Ignore
    }
  }
}

function initTabDotListeners(): void {
  if (typeof window === 'undefined' || tabDotListenersInitialized) return;
  tabDotListenersInitialized = true;

  getFaviconLinkElement();
  if (typeof document !== 'undefined' && !baseDocumentTitle) {
    baseDocumentTitle = document.title;
  }

  window.addEventListener('focus', () => {
    clearTabNotificationDot();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      clearTabNotificationDot();
    }
  });

  window.addEventListener('pointerdown', () => {
    clearTabNotificationDot();
  });

  window.addEventListener('keydown', () => {
    clearTabNotificationDot();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (
        event.data &&
        (event.data.type === 'SW_NOTIFICATION_RECEIVED' ||
          event.data.type === 'SHOW_NOTIFICATION')
      ) {
        if (Date.now() - lastDotTriggeredAt > 2000) {
          showTabNotificationDot();
        }
      }
    });
  }
}

export function showTabNotificationDot(): void {
  if (typeof window === 'undefined') return;
  initTabDotListeners();
  unreadTabNotificationCount += 1;
  lastDotTriggeredAt = Date.now();
  applyTabNotificationDot();
}

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
  initTabDotListeners();
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
  // If user disabled notifications, do not trigger sound, tab dot or system banner
  try {
    if (localStorage.getItem('wm_notifications_disabled') === 'true') {
      return;
    }
  } catch {
    // Ignore
  }

  playNotificationChime();
  showTabNotificationDot();

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
