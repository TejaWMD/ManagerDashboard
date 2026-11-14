import React, { useEffect, useMemo, useState } from 'react';
import {
  Query,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import {
  calculateAllManagersKpi,
  KpiTimeWindow,
} from '../../lib/kpi';
import { redirectToMainApp } from '../../lib/sso';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './KPIPage.css';

interface KPIPageProps {
  currentUser: UserAccount;
  queries: Query[];
  users?: UserAccount[];
  onNavigate?: (page: 'home' | 'queries' | 'kpi') => void;
  onRefreshQueries?: () => Promise<Query[] | void>;
}

export const KPIPage: React.FC<KPIPageProps> = ({
  currentUser,
  queries,
  users,
  onNavigate,
  onRefreshQueries,
}) => {
  const userList = users && users.length > 0 ? users : AUTHORIZED_USERS;
  const managers = useMemo(
    () => userList.filter((u) => u.role === 'manager'),
    [userList]
  );

  // Default to 'all' so lifetime and historical queries from Supabase are fully displayed
  const [timeWindow, setTimeWindow] = useState<KpiTimeWindow>('all');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('ALL');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Automatically refresh queries straight from Supabase on mount
  useEffect(() => {
    if (onRefreshQueries) {
      onRefreshQueries().catch(() => {});
    }
  }, [onRefreshQueries]);

  const handleManualRefresh = async () => {
    if (!onRefreshQueries || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefreshQueries();
    } finally {
      setIsRefreshing(false);
    }
  };

  const nowMs = useMemo(() => Date.now(), []);

  // Compute rolling KPI stats for all managers
  const { stats: managerStats } = useMemo(() => {
    return calculateAllManagersKpi(queries, managers, {
      window: timeWindow,
      nowMs,
    });
  }, [queries, managers, timeWindow, nowMs]);

  return (
    <div className="kpi-screen-container">
      {/* 1. Sleek Bubbly Header */}
      <header className="kpi-compact-header">
        <div className="kpi-header-left">
          <div className="kpi-title-cluster">
            <h1 className="kpi-page-heading">Manager KPI</h1>
          </div>
        </div>

        <div className="kpi-header-right">
          {/* Sync / Refresh Button */}
          {onRefreshQueries && (
            <button
              type="button"
              className={`kpi-refresh-btn ${isRefreshing ? 'kpi-refresh-btn--spinning' : ''}`}
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              title="Click to fetch the latest query data directly from Supabase"
            >
              <span className="kpi-refresh-icon">🔄</span>
              <span>{isRefreshing ? 'Syncing...' : 'Sync Supabase'}</span>
            </button>
          )}

          {/* Time Window Pills */}
          <div className="kpi-pill-group">
            <button
              type="button"
              className={`kpi-pill-btn ${timeWindow === 'all' ? 'kpi-pill-btn--active' : ''}`}
              onClick={() => setTimeWindow('all')}
            >
              All Time
            </button>
            <button
              type="button"
              className={`kpi-pill-btn ${timeWindow === '7d' ? 'kpi-pill-btn--active' : ''}`}
              onClick={() => setTimeWindow('7d')}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`kpi-pill-btn ${timeWindow === '14d' ? 'kpi-pill-btn--active' : ''}`}
              onClick={() => setTimeWindow('14d')}
            >
              14 Days
            </button>
            <button
              type="button"
              className={`kpi-pill-btn ${timeWindow === '30d' ? 'kpi-pill-btn--active' : ''}`}
              onClick={() => setTimeWindow('30d')}
            >
              30 Days
            </button>
          </div>

          <button
            type="button"
            className="kpi-brand-logo-badge"
            onClick={() => redirectToMainApp()}
            title="Back to WMD Hub"
            aria-label="Back to WMD Hub"
            style={{ cursor: 'pointer' }}
          >
            <img src={wmdLogo} alt="WMD" className="kpi-brand-logo-img" />
          </button>
        </div>
      </header>

      {/* 2. Unified 5-Card Balanced Grid (All cards full width, compact, fit to screen) */}
      <div className="kpi-five-cards-grid">
        {/* Manager KPI Scorecards */}
        <section className="kpi-managers-row" aria-label="Manager KPI Scorecards">
          {managerStats.map((stat, idx) => {
            const rankMedal =
              idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '🏅';
            const isMe = currentUser.id === stat.manager.id;
            const isSelected = selectedManagerId === stat.manager.id;

            const scoreColorClass =
              stat.hasActiveUrgentPenalty
                ? 'kpi-card--red'
                : stat.totalEvaluated === 0 && stat.totalRated === 0
                ? 'kpi-card--neutral'
                : stat.overallKpi >= 85
                ? 'kpi-card--green'
                : stat.overallKpi >= 70
                ? 'kpi-card--amber'
                : 'kpi-card--red';

            const onTimePct =
              stat.totalAssigned > 0
                ? Math.round((stat.onTimeCount / stat.totalAssigned) * 100)
                : 0;
            const latePct =
              stat.totalAssigned > 0
                ? Math.round((stat.lateCount / stat.totalAssigned) * 100)
                : 0;
            const overduePct =
              stat.totalAssigned > 0
                ? Math.round((stat.overdueCount / stat.totalAssigned) * 100)
                : 0;
            const inProgressPct =
              stat.totalAssigned > 0
                ? Math.max(0, 100 - onTimePct - latePct - overduePct)
                : 0;

            return (
              <div
                key={stat.manager.id}
                className={`kpi-uniform-card kpi-mgr-box ${scoreColorClass} ${
                  isSelected ? 'kpi-mgr-box--selected' : ''
                } ${isMe ? 'kpi-mgr-box--me' : ''}`}
                onClick={() =>
                  setSelectedManagerId((prev) =>
                    prev === stat.manager.id ? 'ALL' : stat.manager.id
                  )
                }
                title={isMe ? `${stat.manager.name} (You)` : stat.manager.name}
              >
                {/* Card Header: Profile Left, Rank Bubble Right */}
                <div className="mgr-box-top">
                  <div className="mgr-profile-inline">
                    <div className="mgr-avatar">{stat.manager.avatarInitials}</div>
                    <div className="mgr-meta-col">
                      <div className="mgr-name-line">
                        <span className="mgr-name">{stat.manager.name}</span>
                        {isMe && <span className="mgr-you-tag">You</span>}
                        {stat.hasActiveUrgentPenalty && (
                          <span
                            className="mgr-urgent-penalty-pill"
                            title="Active urgent query pending: 50% KPI penalty applied until completed"
                          >
                            🚨 -50% Urgent
                          </span>
                        )}
                      </div>
                      <span className="mgr-role-text">Manager</span>
                    </div>
                  </div>

                  <div className="mgr-rank-pill">
                    <span className="rank-emoji">{rankMedal}</span>
                    <span className="rank-text">#{idx + 1}</span>
                  </div>
                </div>

                {/* Dual Metrics Showcase: Overall KPI (Left) + Completed / Received (Right) */}
                <div className="mgr-score-block">
                  <div className="mgr-score-primary">
                    <div className="mgr-score-topline">
                      <span className="score-number">{stat.overallKpi}%</span>
                      {stat.hasActiveUrgentPenalty ? (
                        <span className="mgr-score-tag mgr-score-tag--penalty" title="Overall KPI reduced by 50% due to active urgent query">
                          🚨 50% Penalty
                        </span>
                      ) : (
                        <span className="mgr-score-tag">Overall KPI</span>
                      )}
                    </div>
                    <span className="score-caption">
                      {stat.hasActiveUrgentPenalty ? 'Reduced by 50% (Urgent)' : 'Overall KPI Score'}
                    </span>
                  </div>

                  <div className="mgr-completion-secondary">
                    <div className="mgr-score-topline">
                      <span className="completion-number">
                        {stat.completedCount}
                        <span className="completion-slash">/</span>
                        {stat.totalAssigned}
                      </span>
                      <span className="mgr-completion-tag">
                        {stat.completionRate}% Done
                      </span>
                    </div>
                    <span className="score-caption">Completed / Received</span>
                  </div>
                </div>

                {/* Sub-Metric Component Badge: Turnaround SLA Score (Average Rating hidden from display) */}
                <div className="mgr-pillars-row">
                  <div
                    className="mgr-pillar-box mgr-pillar-box--full"
                    title="Turnaround SLA Score: On-time (+1.0 pt), Late (+0.5 pt), Overdue (0.0 pt) against target deadline"
                  >
                    <div className="mgr-pillar-info">
                      <span className="mgr-pillar-title">Turnaround Score</span>
                      <span className="mgr-pillar-sub">
                        {stat.totalEvaluated === 0
                          ? '0 / 0'
                          : `${stat.earnedPoints}/${stat.totalEvaluated}`}{' '}
                        pts
                      </span>
                    </div>
                    <span className="mgr-pillar-value">{stat.turnaroundKpi}%</span>
                  </div>
                </div>

                {/* Distribution Segmented Bar */}
                <div className="mgr-metrics-group">
                  <div className="mgr-progress-track" title="On-Time | Late | Overdue | In-Progress">
                    <div
                      className="progress-seg progress-seg--ontime"
                      style={{ width: `${onTimePct}%` }}
                      title={`On-time: ${stat.onTimeCount}`}
                    />
                    <div
                      className="progress-seg progress-seg--late"
                      style={{ width: `${latePct}%` }}
                      title={`Late: ${stat.lateCount}`}
                    />
                    <div
                      className="progress-seg progress-seg--overdue"
                      style={{ width: `${overduePct}%` }}
                      title={`Overdue: ${stat.overdueCount}`}
                    />
                    <div
                      className="progress-seg progress-seg--inprog"
                      style={{ width: `${inProgressPct}%` }}
                      title={`In Progress: ${stat.inProgressCount}`}
                    />
                  </div>

                  {/* 3 Clear Stat Capsules: On-Time, Late, and Overdue */}
                  <div className="mgr-stats-capsules">
                    <div className="stat-capsule stat-capsule--ontime" title="Queries completed within target deadline (+1.0 pt)">
                      <span className="capsule-num">⚡ {stat.onTimeCount}</span>
                      <span className="capsule-lbl">On-Time</span>
                    </div>
                    <div className="stat-capsule stat-capsule--late" title="Queries completed after target deadline (+0.5 pt)">
                      <span className="capsule-num">⏱️ {stat.lateCount}</span>
                      <span className="capsule-lbl">Late</span>
                    </div>
                    <div className="stat-capsule stat-capsule--overdue" title="Queries pending past target deadline (0.0 pt penalty)">
                      <span className="capsule-num">⚠️ {stat.overdueCount}</span>
                      <span className="capsule-lbl">Overdue</span>
                    </div>
                  </div>
                </div>

                {/* Turnaround Speed & Context Footer Strip */}
                <div className="mgr-speed-strip">
                  <div className="mgr-speed-item">
                    <span className="speed-lbl">Avg Response:</span>
                    <span className="speed-val-pill">
                      {stat.avgManagerTurnaroundHours !== null
                        ? `${stat.avgManagerTurnaroundHours}h`
                        : '—'}
                    </span>
                  </div>
                  <span className="mgr-footer-counts">
                    {stat.completedCount} completed · {stat.overdueCount} overdue · {stat.totalAssigned} received
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
};