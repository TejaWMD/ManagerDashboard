export type UserRole = 'account_manager' | 'manager' | 'admin';

export type PageView = 'home' | 'complaints';

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

export type ComplaintStatus = 'Pending' | 'Completed';

export interface Complaint {
  id: string; // matches complaintId for React keys
  complaintId: string; // e.g., CMP-001 (Primary Key in Supabase)
  createdAt: string; // Immutable creation timestamp string (YYYY-MM-DD HH:mm:ss)
  createdAtMs: number; // Immutable creation epoch milliseconds for calculations
  completedAt?: string | null; // Completion timestamp string when both Manager & AM checked
  completedAtMs?: number | null; // Completion epoch milliseconds for SLA / delay persistence
  isDelayed?: boolean; // Persisted flag if complaint exceeded 24h before or at completion
  accountManagerId: string; // Foreign Key -> UserAccount.id (e.g., 'am-1')
  accountManagerEmail: string;
  accountManagerName: string;
  managerId: string; // Foreign Key -> UserAccount.id (e.g., 'mgr-1')
  managerEmail: string;
  managerName: string;
  complaintText: string;
  managerRemark: string;
  managerDone: boolean;
  accountManagerRemark: string;
  accountManagerDone: boolean;
  status: ComplaintStatus;
  delayNotified?: boolean;
}

export const DELAY_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours (172,800,000 ms)

export function isComplaintDone(complaint: Complaint): boolean {
  return Boolean(complaint.managerDone && complaint.accountManagerDone);
}

export function getComplaintStageRank(complaint: Complaint): number {
  // 0: both unchecked (top priority)
  // 1: only checked by manager (middle priority)
  // 2: checked by both (completed - bottom)
  if (complaint.managerDone && complaint.accountManagerDone) {
    return 2;
  }
  if (complaint.managerDone && !complaint.accountManagerDone) {
    return 1;
  }
  if (!complaint.managerDone && !complaint.accountManagerDone) {
    return 0;
  }
  return 1;
}

export function getComplaintTimestampMs(complaint: Complaint): number {
  if (
    typeof complaint.createdAtMs === 'number' &&
    !Number.isNaN(complaint.createdAtMs) &&
    complaint.createdAtMs > 0
  ) {
    return complaint.createdAtMs;
  }
  if (complaint.createdAt) {
    const parsed = Date.parse(complaint.createdAt.replace(' ', 'T'));
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

export function sortComplaintsByStatusAndTimestamp(
  list: Complaint[],
  timestampOrder: 'desc' | 'asc' = 'desc'
): Complaint[] {
  return [...list].sort((a, b) => {
    const rankDiff = getComplaintStageRank(a) - getComplaintStageRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const timeA = getComplaintTimestampMs(a);
    const timeB = getComplaintTimestampMs(b);
    if (timeA !== timeB) {
      return timestampOrder === 'desc' ? timeB - timeA : timeA - timeB;
    }
    return a.complaintId.localeCompare(b.complaintId);
  });
}

export function isComplaintDelayed(
  complaint: Complaint,
  nowMs: number = Date.now()
): boolean {
  if (complaint.isDelayed === true) {
    return true;
  }

  const createdMs = getComplaintTimestampMs(complaint);
  if (createdMs <= 0) {
    return false;
  }

  // If completed (both Manager Done & AM Done are checked), check if it took >24h to complete
  if (isComplaintDone(complaint)) {
    if (
      typeof complaint.completedAtMs === 'number' &&
      !Number.isNaN(complaint.completedAtMs) &&
      complaint.completedAtMs > 0
    ) {
      return complaint.completedAtMs - createdMs > DELAY_THRESHOLD_MS;
    }
    if (complaint.completedAt) {
      const parsedCompleted = Date.parse(complaint.completedAt.replace(' ', 'T'));
      if (!Number.isNaN(parsedCompleted) && parsedCompleted > 0) {
        return parsedCompleted - createdMs > DELAY_THRESHOLD_MS;
      }
    }
    return false;
  }

  // Open complaint: delayed if more than 24h has elapsed since creation
  return nowMs - createdMs > DELAY_THRESHOLD_MS;
}

export function isComplaintPending(
  complaint: Complaint,
  nowMs: number = Date.now()
): boolean {
  return !isComplaintDone(complaint) && !isComplaintDelayed(complaint, nowMs);
}

export function belongsToAccountManager(
  complaint: Complaint,
  user: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (complaint.accountManagerId && user.id) {
    return complaint.accountManagerId === user.id;
  }
  return (
    Boolean(complaint.accountManagerEmail) &&
    complaint.accountManagerEmail.toLowerCase() === user.email.toLowerCase()
  );
}

export function belongsToManager(
  complaint: Complaint,
  manager: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (complaint.managerId && manager.id) {
    return complaint.managerId === manager.id;
  }
  return (
    Boolean(complaint.managerEmail) &&
    complaint.managerEmail.toLowerCase() === manager.email.toLowerCase()
  );
}

export function isComplaintRelevantToUser(
  complaint: Complaint,
  user: Pick<UserAccount, 'id' | 'email' | 'role'>
): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'account_manager') {
    return belongsToAccountManager(complaint, user);
  }
  if (user.role === 'manager') {
    return (
      belongsToManager(complaint, user) ||
      belongsToAccountManager(complaint, user)
    );
  }
  return true;
}
