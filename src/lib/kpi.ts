import {
  belongsToManager,
  Complaint,
  DELAY_THRESHOLD_MS,
  EvaluatedComplaintDetail,
  getComplaintTimestampMs,
  ManagerKpiStats,
  UserAccount,
} from '../types';

export type KpiTimeWindow = '7d' | '14d' | '30d' | 'all';

export interface CalculateKpiOptions {
  window?: KpiTimeWindow;
  nowMs?: number;
}

/**
 * Evaluates a single complaint for weighted KPI points based on Director requirements:
 * - Completed On-Time (<= 48h): +1.0 pt
 * - Completed Late (> 48h):     +0.5 pt
 * - Open & Overdue (> 48h):     0.0 pt (included in evaluated complaints)
 * - Open & In-Progress (< 48h): Excluded from evaluation until 48h threshold passes
 */
export function evaluateComplaintKpi(
  complaint: Complaint,
  nowMs: number = Date.now()
): EvaluatedComplaintDetail {
  const createdMs = getComplaintTimestampMs(complaint);
  const managerDone = Boolean(complaint.managerDone);

  if (managerDone) {
    // Determine when manager finished their work (Anti-cheat timestamp)
    let managerDoneMs = complaint.managerDoneAtMs;
    if (!managerDoneMs && complaint.completedAtMs) {
      managerDoneMs = complaint.completedAtMs;
    }
    if (!managerDoneMs) {
      managerDoneMs = complaint.isDelayed
        ? createdMs + DELAY_THRESHOLD_MS + 1
        : createdMs;
    }

    const turnaroundMs = Math.max(0, managerDoneMs - createdMs);
    const turnaroundHours = Math.round((turnaroundMs / (1000 * 60 * 60)) * 10) / 10;
    const isOnTime = turnaroundMs <= DELAY_THRESHOLD_MS && !complaint.isDelayed;

    // Sender verification latency: completedAtMs - managerDoneAtMs
    let senderVerificationHours: number | null = null;
    if (
      complaint.accountManagerDone &&
      complaint.completedAtMs &&
      complaint.completedAtMs >= managerDoneMs
    ) {
      const verifyMs = complaint.completedAtMs - managerDoneMs;
      senderVerificationHours = Math.round((verifyMs / (1000 * 60 * 60)) * 10) / 10;
    }

    return {
      complaint,
      status: isOnTime ? 'ON_TIME' : 'LATE',
      points: isOnTime ? 1.0 : 0.5,
      isEvaluated: true,
      managerTurnaroundHours: turnaroundHours,
      senderVerificationHours,
    };
  }

  // Manager is NOT done yet
  const elapsedMs = Math.max(0, nowMs - createdMs);
  const isPast48h = elapsedMs > DELAY_THRESHOLD_MS || complaint.isDelayed === true;

  if (isPast48h) {
    return {
      complaint,
      status: 'OVERDUE',
      points: 0.0,
      isEvaluated: true,
      managerTurnaroundHours: null,
      senderVerificationHours: null,
    };
  }

  // In Progress (< 48h): Excluded from penalty until 48h passes
  return {
    complaint,
    status: 'IN_PROGRESS',
    points: 0.0,
    isEvaluated: false,
    managerTurnaroundHours: null,
    senderVerificationHours: null,
  };
}

/**
 * Filter complaints according to rolling time window.
 * Default is 7-day rolling window as requested.
 * Anti-cheat safeguard: Open overdue complaints are NEVER excluded even if they age past 7 days!
 */
export function filterComplaintsByWindow(
  complaints: Complaint[],
  window: KpiTimeWindow = '7d',
  nowMs: number = Date.now()
): Complaint[] {
  if (window === 'all') return complaints;

  const days = window === '7d' ? 7 : window === '14d' ? 14 : 30;
  const windowThresholdMs = nowMs - days * 24 * 60 * 60 * 1000;

  return complaints.filter((c) => {
    const createdMs = getComplaintTimestampMs(c);
    // Included if created within rolling window
    if (createdMs >= windowThresholdMs) return true;

    // Anti-cheat: If manager has NOT finished and it is overdue, keep it in the window!
    const isUnresolvedOverdue =
      !c.managerDone && nowMs - createdMs > DELAY_THRESHOLD_MS;
    return isUnresolvedOverdue;
  });
}

/**
 * Calculates weighted KPI statistics for a single manager.
 */
export function calculateManagerKpi(
  complaints: Complaint[],
  manager: UserAccount,
  options: CalculateKpiOptions = {}
): ManagerKpiStats {
  const { window = '7d', nowMs = Date.now() } = options;

  // 1. Scoped to this manager
  const assigned = complaints.filter((c) => belongsToManager(c, manager));

  // 2. Filter by rolling window
  const windowComplaints = filterComplaintsByWindow(assigned, window, nowMs);

  // 3. Evaluate each complaint
  const evaluatedList = windowComplaints.map((c) => evaluateComplaintKpi(c, nowMs));

  let onTimeCount = 0;
  let lateCount = 0;
  let overdueCount = 0;
  let inProgressCount = 0;
  let earnedPoints = 0;

  const turnaroundTimes: number[] = [];
  const senderVerifyTimes: number[] = [];

  for (const item of evaluatedList) {
    if (item.status === 'ON_TIME') {
      onTimeCount += 1;
      earnedPoints += 1.0;
      if (item.managerTurnaroundHours !== null) {
        turnaroundTimes.push(item.managerTurnaroundHours);
      }
      if (item.senderVerificationHours !== null) {
        senderVerifyTimes.push(item.senderVerificationHours);
      }
    } else if (item.status === 'LATE') {
      lateCount += 1;
      earnedPoints += 0.5;
      if (item.managerTurnaroundHours !== null) {
        turnaroundTimes.push(item.managerTurnaroundHours);
      }
      if (item.senderVerificationHours !== null) {
        senderVerifyTimes.push(item.senderVerificationHours);
      }
    } else if (item.status === 'OVERDUE') {
      overdueCount += 1;
      // 0.0 points
    } else if (item.status === 'IN_PROGRESS') {
      inProgressCount += 1;
      // Excluded from totalEvaluated and earnedPoints
    }
  }

  const totalEvaluated = onTimeCount + lateCount + overdueCount;
  // If no evaluated complaints (e.g. 0 complaints or only in-progress), default to 100%
  const kpiScore =
    totalEvaluated > 0
      ? Math.round((earnedPoints / totalEvaluated) * 100)
      : 100;

  const avgManagerTurnaroundHours =
    turnaroundTimes.length > 0
      ? Math.round(
          (turnaroundTimes.reduce((acc, v) => acc + v, 0) / turnaroundTimes.length) * 10
        ) / 10
      : null;

  const avgSenderVerificationHours =
    senderVerifyTimes.length > 0
      ? Math.round(
          (senderVerifyTimes.reduce((acc, v) => acc + v, 0) / senderVerifyTimes.length) * 10
        ) / 10
      : null;

  return {
    manager,
    kpiScore,
    earnedPoints: Math.round(earnedPoints * 10) / 10,
    totalEvaluated,
    totalAssigned: windowComplaints.length,
    onTimeCount,
    lateCount,
    overdueCount,
    inProgressCount,
    avgManagerTurnaroundHours,
    avgSenderVerificationHours,
    evaluatedComplaints: evaluatedList,
  };
}

/**
 * Calculates weighted KPI statistics for all managers, sorted by score descending.
 */
export function calculateAllManagersKpi(
  complaints: Complaint[],
  managers: UserAccount[],
  options: CalculateKpiOptions = {}
): {
  stats: ManagerKpiStats[];
  teamAverageKpi: number;
} {
  const stats = managers.map((mgr) => calculateManagerKpi(complaints, mgr, options));

  // Sort by KPI Score (highest first), then earned points, then on-time count
  stats.sort((a, b) => {
    if (b.kpiScore !== a.kpiScore) return b.kpiScore - a.kpiScore;
    if (b.earnedPoints !== a.earnedPoints) return b.earnedPoints - a.earnedPoints;
    return b.onTimeCount - a.onTimeCount;
  });

  const totalEvaluatedSum = stats.reduce((acc, s) => acc + s.totalEvaluated, 0);
  const totalEarnedSum = stats.reduce((acc, s) => acc + s.earnedPoints, 0);

  const teamAverageKpi =
    totalEvaluatedSum > 0
      ? Math.round((totalEarnedSum / totalEvaluatedSum) * 100)
      : stats.length > 0
      ? Math.round(stats.reduce((acc, s) => acc + s.kpiScore, 0) / stats.length)
      : 100;

  return {
    stats,
    teamAverageKpi,
  };
}
