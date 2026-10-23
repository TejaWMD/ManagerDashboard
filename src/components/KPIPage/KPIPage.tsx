import React, { useMemo, useState } from 'react';
import {
  Query,
  isQueryDelayed,
  isQueryDone,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import {
  calculateAllManagersKpi,
  evaluateQueryKpi,
  filterQueriesByWindow,
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
  const [viewingQuery, setViewingQuery] = useState<Query | null>(null);
  const activeViewingQuery = useMemo(() => {
    if (!viewingQuery) return null;
    return (
      queries.find((c) => c.queryId === viewingQuery.queryId) ||
      viewingQuery
    );
  }, [queries, viewingQuery]);

  const nowMs = useMemo(() => Date.now(), []);

  // Compute rolling KPI stats for all 3 managers
  const { stats: managerStats, teamAverageKpi } = useMemo(() => {
    return calculateAllManagersKpi(queries, managers, {
      window: timeWindow,
      nowMs,
    });
  }, [queries, managers, timeWindow, nowMs]);

  // Overall totals across the 3 managers in the selected window
  const overallTotals = useMemo(() => {
    const totalOnTime = managerStats.reduce((sum, s) => sum + s.onTimeCount, 0);
    const totalLate = managerStats.reduce((sum, s) => sum + s.lateCount, 0);
    const totalOverdue = managerStats.reduce((sum, s) => sum + s.overdueCount, 0);
    const totalEvaluated = managerStats.reduce((sum, s) => sum + s.totalEvaluated, 0);
    return { totalOnTime, totalLate, totalOverdue, totalEvaluated };
  }, [managerStats]);

  // Recent evaluated tickets for the quick snapshot card (max 4 items so it fits the exact card height)
  const recentEvaluated = useMemo(() => {
    const inWindow = filterQueriesByWindow(queries, timeWindow, nowMs);
    const evaluated = inWindow
      .map((c) => evaluateQueryKpi(c, nowMs))
      .filter((item) => item.isEvaluated);

    const filtered =
      selectedManagerId === 'ALL'
        ? evaluated
        : evaluated.filter((item) => item.query.managerId === selectedManagerId);

    return filtered.slice(0, 4);
  }, [queries, timeWindow, nowMs, selectedManagerId]);

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

      {/* 2. Unified 5-Card Balanced Grid (All 5 cards share exact sizing & bubbly styling) */}
      <div className="kpi-five-cards-grid">
        {/* Top 3 Manager KPI Cards */}
        <section className="kpi-managers-row" aria-label="Manager KPI Scorecards">
          {managerStats.map((stat, idx) => {
            const rankMedal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
            const isMe = currentUser.id === stat.manager.id;
            const isSelected = selectedManagerId === stat.manager.id;

            const scoreColorClass =
              stat.kpiScore >= 85
                ? 'kpi-card--green'
                : stat.kpiScore >= 70
                ? 'kpi-card--amber'
                : 'kpi-card--red';

            const onTimePct =
              stat.totalEvaluated > 0
                ? Math.round((stat.onTimeCount / stat.totalEvaluated) * 100)
                : 0;
            const latePct =
              stat.totalEvaluated > 0
                ? Math.round((stat.lateCount / stat.totalEvaluated) * 100)
                : 0;
            const overduePct =
              stat.totalEvaluated > 0
                ? Math.round((stat.overdueCount / stat.totalEvaluated) * 100)
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
                title="Click to filter recent queue"
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

                {/* Bubbly Score & Points Showcase */}
                <div className="mgr-score-block">
                  <div className="mgr-big-num">
                    <span className="score-number">{stat.kpiScore}%</span>
                    <span className="score-caption">KPI Score</span>
                  </div>

                  <div className="mgr-points-pill">
                    <span className="points-number">
                      {stat.earnedPoints} <span className="points-slash">/</span>{' '}
                      {stat.totalEvaluated}
                    </span>
                    <span className="points-caption">Pts Earned</span>
                  </div>
                </div>

                {/* Distribution Mini Bar + Compact Stat Bubbles */}
                <div className="mgr-metrics-group">
                  <div className="mgr-progress-track">
                    <div
                      className="progress-seg progress-seg--ontime"
                      style={{ width: `${onTimePct}%` }}
                    />
                    <div
                      className="progress-seg progress-seg--late"
                      style={{ width: `${latePct}%` }}
                    />
                    <div
                      className="progress-seg progress-seg--overdue"
                      style={{ width: `${overduePct}%` }}
                    />
                  </div>

                  <div className="mgr-stats-capsules">
                    <div className="stat-capsule stat-capsule--ontime">
                      <span className="capsule-num">⚡ {stat.onTimeCount}</span>
                      <span className="capsule-lbl">On-Time</span>
                    </div>
                    <div className="stat-capsule stat-capsule--late">
                      <span className="capsule-num">⏱️ {stat.lateCount}</span>
                      <span className="capsule-lbl">Late</span>
                    </div>
                    <div className="stat-capsule stat-capsule--overdue">
                      <span className="capsule-num">⚠️ {stat.overdueCount}</span>
                      <span className="capsule-lbl">Overdue</span>
                    </div>
                  </div>
                </div>

                {/* Turnaround Speed Footer Bubble */}
                <div className="mgr-speed-strip">
                  <span className="speed-lbl">Avg Response Speed</span>
                  <span className="speed-val-pill">
                    {stat.avgManagerTurnaroundHours !== null
                      ? `${stat.avgManagerTurnaroundHours} hrs`
                      : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {/* Bottom 2 Analytics Cards (Same exact card size & height) */}
        <section className="kpi-bottom-panels" aria-label="Analytics & Breakdown">
          {/* Card 4: Team Score Comparison */}
          <div className="kpi-uniform-card kpi-panel-card">
            <div className="panel-header-clean">
              <h2 className="panel-title-clean">Team Performance</h2>
              <span className="panel-tag-clean">Avg: {teamAverageKpi}%</span>
            </div>

            <div className="panel-bars-list">
              {managerStats.map((stat) => {
                const barColorClass =
                  stat.kpiScore >= 85
                    ? 'comp-bar-fill--green'
                    : stat.kpiScore >= 70
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
                          style={{ width: `${stat.kpiScore}%` }}
                        />
                      </div>
                    </div>

                    <div className="comp-nums-col">
                      <span className="comp-rate-val">{stat.kpiScore}%</span>
                      <span className="comp-pts-sub">{stat.earnedPoints}p</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="team-summary-pill-row">
              <div className="summary-bubble">
                <span className="summary-lbl">Total</span>
                <strong className="summary-val">{overallTotals.totalEvaluated}</strong>
              </div>
              <div className="summary-bubble summary-bubble--ontime">
                <span className="summary-lbl">On-Time</span>
                <strong className="summary-val">{overallTotals.totalOnTime}</strong>
              </div>
              <div className="summary-bubble summary-bubble--late">
                <span className="summary-lbl">Late</span>
                <strong className="summary-val">{overallTotals.totalLate}</strong>
              </div>
              <div className="summary-bubble summary-bubble--overdue">
                <span className="summary-lbl">Overdue</span>
                <strong className="summary-val">{overallTotals.totalOverdue}</strong>
              </div>
            </div>
          </div>

          {/* Card 5: Recent Queue Snapshot */}
          <div className="kpi-uniform-card kpi-panel-card">
            <div className="panel-header-clean">
              <div className="panel-title-group">
                <h2 className="panel-title-clean">Recent Queue</h2>
                {selectedManagerId !== 'ALL' && (
                  <button
                    type="button"
                    className="panel-filter-indicator"
                    onClick={() => setSelectedManagerId('ALL')}
                    title="Click to clear filter"
                  >
                    {managers.find((m) => m.id === selectedManagerId)?.name} &times;
                  </button>
                )}
              </div>

              {onNavigate && (
                <button
                  type="button"
                  className="panel-view-all-btn"
                  onClick={() => onNavigate('queries')}
                >
                  View All &rarr;
                </button>
              )}
            </div>

            <div className="recent-queue-list">
              {recentEvaluated.map(({ query: c, status, managerTurnaroundHours }) => {
                const pointChipClass =
                  status === 'ON_TIME'
                    ? 'pt-chip--ontime'
                    : status === 'LATE'
                    ? 'pt-chip--late'
                    : 'pt-chip--overdue';

                const pointText =
                  status === 'ON_TIME'
                    ? '+1.0'
                    : status === 'LATE'
                    ? '+0.5'
                    : '0.0';

                return (
                  <div
                    key={c.queryId}
                    className="queue-row-item"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setViewingQuery(c)}
                    title="Click to view query details"
                  >
                    <div className="queue-id-box">
                      <span className="queue-id">{c.queryId}</span>
                    </div>

                    <div className="queue-detail-box">
                      <span className="queue-people">
                        {c.accountManagerName} &rarr; <strong>{c.managerName}</strong>
                      </span>
                      <span className="queue-remark-snippet">
                        {c.managerRemarkTitle || c.managerRemark
                          ? `"${c.managerRemarkTitle || c.managerRemark}"`
                          : c.queryTitle || c.queryText}
                      </span>
                    </div>

                    <div className="queue-speed-box">
                      {managerTurnaroundHours !== null ? (
                        <span className="queue-speed-val">{managerTurnaroundHours}h</span>
                      ) : (
                        <span className="queue-speed-pending">&gt;48h</span>
                      )}
                    </div>

                    <div className="queue-point-box">
                      <span className={`queue-pt-chip ${pointChipClass}`}>{pointText}</span>
                    </div>
                  </div>
                );
              })}

              {recentEvaluated.length === 0 && (
                <div className="queue-empty-msg">No evaluated queries in this window.</div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* View Query Details Pop-up Modal */}
      {activeViewingQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setViewingQuery(null)}
        >
          <div
            className="modal-dialog query-view-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kpi-view-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <div className="query-view-title-row">
                  <h3 id="kpi-view-query-modal-title">
                    Query {activeViewingQuery.queryId}
                  </h3>
                  <div className="td-status-pills-wrap">
                    {isQueryDone(activeViewingQuery) ? (
                      <>
                        <span className="table-status-pill table-status-pill--completed">
                          Completed
                        </span>
                        {isQueryDelayed(activeViewingQuery, nowMs) && (
                          <span className="table-status-pill table-status-pill--delayed">
                            Delayed
                          </span>
                        )}
                      </>
                    ) : activeViewingQuery.managerDone &&
                      !activeViewingQuery.accountManagerDone ? (
                      <>
                        <span className="table-status-pill table-status-pill--mgr-done">
                          Mgr Checked
                        </span>
                        {isQueryDelayed(activeViewingQuery, nowMs) && (
                          <span className="table-status-pill table-status-pill--delayed">
                            Delayed
                          </span>
                        )}
                      </>
                    ) : isQueryDelayed(activeViewingQuery, nowMs) ? (
                      <span className="table-status-pill table-status-pill--delayed">
                        Delayed
                      </span>
                    ) : (
                      <span className="table-status-pill table-status-pill--pending">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
                <span className="modal-sender-badge">
                  Created: <strong>{activeViewingQuery.createdAt}</strong>
                  {activeViewingQuery.completedAt && (
                    <>
                      {' '}
                      &bull; Completed:{' '}
                      <strong>{activeViewingQuery.completedAt}</strong>
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setViewingQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="query-view-body">
              <div className="query-view-meta-grid">
                <div className="query-view-meta-box">
                  <span className="query-view-meta-label">From (Sender)</span>
                  <div className="person-cell-wrapper">
                    <span className="query-view-meta-value">
                      {activeViewingQuery.accountManagerName}
                    </span>
                  </div>
                </div>

                <div className="query-view-meta-box">
                  <span className="query-view-meta-label">Assigned Manager</span>
                  <div className="person-cell-wrapper">
                    <span className="query-view-meta-value">
                      {activeViewingQuery.managerName}
                    </span>
                  </div>
                </div>
              </div>

              <div className="query-view-section">
                <span className="query-view-section-label">Query Details</span>
                <div className="query-view-content-box">
                  <div className="query-view-field-block">
                    <span className="query-view-sub-label">Title</span>
                    <div className="query-view-item-title">
                      {activeViewingQuery.queryTitle ||
                        activeViewingQuery.queryText}
                    </div>
                  </div>
                  <div className="query-view-field-block query-view-field-block--desc">
                    <span className="query-view-sub-label">Description</span>
                    <div className="query-view-item-desc">
                      {activeViewingQuery.queryText || '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="query-view-remarks-grid">
                <div className="query-view-section">
                  <div className="query-view-section-header">
                    <span className="query-view-section-label">Manager Remark</span>
                    <span
                      className={`query-view-check-tag ${
                        activeViewingQuery.managerDone
                          ? 'query-view-check-tag--done'
                          : ''
                      }`}
                    >
                      {activeViewingQuery.managerDone ? '✓ Mgr Done' : 'Unchecked'}
                    </span>
                  </div>
                  <div
                    className={`query-view-remark-box ${
                      !activeViewingQuery.managerRemarkTitle &&
                      !activeViewingQuery.managerRemark
                        ? 'query-view-remark-box--empty'
                        : ''
                    }`}
                  >
                    {activeViewingQuery.managerRemarkTitle ||
                    activeViewingQuery.managerRemark ? (
                      <>
                        <div className="query-view-field-block">
                          <span className="query-view-sub-label">Title</span>
                          <div className="query-view-item-title">
                            {activeViewingQuery.managerRemarkTitle ||
                              activeViewingQuery.managerRemark}
                          </div>
                        </div>
                        <div className="query-view-field-block query-view-field-block--desc">
                          <span className="query-view-sub-label">Description</span>
                          <div className="query-view-item-desc">
                            {activeViewingQuery.managerRemark || '—'}
                          </div>
                        </div>
                      </>
                    ) : (
                      'No manager remark yet.'
                    )}
                  </div>
                </div>

                <div className="query-view-section">
                  <div className="query-view-section-header">
                    <span className="query-view-section-label">Sender Remark</span>
                    <span
                      className={`query-view-check-tag ${
                        activeViewingQuery.accountManagerDone
                          ? 'query-view-check-tag--done'
                          : ''
                      }`}
                    >
                      {activeViewingQuery.accountManagerDone
                        ? '✓ Sender Done'
                        : 'Unchecked'}
                    </span>
                  </div>
                  <div
                    className={`query-view-remark-box ${
                      !activeViewingQuery.accountManagerRemarkTitle &&
                      !activeViewingQuery.accountManagerRemark
                        ? 'query-view-remark-box--empty'
                        : ''
                    }`}
                  >
                    {activeViewingQuery.accountManagerRemarkTitle ||
                    activeViewingQuery.accountManagerRemark ? (
                      <>
                        <div className="query-view-field-block">
                          <span className="query-view-sub-label">Title</span>
                          <div className="query-view-item-title">
                            {activeViewingQuery.accountManagerRemarkTitle ||
                              activeViewingQuery.accountManagerRemark}
                          </div>
                        </div>
                        <div className="query-view-field-block query-view-field-block--desc">
                          <span className="query-view-sub-label">Description</span>
                          <div className="query-view-item-desc">
                            {activeViewingQuery.accountManagerRemark || '—'}
                          </div>
                        </div>
                      </>
                    ) : (
                      'No sender remark yet.'
                    )}
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setViewingQuery(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};