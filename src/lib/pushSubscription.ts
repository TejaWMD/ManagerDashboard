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

// Subscribe the user's browser to Desktop Web Push and save the token to Supabase
export async function subscribeUserToPush(
  userId: string
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
    if (!sub) {
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
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
    const { error: dbError } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh,
        auth,
      },
      { onConflict: 'user_id,endpoint' }
    );

    if (dbError) {
      console.warn('[Push] Failed to store subscription in DB:', dbError.message);
      // Non-blocking fallback: try inserting
      await supabase.from('push_subscriptions').insert([
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh,
          auth,
        },
      ]);
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
    const sub = await getExistingPushSubscription();
    if (sub) {
      await sub.unsubscribe();
      await supabase
        .from('push_subscriptions')
        .delete()
        .match({ user_id: userId, endpoint: sub.endpoint });
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
