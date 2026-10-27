// Notification Dispatcher & Role Matrix for WMD Query Portal
import { Query, UserAccount, Appointment } from '../types';
import { AUTHORIZED_USERS } from '../data/users';
import { supabase } from './supabase';
import { showWebNotification } from './notifications';

export type NotificationEventType =
  | 'NEW_QUERY'
  | 'MANAGER_REMARK'
  | 'MANAGER_DONE'
  | 'AM_REMARK'
  | 'AM_DONE'
  | 'QUERY_DELAYED'
  | 'EXTENSION_REQUESTED'
  | 'EXTENSION_APPROVED'
  | 'EXTENSION_DECLINED'
  | 'TEST';

export interface DispatchNotificationParams {
  event: NotificationEventType;
  query: Query;
  actor: UserAccount;
  remarkText?: string;
  isDone?: boolean;
}

// Compute all admin user IDs
export function getAdminUserIds(): string[] {
  return AUTHORIZED_USERS.filter((u) => u.role === 'admin').map((u) => u.id);
}

// Determine target recipients strictly according to requirements:
// 1. Account Manager: Manager remark, Manager Done, Query delayed
// 2. Manager: New query assigned, AM remark, AM Done, Query delayed
// 3. Admin: All events
// Self-exclusion: The actor who initiated the event is never notified of their own action
export function computeTargetRecipients(
  event: NotificationEventType,
  query: Query,
  actorId: string
): string[] {
  const adminIds = getAdminUserIds();
  const rawRecipients: string[] = [];

  switch (event) {
    case 'NEW_QUERY':
      // AM submits query -> Notify Manager + Admin
      rawRecipients.push(query.managerId, ...adminIds);
      break;

    case 'MANAGER_REMARK':
      // Manager submits remark -> Notify Account Manager + Admin
      rawRecipients.push(query.accountManagerId, ...adminIds);
      break;

    case 'MANAGER_DONE':
      // Manager checks Done -> Notify Account Manager + Admin
      rawRecipients.push(query.accountManagerId, ...adminIds);
      break;

    case 'AM_REMARK':
      // AM submits remark -> Notify Manager + Admin
      rawRecipients.push(query.managerId, ...adminIds);
      break;

    case 'AM_DONE':
      // AM checks Done (Query completed) -> Notify Manager + Admin
      rawRecipients.push(query.managerId, ...adminIds);
      break;

    case 'QUERY_DELAYED':
      // Past completion target -> Notify Manager, Account Manager + Admin
      rawRecipients.push(
        query.managerId,
        query.accountManagerId,
        ...adminIds
      );
      break;

    case 'EXTENSION_REQUESTED':
      // Manager requests completion date extension -> Notify Account Manager (Sender) + Admin
      rawRecipients.push(query.accountManagerId, ...adminIds);
      break;

    case 'EXTENSION_APPROVED':
      // AM approves extension -> Notify Manager + Admin
      rawRecipients.push(query.managerId, ...adminIds);
      break;

    case 'EXTENSION_DECLINED':
      // AM declines extension -> Notify Manager + Admin
      rawRecipients.push(query.managerId, ...adminIds);
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
  query: Query,
  actor: UserAccount,
  remarkText?: string
): { title: string; body: string } {
  const actorRoleLabel =
    actor.role === 'manager'
      ? 'Manager'
      : actor.role === 'account_manager'
      ? 'Account Manager'
      : 'Admin';

  switch (event) {
    case 'NEW_QUERY':
      return {
        title: `🚨 New Query: ${query.queryId}`,
        body: `${actorRoleLabel} ${actor.name} assigned ${query.queryId} to ${query.managerName}: "${(query.queryTitle || query.queryText).slice(0, 80)}"`,
      };

    case 'MANAGER_REMARK':
      return {
        title: `💬 Manager Remark: ${query.queryId}`,
        body: `Manager ${actor.name}: "${(remarkText || query.managerRemarkTitle || query.managerRemark).slice(0, 90)}"`,
      };

    case 'MANAGER_DONE':
      return {
        title: `✅ Manager Checked Done: ${query.queryId}`,
        body: `Manager ${actor.name} marked ${query.queryId} as Done. Pending sender verification.`,
      };

    case 'AM_REMARK':
      return {
        title: `💬 ${actorRoleLabel} Remark: ${query.queryId}`,
        body: `${actorRoleLabel} ${actor.name}: "${(remarkText || query.accountManagerRemarkTitle || query.accountManagerRemark).slice(0, 90)}"`,
      };

    case 'AM_DONE':
      return {
        title: `🎉 Query Completed: ${query.queryId}`,
        body: `${actorRoleLabel} ${actor.name} verified and marked Done. ${query.queryId} is now Completed!`,
      };

    case 'QUERY_DELAYED':
      return {
        title: `⚠️ Query Delayed: ${query.queryId}`,
        body: `${query.queryId} has passed its target completion deadline with no manager completion. Assigned to ${query.managerName}.`,
      };

    case 'EXTENSION_REQUESTED':
      return {
        title: `⏳ Extension Requested: ${query.queryId}`,
        body: `Manager ${actor.name} requested completion date extension to ${query.extensionProposedDueAt || 'new date'}: "${(query.extensionReason || '').slice(0, 80)}"`,
      };

    case 'EXTENSION_APPROVED':
      return {
        title: `✅ Extension Approved: ${query.queryId}`,
        body: `${actorRoleLabel} ${actor.name} approved completion extension until ${query.targetDueAt || query.extensionProposedDueAt || 'extended date'}.`,
      };

    case 'EXTENSION_DECLINED':
      return {
        title: `❌ Extension Declined: ${query.queryId}`,
        body: `${actorRoleLabel} ${actor.name} declined completion extension request.`,
      };

    case 'TEST':
      return {
        title: `🔔 Portal Test Alert`,
        body: `This is a test notification triggered by ${actor.name}.`,
      };
  }
}

// Dispatches push notification through Supabase Edge Function to target devices
export async function dispatchQueryPushNotification(
  params: DispatchNotificationParams
): Promise<{ success: boolean; recipientCount: number }> {
  const { event, query, actor, remarkText } = params;

  const recipientUserIds = computeTargetRecipients(event, query, actor.id);
  if (recipientUserIds.length === 0) {
    return { success: true, recipientCount: 0 };
  }

  const { title, body } = formatNotificationContent(
    event,
    query,
    actor,
    remarkText
  );

  const payload = {
    event,
    queryId: query.queryId,
    actorId: actor.id,
    actorName: actor.name,
    actorRole: actor.role,
    recipientUserIds,
    title,
    body,
    icon: './portal-icon.svg',
    badge: './portal-icon.svg',
    tag: `wmd-${query.queryId}-${event.toLowerCase()}`,
    data: {
      queryId: query.queryId,
      url: `./?query=${query.queryId}`,
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

// ============================================================================
// Appointment Notifications
// ============================================================================

export type AppointmentNotificationEventType =
  | 'APPOINTMENT_REQUESTED'
  | 'APPOINTMENT_ACCEPTED'
  | 'APPOINTMENT_RESCHEDULE_REQUESTED'
  | 'APPOINTMENT_RESCHEDULE_ACCEPTED'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_UPDATED';

export interface DispatchAppointmentNotificationParams {
  event: AppointmentNotificationEventType;
  appointment: Appointment;
  actor: UserAccount;
  note?: string;
}

export function computeAppointmentRecipients(
  event: AppointmentNotificationEventType,
  appointment: Appointment,
  actorId: string
): string[] {
  const adminIds = getAdminUserIds();
  const rawRecipients: string[] = [];
  const attendeeIds =
    Array.isArray(appointment.attendees) && appointment.attendees.length > 0
      ? appointment.attendees.map((a) => a.id)
      : [appointment.receiverId || ''];

  switch (event) {
    case 'APPOINTMENT_REQUESTED':
    case 'APPOINTMENT_UPDATED':
      // Requester sent/updated -> Notify all Attendees + Admin
      rawRecipients.push(...attendeeIds, ...adminIds);
      break;

    case 'APPOINTMENT_ACCEPTED':
      // An attendee accepted -> Notify Requester + other attendees + Admin
      rawRecipients.push(appointment.requesterId, ...attendeeIds, ...adminIds);
      break;

    case 'APPOINTMENT_RESCHEDULE_REQUESTED':
      // Reschedule proposed -> Notify Requester + all attendees + Admin
      rawRecipients.push(appointment.requesterId, ...attendeeIds, ...adminIds);
      break;

    case 'APPOINTMENT_RESCHEDULE_ACCEPTED':
      // New time accepted -> Notify both parties (excluding actor) + Admin
      rawRecipients.push(appointment.requesterId, ...attendeeIds, ...adminIds);
      break;

    case 'APPOINTMENT_CANCELLED':
      // Requester cancelled -> Notify all Attendees + Admin
      rawRecipients.push(...attendeeIds, ...adminIds);
      break;
  }

  // Deduplicate and filter out the initiator
  return Array.from(new Set(rawRecipients)).filter(
    (id) => Boolean(id) && id !== actorId
  );
}

export function formatAppointmentNotificationContent(
  event: AppointmentNotificationEventType,
  appointment: Appointment,
  actor: UserAccount
): { title: string; body: string } {
  const timeLabel = appointment.scheduledAt;

  switch (event) {
    case 'APPOINTMENT_REQUESTED':
      return {
        title: `📅 New Appointment: ${appointment.title}`,
        body: `${actor.name} scheduled a ${appointment.meetingType} on ${timeLabel}. Agenda: "${appointment.agenda.slice(0, 80)}"`,
      };

    case 'APPOINTMENT_ACCEPTED':
      return {
        title: `✅ Appointment Confirmed: ${appointment.title}`,
        body: `${actor.name} confirmed the appointment for ${timeLabel}.`,
      };

    case 'APPOINTMENT_RESCHEDULE_REQUESTED':
      return {
        title: `⏳ Reschedule Requested: ${appointment.title}`,
        body: `${actor.name} proposed a new time (${appointment.proposedScheduledAt || 'new date/time'}). Reason: "${appointment.rescheduleReason || 'Schedule conflict'}"`,
      };

    case 'APPOINTMENT_RESCHEDULE_ACCEPTED':
      return {
        title: `✅ Reschedule Confirmed: ${appointment.title}`,
        body: `The new meeting time has been confirmed for ${timeLabel}.`,
      };

    case 'APPOINTMENT_UPDATED':
      return {
        title: `📝 Appointment Updated: ${appointment.title}`,
        body: `${actor.name} updated the appointment details for ${timeLabel}.`,
      };

    case 'APPOINTMENT_CANCELLED':
      return {
        title: `❌ Appointment Cancelled: ${appointment.title}`,
        body: `${actor.name} cancelled the appointment for ${timeLabel}. Remark: "${appointment.cancellationRemark || 'Cancelled after discussion'}"`,
      };
  }
}

export async function dispatchAppointmentPushNotification(
  params: DispatchAppointmentNotificationParams
): Promise<{ success: boolean; recipientCount: number }> {
  const { event, appointment, actor } = params;

  const recipientUserIds = computeAppointmentRecipients(event, appointment, actor.id);
  if (recipientUserIds.length === 0) {
    return { success: true, recipientCount: 0 };
  }

  const { title, body } = formatAppointmentNotificationContent(
    event,
    appointment,
    actor
  );

  const payload = {
    event,
    appointmentId: appointment.id,
    actorId: actor.id,
    actorName: actor.name,
    recipientUserIds,
    title,
    body,
    icon: './portal-icon.svg',
    badge: './portal-icon.svg',
    tag: `wmd-${appointment.id}-${event.toLowerCase()}`,
    data: {
      appointmentId: appointment.id,
      url: './',
      event,
    },
  };

  try {
    // 1. Invoke Supabase Edge Function 'send-push'
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: payload,
    });

    if (error) {
      console.warn('[PushDispatcher] Supabase Edge Function error for appointment:', error.message);
    } else {
      console.log('[PushDispatcher] Appointment push result:', data);
    }

    // 2. Play chime and desktop notification
    showWebNotification(title, body, payload.tag);

    return { success: !error, recipientCount: recipientUserIds.length };
  } catch (err) {
    console.warn('[PushDispatcher] Failed to dispatch appointment notification:', err);
    // Still trigger in-app notification
    showWebNotification(title, body, payload.tag);
    return { success: false, recipientCount: recipientUserIds.length };
  }
}

