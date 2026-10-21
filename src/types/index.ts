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
}

export type ComplaintStatus = 'Pending' | 'Completed';

export interface Complaint {
  id: string; // matches complaintId for React keys
  complaintId: string; // e.g., CMP-001 (Primary Key in Supabase)
  createdAt: string; // Immutable creation timestamp string (YYYY-MM-DD HH:mm:ss)
  createdAtMs: number; // Immutable creation epoch milliseconds for calculations
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
}

const DELAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  const parsed = Date.parse(complaint.createdAt.replace(' ', 'T'));
  return Number.isNaN(parsed) ? 0 : parsed;
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

export function isComplaintDelayed(complaint: Complaint): boolean {
  if (isComplaintDone(complaint)) {
    return false;
  }
  const createdMs =
    typeof complaint.createdAtMs === 'number' && !Number.isNaN(complaint.createdAtMs)
      ? complaint.createdAtMs
      : Date.parse(complaint.createdAt.replace(' ', 'T'));
  if (Number.isNaN(createdMs)) {
    return false;
  }
  return Date.now() - createdMs > DELAY_THRESHOLD_MS;
}

export function belongsToAccountManager(
  complaint: Complaint,
  user: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (complaint.accountManagerId && user.id) {
    return complaint.accountManagerId === user.id;
  }
  return complaint.accountManagerEmail.toLowerCase() === user.email.toLowerCase();
}

export function belongsToManager(
  complaint: Complaint,
  manager: Pick<UserAccount, 'id' | 'email'>
): boolean {
  if (complaint.managerId && manager.id) {
    return complaint.managerId === manager.id;
  }
  return complaint.managerEmail.toLowerCase() === manager.email.toLowerCase();
}
