import { Query, UserAccount } from '../types';
import { getFirstManagerRemarkTimestampMs } from '../types';

export interface RatingBreakdown {
  adminRating: number;
  adminRemark?: string | null;
  adminRatedAt?: string | null;
  systemRating: number;
  systemReason: string;
  senderRating?: number | null;
  senderRemark?: string | null;
  senderRatedAt?: string | null;
  receiverRating?: number | null;
  receiverRemark?: string | null;
  receiverRatedAt?: string | null;
  overallRating: number; // Out of 10.0
}

/**
 * Calculates the System Rating for the RECEIVING MANAGER on a query.
 *
 * Rules:
 * Normal Query (24h Due):
 *  - 10 stars: First remark within 2 hours
 *  - 5 stars: First remark between >2 hours and <=12 hours
 *  - 0 stars: First remark after >12 hours or no remark placed after 12h
 *
 * Urgent Query:
 *  - 10 stars: First remark within 30 minutes
 *  - 5 stars: First remark between >30 minutes and <=1 hour
 *  - 0 stars: First remark after >1 hour or no remark placed after 1 hour
 */
export function calculateReceiverSystemRating(
  query: Query,
  nowMs: number = Date.now()
): { rating: number; reason: string } {
  if (!query) {
    return { rating: 10, reason: 'Default rating' };
  }

  const createdMs = query.createdAtMs || 0;
  if (createdMs <= 0) {
    return { rating: 10, reason: 'Default rating' };
  }

  const firstRemarkMs = getFirstManagerRemarkTimestampMs(query);
  const isUrgent = Boolean(query.isUrgent);

  if (isUrgent) {
    const THIRTY_MINS_MS = 30 * 60 * 1000;
    const ONE_HOUR_MS = 60 * 60 * 1000;

    if (firstRemarkMs !== null) {
      const elapsed = firstRemarkMs - createdMs;
      if (elapsed <= THIRTY_MINS_MS) {
        const mins = Math.max(1, Math.round(elapsed / 60000));
        return { rating: 10, reason: `Responded in ${mins}m (within 30m SLA)` };
      } else if (elapsed <= ONE_HOUR_MS) {
        const mins = Math.round(elapsed / 60000);
        return { rating: 5, reason: `Responded in ${mins}m (>30m & <=1h)` };
      } else {
        const hours = (elapsed / 3600000).toFixed(1);
        return { rating: 0, reason: `Responded after ${hours}h (>1h SLA exceeded)` };
      }
    } else {
      // No remark placed yet
      const isCompleted = query.managerDone && query.accountManagerDone;
      const elapsed = isCompleted && query.completedAtMs ? query.completedAtMs - createdMs : nowMs - createdMs;

      if (elapsed <= THIRTY_MINS_MS) {
        const minsRemaining = Math.max(0, Math.round((THIRTY_MINS_MS - elapsed) / 60000));
        return { rating: 10, reason: `No remark yet (${minsRemaining}m left before rating drops to 5★)` };
      } else if (elapsed <= ONE_HOUR_MS) {
        const minsRemaining = Math.max(0, Math.round((ONE_HOUR_MS - elapsed) / 60000));
        return { rating: 5, reason: `No remark yet (>30m, ${minsRemaining}m left before rating drops to 0★)` };
      } else {
        return { rating: 0, reason: 'Overdue: No manager remark placed within 1 hour' };
      }
    }
  } else {
    // Normal Query (24h Due)
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

    if (firstRemarkMs !== null) {
      const elapsed = firstRemarkMs - createdMs;
      if (elapsed <= TWO_HOURS_MS) {
        const mins = Math.max(1, Math.round(elapsed / 60000));
        const timeStr = mins < 60 ? `${mins}m` : `${(mins / 60).toFixed(1)}h`;
        return { rating: 10, reason: `Responded in ${timeStr} (within 2h SLA)` };
      } else if (elapsed <= TWELVE_HOURS_MS) {
        const hours = (elapsed / 3600000).toFixed(1);
        return { rating: 5, reason: `Responded in ${hours}h (>2h & <=12h)` };
      } else {
        const hours = (elapsed / 3600000).toFixed(1);
        return { rating: 0, reason: `Responded after ${hours}h (>12h SLA exceeded)` };
      }
    } else {
      // No remark placed yet
      const isCompleted = query.managerDone && query.accountManagerDone;
      const elapsed = isCompleted && query.completedAtMs ? query.completedAtMs - createdMs : nowMs - createdMs;

      if (elapsed <= TWO_HOURS_MS) {
        const hoursLeft = ((TWO_HOURS_MS - elapsed) / 3600000).toFixed(1);
        return { rating: 10, reason: `No remark yet (${hoursLeft}h left before rating drops to 5★)` };
      } else if (elapsed <= TWELVE_HOURS_MS) {
        const hoursLeft = ((TWELVE_HOURS_MS - elapsed) / 3600000).toFixed(1);
        return { rating: 5, reason: `No remark yet (>2h, ${hoursLeft}h left before rating drops to 0★)` };
      } else {
        return { rating: 0, reason: 'Overdue: No manager remark placed within 12 hours' };
      }
    }
  }
}

/**
 * Calculates the System Rating for the SENDER (ACCOUNT MANAGER) on a query.
 *
 * Rules:
 * - Default 10 stars if receiver never requested remark or extension.
 *
 * Normal Query:
 *  - 10 stars: Responded within 2 hours
 *  - 5 stars: >2 hours & <=12 hours sender never responded
 *  - 0 stars: >12 hours sender never responded
 *
 * Urgent Query:
 *  - 10 stars: Responded within 1 hour
 *  - 5 stars: >1 hour & <=3 hours sender never responded
 *  - 0 stars: >3 hours sender never responded
 */
export function calculateSenderSystemRating(
  query: Query,
  nowMs: number = Date.now()
): { rating: number; reason: string } {
  if (!query) {
    return { rating: 10, reason: 'Default rating' };
  }

  const isUrgent = Boolean(query.isUrgent);

  // Check if receiving manager asked for extension or posted a remark
  let requestMs: number | null = null;
  let responseMs: number | null = null;
  let requestType = '';

  // 1. Check extension request
  if (query.extensionRequestedAt) {
    const extRequestedMs =
      query.extensionProposedDueAtMs ||
      new Date(query.extensionRequestedAt).getTime() ||
      null;
    if (extRequestedMs && (!requestMs || extRequestedMs < requestMs)) {
      requestMs = extRequestedMs;
      requestType = 'extension request';
      if (query.extensionReviewedAt) {
        responseMs = new Date(query.extensionReviewedAt).getTime() || null;
      }
    }
  }

  // 2. Check manager remarks in remarks log
  if (Array.isArray(query.remarks) && query.remarks.length > 0) {
    const mgrRemarks = query.remarks.filter(
      (r) => r.type === 'manager' || r.authorRole === 'manager'
    );
    if (mgrRemarks.length > 0) {
      const earliestMgr = mgrRemarks[0];
      const earliestMgrMs = earliestMgr.createdAtMs || 0;
      if (earliestMgrMs > 0 && (!requestMs || earliestMgrMs < requestMs)) {
        requestMs = earliestMgrMs;
        requestType = 'manager remark';

        // Check if sender replied after this remark
        const senderReplies = query.remarks.filter(
          (r) =>
            (r.type === 'sender' || r.authorRole === 'account_manager') &&
            (r.createdAtMs || 0) >= earliestMgrMs
        );
        if (senderReplies.length > 0) {
          responseMs = senderReplies[0].createdAtMs || null;
        } else if (query.accountManagerDone && query.completedAtMs) {
          responseMs = query.completedAtMs;
        }
      }
    }
  }

  // If no extension request and no manager remark, sender responded properly by default
  if (!requestMs) {
    return { rating: 10, reason: 'Sender responding properly (Default 10★)' };
  }

  const SLA_10_MS = isUrgent ? 1 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  const SLA_5_MS = isUrgent ? 3 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;

  if (responseMs !== null) {
    const elapsed = responseMs - requestMs;
    if (elapsed <= SLA_10_MS) {
      const mins = Math.max(1, Math.round(elapsed / 60000));
      const str = mins < 60 ? `${mins}m` : `${(mins / 60).toFixed(1)}h`;
      return { rating: 10, reason: `Responded to ${requestType} in ${str}` };
    } else if (elapsed <= SLA_5_MS) {
      const hours = (elapsed / 3600000).toFixed(1);
      return { rating: 5, reason: `Responded to ${requestType} in ${hours}h (late)` };
    } else {
      const hours = (elapsed / 3600000).toFixed(1);
      return { rating: 0, reason: `Responded to ${requestType} after ${hours}h (>SLA)` };
    }
  } else {
    // Sender has NOT responded yet
    const elapsed = nowMs - requestMs;
    if (elapsed <= SLA_10_MS) {
      const minsLeft = Math.max(0, Math.round((SLA_10_MS - elapsed) / 60000));
      return {
        rating: 10,
        reason: `Pending response to ${requestType} (${minsLeft}m left before rating drops to 5★)`,
      };
    } else if (elapsed <= SLA_5_MS) {
      const hoursLeft = ((SLA_5_MS - elapsed) / 3600000).toFixed(1);
      return {
        rating: 5,
        reason: `Pending response to ${requestType} (${hoursLeft}h left before rating drops to 0★)`,
      };
    } else {
      return {
        rating: 0,
        reason: `Overdue: Sender did not respond to ${requestType}`,
      };
    }
  }
}

/**
 * Calculates the composite Receiver Rating (out of 10.0 stars)
 * Formula: Admin (50%) + System (30%) + Sender (20%)
 */
export function calculateReceiverOverallRating(
  query: Query,
  nowMs: number = Date.now()
): RatingBreakdown {
  const adminRating =
    typeof query.adminReceiverRating === 'number' && query.adminReceiverRating >= 1
      ? query.adminReceiverRating
      : 10; // Default 10 stars

  const system = calculateReceiverSystemRating(query, nowMs);

  // Normalize legacy 1-5 rating to 10 if necessary
  let senderRating: number | null = null;
  if (typeof query.senderReceiverRating === 'number' && query.senderReceiverRating >= 1) {
    senderRating = query.senderReceiverRating;
  } else if (typeof query.rating === 'number' && query.rating >= 1) {
    senderRating = query.rating <= 5 ? query.rating * 2 : query.rating;
  }

  // If sender has not rated yet, default to 10 stars
  const effectiveSenderRating = senderRating !== null ? senderRating : 10;

  const rawScore = adminRating * 0.5 + system.rating * 0.3 + effectiveSenderRating * 0.2;
  const overallRating = Math.round(rawScore * 10) / 10;

  return {
    adminRating,
    adminRemark: query.adminReceiverRemark || null,
    adminRatedAt: query.adminReceiverRatedAt || null,
    systemRating: system.rating,
    systemReason: system.reason,
    senderRating,
    senderRemark: query.senderReceiverRemark || null,
    senderRatedAt: query.senderReceiverRatedAt || null,
    overallRating,
  };
}

// Cutoff timestamp: Queries created up till this timestamp default receiver rating for sender to 10 stars.
// For queries created after this timestamp, receiver rating for sender will be prompted and calculated.
export const RECEIVER_RATING_FEATURE_START_MS = 1794298058000; // 2026-11-10T16:07:38+08:00

/**
 * Calculates the composite Sender Rating (out of 10.0 stars)
 * Formula: Admin (50%) + System (30%) + Receiver (20%)
 */
export function calculateSenderOverallRating(
  query: Query,
  nowMs: number = Date.now()
): RatingBreakdown {
  const adminRating =
    typeof query.adminSenderRating === 'number' && query.adminSenderRating >= 1
      ? query.adminSenderRating
      : 10; // Default 10 stars

  const system = calculateSenderSystemRating(query, nowMs);

  let receiverRating: number | null = null;
  let receiverRemark: string | null = null;
  let receiverRatedAt: string | null = null;

  if (typeof query.receiverSenderRating === 'number' && query.receiverSenderRating >= 1) {
    receiverRating = query.receiverSenderRating;
    receiverRemark = query.receiverSenderRemark || null;
    receiverRatedAt = query.receiverSenderRatedAt || null;
  } else if (!query.createdAtMs || query.createdAtMs <= RECEIVER_RATING_FEATURE_START_MS) {
    // For queries up till now, just make it all the senders to be 10 stars
    receiverRating = 10;
    receiverRemark = 'Default 10★ rating (Legacy query)';
  }

  // If receiver has not rated yet on new query, default to 10 stars for composite score calculation
  const effectiveReceiverRating = receiverRating !== null ? receiverRating : 10;

  const rawScore = adminRating * 0.5 + system.rating * 0.3 + effectiveReceiverRating * 0.2;
  const overallRating = Math.round(rawScore * 10) / 10;

  return {
    adminRating,
    adminRemark: query.adminSenderRemark || null,
    adminRatedAt: query.adminSenderRatedAt || null,
    systemRating: system.rating,
    systemReason: system.reason,
    receiverRating,
    receiverRemark,
    receiverRatedAt,
    overallRating,
  };
}

export interface UserRatingStats {
  user: UserAccount;
  senderQueriesCount: number;
  avgSenderRating: number | null; // out of 10.0
  receiverQueriesCount: number;
  avgReceiverRating: number | null; // out of 10.0
  combinedAverageRating: number | null; // out of 10.0
  totalQueriesInvolved: number;
}

/**
 * Aggregates ratings for all users across the queries database.
 */
export function calculateAllUsersRatingStats(
  users: UserAccount[],
  queries: Query[],
  nowMs: number = Date.now()
): UserRatingStats[] {
  return users.map((user) => {
    const userEmailLower = (user.email || '').toLowerCase().trim();
    const userId = user.id;

    // Queries where this user is SENDER
    const senderQueries = queries.filter((q) => {
      const qEmail = (q.accountManagerEmail || '').toLowerCase().trim();
      return q.accountManagerId === userId || (qEmail && qEmail === userEmailLower);
    });

    let avgSenderRating: number | null = null;
    if (senderQueries.length > 0) {
      const sumSender = senderQueries.reduce((sum, q) => {
        return sum + calculateSenderOverallRating(q, nowMs).overallRating;
      }, 0);
      avgSenderRating = Math.round((sumSender / senderQueries.length) * 10) / 10;
    }

    // Queries where this user is RECEIVER
    const receiverQueries = queries.filter((q) => {
      const qEmail = (q.managerEmail || '').toLowerCase().trim();
      return q.managerId === userId || (qEmail && qEmail === userEmailLower);
    });

    let avgReceiverRating: number | null = null;
    if (receiverQueries.length > 0) {
      const sumReceiver = receiverQueries.reduce((sum, q) => {
        return sum + calculateReceiverOverallRating(q, nowMs).overallRating;
      }, 0);
      avgReceiverRating = Math.round((sumReceiver / receiverQueries.length) * 10) / 10;
    }

    // Combined rating across all queries involved
    const totalCount = senderQueries.length + receiverQueries.length;
    let combinedAverageRating: number | null = null;
    if (totalCount > 0) {
      const totalSum =
        (avgSenderRating !== null ? avgSenderRating * senderQueries.length : 0) +
        (avgReceiverRating !== null ? avgReceiverRating * receiverQueries.length : 0);
      combinedAverageRating = Math.round((totalSum / totalCount) * 10) / 10;
    }

    return {
      user,
      senderQueriesCount: senderQueries.length,
      avgSenderRating,
      receiverQueriesCount: receiverQueries.length,
      avgReceiverRating,
      combinedAverageRating,
      totalQueriesInvolved: totalCount,
    };
  });
}
