// Web Push Subscription Helper for Manager Dashboard
import { supabase } from './supabase';

export const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BCEB9PkPPBOooUYwvmg1UZalOVO10DVdzsdCcKAoHFyARTSRsSjFogXcLzF0KSbLv6Z4IW548ttA0vCBfmMExqI';

export interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Convert a base64 string to a Uint8Array for PushManager subscription
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Check if current browser supports Desktop Web Push
export function isPushNotificationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Get the active ServiceWorker registration
async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

// Check if this browser currently has an active push subscription
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushNotificationSupported()) return null;
  try {
    const reg = await getReadyRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn('[Push] Error getting subscription:', err);
    return null;
  }
}

export interface PushStatusInfo {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  hasBrowserSub: boolean;
  isRegisteredInDb: boolean;
  endpoint?: string;
}

// Queries both browser and Supabase to determine subscription synchronization status
export async function checkPushStatus(userId: string): Promise<PushStatusInfo> {
  const supported = isPushNotificationSupported();
  if (!supported) {
    return {
      supported: false,
      permission: 'unsupported',
      hasBrowserSub: false,
      isRegisteredInDb: false,
    };
  }

  const permission =
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default';

  const sub = await getExistingPushSubscription();
  const hasBrowserSub = Boolean(sub);

  let isRegisteredInDb = false;
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint')
        .eq('user_id', userId);

      if (!error && Array.isArray(data) && data.length > 0) {
        isRegisteredInDb = true;

        // If browser has an active subscription whose endpoint is not in Supabase yet,
        // sync it automatically behind the scenes without prompting the user
        if (sub && !data.some((row) => row.endpoint === sub.endpoint)) {
          const rawKey = sub.getKey ? sub.getKey('p256dh') : null;
          const rawAuth = sub.getKey ? sub.getKey('auth') : null;
          const p256dh = rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))) : '';
          const auth = rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : '';
          supabase
            .from('push_subscriptions')
            .upsert(
              { user_id: userId, endpoint: sub.endpoint, p256dh, auth },
              { onConflict: 'user_id,endpoint' }
            )
            .then(
              () => {},
              (e: unknown) => console.warn('[Push] Silent sync error:', e)
            );
        }

        try {
          localStorage.removeItem('wm_notifications_disabled');
        } catch {
          // Ignore
        }
      }
    } catch (err) {
      console.warn('[Push] Error checking DB subscription status:', err);
    }
  }

  return {
    supported,
    permission,
    hasBrowserSub,
    isRegisteredInDb,
    endpoint: sub?.endpoint,
  };
}

// Subscribe the user's browser to Desktop Web Push and save the token to Supabase
export async function subscribeUserToPush(
  userId: string,
  forceRenew: boolean = false
): Promise<{ success: boolean; subscription?: PushSubscription; error?: string }> {
  if (!isPushNotificationSupported()) {
    return {
      success: false,
      error:
        'Push notifications are not supported in this browser or over insecure HTTP.',
    };
  }

  try {
    // 1. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error:
          permission === 'denied'
            ? 'Notifications were blocked. Please enable them in your browser site settings.'
            : 'Notification permission was dismissed.',
      };
    }

    // 2. Ensure Service Worker is ready
    const reg = await getReadyRegistration();
    if (!reg) {
      return {
        success: false,
        error: 'Service Worker could not be activated.',
      };
    }

    // 3. Get existing or subscribe anew with VAPID applicationServerKey
    let sub = await reg.pushManager.getSubscription();

    // If forceRenew is requested (e.g. after database data was wiped), unsubscribe first to get a fresh subscription
    if (forceRenew && sub) {
      try {
        await sub.unsubscribe();
      } catch (err) {
        console.warn('[Push] Error unsubscribing prior subscription during renew:', err);
      }
      sub = null;
    }

    if (!sub) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // 4. Extract token keys
    const rawKey = sub.getKey ? sub.getKey('p256dh') : null;
    const rawAuth = sub.getKey ? sub.getKey('auth') : null;
    const p256dh = rawKey
      ? btoa(String.fromCharCode(...new Uint8Array(rawKey)))
      : '';
    const auth = rawAuth
      ? btoa(String.fromCharCode(...new Uint8Array(rawAuth)))
      : '';

    // 5. Save/Update subscription in Supabase database
    let savedSuccessfully = false;
    let saveErrorMessage = '';

    const { error: upsertError } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh,
        auth,
      },
      { onConflict: 'user_id,endpoint' }
    );

    if (!upsertError) {
      savedSuccessfully = true;
    } else {
      console.warn('[Push] Upsert failed, falling back to delete + insert:', upsertError.message);
      // Fallback: Delete any duplicate record for this user and endpoint then insert
      await supabase
        .from('push_subscriptions')
        .delete()
        .match({ user_id: userId, endpoint: sub.endpoint });

      const { error: insertError } = await supabase.from('push_subscriptions').insert([
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh,
          auth,
        },
      ]);

      if (!insertError) {
        savedSuccessfully = true;
      } else {
        saveErrorMessage = insertError.message || upsertError.message;
        console.error('[Push] Failed to insert subscription:', saveErrorMessage);
      }
    }

    if (!savedSuccessfully) {
      return {
        success: false,
        error: `Browser notification enabled, but could not save subscription to Supabase: ${saveErrorMessage}`,
      };
    }

    try {
      localStorage.removeItem('wm_notifications_disabled');
    } catch {
      // Ignore
    }

    return { success: true, subscription: sub };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Push] Subscription failed:', err);
    return { success: false, error: message };
  }
}

// Unsubscribe the user's browser and remove from database
export async function unsubscribeUserFromPush(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    try {
      localStorage.setItem('wm_notifications_disabled', 'true');
    } catch {
      // Ignore
    }

    const sub = await getExistingPushSubscription();
    if (sub) {
      try {
        await sub.unsubscribe();
      } catch (err) {
        console.warn('[Push] Unsubscribe on pushManager failed:', err);
      }
    }

    // Remove all subscriptions for this user from database
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
