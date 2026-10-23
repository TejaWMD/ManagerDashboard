// Background SLA Delay Monitor for WMD Query Portal
import { Query, isQueryDelayed, UserAccount } from '../types';
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
