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

export interface Query {
  id: string; // matches queryId for React keys
  queryId: string; // e.g., QRY-001 (Primary Key in Supabase)
  createdAt: string; // Immutable creation timestamp string (YYYY-MM-DD HH:mm:ss)
  createdAtMs: number; // Immutable creation epoch milliseconds for calculations
  completedAt?: string | null; // Completion timestamp string when both Manager & AM checked
  completedAtMs?: number | null; // Completion epoch milliseconds for SLA / delay persistence
  isDelayed?: boolean; // Persisted flag if query exceeded 24h before or at completion
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
  managerDoneAtMs?: number | null; // Epoch ms when assigned manager marked Done (for SLA tracking)
  accountManagerRemarkTitle: string;
  accountManagerRemark: string;
  accountManagerDone: boolean;
  status: QueryStatus;
  delayNotified?: boolean;
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

  const createdMs = getQueryTimestampMs(query);
  if (createdMs <= 0) {
    return false;
  }

  // If completed (both Manager Done & AM Done are checked), check if it took >24h to complete
  if (isQueryDone(query)) {
    if (
      typeof query.completedAtMs === 'number' &&
      !Number.isNaN(query.completedAtMs) &&
      query.completedAtMs > 0
    ) {
      return query.completedAtMs - createdMs > DELAY_THRESHOLD_MS;
    }
    if (query.completedAt) {
      const parsedCompleted = Date.parse(query.completedAt.replace(' ', 'T'));
      if (!Number.isNaN(parsedCompleted) && parsedCompleted > 0) {
        return parsedCompleted - createdMs > DELAY_THRESHOLD_MS;
      }
    }
    return false;
  }

  // Open query: delayed if more than 24h has elapsed since creation
  return nowMs - createdMs > DELAY_THRESHOLD_MS;
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
  kpiScore: number; // 0 - 100 percentage
  earnedPoints: number;
  totalEvaluated: number; // count of evaluated queries (onTime + late + overdue)
  totalAssigned: number; // total queries received in window
  onTimeCount: number; // +1.0
  lateCount: number; // +0.5
  overdueCount: number; // 0.0
  inProgressCount: number; // excluded (<48h)
  avgManagerTurnaroundHours: number | null;
  avgSenderVerificationHours: number | null;
  evaluatedQueries: EvaluatedQueryDetail[];
}
