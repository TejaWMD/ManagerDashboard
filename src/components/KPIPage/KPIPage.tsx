import React, { useMemo, useState } from 'react';
import {
  Query,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import {
  calculateAllManagersKpi,
  KpiTimeWindow,
} from '../../lib/kpi';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './KPIPage.css';

interface KPIPageProps {
  currentUser: UserAccount;
  queries: Query[];
  users?: UserAccount[];
  onNavigate?: (page: 'home' | 'queries' | 'kpi') => void;
}

export const KPIPage: React.FC<KPIPageProps> = ({
  currentUser,
  queries,
  users,
  onNavigate,
}) => {
  const userList = users && users.length > 0 ? users : AUTHORIZED_USERS;
  const managers = useMemo(
    () => userList.filter((u) => u.role === 'manager'),
    [userList]
  );

  const [timeWindow, setTimeWindow] = useState<KpiTimeWindow>('7d');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('ALL');

  const nowMs = useMemo(() => Date.now(), []);

  // Compute rolling KPI stats for all managers
  const { stats: managerStats, teamAverageKpi, teamAverageRating } = useMemo(() => {
    return calculateAllManagersKpi(queries, managers, {
      window: timeWindow,
      nowMs,
    });
  }, [queries, managers, timeWindow, nowMs]);

  // Overall totals across the managers in the selected window
  const overallTotals = useMemo(() => {
    const totalOnTime = managerStats.reduce((sum, s) => sum + s.onTimeCount, 0);
    const totalLate = managerStats.reduce((sum, s) => sum + s.lateCount, 0);
    const totalOverdue = managerStats.reduce((sum, s) => sum + s.overdueCount, 0);
    const totalDelayed = totalLate + totalOverdue;
    const totalInProgress = managerStats.reduce((sum, s) => sum + s.inProgressCount, 0);
    const totalEvaluated = managerStats.reduce((sum, s) => sum + s.totalEvaluated, 0);
    const totalAssigned = managerStats.reduce((sum, s) => sum + s.totalAssigned, 0);
    const totalCompleted = totalOnTime + totalLate;
    const overallCompletionRate =
      totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;

    return {
      totalOnTime,
      totalLate,
      totalOverdue,
      totalDelayed,
      totalInProgress,
      totalEvaluated,
      totalAssigned,
      totalCompleted,
      overallCompletionRate,
    };
  }, [managerStats]);

  return (
    <div className="kpi-screen-container">
      {/* 1. Sleek Bubbly Header */}
      <header className="kpi-compact-header">
        <div className="kpi-header-left">
          <div className="kpi-title-cluster">
            <h1 className="kpi-page-heading">Manager KPI</h1>
            {/* <span className="kpi-badge-live">
              <span className="kpi-live-dot" /> Live
            </span> */}
          </div>
        </div>

        <div className="kpi-header-right">
          {/* Time Window Pills */}
          <div className="kpi-pill-group">
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
            <button
              type="button"
              className={`kpi-pill-btn ${timeWindow === 'all' ? 'kpi-pill-btn--active' : ''}`}
              onClick={() => setTimeWindow('all')}
            >
              All Time
            </button>
          </div>

          <div className="kpi-brand-logo-badge" title="WMD">
            <img src={wmdLogo} alt="WMD" className="kpi-brand-logo-img" />
          </div>
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
              stat.totalEvaluated === 0 && stat.totalRated === 0
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
                      <span className="mgr-score-tag">Overall KPI</span>
                    </div>
                    <span className="score-caption">Combined KPI Score</span>
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

                {/* Sub-Metric Component Badges: Completion Rate + Avg Rating */}
                <div className="mgr-pillars-row">
                  <div className="mgr-pillar-box" title="Based on On-time (+1.0) and Late (+0.5) completion against target deadline">
                    <span className="mgr-pillar-title">Completion Rate</span>
                    <span className="mgr-pillar-value">{stat.turnaroundKpi}%</span>
                    <span className="mgr-pillar-sub">
                      {stat.totalEvaluated === 0
                        ? '0 / 0'
                        : `${stat.earnedPoints}/${stat.totalEvaluated}`}{' '}
                      pts
                    </span>
                  </div>
                  <div className="mgr-pillar-box" title="Average anonymous sender rating">
                    <span className="mgr-pillar-title">Average Rating</span>
                    <span className="mgr-pillar-value">
                      {stat.avgRating !== null ? `⭐ ${stat.avgRating}` : '—'}
                      {stat.avgRating !== null && <span className="mgr-pillar-slash">/ 5.0</span>}
                    </span>
                    <span className="mgr-pillar-sub">
                      {stat.totalRated > 0
                        ? `${stat.totalRated} review${stat.totalRated === 1 ? '' : 's'}`
                        : 'No ratings yet'}
                    </span>
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

                  {/* 4 Compact Stat Capsules Spanning Full Width */}
                  <div className="mgr-stats-capsules">
                    <div className="stat-capsule stat-capsule--ontime" title="Queries completed within 48h (+1.0 pt)">
                      <span className="capsule-num">⚡ {stat.onTimeCount}</span>
                      <span className="capsule-lbl">On-Time</span>
                    </div>
                    <div className="stat-capsule stat-capsule--late" title="Queries completed after 48h (+0.5 pt)">
                      <span className="capsule-num">⏱️ {stat.lateCount}</span>
                      <span className="capsule-lbl">Late</span>
                    </div>
                    <div className="stat-capsule stat-capsule--overdue" title="Queries open past 48h (0.0 pt penalty)">
                      <span className="capsule-num">⚠️ {stat.overdueCount}</span>
                      <span className="capsule-lbl">Overdue</span>
                    </div>
                    <div className="stat-capsule stat-capsule--delayed" title="All delayed queries (late + overdue)">
                      <span className="capsule-num">🚨 {stat.delayedCount}</span>
                      <span className="capsule-lbl">Delayed</span>
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
                    {stat.completedCount} completed · {stat.delayedCount} delayed · {stat.totalAssigned} received
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Bottom 2 Analytics Cards (Full-width 2-column balanced grid) */}
        <section className="kpi-bottom-panels" aria-label="Analytics & Breakdown">
          {/* Card 4: Team Score Comparison */}
          <div className="kpi-uniform-card kpi-panel-card">
            <div className="panel-header-clean">
              <h2 className="panel-title-clean">Team Performance</h2>
              <div className="panel-tags-cluster">
                <span className="panel-tag-clean">Team KPI: {teamAverageKpi}%</span>
                {teamAverageRating !== null && (
                  <span className="panel-tag-clean">Team Rating: ⭐ {teamAverageRating}/5.0</span>
                )}
                <span className="panel-tag-clean panel-tag-clean--alt">
                  {overallTotals.totalCompleted}/{overallTotals.totalAssigned} ({overallTotals.overallCompletionRate}%) Completion Rate
                </span>
              </div>
            </div>

            <div className="panel-bars-list">
              {managerStats.map((stat) => {
                const barColorClass =
                  stat.totalEvaluated === 0 && stat.totalRated === 0
                    ? 'comp-bar-fill--neutral'
                    : stat.overallKpi >= 85
                    ? 'comp-bar-fill--green'
                    : stat.overallKpi >= 70
                    ? 'comp-bar-fill--amber'
                    : 'comp-bar-fill--red';

                return (
                  <div key={stat.manager.id} className="comp-bar-item">
                    <div className="comp-user-col">
                      <span className="comp-avatar">{stat.manager.avatarInitials}</span>
                      <span className="comp-name">{stat.manager.name}</span>
                    </div>

                    <div className="comp-track-col">
                      <div className="comp-bar-track">
                        <div
                          className={`comp-bar-fill ${barColorClass}`}
                          style={{ width: `${stat.overallKpi}%` }}
                        />
                      </div>
                    </div>

                    <div className="comp-nums-col">
                      <span className="comp-rate-val">{stat.overallKpi}%</span>
                      <span className="comp-pts-sub">
                        Turnaround: {stat.turnaroundKpi}% · {stat.avgRating !== null ? `⭐${stat.avgRating}` : 'No rating'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 5-Column Full-Width Summary Bubbles */}
            <div className="team-summary-pill-row">
              <div className="summary-bubble">
                <span className="summary-lbl">Received</span>
                <strong className="summary-val">{overallTotals.totalAssigned}</strong>
              </div>
              <div className="summary-bubble summary-bubble--ontime">
                <span className="summary-lbl">Completed</span>
                <strong className="summary-val">{overallTotals.totalCompleted}</strong>
              </div>
              <div className="summary-bubble summary-bubble--overdue">
                <span className="summary-lbl">Delayed</span>
                <strong className="summary-val">{overallTotals.totalDelayed}</strong>
              </div>
              <div className="summary-bubble summary-bubble--late">
                <span className="summary-lbl">Completion Rate</span>
                <strong className="summary-val">{overallTotals.overallCompletionRate}%</strong>
              </div>
              <div className="summary-bubble summary-bubble--inprog">
                <span className="summary-lbl">In-Prog</span>
                <strong className="summary-val">{overallTotals.totalInProgress}</strong>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};