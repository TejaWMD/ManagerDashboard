import React, { useMemo, useState } from 'react';
import { Complaint, UserAccount } from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import {
  calculateAllManagersKpi,
  evaluateComplaintKpi,
  filterComplaintsByWindow,
  KpiTimeWindow,
} from '../../lib/kpi';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './KPIPage.css';

interface KPIPageProps {
  currentUser: UserAccount;
  complaints: Complaint[];
  users?: UserAccount[];
  onNavigate?: (page: 'home' | 'complaints' | 'kpi') => void;
}

export const KPIPage: React.FC<KPIPageProps> = ({
  currentUser,
  complaints,
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

  // Compute 7-day rolling KPI stats for all 3 managers
  const { stats: managerStats, teamAverageKpi } = useMemo(() => {
    return calculateAllManagersKpi(complaints, managers, {
      window: timeWindow,
      nowMs,
    });
  }, [complaints, managers, timeWindow, nowMs]);

  // Overall totals across the 3 managers in the selected window
  const overallTotals = useMemo(() => {
    const totalOnTime = managerStats.reduce((sum, s) => sum + s.onTimeCount, 0);
    const totalLate = managerStats.reduce((sum, s) => sum + s.lateCount, 0);
    const totalOverdue = managerStats.reduce((sum, s) => sum + s.overdueCount, 0);
    const totalEvaluated = managerStats.reduce((sum, s) => sum + s.totalEvaluated, 0);
    return { totalOnTime, totalLate, totalOverdue, totalEvaluated };
  }, [managerStats]);

  // Recent evaluated tickets for the quick snapshot card (max 5 items, clean & compact)
  const recentEvaluated = useMemo(() => {
    const inWindow = filterComplaintsByWindow(complaints, timeWindow, nowMs);
    const evaluated = inWindow
      .map((c) => evaluateComplaintKpi(c, nowMs))
      .filter((item) => item.isEvaluated);

    const filtered =
      selectedManagerId === 'ALL'
        ? evaluated
        : evaluated.filter((item) => item.complaint.managerId === selectedManagerId);

    return filtered.slice(0, 5);
  }, [complaints, timeWindow, nowMs, selectedManagerId]);

  return (
    <div className="kpi-screen-container">
      {/* 1. Sleek Compact Header */}
      <header className="kpi-compact-header">
        <div className="kpi-header-left">
          <div className="kpi-title-cluster">
            <h1 className="kpi-page-heading">Manager KPI</h1>
            <span className="kpi-badge-live">Live</span>
          </div>

          {/* Minimal Key / Rule Badges */}
          <div className="kpi-rule-chips">
            <span className="kpi-chip kpi-chip--ontime">&le;48h On-Time (+1.0)</span>
            <span className="kpi-chip kpi-chip--late">&gt;48h Late (+0.5)</span>
            <span className="kpi-chip kpi-chip--overdue">&gt;48h Overdue (0.0)</span>
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

      {/* 2. Primary Focus: 3 Manager KPI Cards Side-by-Side */}
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
              className={`kpi-mgr-box ${scoreColorClass} ${
                isSelected ? 'kpi-mgr-box--selected' : ''
              } ${isMe ? 'kpi-mgr-box--me' : ''}`}
              onClick={() =>
                setSelectedManagerId((prev) =>
                  prev === stat.manager.id ? 'ALL' : stat.manager.id
                )
              }
              title="Click to filter recent queue"
            >
              {/* Card Header: Rank & Profile */}
              <div className="mgr-box-top">
                <div className="mgr-rank-pill">
                  <span className="rank-emoji">{rankMedal}</span>
                  <span className="rank-text">#{idx + 1}</span>
                </div>

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
              </div>

              {/* Big KPI Score & Points */}
              <div className="mgr-score-block">
                <div className="mgr-big-num">
                  <span className="score-number">{stat.kpiScore}%</span>
                  <span className="score-caption">KPI Score</span>
                </div>

                <div className="mgr-points-block">
                  <span className="points-number">
                    {stat.earnedPoints} / {stat.totalEvaluated}
                  </span>
                  <span className="points-caption">Pts Earned</span>
                </div>
              </div>

              {/* Distribution Mini Bar */}
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

              {/* Quick Stat Badges */}
              <div className="mgr-stats-capsules">
                <span className="stat-capsule stat-capsule--ontime">
                  ⚡ {stat.onTimeCount} On-Time
                </span>
                <span className="stat-capsule stat-capsule--late">
                  ⏱️ {stat.lateCount} Late
                </span>
                <span className="stat-capsule stat-capsule--overdue">
                  ⚠️ {stat.overdueCount} Overdue
                </span>
              </div>

              {/* Turnaround Speed */}
              <div className="mgr-speed-strip">
                <span className="speed-lbl">Avg Response Speed:</span>
                <span className="speed-val">
                  {stat.avgManagerTurnaroundHours !== null
                    ? `${stat.avgManagerTurnaroundHours} hrs`
                    : '—'}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* 3. Balanced Bottom Row (Fills remaining height without scrolling) */}
      <section className="kpi-bottom-panels" aria-label="Analytics & Breakdown">
        {/* Panel 1: Team Score Comparison */}
        <div className="kpi-panel-card">
          <div className="panel-header-clean">
            <h2 className="panel-title-clean">Team Performance Comparison</h2>
            <span className="panel-tag-clean">Avg: {teamAverageKpi}%</span>
          </div>

          <div className="panel-bars-list">
            {managerStats.map((stat) => (
              <div key={stat.manager.id} className="comp-bar-item">
                <div className="comp-user-col">
                  <span className="comp-avatar">{stat.manager.avatarInitials}</span>
                  <span className="comp-name">{stat.manager.name}</span>
                </div>

                <div className="comp-track-col">
                  <div className="comp-bar-track">
                    <div
                      className="comp-bar-fill"
                      style={{ width: `${stat.kpiScore}%` }}
                    />
                  </div>
                </div>

                <div className="comp-nums-col">
                  <span className="comp-rate-val">{stat.kpiScore}%</span>
                  <span className="comp-pts-sub">({stat.earnedPoints} pts)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="team-summary-pill-row">
            <span className="summary-indicator">
              Total Evaluated: <strong>{overallTotals.totalEvaluated}</strong>
            </span>
            <span className="summary-indicator">
              On-Time: <strong>{overallTotals.totalOnTime}</strong>
            </span>
            <span className="summary-indicator">
              Late: <strong>{overallTotals.totalLate}</strong>
            </span>
            <span className="summary-indicator">
              Overdue: <strong>{overallTotals.totalOverdue}</strong>
            </span>
          </div>
        </div>

        {/* Panel 2: Recent Queue Snapshot */}
        <div className="kpi-panel-card">
          <div className="panel-header-clean">
            <div className="panel-title-group">
              <h2 className="panel-title-clean">Recent Evaluated Queue</h2>
              {selectedManagerId !== 'ALL' && (
                <span className="panel-filter-indicator">
                  Filter: {managers.find((m) => m.id === selectedManagerId)?.name}
                </span>
              )}
            </div>

            {onNavigate && (
              <button
                type="button"
                className="panel-view-all-btn"
                onClick={() => onNavigate('complaints')}
              >
                View Complaints &rarr;
              </button>
            )}
          </div>

          <div className="recent-queue-list">
            {recentEvaluated.map(({ complaint: c, status, managerTurnaroundHours }) => {
              const pointChipClass =
                status === 'ON_TIME'
                  ? 'pt-chip--ontime'
                  : status === 'LATE'
                  ? 'pt-chip--late'
                  : 'pt-chip--overdue';

              const pointText =
                status === 'ON_TIME'
                  ? '+1.0 pt'
                  : status === 'LATE'
                  ? '+0.5 pt'
                  : '0.0 pt';

              return (
                <div key={c.complaintId} className="queue-row-item">
                  <div className="queue-id-box">
                    <span className="queue-id">{c.complaintId}</span>
                  </div>

                  <div className="queue-detail-box">
                    <span className="queue-people">
                      {c.accountManagerName} &rarr; <strong>{c.managerName}</strong>
                    </span>
                    <span className="queue-remark-snippet">
                      {c.managerRemark ? `"${c.managerRemark}"` : c.complaintText}
                    </span>
                  </div>

                  <div className="queue-speed-box">
                    {managerTurnaroundHours !== null ? (
                      <span className="queue-speed-val">{managerTurnaroundHours}h</span>
                    ) : (
                      <span className="queue-speed-pending">&gt;48h Overdue</span>
                    )}
                  </div>

                  <div className="queue-point-box">
                    <span className={`queue-pt-chip ${pointChipClass}`}>{pointText}</span>
                  </div>
                </div>
              );
            })}

            {recentEvaluated.length === 0 && (
              <div className="queue-empty-msg">No evaluated complaints in this window.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
