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
  // 0: both unchecked (top priority)
  // 1: only checked by manager (middle priority)
  // 2: checked by both (completed - bottom)
  if (query.managerDone && query.accountManagerDone) {
    return 2;
  }
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

export function belongsToAppointment(
  appointment: Appointment,
  user: Pick<UserAccount, 'id' | 'email' | 'role'>
): boolean {
  if (user.role === 'admin') return true;
  if (appointment.requesterId === user.id) return true;
  if (
    Boolean(user.email) &&
    appointment.requesterEmail?.toLowerCase() === user.email.toLowerCase()
  ) {
    return true;
  }
  if (Array.isArray(appointment.attendees) && appointment.attendees.length > 0) {
    return appointment.attendees.some(
      (att) =>
        att.id === user.id ||
        (Boolean(user.email) &&
          att.email?.toLowerCase() === user.email.toLowerCase())
    );
  }
  return (
    appointment.receiverId === user.id ||
    (Boolean(user.email) &&
      appointment.receiverEmail?.toLowerCase() === user.email.toLowerCase())
  );
}

export function isAppointmentActionNeeded(
  appointment: Appointment,
  user: Pick<UserAccount, 'id'>
): boolean {
  if (appointment.status === 'PENDING') {
    if (appointment.requesterId === user.id) return false;
    if (Array.isArray(appointment.attendees) && appointment.attendees.length > 0) {
      return appointment.attendees.some((a) => a.id === user.id);
    }
    return appointment.receiverId === user.id;
  }
  if (
    appointment.status === 'RESCHEDULE_PROPOSED' &&
    appointment.rescheduleProposedBy !== user.id
  ) {
    if (appointment.requesterId === user.id) return true;
    if (Array.isArray(appointment.attendees) && appointment.attendees.length > 0) {
      return appointment.attendees.some((a) => a.id === user.id);
    }
    return appointment.receiverId === user.id;
  }
  return false;
}

export function isAppointmentUpcoming(
  appointment: Appointment,
  nowMs = Date.now()
): boolean {
  if (appointment.status === 'CANCELLED' || appointment.status === 'DECLINED') {
    return false;
  }
  return appointment.scheduledAtMs >= nowMs - 30 * 60 * 1000; // within 30 min ago or in the future
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
