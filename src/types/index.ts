export type UserRole = 'account_manager' | 'manager' | 'admin';

export type PageView =
  | 'home'
  | 'queries'
  | 'kpi'
  | 'tracking'
  | 'my-trello'
  | 'admin-trello'
  | 'ratings';

export interface UserTrelloIntegration {
  userId: string;
  trelloMemberId: string;
  trelloUsername: string;
  trelloFullName: string;
  trelloEmail?: string;
  trelloAvatarUrl?: string;
  trelloToken: string;
  updatedAt: string;
}

export interface TrelloBoard {
  id: string;
  name: string;
  desc?: string;
  url: string;
  closed?: boolean;
}

export interface TrelloList {
  id: string;
  name: string;
  closed?: boolean;
  idBoard: string;
}

export interface TrelloCardLabel {
  id: string;
  name: string;
  color: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  idList: string;
  idBoard: string;
  due?: string | null;
  dueComplete?: boolean;
  idMembers?: string[];
  labels?: TrelloCardLabel[];
  shortUrl?: string;
  dateLastActivity?: string;
}

export interface TrelloCardAction {
  id: string;
  idMemberCreator: string;
  type: string;
  date: string;
  data: {
    text?: string;
    card?: { id: string; name: string };
    board?: { id: string; name: string };
    list?: { id: string; name: string };
    listBefore?: { id: string; name: string };
    listAfter?: { id: string; name: string };
  };
  memberCreator?: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl?: string;
  };
}

export type ActivityActionType =
  | 'QUERY_CREATED'
  | 'QUERY_UPDATED'
  | 'QUERY_MANAGER_DONE'
  | 'QUERY_ACCOUNT_MANAGER_DONE'
  | 'QUERY_COMPLETED'
  | 'QUERY_REMARK_ADDED'
  | 'QUERY_EXTENSION_REQUESTED'
  | 'QUERY_EXTENSION_RESOLVED'
  | 'QUERY_RATED'
  | 'APPOINTMENT_BOOKED'
  | 'APPOINTMENT_UPDATED'
  | 'APPOINTMENT_ACCEPTED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_DECLINED'
  | 'APPOINTMENT_CANCELLED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'PAGE_VIEW';

export type ActivityCategory = 'all' | 'query' | 'appointment' | 'auth' | 'navigation';

export interface UserActivity {
  id: string; // e.g., 'act-1729000000000-xyz'
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  actionType: ActivityActionType;
  category: ActivityCategory;
  actionTitle: string;
  actionDetails?: string;
  targetId?: string | null; // e.g. 'QRY-001', 'APT-002'
  targetType?: 'query' | 'appointment' | 'auth' | 'navigation' | null;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
  createdAt: string; // YYYY-MM-DD HH:mm:ss
  createdAtMs: number;
}

export interface UserPresence {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  currentPage: PageView;
  currentAction?: string;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
  lastSeenAt: string;
  lastSeenAtMs: number;
  isOnline: boolean;
}

import { parseDateToMs } from '../lib/dateUtils';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  roleLabel: string;
  avatarInitials: string;
  phone?: string;
}

export type QueryStatus = 'Pending' | 'Completed';

export type ExtensionStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'DECLINED';

export interface QueryAttachment {
  id: string; // e.g., 'att-1729000000000-xyz'
  name: string; // Original filename, e.g. 'Project_Scope.pdf'
  size: number; // File size in bytes
  type: string; // MIME type, e.g. 'application/pdf', 'image/png'
  url: string; // Data URL (Base64) or remote URL
  uploadedAt?: string;
  uploadedBy?: string; // Name of user who attached the file
  uploaderRole?: 'sender' | 'manager'; // Sender or Receiving Manager
}

export interface QueryRemark {
  id: string; // e.g. 'rmk-1730000000000-xyz'
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  type: 'manager' | 'sender'; // 'manager' = resolution / progress, 'sender' = verification / feedback
  title?: string;
  text: string;
  createdAt: string; // Formatted 'DD-MM-YYYY HH:mm'
  createdAtMs: number;
}

export interface QueryCCUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface Query {
  id: string; // matches queryId for React keys
  queryId: string; // e.g., QRY-001 (Primary Key in Supabase)
  createdAt: string; // Immutable creation timestamp string (YYYY-MM-DD HH:mm:ss)
  createdAtMs: number; // Immutable creation epoch milliseconds for calculations
  completedAt?: string | null; // Completion timestamp string when both Manager & AM checked (or admin/auto completed)
  completedAtMs?: number | null; // Completion epoch milliseconds for completion tracking
  isDelayed?: boolean; // Persisted flag if query exceeded target completion deadline before or at completion
  accountManagerId: string; // Foreign Key -> UserAccount.id (e.g., 'am-1')
  accountManagerEmail: string;
  accountManagerName: string;
  managerId: string; // Foreign Key -> UserAccount.id (e.g., 'mgr-1')
  managerEmail: string;
  managerName: string;
  queryTitle: string;
  queryText: string;
  managerRemarkTitle: string;
  managerRemark: string;
  managerDone: boolean;
  managerDoneAt?: string | null; // Timestamp when assigned manager marked Done
  managerDoneAtMs?: number | null; // Epoch ms when assigned manager marked Done (for turnaround tracking)
  accountManagerRemarkTitle: string;
  accountManagerRemark: string;
  accountManagerDone: boolean;
  status: QueryStatus;
  delayNotified?: boolean;
  rating?: number | null; // Legacy / sender rating
  // 10-Star Ratings System: Receiver Ratings (Admin 50% + System 30% + Sender 20%)
  adminReceiverRating?: number | null; // Admin rating for Receiver (1-10 stars, default 10)
  adminReceiverRemark?: string | null; // Mandatory remark if Admin rates Receiver
  adminReceiverRatedAt?: string | null;
  adminReceiverRatedAtMs?: number | null;
  senderReceiverRating?: number | null; // Sender rating for Receiver (1-10 stars)
  senderReceiverRemark?: string | null; // Mandatory remark from Sender
  senderReceiverRatedAt?: string | null;
  senderReceiverRatedAtMs?: number | null;
  // 10-Star Ratings System: Sender Ratings (Admin 50% + System 30% + Receiver 20%)
  adminSenderRating?: number | null; // Admin rating for Sender (1-10 stars, default 10)
  adminSenderRemark?: string | null; // Mandatory remark if Admin rates Sender
  adminSenderRatedAt?: string | null;
  adminSenderRatedAtMs?: number | null;
  receiverSenderRating?: number | null; // Receiver rating for Sender (1-10 stars)
  receiverSenderRemark?: string | null; // Mandatory remark from Receiver
  receiverSenderRatedAt?: string | null;
  receiverSenderRatedAtMs?: number | null;
  // Timestamped remarks log for Manager and Sender
  remarks?: QueryRemark[];
  // Admin Force Completion & Auto-completion tracking
  adminCompletedBy?: string | null;
  adminCompletedAt?: string | null;
  adminCompletedAtMs?: number | null;
  autoCompletedAt?: string | null;
  autoCompletedAtMs?: number | null;
  completionNote?: string | null; // Audit note, e.g. "Completed by Admin Mani on 05-11-2026 10:15 (Sender Inactive)"
  // Target Completion & Extension Management
  targetDueAt?: string | null; // Effective target completion timestamp string (YYYY-MM-DD HH:mm:ss)
  targetDueAtMs?: number | null; // Effective target completion epoch ms
  extensionStatus?: ExtensionStatus | null; // 'NONE' | 'PENDING' | 'APPROVED' | 'DECLINED'
  extensionRequestedAt?: string | null;
  extensionProposedDueAt?: string | null;
  extensionProposedDueAtMs?: number | null;
  extensionReason?: string | null;
  extensionReviewNote?: string | null;
  extensionReviewedAt?: string | null;
  linkedAppointmentId?: string | null; // e.g. 'APT-001' if query was raised following an appointment
  isUrgent?: boolean; // Flag indicating query is urgent (immediate response required, no 24h delay threshold)
  lastUrgentReminderAtMs?: number | null; // Epoch ms of the latest 24h reminder notification sent to receiver
  firstManagerRemarkAtMs?: number | null; // Epoch ms of the first manager remark (used to evaluate 1h SLA for urgent queries)
  attachments?: QueryAttachment[]; // Attached documents from user's device (sender)
  managerAttachments?: QueryAttachment[]; // Attached documents from receiving manager / solution
  ccUsers?: QueryCCUser[]; // Team members CC'd on this query (View-only awareness access)
}

export type MeetingType = 'Online Call' | 'Office/Desk' | 'Phone';

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'RESCHEDULE_PROPOSED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'COMPLETED';

export interface AppointmentAttendee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status?: AppointmentStatus;
}

export interface Appointment {
  id: string; // e.g., 'APT-001'
  title: string; // Subject / Topic
  agenda: string; // Agenda / Discussion (Mandatory)
  requesterId: string; // Foreign Key -> UserAccount.id
  requesterName: string;
  requesterEmail: string;
  requesterRole: UserRole;
  // Multiple attendees
  attendees: AppointmentAttendee[];
  receiverId?: string; // Fallback / Primary attendee
  receiverName?: string;
  receiverEmail?: string;
  receiverRole?: UserRole;
  scheduledAt: string; // e.g., '2026-10-28 14:30:00'
  scheduledAtMs: number; // Epoch ms for time calculations & sorting
  durationMinutes?: number; // Optional
  meetingType: MeetingType; // 'Online Call' | 'Office/Desk' | 'Phone'
  meetingLocation?: string; // Room, call link, or phone note
  status: AppointmentStatus;
  
  // Reschedule tracking
  rescheduleProposedBy?: string | null; // User ID who initiated the reschedule
  proposedScheduledAt?: string | null;
  proposedScheduledAtMs?: number | null;
  rescheduleReason?: string | null;

  // Cancellation tracking (Requester only with mandatory remark)
  cancellationRemark?: string | null;
  cancelledAt?: string | null;

  // Bidirectional Query Link
  queryId?: string | null; // e.g. 'QRY-001' if linked to an existing query

  createdAt: string;
  createdAtMs: number;
  updatedAt?: string | null;
}

export const DELAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours (86,400,000 ms)
export const SENDER_GRACE_PERIOD_MS = 12 * 60 * 60 * 1000; // 12 hours (43,200,000 ms) auto-completion grace period after manager marks Done

export function isQueryDone(query: Query): boolean {
  if (!query) return false;
  const mgrDone = Boolean(query.managerDone);
  const senderDone = Boolean(query.accountManagerDone);
  const isBothDone = mgrDone && senderDone;
  const statusStr = (query.status || '').trim().toLowerCase();
  const isStatusCompleted = statusStr === 'completed' || statusStr === 'done';
  const hasCompletedAt = Boolean(query.completedAtMs || query.completedAt);
  const hasAdminOrAutoCompleted = Boolean(query.adminCompletedAt || query.autoCompletedAt);
  return isBothDone || isStatusCompleted || hasCompletedAt || hasAdminOrAutoCompleted;
}

/**
 * Returns true if an urgent query is considered completed or resolved,
 * halting urgent reminder alerts immediately.
 * An urgent query is resolved when:
 * 1. Both manager & sender marked done (or status is Completed / hasCompletedAt), OR
 * 2. Assigned manager has marked Done (the urgent resolution action is completed)
 */
export function isUrgentQueryCompleted(query: Query): boolean {
  if (!query) return false;
  const statusStr = (query.status || '').trim().toLowerCase();
  const isStatusCompleted = statusStr === 'completed' || statusStr === 'done';
  const hasCompletedAt = Boolean(query.completedAtMs || query.completedAt);
  return (
    isQueryDone(query) ||
    Boolean(query.managerDone) ||
    isStatusCompleted ||
    hasCompletedAt
  );
}

/**
 * Calculates remaining grace period milliseconds for sender review after manager marks Done.
 * Returns null if not in active grace period (e.g. manager not done, or sender already done).
 */
export function getSenderGracePeriodRemainingMs(query: Query, nowMs: number = Date.now()): number | null {
  if (!query.managerDone || query.accountManagerDone || !query.managerDoneAtMs) {
    return null;
  }
  const graceEnd = query.managerDoneAtMs + SENDER_GRACE_PERIOD_MS;
  return Math.max(0, graceEnd - nowMs);
}

/**
 * Returns true if the 12h sender grace period after manager resolution has expired.
 */
export function isSenderGracePeriodExpired(query: Query, nowMs: number = Date.now()): boolean {
  if (!query.managerDone || query.accountManagerDone || !query.managerDoneAtMs) {
    return false;
  }
  return nowMs >= query.managerDoneAtMs + SENDER_GRACE_PERIOD_MS;
}

/**
 * Returns true if a query is delayed specifically because the sender has not confirmed
 * even though the manager solved it on or before the due date.
 */
export function isSenderDelayed(query: Query, nowMs: number = Date.now()): boolean {
  if (query.isUrgent) return false;
  const deadlineMs = getQueryDeadlineMs(query);
  if (deadlineMs <= 0) return false;
  return Boolean(
    query.managerDone &&
    !query.accountManagerDone &&
    query.managerDoneAtMs !== null &&
    query.managerDoneAtMs !== undefined &&
    query.managerDoneAtMs <= deadlineMs &&
    nowMs > deadlineMs
  );
}

export function getQueryStageRank(query: Query): number {
  // 2: checked by both (completed - bottom, whether normal or urgent)
  if (query.managerDone && query.accountManagerDone) {
    return 2;
  }
  // Urgent queries stay on top of the query list until completed
  // -2: Urgent both unchecked (top priority)
  // -1: Urgent manager done, awaiting sender verification
  if (query.isUrgent) {
    return query.managerDone ? -1 : -2;
  }
  // Normal queries:
  // 0: both unchecked (top normal priority)
  // 1: only checked by manager (middle priority)
  if (query.managerDone && !query.accountManagerDone) {
    return 1;
  }
  if (!query.managerDone && !query.accountManagerDone) {
    return 0;
  }
  return 1;
}

export function getQueryTimestampMs(query: Query): number {
  if (
    typeof query.createdAtMs === 'number' &&
    !Number.isNaN(query.createdAtMs) &&
    query.createdAtMs > 0
  ) {
    return query.createdAtMs;
  }
  if (query.createdAt) {
    const parsed = parseDateToMs(query.createdAt);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

/**
 * Returns the effective target completion deadline in epoch ms:
 * If an approved extension (or explicit targetDueAt) is set, returns targetDueAtMs.
 * Otherwise defaults to createdAt + 24 hours.
 */
export function getQueryDeadlineMs(query: Query): number {
  if (
    typeof query.targetDueAtMs === 'number' &&
    !Number.isNaN(query.targetDueAtMs) &&
    query.targetDueAtMs > 0
  ) {
    return query.targetDueAtMs;
  }
  if (query.targetDueAt) {
    const parsed = parseDateToMs(query.targetDueAt);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const createdMs = getQueryTimestampMs(query);
  return createdMs > 0 ? createdMs + DELAY_THRESHOLD_MS : 0;
}

export function sortQueriesByStatusAndTimestamp(
  list: Query[],
  timestampOrder: 'desc' | 'asc' = 'desc'
): Query[] {
  return [...list].sort((a, b) => {
    const rankDiff = getQueryStageRank(a) - getQueryStageRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const timeA = getQueryTimestampMs(a);
    const timeB = getQueryTimestampMs(b);
    if (timeA !== timeB) {
      return timestampOrder === 'desc' ? timeB - timeA : timeA - timeB;
    }
    return a.queryId.localeCompare(b.queryId);
  });
}

export const URGENT_REMINDER_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (600,000 ms)
export const URGENT_MANAGER_REMARK_WINDOW_MS = 60 * 60 * 1000; // 1 hour (3,600,000 ms)

export function hasManagerRemark(query: Query): boolean {
  if (!query) return false;
  if ((query.managerRemark || '').trim() || (query.managerRemarkTitle || '').trim()) {
    return true;
  }
  if (
    query.managerDone ||
    Boolean(query.managerDoneAt) ||
    Boolean(query.managerDoneAtMs)
  ) {
    return true;
  }
  if (
    Array.isArray(query.remarks) &&
    query.remarks.some((r) => r.type === 'manager' || r.authorRole === 'manager')
  ) {
    return true;
  }
  return false;
}

export function isUrgentManagerRemarkOverdue(query: Query, nowMs: number = Date.now()): boolean {
  if (
    !query ||
    !query.isUrgent ||
    isQueryDone(query) ||
    isUrgentQueryCompleted(query)
  ) {
    return false;
  }
  if (hasManagerRemark(query)) {
    return false;
  }
  const createdMs = getQueryTimestampMs(query);
  if (createdMs <= 0) return false;
  return nowMs - createdMs >= URGENT_MANAGER_REMARK_WINDOW_MS;
}

export function getFirstManagerRemarkTimestampMs(query: Query): number | null {
  if (!query) return null;
  if (typeof query.firstManagerRemarkAtMs === 'number' && query.firstManagerRemarkAtMs > 0) {
    return query.firstManagerRemarkAtMs;
  }
  // Check remarks log for the earliest remark of type 'manager'
  if (Array.isArray(query.remarks) && query.remarks.length > 0) {
    const mgrRemarks = query.remarks.filter(
      (r) => r.type === 'manager' || r.authorRole === 'manager'
    );
    if (mgrRemarks.length > 0) {
      const timestamps = mgrRemarks
        .map((r) => r.createdAtMs || parseDateToMs(r.createdAt) || 0)
        .filter((t) => t > 0);
      if (timestamps.length > 0) {
        return Math.min(...timestamps);
      }
    }
  }
  // If manager marked done, managerDoneAtMs is a manager resolution action
  if (query.managerDone && query.managerDoneAtMs) {
    return query.managerDoneAtMs;
  }
  // If managerRemark exists as legacy string but not in remarks array
  if ((query.managerRemark || '').trim() || (query.managerRemarkTitle || '').trim()) {
    return query.managerDoneAtMs || query.createdAtMs || null;
  }
  return null;
}

export function isQueryExemptFromDelay(
  query: Pick<Query, 'queryId' | 'isUrgent'>
): boolean {
  if (query.queryId) {
    const id = query.queryId.trim().toUpperCase();
    if (id === 'QRY-009' || id === 'QRY-005') {
      return true;
    }
  }
  return false;
}

export function isQueryDelayed(
  query: Query,
  nowMs: number = Date.now()
): boolean {
  if (!query) return false;

  // Exempted QRY-009 legacy
  if (isQueryExemptFromDelay(query)) {
    return false;
  }

  const deadlineMs = getQueryDeadlineMs(query);

  // Active approved extension: NEVER delayed while within the approved extended deadline!
  if (query.extensionStatus === 'APPROVED' && deadlineMs > 0 && nowMs <= deadlineMs) {
    return false;
  }

  // Urgent query delay rule (unless an approved extension is active):
  // Situation 1: Manager put remark within 1 hour -> NOT delayed (completed on time)
  // Situation 2: Manager never put remark within 1 hour -> DELAYED (even when completed later)
  if (query.isUrgent) {
    const createdMs = getQueryTimestampMs(query);
    if (createdMs <= 0) return false;
    const firstMgrRemarkMs = getFirstManagerRemarkTimestampMs(query);
    if (firstMgrRemarkMs !== null) {
      return firstMgrRemarkMs > createdMs + URGENT_MANAGER_REMARK_WINDOW_MS;
    }
    return nowMs > createdMs + URGENT_MANAGER_REMARK_WINDOW_MS;
  }

  if (deadlineMs <= 0) {
    return false;
  }

  // If completed (both Manager Done & AM Done are checked), check if completion exceeded deadline
  if (isQueryDone(query)) {
    if (
      typeof query.completedAtMs === 'number' &&
      !Number.isNaN(query.completedAtMs) &&
      query.completedAtMs > 0
    ) {
      return query.completedAtMs > deadlineMs;
    }
    if (query.completedAt) {
      const parsedCompleted = parseDateToMs(query.completedAt);
      if (!Number.isNaN(parsedCompleted) && parsedCompleted > 0) {
        return parsedCompleted > deadlineMs;
      }
    }
    return query.isDelayed === true;
  }

  if (query.isDelayed === true) {
    return true;
  }

  // Open query: delayed if current time has passed target completion deadline
  return nowMs > deadlineMs;
}

export function isQueryPending(
  query: Query,
  nowMs: number = Date.now()
): boolean {
  return !isQueryDone(query) && !isQueryDelayed(query, nowMs);
}

export function belongsToAccountManager(
  query: Query,
  user: Pick<UserAccount, 'id' | 'email'> & { name?: string }
): boolean {
  if (!query || !user) return false;
  const qId = (query.accountManagerId || '').trim().toLowerCase();
  const uId = (user.id || '').trim().toLowerCase();
  if (qId && uId && qId === uId) return true;

  const qEmail = (query.accountManagerEmail || '').trim().toLowerCase();
  const uEmail = (user.email || '').trim().toLowerCase();
  if (qEmail && uEmail && qEmail === uEmail) return true;

  const uName = (user.name || '').trim().toLowerCase();
  const qName = (query.accountManagerName || '').trim().toLowerCase();
  if (qId && uName && qId === uName) return true;
  if (qId && uEmail && qId === uEmail) return true;
  if (qName && uName && qName === uName) return true;

  return false;
}

export function belongsToManager(
  query: Query,
  manager: Pick<UserAccount, 'id' | 'email'> & { name?: string }
): boolean {
  if (!query || !manager) return false;
  const qId = (query.managerId || '').trim().toLowerCase();
  const mId = (manager.id || '').trim().toLowerCase();
  if (qId && mId && qId === mId) return true;

  const qEmail = (query.managerEmail || '').trim().toLowerCase();
  const mEmail = (manager.email || '').trim().toLowerCase();
  if (qEmail && mEmail && qEmail === mEmail) return true;

  const mName = (manager.name || '').trim().toLowerCase();
  const qName = (query.managerName || '').trim().toLowerCase();
  if (qId && mName && qId === mName) return true;
  if (qId && mEmail && qId === mEmail) return true;
  if (qName && mName && qName === mName) return true;

  return false;
}

export function isUserCcOnQuery(
  query: Query,
  user: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (!query.ccUsers || !Array.isArray(query.ccUsers) || query.ccUsers.length === 0) {
    return false;
  }
  return query.ccUsers.some(
    (u) =>
      (u.id && user.id && u.id === user.id) ||
      (u.email && user.email && u.email.toLowerCase() === user.email.toLowerCase())
  );
}

export function isQueryRelevantToUser(
  query: Query,
  user: Pick<UserAccount, 'id' | 'email' | 'role'>
): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'account_manager') {
    return belongsToAccountManager(query, user) || isUserCcOnQuery(query, user);
  }
  if (user.role === 'manager') {
    return (
      belongsToManager(query, user) ||
      belongsToAccountManager(query, user) ||
      isUserCcOnQuery(query, user)
    );
  }
  return true;
}

export function isUserRequesterOfAppointment(
  appointment: Appointment,
  user: Pick<UserAccount, 'id' | 'email'> & { name?: string }
): boolean {
  if (appointment.requesterId && user.id && appointment.requesterId === user.id) {
    return true;
  }
  if (
    Boolean(user.email) &&
    Boolean(appointment.requesterEmail) &&
    appointment.requesterEmail.toLowerCase() === user.email.toLowerCase()
  ) {
    return true;
  }
  if (
    Boolean(user.name) &&
    Boolean(appointment.requesterName) &&
    appointment.requesterName.trim().toLowerCase() === user.name!.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

export function isUserAttendeeOfAppointment(
  appointment: Appointment,
  user: Pick<UserAccount, 'id' | 'email'> & { name?: string }
): boolean {
  if (Array.isArray(appointment.attendees) && appointment.attendees.length > 0) {
    const matchedInAttendees = appointment.attendees.some(
      (att) =>
        (att.id && user.id && att.id === user.id) ||
        (Boolean(user.email) &&
          Boolean(att.email) &&
          att.email.toLowerCase() === user.email.toLowerCase()) ||
        (Boolean(user.name) &&
          Boolean(att.name) &&
          att.name.trim().toLowerCase() === user.name!.trim().toLowerCase())
    );
    if (matchedInAttendees) return true;
  }

  if (appointment.receiverId && user.id && appointment.receiverId === user.id) {
    return true;
  }
  if (
    Boolean(user.email) &&
    Boolean(appointment.receiverEmail) &&
    appointment.receiverEmail!.toLowerCase() === user.email.toLowerCase()
  ) {
    return true;
  }
  if (Boolean(user.name) && Boolean(appointment.receiverName)) {
    const names = appointment.receiverName!
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
    if (names.includes(user.name!.trim().toLowerCase())) {
      return true;
    }
  }
  return false;
}

export function belongsToAppointment(
  appointment: Appointment,
  user: Pick<UserAccount, 'id' | 'email' | 'role'> & { name?: string }
): boolean {
  if (user.role === 'admin') return true;
  return (
    isUserRequesterOfAppointment(appointment, user) ||
    isUserAttendeeOfAppointment(appointment, user)
  );
}

export function isUserParticipantInAppointment(
  appointment: Appointment,
  user: Pick<UserAccount, 'id' | 'email'> & { name?: string }
): boolean {
  return (
    isUserAttendeeOfAppointment(appointment, user) ||
    isUserRequesterOfAppointment(appointment, user)
  );
}

export function getAppointmentAcceptedCount(appointment: Appointment): {
  accepted: number;
  total: number;
  allAccepted: boolean;
  hasMultipleAttendees: boolean;
} {
  const attendees =
    Array.isArray(appointment.attendees) && appointment.attendees.length > 0
      ? appointment.attendees
      : appointment.receiverId
      ? [
          {
            id: appointment.receiverId,
            name: appointment.receiverName || '',
            email: appointment.receiverEmail || '',
            role: appointment.receiverRole || 'manager',
            status: appointment.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING',
          } as AppointmentAttendee,
        ]
      : [];

  const total = attendees.length;
  if (total === 0) {
    const isConf = appointment.status === 'CONFIRMED';
    return {
      accepted: isConf ? 1 : 0,
      total: 1,
      allAccepted: isConf,
      hasMultipleAttendees: false,
    };
  }

  const accepted = attendees.filter(
    (a) => a.status === 'CONFIRMED' || (appointment.status === 'CONFIRMED' && !a.status)
  ).length;

  return {
    accepted,
    total,
    allAccepted: total > 0 && accepted === total,
    hasMultipleAttendees: total > 1,
  };
}

export function hasUserAcceptedAppointment(
  appointment: Appointment,
  user: Pick<UserAccount, 'id' | 'email'> & { name?: string }
): boolean {
  if (appointment.status === 'CONFIRMED') return true;
  if (!Array.isArray(appointment.attendees) || appointment.attendees.length === 0) {
    return false;
  }

  const matched = appointment.attendees.find(
    (att) =>
      (att.id && user.id && att.id === user.id) ||
      (Boolean(user.email) &&
        Boolean(att.email) &&
        att.email.toLowerCase() === user.email.toLowerCase()) ||
      (Boolean(user.name) &&
        Boolean(att.name) &&
        att.name.trim().toLowerCase() === user.name!.trim().toLowerCase())
  );

  return Boolean(matched && matched.status === 'CONFIRMED');
}

export function isAppointmentActionNeeded(
  appointment: Appointment,
  user: Pick<UserAccount, 'id'> & { email?: string; name?: string; role?: UserRole }
): boolean {
  const userForMatch = {
    id: user.id,
    email: user.email || '',
    name: user.name,
  };

  if (appointment.status === 'PENDING') {
    if (user.role === 'admin') {
      const { allAccepted } = getAppointmentAcceptedCount(appointment);
      return !allAccepted;
    }
    if (isUserRequesterOfAppointment(appointment, userForMatch)) return false;
    if (!isUserAttendeeOfAppointment(appointment, userForMatch)) return false;
    // An attendee only needs action if they haven't accepted yet
    return !hasUserAcceptedAppointment(appointment, userForMatch);
  }
  if (
    appointment.status === 'RESCHEDULE_PROPOSED' &&
    appointment.rescheduleProposedBy !== user.id
  ) {
    if (user.role === 'admin') return true;
    return (
      isUserRequesterOfAppointment(appointment, userForMatch) ||
      isUserAttendeeOfAppointment(appointment, userForMatch)
    );
  }
  return false;
}

export function isAppointmentUpcoming(
  appointment: Appointment,
  nowMs = Date.now()
): boolean {
  if (
    appointment.status === 'CANCELLED' ||
    appointment.status === 'DECLINED' ||
    appointment.status === 'COMPLETED'
  ) {
    return false;
  }
  if (
    appointment.status === 'PENDING' ||
    appointment.status === 'RESCHEDULE_PROPOSED'
  ) {
    return true;
  }
  const effectiveTimeMs = Math.max(
    appointment.scheduledAtMs || 0,
    appointment.proposedScheduledAtMs || 0
  );
  return effectiveTimeMs >= nowMs - 30 * 60 * 1000; // within 30 min ago or in the future
}

export function getLinkedAppointmentForQuery(
  query: Query | null | undefined,
  appointments: Appointment[]
): Appointment | null {
  if (!query || !Array.isArray(appointments)) return null;
  return (
    appointments.find(
      (apt) =>
        (Boolean(query.linkedAppointmentId) &&
          apt.id === query.linkedAppointmentId) ||
        (Boolean(apt.queryId) && apt.queryId === query.queryId)
    ) || null
  );
}

export function getLinkedQueryForAppointment(
  appointment: Appointment | null | undefined,
  queries: Query[]
): Query | null {
  if (!appointment || !Array.isArray(queries)) return null;
  return (
    queries.find(
      (q) =>
        (Boolean(appointment.queryId) && q.queryId === appointment.queryId) ||
        (Boolean(q.linkedAppointmentId) &&
          q.linkedAppointmentId === appointment.id)
    ) || null
  );
}

// -----------------------------------------------------------------------------
// Manager KPI Weighted Scoring Types
// -----------------------------------------------------------------------------
export type QueryKpiStatus =
  | 'ON_TIME' // Completed on-time (<= 24h): +1.0 pt
  | 'LATE' // Completed late (> 24h): +0.5 pt
  | 'OVERDUE' // Open and overdue (> 24h): 0.0 pt
  | 'IN_PROGRESS'; // Open and within 24h: Excluded from evaluation

export interface EvaluatedQueryDetail {
  query: Query;
  status: QueryKpiStatus;
  points: number; // 1.0, 0.5, 0.0
  isEvaluated: boolean; // false if in-progress (<24h)
  managerTurnaroundHours: number | null; // Hours from creation to manager done
  senderVerificationHours: number | null; // Hours from manager done to sender confirmation
}

export interface ManagerKpiStats {
  manager: UserAccount;
  kpiScore: number; // 0 - 100 percentage based on weighted turnaround formula (Turnaround KPI)
  turnaroundKpi: number; // Alias for previous weighted calculation
  earnedPoints: number;
  totalEvaluated: number; // count of evaluated queries (onTime + late + overdue)
  totalAssigned: number; // total queries received in window
  completedCount: number; // onTimeCount + lateCount
  delayedCount: number; // lateCount + overdueCount (all delayed queries)
  completionRate: number; // percentage of completed vs received: (completedCount / totalAssigned) * 100
  onTimeCount: number; // +1.0
  lateCount: number; // +0.5
  overdueCount: number; // 0.0
  inProgressCount: number; // excluded (<24h)
  avgRating: number | null; // Average sender rating (1.0 to 5.0)
  totalRated: number; // Number of rated queries in window
  overallKpi: number; // Combined score: average of turnaround KPI and average rating percentage
  avgManagerTurnaroundHours: number | null;
  avgSenderVerificationHours: number | null;
  evaluatedQueries: EvaluatedQueryDetail[];
  hasActiveUrgentPenalty?: boolean; // 50% KPI penalty applied while urgent queries remain uncompleted
  activeUrgentCount?: number;
}
