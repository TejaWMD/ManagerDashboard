import { Complaint, UserAccount } from '../types';

const CALLMEBOT_STORAGE_KEY = 'wm_callmebot_keys_v1';
const WEB_NOTIFICATION_SOUND_KEY = 'wm_notification_sound_enabled';

// Clean international phone number to digits only (e.g. "+60 19-400 17570" -> "601940017570")
export function cleanPhoneNumber(phone?: string | null): string {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '');
}

// Retrieve locally cached CallMeBot API keys (mapped by user ID)
export function getLocalCallMeBotKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CALLMEBOT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Save CallMeBot API key locally for a specific user ID
export function saveLocalCallMeBotKey(userId: string, apiKey: string): void {
  try {
    const current = getLocalCallMeBotKeys();
    current[userId] = apiKey.trim();
    localStorage.setItem(CALLMEBOT_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

// Play a pleasant, lightweight notification chime using Web Audio API
export function playNotificationChime(): void {
  try {
    const isSoundEnabled = localStorage.getItem(WEB_NOTIFICATION_SOUND_KEY) !== 'false';
    if (!isSoundEnabled) return;

    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    // Audio autoplay might be restricted before first interaction
  }
}

// Register service worker for Web Push & system lock-screen notifications
let swRegistration: ServiceWorkerRegistration | null = null;

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
        'You will now receive alerts on this device whenever complaints or remarks are updated!'
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

// Dispatch WhatsApp message via CallMeBot gateway
export async function sendCallMeBotWhatsApp(
  phone: string,
  apiKey: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone) {
    return { success: false, error: 'Phone number is empty' };
  }
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      error: `No CallMeBot API key configured for phone ${phone}. Send "I allow callmebot to send me messages" to +34 911 06 73 81 on WhatsApp to get one.`,
    };
  }

  const endpoint = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(
    cleanPhone
  )}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey.trim())}`;

  try {
    // mode: 'no-cors' allows sending GET request across domains without browser blocking
    await fetch(endpoint, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-cache',
    });
    return { success: true };
  } catch {
    // Secondary fallback: image element ping
    try {
      const img = new Image();
      img.src = endpoint;
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Network request failed',
      };
    }
  }
}

export type ComplaintNotificationAction =
  | 'NEW_COMPLAINT'
  | 'MANAGER_REMARK'
  | 'MANAGER_DONE'
  | 'MANAGER_UNDONE'
  | 'AM_REMARK'
  | 'AM_DONE'
  | 'COMPLETED';

interface DispatchOptions {
  action: ComplaintNotificationAction;
  complaint: Complaint;
  actor: UserAccount;
  allUsers: UserAccount[];
  detailNote?: string;
}

// Master dispatcher for multi-channel notifications (WhatsApp + Web Notification)
export async function dispatchComplaintNotifications({
  action,
  complaint,
  actor,
  allUsers,
  detailNote,
}: DispatchOptions): Promise<void> {
  const localKeys = getLocalCallMeBotKeys();

  // Find recipient users:
  // 1. Manager assigned to complaint
  // 2. Account Manager assigned to complaint
  // 3. All Admin accounts
  const manager = allUsers.find((u) => u.id === complaint.managerId);
  const accountManager = allUsers.find((u) => u.id === complaint.accountManagerId);
  const admins = allUsers.filter((u) => u.role === 'admin');

  // Identify who should be notified based on who took the action
  const targets: { user: UserAccount; roleInComplaint: 'manager' | 'am' | 'admin' }[] = [];

  if (action === 'NEW_COMPLAINT') {
    // AM created -> Notify Manager + Admin
    if (manager && manager.id !== actor.id) {
      targets.push({ user: manager, roleInComplaint: 'manager' });
    }
    for (const admin of admins) {
      if (admin.id !== actor.id) {
        targets.push({ user: admin, roleInComplaint: 'admin' });
      }
    }
  } else if (action === 'MANAGER_REMARK' || action === 'MANAGER_DONE' || action === 'MANAGER_UNDONE') {
    // Manager updated -> Notify AM + Admin
    if (accountManager && accountManager.id !== actor.id) {
      targets.push({ user: accountManager, roleInComplaint: 'am' });
    }
    for (const admin of admins) {
      if (admin.id !== actor.id) {
        targets.push({ user: admin, roleInComplaint: 'admin' });
      }
    }
  } else if (action === 'AM_REMARK' || action === 'AM_DONE' || action === 'COMPLETED') {
    // AM updated -> Notify Manager + Admin
    if (manager && manager.id !== actor.id) {
      targets.push({ user: manager, roleInComplaint: 'manager' });
    }
    for (const admin of admins) {
      if (admin.id !== actor.id) {
        targets.push({ user: admin, roleInComplaint: 'admin' });
      }
    }
  } else {
    // Admin edited -> Notify both Manager and AM
    if (manager && manager.id !== actor.id) {
      targets.push({ user: manager, roleInComplaint: 'manager' });
    }
    if (accountManager && accountManager.id !== actor.id) {
      targets.push({ user: accountManager, roleInComplaint: 'am' });
    }
  }

  // Generate action description text
  let actionTitle = '';
  let actionDetail = '';

  switch (action) {
    case 'NEW_COMPLAINT':
      actionTitle = 'New Complaint Created';
      actionDetail = `Text: "${complaint.complaintText.slice(0, 100)}${
        complaint.complaintText.length > 100 ? '...' : ''
      }"`;
      break;
    case 'MANAGER_REMARK':
      actionTitle = 'Manager Added Remark';
      actionDetail = `Remark: "${complaint.managerRemark.slice(0, 100)}"`;
      break;
    case 'MANAGER_DONE':
      actionTitle = 'Manager Marked Done';
      actionDetail = `Manager ${complaint.managerName} marked Done. Waiting for Account Manager.`;
      break;
    case 'MANAGER_UNDONE':
      actionTitle = 'Manager Unchecked Done';
      actionDetail = `Manager ${complaint.managerName} unmarked Done.`;
      break;
    case 'AM_REMARK':
      actionTitle = 'Account Manager Added Remark';
      actionDetail = `Remark: "${complaint.accountManagerRemark.slice(0, 100)}"`;
      break;
    case 'AM_DONE':
    case 'COMPLETED':
      actionTitle = 'Complaint Marked COMPLETED';
      actionDetail = `Both Manager and AM confirmed. Status is now Completed!`;
      break;
  }

  if (detailNote) {
    actionDetail = `${actionDetail} (${detailNote})`;
  }

  // Send WhatsApp to each target user if they have phone & key
  for (const { user, roleInComplaint } of targets) {
    const phone = user.phone;
    const apiKey = localKeys[user.id] || user.callmebotApiKey || '';

    if (!phone) continue;

    // Compose custom WhatsApp message
    let recipientGreeting = `Hello ${user.name}`;
    if (roleInComplaint === 'admin') {
      recipientGreeting = `[ADMIN LOG]`;
    }

    const message = [
      `🔔 *WM Portal Notification*`,
      `${recipientGreeting},`,
      `*Action*: ${actionTitle}`,
      `*Complaint*: ${complaint.complaintId}`,
      `*Updated by*: ${actor.name} (${actor.roleLabel})`,
      `*Assigned AM*: ${complaint.accountManagerName}`,
      `*Assigned Manager*: ${complaint.managerName}`,
      `*Details*: ${actionDetail}`,
      `*Status*: ${complaint.status}`,
    ].join('\n');

    if (apiKey) {
      sendCallMeBotWhatsApp(phone, apiKey, message).then((res) => {
        if (!res.success) {
          console.warn(`[WhatsApp] Failed to send to ${user.name} (${phone}):`, res.error);
        } else {
          console.log(`[WhatsApp] Alert dispatched successfully to ${user.name} (${phone})`);
        }
      });
    } else {
      console.info(
        `[WhatsApp] Skipped sending to ${user.name} (${phone}) because CallMeBot API key is not set yet.`
      );
    }
  }
}
