export type UserRole = 'account_manager' | 'manager' | 'admin';

export type PageView = 'home' | 'queries' | 'kpi';

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
}

export interface Query {
  id: string; // matches queryId for React keys
  queryId: string; // e.g., QRY-001 (Primary Key in Supabase)
  createdAt: string; // Immutable creation timestamp string (YYYY-MM-DD HH:mm:ss)
  createdAtMs: number; // Immutable creation epoch milliseconds for calculations
  completedAt?: string | null; // Completion timestamp string when both Manager & AM checked
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
  rating?: number | null; // Mandatory 1-5 star rating provided by sender upon completion
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
  isUrgent?: boolean; // Flag indicating query is urgent (immediate response required, no 48h delay threshold)
  lastUrgentReminderAtMs?: number | null; // Epoch ms of the latest 24h reminder notification sent to receiver
  attachments?: QueryAttachment[]; // Attached documents from user's device
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

export const DELAY_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours (172,800,000 ms)

export function isQueryDone(query: Query): boolean {
  return Boolean(query.managerDone && query.accountManagerDone);
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
    const parsed = Date.parse(query.createdAt.replace(' ', 'T'));
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

/**
 * Returns the effective target completion deadline in epoch ms:
 * If an approved extension (or explicit targetDueAt) is set, returns targetDueAtMs.
 * Otherwise defaults to createdAt + 48 hours.
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
    const parsed = Date.parse(query.targetDueAt.replace(' ', 'T'));
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

export function isQueryDelayed(
  query: Query,
  nowMs: number = Date.now()
): boolean {
  // Urgent queries do not have a 48h delay threshold and are never classified as delayed
  if (query.isUrgent) {
    return false;
  }

  if (query.isDelayed === true) {
    return true;
  }

  const deadlineMs = getQueryDeadlineMs(query);
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
      const parsedCompleted = Date.parse(query.completedAt.replace(' ', 'T'));
      if (!Number.isNaN(parsedCompleted) && parsedCompleted > 0) {
        return parsedCompleted > deadlineMs;
      }
    }
    return false;
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
  user: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (query.accountManagerId && user.id) {
    return query.accountManagerId === user.id;
  }
  return (
    Boolean(query.accountManagerEmail) &&
    query.accountManagerEmail.toLowerCase() === user.email.toLowerCase()
  );
}

export function belongsToManager(
  query: Query,
  manager: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (query.managerId && manager.id) {
    return query.managerId === manager.id;
  }
  return (
    Boolean(query.managerEmail) &&
    query.managerEmail.toLowerCase() === manager.email.toLowerCase()
  );
}

export function isQueryRelevantToUser(
  query: Query,
  user: Pick<UserAccount, 'id' | 'email' | 'role'>
): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'account_manager') {
    return belongsToAccountManager(query, user);
  }
  if (user.role === 'manager') {
    return (
      belongsToManager(query, user) ||
      belongsToAccountManager(query, user)
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
    return appointment.status === 'CONFIRMED';
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

  return Boolean(matched && (matched.status === 'CONFIRMED' || appointment.status === 'CONFIRMED'));
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
  | 'ON_TIME' // Completed on-time (<= 48h): +1.0 pt
  | 'LATE' // Completed late (> 48h): +0.5 pt
  | 'OVERDUE' // Open and overdue (> 48h): 0.0 pt
  | 'IN_PROGRESS'; // Open and within 48h: Excluded from evaluation

export interface EvaluatedQueryDetail {
  query: Query;
  status: QueryKpiStatus;
  points: number; // 1.0, 0.5, 0.0
  isEvaluated: boolean; // false if in-progress (<48h)
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
  inProgressCount: number; // excluded (<48h)
  avgRating: number | null; // Average sender rating (1.0 to 5.0)
  totalRated: number; // Number of rated queries in window
  overallKpi: number; // Combined score: average of turnaround KPI and average rating percentage
  avgManagerTurnaroundHours: number | null;
  avgSenderVerificationHours: number | null;
  evaluatedQueries: EvaluatedQueryDetail[];
}
