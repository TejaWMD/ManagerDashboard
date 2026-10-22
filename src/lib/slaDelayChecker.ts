// Background SLA Delay Monitor for WMD Query Portal
import { Complaint, isComplaintDelayed, UserAccount } from '../types';
import { supabase } from './supabase';
import { dispatchComplaintPushNotification } from './pushDispatcher';

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

function recordDelayNotifiedLocally(complaintId: string): void {
  try {
    const current = getLocalDelayNotifiedSet();
    current.add(complaintId);
    localStorage.setItem(
      DELAY_NOTIFIED_CACHE_KEY,
      JSON.stringify(Array.from(current))
    );
  } catch {
    // Ignore
  }
}

// Check open complaints and dispatch notifications for SLA breaches
export async function checkAndNotifyDelayedComplaints(
  complaints: Complaint[]
): Promise<string[]> {
  const nowMs = Date.now();
  const localNotified = getLocalDelayNotifiedSet();
  const notifiedIds: string[] = [];

  for (const complaint of complaints) {
    // Only alert if manager has NOT marked Done and complaint is delayed
    if (complaint.managerDone) {
      continue;
    }

    const delayed = isComplaintDelayed(complaint, nowMs);
    if (!delayed) {
      continue;
    }

    // Check if already notified
    if (complaint.delayNotified === true || localNotified.has(complaint.complaintId)) {
      continue;
    }

    console.log(`[SLAChecker] Complaint ${complaint.complaintId} is delayed. Triggering alerts...`);
    recordDelayNotifiedLocally(complaint.complaintId);
    notifiedIds.push(complaint.complaintId);

    // 1. Dispatch push notification to Manager, AM, and Admin
    await dispatchComplaintPushNotification({
      event: 'COMPLAINT_DELAYED',
      complaint,
      actor: SYSTEM_ACTOR,
    });

    // 2. Persist delay_notified = TRUE in Supabase
    try {
      await supabase
        .from('complaints')
        .update({ delay_notified: true })
        .eq('complaint_id', complaint.complaintId);
    } catch {
      // Non-blocking if column does not exist yet
    }
  }

  return notifiedIds;
}
