// Background SLA Delay & Urgent Reminder Monitor for WMD Query Portal
import { Query, isQueryDelayed, isQueryDone, UserAccount } from '../types';
import { supabase } from './supabase';
import { dispatchQueryPushNotification } from './pushDispatcher';

const SYSTEM_ACTOR: UserAccount = {
  id: 'system',
  name: 'System Monitor',
  email: 'system@portal.internal',
  password: '',
  role: 'admin',
  roleLabel: 'System',
  avatarInitials: 'SM',
};

const DELAY_NOTIFIED_CACHE_KEY = 'wm_delay_notified_cache_v1';
const URGENT_REMINDER_CACHE_KEY = 'wm_urgent_reminder_cache_v1';
export const URGENT_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours (86,400,000 ms)

function getLocalDelayNotifiedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DELAY_NOTIFIED_CACHE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function recordDelayNotifiedLocally(queryId: string): void {
  try {
    const current = getLocalDelayNotifiedSet();
    current.add(queryId);
    localStorage.setItem(
      DELAY_NOTIFIED_CACHE_KEY,
      JSON.stringify(Array.from(current))
    );
  } catch {
    // Ignore
  }
}

export function resetDelayNotifiedLocally(queryId: string): void {
  try {
    const current = getLocalDelayNotifiedSet();
    current.delete(queryId);
    localStorage.setItem(
      DELAY_NOTIFIED_CACHE_KEY,
      JSON.stringify(Array.from(current))
    );
  } catch {
    // Ignore
  }
}

function getLocalUrgentReminderMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(URGENT_REMINDER_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function recordUrgentReminderLocally(queryId: string, timestampMs: number): void {
  try {
    const current = getLocalUrgentReminderMap();
    current[queryId] = timestampMs;
    localStorage.setItem(URGENT_REMINDER_CACHE_KEY, JSON.stringify(current));
  } catch {
    // Ignore
  }
}

export function clearUrgentReminderLocally(queryId: string): void {
  try {
    const current = getLocalUrgentReminderMap();
    delete current[queryId];
    localStorage.setItem(URGENT_REMINDER_CACHE_KEY, JSON.stringify(current));
  } catch {
    // Ignore
  }
}

// Check open queries and dispatch notifications for SLA breaches
export async function checkAndNotifyDelayedQueries(
  queries: Query[]
): Promise<string[]> {
  const nowMs = Date.now();
  const localNotified = getLocalDelayNotifiedSet();
  const notifiedIds: string[] = [];

  for (const query of queries) {
    // Only alert if manager has NOT marked Done and query is delayed
    if (query.managerDone) {
      continue;
    }

    const delayed = isQueryDelayed(query, nowMs);
    if (!delayed) {
      continue;
    }

    // Check if already notified
    if (query.delayNotified === true || localNotified.has(query.queryId)) {
      continue;
    }

    console.log(`[SLAChecker] Query ${query.queryId} is delayed. Triggering alerts...`);
    recordDelayNotifiedLocally(query.queryId);
    notifiedIds.push(query.queryId);

    // 1. Dispatch push notification to Manager, AM, and Admin
    await dispatchQueryPushNotification({
      event: 'QUERY_DELAYED',
      query,
      actor: SYSTEM_ACTOR,
    });

    // 2. Persist delay_notified = TRUE in Supabase
    try {
      await supabase
        .from('queries')
        .update({ delay_notified: true })
        .eq('query_id', query.queryId);
    } catch {
      // Non-blocking if column does not exist yet
    }
  }

  return notifiedIds;
}

/**
 * Checks all open urgent queries and dispatches a reminder notification to the receiver
 * every 24 hours until the query is fully completed.
 */
export async function checkAndNotifyUrgentReminders(
  queries: Query[]
): Promise<string[]> {
  const nowMs = Date.now();
  const localReminders = getLocalUrgentReminderMap();
  const remindedIds: string[] = [];

  for (const query of queries) {
    // Only monitor urgent queries that are NOT yet completed
    if (!query.isUrgent || isQueryDone(query)) {
      continue;
    }

    const createdMs = query.createdAtMs || Date.parse(query.createdAt.replace(' ', 'T')) || 0;
    if (createdMs <= 0) continue;

    // Last reminder time is the maximum of locally recorded reminder, DB record, or creation time
    const lastNotifiedAt = Math.max(
      localReminders[query.queryId] || 0,
      query.lastUrgentReminderAtMs || 0,
      createdMs
    );

    // Check if 24 hours have elapsed since creation or the last 24h reminder
    if (nowMs - lastNotifiedAt >= URGENT_REMINDER_INTERVAL_MS) {
      console.log(`[SLAChecker] 24h reminder due for urgent query ${query.queryId}. Triggering alert...`);
      recordUrgentReminderLocally(query.queryId, nowMs);
      remindedIds.push(query.queryId);

      // 1. Dispatch push notification to receiver and admin
      await dispatchQueryPushNotification({
        event: 'URGENT_REMINDER',
        query,
        actor: SYSTEM_ACTOR,
      });

      // 2. Persist last_urgent_reminder_at_ms in Supabase
      try {
        await supabase
          .from('queries')
          .update({ last_urgent_reminder_at_ms: nowMs })
          .eq('query_id', query.queryId);
      } catch {
        // Non-blocking if column does not exist yet
      }
    }
  }

  return remindedIds;
}
