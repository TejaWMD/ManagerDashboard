// Notification Dispatcher & Role Matrix for WMD Query Portal
import { Complaint, UserAccount } from '../types';
import { AUTHORIZED_USERS } from '../data/users';
import { supabase } from './supabase';
import { showWebNotification } from './notifications';

export type NotificationEventType =
  | 'NEW_COMPLAINT'
  | 'MANAGER_REMARK'
  | 'MANAGER_DONE'
  | 'AM_REMARK'
  | 'AM_DONE'
  | 'COMPLAINT_DELAYED'
  | 'TEST';

export interface DispatchNotificationParams {
  event: NotificationEventType;
  complaint: Complaint;
  actor: UserAccount;
  remarkText?: string;
  isDone?: boolean;
}

// Compute all admin user IDs
export function getAdminUserIds(): string[] {
  return AUTHORIZED_USERS.filter((u) => u.role === 'admin').map((u) => u.id);
}

// Determine target recipients strictly according to requirements:
// 1. Account Manager: Manager remark, Manager Done, Complaint delayed
// 2. Manager: New complaint assigned, AM remark, AM Done, Complaint delayed
// 3. Admin: All events
// Self-exclusion: The actor who initiated the event is never notified of their own action
export function computeTargetRecipients(
  event: NotificationEventType,
  complaint: Complaint,
  actorId: string
): string[] {
  const adminIds = getAdminUserIds();
  const rawRecipients: string[] = [];

  switch (event) {
    case 'NEW_COMPLAINT':
      // AM submits complaint -> Notify Manager + Admin
      rawRecipients.push(complaint.managerId, ...adminIds);
      break;

    case 'MANAGER_REMARK':
      // Manager submits remark -> Notify Account Manager + Admin
      rawRecipients.push(complaint.accountManagerId, ...adminIds);
      break;

    case 'MANAGER_DONE':
      // Manager checks Done -> Notify Account Manager + Admin
      rawRecipients.push(complaint.accountManagerId, ...adminIds);
      break;

    case 'AM_REMARK':
      // AM submits remark -> Notify Manager + Admin
      rawRecipients.push(complaint.managerId, ...adminIds);
      break;

    case 'AM_DONE':
      // AM checks Done (Complaint completed) -> Notify Manager + Admin
      rawRecipients.push(complaint.managerId, ...adminIds);
      break;

    case 'COMPLAINT_DELAYED':
      // SLA delayed -> Notify Manager, Account Manager + Admin
      rawRecipients.push(
        complaint.managerId,
        complaint.accountManagerId,
        ...adminIds
      );
      break;

    case 'TEST':
      rawRecipients.push(actorId, ...adminIds);
      break;
  }

  // Deduplicate and filter out the actor (initiator) unless it's an explicit test
  const unique = Array.from(new Set(rawRecipients)).filter(
    (id) => Boolean(id) && (event === 'TEST' || id !== actorId)
  );

  return unique;
}

// Format notification title and body based on event type
export function formatNotificationContent(
  event: NotificationEventType,
  complaint: Complaint,
  actor: UserAccount,
  remarkText?: string
): { title: string; body: string } {
  switch (event) {
    case 'NEW_COMPLAINT':
      return {
        title: `🚨 New Complaint: ${complaint.complaintId}`,
        body: `${actor.name} assigned ${complaint.complaintId} to ${complaint.managerName}: "${complaint.complaintText.slice(0, 80)}"`,
      };

    case 'MANAGER_REMARK':
      return {
        title: `💬 Manager Remark: ${complaint.complaintId}`,
        body: `Manager ${actor.name}: "${(remarkText || complaint.managerRemark).slice(0, 90)}"`,
      };

    case 'MANAGER_DONE':
      return {
        title: `✅ Manager Checked Done: ${complaint.complaintId}`,
        body: `Manager ${actor.name} marked ${complaint.complaintId} as Done. Pending AM verification.`,
      };

    case 'AM_REMARK':
      return {
        title: `💬 AM Remark: ${complaint.complaintId}`,
        body: `AM ${actor.name}: "${(remarkText || complaint.accountManagerRemark).slice(0, 90)}"`,
      };

    case 'AM_DONE':
      return {
        title: `🎉 Complaint Completed: ${complaint.complaintId}`,
        body: `AM ${actor.name} verified and marked Done. ${complaint.complaintId} is now Completed!`,
      };

    case 'COMPLAINT_DELAYED':
      return {
        title: `⚠️ Complaint SLA Delayed: ${complaint.complaintId}`,
        body: `${complaint.complaintId} is delayed (>48h) with no manager completion. Assigned to ${complaint.managerName}.`,
      };

    case 'TEST':
      return {
        title: `🔔 Portal Test Alert`,
        body: `This is a test notification triggered by ${actor.name}.`,
      };
  }
}

// Dispatches push notification through Supabase Edge Function to target devices
export async function dispatchComplaintPushNotification(
  params: DispatchNotificationParams
): Promise<{ success: boolean; recipientCount: number }> {
  const { event, complaint, actor, remarkText } = params;

  const recipientUserIds = computeTargetRecipients(event, complaint, actor.id);
  if (recipientUserIds.length === 0) {
    return { success: true, recipientCount: 0 };
  }

  const { title, body } = formatNotificationContent(
    event,
    complaint,
    actor,
    remarkText
  );

  const payload = {
    event,
    complaintId: complaint.complaintId,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    recipientUserIds,
    title,
    body,
    icon: './portal-icon.svg',
    badge: './portal-icon.svg',
    tag: `wmd-${complaint.complaintId}-${event.toLowerCase()}`,
    data: {
      complaintId: complaint.complaintId,
      url: `./?complaint=${complaint.complaintId}`,
      event,
    },
  };

  try {
    // 1. Invoke Supabase Edge Function 'send-push'
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: payload,
    });

    if (error) {
      console.warn('[PushDispatcher] Supabase Edge Function returned error:', error.message);
    } else {
      console.log('[PushDispatcher] Edge function result:', data);
    }

    // 2. Fallback in-app display if current user tab is open and is a recipient
    if (recipientUserIds.includes(actor.id)) {
      showWebNotification(title, body, payload.tag);
    }

    return { success: !error, recipientCount: recipientUserIds.length };
  } catch (err) {
    console.warn('[PushDispatcher] Failed to dispatch push notification:', err);
    return { success: false, recipientCount: recipientUserIds.length };
  }
}
