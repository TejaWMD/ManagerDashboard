import {
  belongsToManager,
  Query,
  DELAY_THRESHOLD_MS,
  EvaluatedQueryDetail,
  getQueryTimestampMs,
  ManagerKpiStats,
  UserAccount,
} from '../types';

export type KpiTimeWindow = '7d' | '14d' | '30d' | 'all';

export interface CalculateKpiOptions {
  window?: KpiTimeWindow;
  nowMs?: number;
}

/**
 * Evaluates a single query for weighted KPI points based on Director requirements:
 * - Completed On-Time (<= 48h): +1.0 pt
 * - Completed Late (> 48h):     +0.5 pt
 * - Open & Overdue (> 48h):     0.0 pt (included in evaluated queries)
 * - Open & In-Progress (< 48h): Excluded from evaluation until 48h threshold passes
 */
export function evaluateQueryKpi(
  query: Query,
  nowMs: number = Date.now()
): EvaluatedQueryDetail {
  const createdMs = getQueryTimestampMs(query);
  const managerDone = Boolean(query.managerDone);

  if (managerDone) {
    // Determine when manager finished their work (Anti-cheat timestamp)
    let managerDoneMs = query.managerDoneAtMs;
    if (!managerDoneMs && query.completedAtMs) {
      managerDoneMs = query.completedAtMs;
    }
    if (!managerDoneMs) {
      managerDoneMs = query.isDelayed
        ? createdMs + DELAY_THRESHOLD_MS + 1
        : createdMs;
    }

    const turnaroundMs = Math.max(0, managerDoneMs - createdMs);
    const turnaroundHours = Math.round((turnaroundMs / (1000 * 60 * 60)) * 10) / 10;
    const isOnTime = turnaroundMs <= DELAY_THRESHOLD_MS && !query.isDelayed;

    // Sender verification latency: completedAtMs - managerDoneAtMs
    let senderVerificationHours: number | null = null;
    if (
      query.accountManagerDone &&
      query.completedAtMs &&
      query.completedAtMs >= managerDoneMs
    ) {
      const verifyMs = query.completedAtMs - managerDoneMs;
      senderVerificationHours = Math.round((verifyMs / (1000 * 60 * 60)) * 10) / 10;
    }

    return {
      query,
      status: isOnTime ? 'ON_TIME' : 'LATE',
      points: isOnTime ? 1.0 : 0.5,
      isEvaluated: true,
      managerTurnaroundHours: turnaroundHours,
      senderVerificationHours,
    };
  }

  // Manager is NOT done yet
  const elapsedMs = Math.max(0, nowMs - createdMs);
  const isPast48h = elapsedMs > DELAY_THRESHOLD_MS || query.isDelayed === true;

  if (isPast48h) {
    return {
      query,
      status: 'OVERDUE',
      points: 0.0,
      isEvaluated: true,
      managerTurnaroundHours: null,
      senderVerificationHours: null,
    };
  }

  // In Progress (< 48h): Excluded from penalty until 48h passes
  return {
    query,
    status: 'IN_PROGRESS',
    points: 0.0,
    isEvaluated: false,
    managerTurnaroundHours: null,
    senderVerificationHours: null,
  };
}

/**
 * Filter queries according to rolling time window.
 * Default is 7-day rolling window as requested.
 * Anti-cheat safeguard: Open overdue queries are NEVER excluded even if they age past 7 days!
 */
export function filterQueriesByWindow(
  queries: Query[],
  window: KpiTimeWindow = '7d',
  nowMs: number = Date.now()
): Query[] {
  if (window === 'all') return queries;

  const days = window === '7d' ? 7 : window === '14d' ? 14 : 30;
  const windowThresholdMs = nowMs - days * 24 * 60 * 60 * 1000;

  return queries.filter((c) => {
    const createdMs = getQueryTimestampMs(c);
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
  queries: Query[],
  manager: UserAccount,
  options: CalculateKpiOptions = {}
): ManagerKpiStats {
  const { window = '7d', nowMs = Date.now() } = options;

  // 1. Scoped to this manager
  const assigned = queries.filter((c) => belongsToManager(c, manager));

  // 2. Filter by rolling window
  const windowQueries = filterQueriesByWindow(assigned, window, nowMs);

  // 3. Evaluate each query
  const evaluatedList = windowQueries.map((c) => evaluateQueryKpi(c, nowMs));

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
  const completedCount = onTimeCount + lateCount;
  const delayedCount = lateCount + overdueCount;
  const totalAssigned = windowQueries.length;
  const completionRate =
    totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100) : 0;

  // Weighted Turnaround KPI Score Formula: (Earned Points ÷ Total Evaluated Queries) × 100
  // If no queries have been evaluated yet (0 completed & 0 overdue), KPI is 0%
  const kpiScore =
    totalEvaluated > 0
      ? Math.round((earnedPoints / totalEvaluated) * 100)
      : 0;
  const turnaroundKpi = kpiScore;

  // Ratings calculation (sender ratings 1-5 stars)
  const ratings: number[] = [];
  for (const c of windowQueries) {
    if (typeof c.rating === 'number' && c.rating >= 1 && c.rating <= 5) {
      ratings.push(c.rating);
    }
  }
  const totalRated = ratings.length;
  const avgRating =
    totalRated > 0
      ? Math.round((ratings.reduce((acc, r) => acc + r, 0) / totalRated) * 10) / 10
      : null;

  // Overall KPI: average of turnaround KPI and sender average rating converted to percentage (5.0 stars = 100%)
  // If no ratings exist yet, overall KPI defaults to turnaround KPI
  let overallKpi = turnaroundKpi;
  if (avgRating !== null) {
    const ratingPercentage = (avgRating / 5.0) * 100;
    overallKpi = Math.round((turnaroundKpi + ratingPercentage) / 2);
  }

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
    turnaroundKpi,
    earnedPoints: Math.round(earnedPoints * 10) / 10,
    totalEvaluated,
    totalAssigned,
    completedCount,
    delayedCount,
    completionRate,
    onTimeCount,
    lateCount,
    overdueCount,
    inProgressCount,
    avgRating,
    totalRated,
    overallKpi,
    avgManagerTurnaroundHours,
    avgSenderVerificationHours,
    evaluatedQueries: evaluatedList,
  };
}

/**
 * Calculates weighted KPI statistics for all managers, sorted by overall KPI score descending.
 */
export function calculateAllManagersKpi(
  queries: Query[],
  managers: UserAccount[],
  options: CalculateKpiOptions = {}
): {
  stats: ManagerKpiStats[];
  teamAverageKpi: number;
  teamAverageRating: number | null;
} {
  const stats = managers.map((mgr) => calculateManagerKpi(queries, mgr, options));

  // Sort by Overall KPI Score (highest first), then Turnaround KPI, then avgRating, then earned points
  stats.sort((a, b) => {
    if (b.overallKpi !== a.overallKpi) return b.overallKpi - a.overallKpi;
    if (b.turnaroundKpi !== a.turnaroundKpi) return b.turnaroundKpi - a.turnaroundKpi;
    const rateA = a.avgRating ?? 0;
    const rateB = b.avgRating ?? 0;
    if (rateB !== rateA) return rateB - rateA;
    if (b.earnedPoints !== a.earnedPoints) return b.earnedPoints - a.earnedPoints;
    return b.onTimeCount - a.onTimeCount;
  });

  const validRatings = stats
    .map((s) => s.avgRating)
    .filter((r): r is number => typeof r === 'number' && !Number.isNaN(r));

  const teamAverageRating =
    validRatings.length > 0
      ? Math.round((validRatings.reduce((acc, r) => acc + r, 0) / validRatings.length) * 10) / 10
      : null;

  const teamAverageKpi =
    stats.length > 0
      ? Math.round(stats.reduce((acc, s) => acc + s.overallKpi, 0) / stats.length)
      : 0;

  return {
    stats,
    teamAverageKpi,
    teamAverageRating,
  };
}
