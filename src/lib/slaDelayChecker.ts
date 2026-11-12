// Background SLA Delay & Urgent Reminder Monitor for WMD Query Portal
import {
  Query,
  isQueryDelayed,
  isQueryDone,
  isUrgentQueryCompleted,
  UserAccount,
} from '../types';
import { supabase } from './supabase';
import { dispatchQueryPushNotification } from './pushDispatcher';
import { parseDateToMs } from './dateUtils';

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
const URGENT_COMPLETED_CACHE_KEY = 'wm_urgent_completed_cache_v1';
export const URGENT_REMINDER_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (600,000 ms)

export function markUrgentQueryFinished(queryId: string): void {
  try {
    const norm = (queryId || '').trim().toUpperCase();
    if (!norm) return;
    const raw = localStorage.getItem(URGENT_COMPLETED_CACHE_KEY);
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    set.add(norm);
    localStorage.setItem(URGENT_COMPLETED_CACHE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore
  }
}

export function isUrgentQueryFinished(queryId: string): boolean {
  try {
    const norm = (queryId || '').trim().toUpperCase();
    if (!norm) return false;
    const raw = localStorage.getItem(URGENT_COMPLETED_CACHE_KEY);
    if (!raw) return false;
    const set = new Set<string>(JSON.parse(raw));
    return set.has(norm);
  } catch {
    return false;
  }
}

export function unmarkUrgentQueryFinished(queryId: string): void {
  try {
    const norm = (queryId || '').trim().toUpperCase();
    if (!norm) return;
    const raw = localStorage.getItem(URGENT_COMPLETED_CACHE_KEY);
    if (!raw) return;
    const set = new Set<string>(JSON.parse(raw));
    set.delete(norm);
    localStorage.setItem(URGENT_COMPLETED_CACHE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore
  }
}

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
    const norm = (queryId || '').trim().toUpperCase();
    const current = getLocalUrgentReminderMap();
    current[queryId] = timestampMs;
    if (norm) {
      current[norm] = timestampMs;
      current[norm.toLowerCase()] = timestampMs;
    }
    localStorage.setItem(URGENT_REMINDER_CACHE_KEY, JSON.stringify(current));
  } catch {
    // Ignore
  }
}

export function clearUrgentReminderLocally(queryId: string): void {
  try {
    const norm = (queryId || '').trim().toUpperCase();
    markUrgentQueryFinished(queryId);
    const current = getLocalUrgentReminderMap();
    delete current[queryId];
    if (norm) {
      delete current[norm];
      delete current[norm.toLowerCase()];
    }
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
 * Checks all open urgent queries and dispatches a reminder notification to sender, receiver, and admin
 * every 10 minutes until the query is fully finalized by the sender.
 */
export async function checkAndNotifyUrgentReminders(
  queries: Query[]
): Promise<string[]> {
  const nowMs = Date.now();
  const localReminders = getLocalUrgentReminderMap();
  const remindedIds: string[] = [];

  for (const query of queries) {
    const normId = (query.queryId || '').trim().toUpperCase();

    // 1. Immediately skip if not urgent or already verified as finished/completed
    const isCompleted =
      isUrgentQueryCompleted(query) ||
      isUrgentQueryFinished(normId) ||
      isUrgentQueryFinished(query.queryId);

    if (!query.isUrgent || isCompleted) {
      if (isCompleted) {
        markUrgentQueryFinished(normId);
        clearUrgentReminderLocally(normId);
      }
      continue;
    }

    const createdMs = query.createdAtMs || parseDateToMs(query.createdAt) || 0;
    if (createdMs <= 0) continue;

    // Last reminder time is the maximum of locally recorded reminder, DB record, or creation time
    const lastNotifiedAt = Math.max(
      localReminders[normId] || 0,
      localReminders[query.queryId] || 0,
      query.lastUrgentReminderAtMs || 0,
      createdMs
    );

    // Check if 10 minutes have elapsed since creation or the last 10m reminder
    if (nowMs - lastNotifiedAt >= URGENT_REMINDER_INTERVAL_MS) {
      // 2. CRITICAL SAFEGUARD: Double-check live DB state before dispatching!
      // This prevents idle/background tabs with stale cache from spamming alerts
      // if manager & sender already completed this urgent query elsewhere.
      try {
        const { data: latestDbRow } = await supabase
          .from('queries')
          .select('query_id, manager_done, manager_remark, manager_remark_title, remarks_log, account_manager_done, status, completed_at, completed_at_ms, last_urgent_reminder_at_ms, is_urgent')
          .ilike('query_id', normId)
          .maybeSingle();

        if (latestDbRow) {
          const dbMgrDone = Boolean(latestDbRow.manager_done);
          const dbSenderDone = Boolean(latestDbRow.account_manager_done);
          const dbStatusStr = (latestDbRow.status || '').trim().toLowerCase();
          const dbStatusCompleted = dbStatusStr === 'completed' || dbStatusStr === 'done';
          const dbHasCompletedAt = Boolean(
            latestDbRow.completed_at || latestDbRow.completed_at_ms
          );
          // If manager has completed/marked done, sender confirmed, status is completed, or completed_at is set:
          // Urgent query is resolved!
          const dbIsDone =
            dbMgrDone ||
            dbSenderDone ||
            dbStatusCompleted ||
            dbHasCompletedAt;

          // Sync live DB state to in-memory query object so stale cache never misinforms the dispatcher
          if (dbMgrDone) query.managerDone = true;
          if (dbSenderDone) query.accountManagerDone = true;
          if (dbStatusCompleted) query.status = 'Completed';
          if (latestDbRow.manager_remark) query.managerRemark = latestDbRow.manager_remark;
          if (latestDbRow.manager_remark_title) query.managerRemarkTitle = latestDbRow.manager_remark_title;

          if (dbIsDone || latestDbRow.is_urgent === false) {
            console.log(
              `[SLAChecker] Urgent query ${normId} is completed/resolved in DB. Halting 10m reminders.`
            );
            query.managerDone = true;
            if (dbSenderDone || dbStatusCompleted) {
              query.accountManagerDone = true;
              query.status = 'Completed';
            }
            markUrgentQueryFinished(normId);
            clearUrgentReminderLocally(normId);
            continue;
          }

          // Check if another client or tab already sent a 10m reminder recently
          const dbLastReminderMs = Number(latestDbRow.last_urgent_reminder_at_ms) || 0;
          if (dbLastReminderMs > 0 && nowMs - dbLastReminderMs < URGENT_REMINDER_INTERVAL_MS) {
            recordUrgentReminderLocally(normId, dbLastReminderMs);
            continue;
          }
        }
      } catch (err) {
        console.warn('[SLAChecker] Live DB state verification error:', err);
      }

      console.log(`[SLAChecker] 10m reminder due for urgent query ${normId}. Triggering alert...`);
      recordUrgentReminderLocally(normId, nowMs);
      remindedIds.push(normId);

      // 3. Dispatch push notification to sender, receiver, CCs, and admin
      await dispatchQueryPushNotification({
        event: 'URGENT_REMINDER',
        query,
        actor: SYSTEM_ACTOR,
      });

      // 4. Persist last_urgent_reminder_at_ms in Supabase
      try {
        await supabase
          .from('queries')
          .update({ last_urgent_reminder_at_ms: nowMs })
          .ilike('query_id', normId);
      } catch {
        // Non-blocking if column does not exist yet
      }
    }
  }

  return remindedIds;
}
