import React, { useEffect, useMemo, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  isComplaintDelayed,
  isComplaintDone,
  isComplaintPending,
  PageView,
  sortComplaintsByStatusAndTimestamp,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import { generateWeeklyManagerReportPdf } from '../../lib/pdfReport';
import './HomePage.css';

interface HomePageProps {
  currentUser: UserAccount;
  complaints: Complaint[];
  onNavigate?: (page: PageView) => void;
  users?: UserAccount[];
}

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  complaints,
  onNavigate,
  users,
}) => {
  const userList = users && users.length > 0 ? users : AUTHORIZED_USERS;
  const accountManagers = useMemo(
    () => userList.filter((u) => u.role === 'account_manager'),
    [userList]
  );
  const managers = useMemo(
    () => userList.filter((u) => u.role === 'manager'),
    [userList]
  );

  // Live clock so delay / SLA calculations stay accurate in real time
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const [selectedAccountManagerId, setSelectedAccountManagerId] =
    useState<string>('ALL');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('ALL');
  const [adminTeamTab, setAdminTeamTab] = useState<'managers' | 'account_managers'>(
    'managers'
  );
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  const handleDownloadPdfReport = () => {
    try {
      setIsGeneratingPdf(true);
      generateWeeklyManagerReportPdf({
        complaints,
        managers,
        adminUser: currentUser,
        nowMs,
      });
    } catch (err) {
      console.error('Failed to generate weekly PDF report:', err);
    } finally {
      setTimeout(() => {
        setIsGeneratingPdf(false);
      }, 600);
    }
  };

  const selectedAmObj = accountManagers.find(
    (am) => am.id === selectedAccountManagerId
  );
  const selectedManagerObj = managers.find((m) => m.id === selectedManagerId);

  // Filter complaints based on user role and active dropdown filters
  const scopedComplaints = useMemo(() => {
    const filtered = complaints.filter((c) => {
      if (currentUser.role === 'account_manager') {
        if (!belongsToAccountManager(c, currentUser)) return false;
        if (selectedManagerId !== 'ALL' && selectedManagerObj) {
          return belongsToManager(c, selectedManagerObj);
        }
        return true;
      }

      if (currentUser.role === 'manager') {
        if (!belongsToManager(c, currentUser)) return false;
        if (selectedAccountManagerId !== 'ALL' && selectedAmObj) {
          return belongsToAccountManager(c, selectedAmObj);
        }
        return true;
      }

      // Admin role
      if (selectedAccountManagerId !== 'ALL' && selectedAmObj) {
        if (!belongsToAccountManager(c, selectedAmObj)) return false;
      }
      if (selectedManagerId !== 'ALL' && selectedManagerObj) {
        if (!belongsToManager(c, selectedManagerObj)) return false;
      }
      return true;
    });

    return sortComplaintsByStatusAndTimestamp(filtered, 'desc');
  }, [
    complaints,
    currentUser,
    selectedAccountManagerId,
    selectedAmObj,
    selectedManagerId,
    selectedManagerObj,
  ]);

  // Core KPI metrics:
  // - Completed: both Manager Done & AM Done are checked
  // - Pending: open complaints under 24h (!done && !delayed)
  // - Delayed / Overdue: complaints that exceeded 24h (stays Delayed even after Completed so KPIs are accurate)
  const totalCount = scopedComplaints.length;
  const doneCount = scopedComplaints.filter((c) => isComplaintDone(c)).length;
  const pendingCount = scopedComplaints.filter((c) =>
    isComplaintPending(c, nowMs)
  ).length;
  const delayedCount = scopedComplaints.filter((c) =>
    isComplaintDelayed(c, nowMs)
  ).length;
  const openDelayedCount = scopedComplaints.filter(
    (c) => !isComplaintDone(c) && isComplaintDelayed(c, nowMs)
  ).length;

  // Stage breakdown counts
  const uncheckedCount = scopedComplaints.filter(
    (c) => !c.managerDone && !c.accountManagerDone && !isComplaintDelayed(c, nowMs)
  ).length;
  const mgrDoneCount = scopedComplaints.filter(
    (c) => c.managerDone && !c.accountManagerDone && !isComplaintDelayed(c, nowMs)
  ).length;

  // Action queues (all open items waiting on Manager or AM)
  const mgrQueueCount = scopedComplaints.filter(
    (c) => !c.managerDone && !c.accountManagerDone
  ).length;
  const amQueueCount = scopedComplaints.filter(
    (c) => c.managerDone && !c.accountManagerDone
  ).length;

  const pct = (value: number) =>
    totalCount > 0 ? Math.round((value / totalCount) * 100) : 0;

  const completionPct = pct(doneCount);
  const pendingPct = pct(pendingCount);
  const delayedPct = pct(delayedCount);
  const openDelayedPct = pct(openDelayedCount);
  const onTimeCount = Math.max(0, totalCount - delayedCount);
  const onTimePct = totalCount > 0 ? Math.round((onTimeCount / totalCount) * 100) : 100;

  const totalCardLabel =
    currentUser.role === 'account_manager'
      ? 'Created'
      : currentUser.role === 'manager'
      ? 'Received'
      : 'Total';

  // Team breakdown metrics
  const baseRoleComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (currentUser.role === 'account_manager') {
        return belongsToAccountManager(c, currentUser);
      }
      if (currentUser.role === 'manager') {
        return belongsToManager(c, currentUser);
      }
      return true;
    });
  }, [complaints, currentUser]);

  const targetPeopleList = useMemo(() => {
    if (currentUser.role === 'account_manager') {
      return managers;
    }
    if (currentUser.role === 'manager') {
      return accountManagers;
    }
    return adminTeamTab === 'managers' ? managers : accountManagers;
  }, [currentUser.role, managers, accountManagers, adminTeamTab]);

  const teamStats = useMemo(() => {
    return targetPeopleList.map((person) => {
      const personComplaints = baseRoleComplaints.filter((c) =>
        person.role === 'manager'
          ? belongsToManager(c, person)
          : belongsToAccountManager(c, person)
      );
      const total = personComplaints.length;
      const done = personComplaints.filter((c) => isComplaintDone(c)).length;
      const mgrDone = personComplaints.filter(
        (c) => c.managerDone && !c.accountManagerDone
      ).length;
      const unchecked = personComplaints.filter(
        (c) => !c.managerDone && !c.accountManagerDone
      ).length;
      const delayed = personComplaints.filter((c) =>
        isComplaintDelayed(c, nowMs)
      ).length;
      const rate = total > 0 ? Math.round((done / total) * 100) : 0;

      return {
        person,
        total,
        done,
        mgrDone,
        unchecked,
        delayed,
        rate,
      };
    });
  }, [targetPeopleList, baseRoleComplaints, nowMs]);

  // Chart 1: Vertical Bar Chart heights calculation (scaled to max count)
  const maxBarVal = Math.max(uncheckedCount, mgrDoneCount, doneCount, delayedCount, 1);
  const calcBarHeight = (val: number) => {
    if (val === 0) return 6; // minimum visual stub
    return Math.max(14, Math.round((val / maxBarVal) * 100));
  };

  // Chart 2: SVG Circular Donut Gauge calculations
  const donutRadius = 46;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutDashOffset =
    donutCircumference - (onTimePct / 100) * donutCircumference;

  // Completion Ring for Done percentage
  const doneDashOffset =
    donutCircumference - (completionPct / 100) * donutCircumference;

  const recentComplaints = useMemo(
    () => scopedComplaints.slice(0, 4),
    [scopedComplaints]
  );

  return (
    <div className="homepage-container">
      {/* Top Banner Header with Filters */}
      <header className="hero-banner">
        <div className="hero-banner-left">
          <div className="hero-brand-dot" />
          <div className="hero-text-stack">
            <span className="hero-role-tag">{currentUser.roleLabel} Dashboard</span>
            <h1 className="hero-title">Welcome, {currentUser.name}</h1>
          </div>
        </div>

        {/* Filters preserved as required */}
        <div className="hero-banner-actions">
          {currentUser.role === 'admin' && (
            <button
              type="button"
              className="admin-report-btn"
              onClick={handleDownloadPdfReport}
              disabled={isGeneratingPdf}
              title="Download 1-page Weekly Manager Summary Report as PDF"
            >
              {isGeneratingPdf ? (
                <>
                  <svg
                    className="admin-report-spinner"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      strokeDasharray="28"
                      strokeDashoffset="10"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Generating PDF...</span>
                </>
              ) : (
                <>
                  <svg
                    className="admin-report-btn-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <polyline points="9 15 12 18 15 15" />
                  </svg>
                  <span>Weekly Report (PDF)</span>
                </>
              )}
            </button>
          )}

          {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
            <div className="hero-filter-item">
              <label htmlFor="home-am-select" className="hero-filter-label">
                Account Mgr
              </label>
              <select
                id="home-am-select"
                aria-label="Filter by Account Manager"
                className="admin-manager-select"
                value={selectedAccountManagerId}
                onChange={(e) => setSelectedAccountManagerId(e.target.value)}
              >
                <option value="ALL">All Account Managers</option>
                {accountManagers.map((am) => (
                  <option key={am.id} value={am.id}>
                    {am.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(currentUser.role === 'account_manager' ||
            currentUser.role === 'admin') && (
            <div className="hero-filter-item">
              <label htmlFor="home-mgr-select" className="hero-filter-label">
                Manager
              </label>
              <select
                id="home-mgr-select"
                aria-label="Filter by Manager"
                className="admin-manager-select"
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
              >
                <option value="ALL">All Managers</option>
                {managers.map((mgr) => (
                  <option key={mgr.id} value={mgr.id}>
                    {mgr.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {/* TOP SECTION: Clean KPI Metric Cards */}
      <section className="kpi-grid" aria-label="KPI Overview">
        {/* Card 1: Total */}
        <div className="kpi-card kpi-card--total">
          <div className="kpi-card-top">
            <div className="kpi-icon-box kpi-icon-box--total">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="7" y1="9" x2="17" y2="9" />
                <line x1="7" y1="13" x2="13" y2="13" />
              </svg>
            </div>
            <span className="kpi-badge kpi-badge--neutral">All Scoped</span>
          </div>
          <div className="kpi-card-mid">
            <div className="kpi-value">{totalCount}</div>
            <span className="kpi-label">{totalCardLabel}</span>
          </div>
          <div className="kpi-mini-distribution">
            <div
              className="kpi-mini-dist-seg kpi-mini-dist-seg--done"
              style={{ width: `${completionPct}%` }}
            />
            <div
              className="kpi-mini-dist-seg kpi-mini-dist-seg--pending"
              style={{ width: `${pendingPct}%` }}
            />
            <div
              className="kpi-mini-dist-seg kpi-mini-dist-seg--delayed"
              style={{ width: `${openDelayedPct}%` }}
            />
          </div>
        </div>

        {/* Card 2: Completed */}
        <div className="kpi-card kpi-card--done">
          <div className="kpi-card-top">
            <div className="kpi-icon-box kpi-icon-box--done">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="kpi-badge kpi-badge--done">{completionPct}%</span>
          </div>
          <div className="kpi-card-mid">
            <div className="kpi-value">{doneCount}</div>
            <span className="kpi-label">Completed</span>
          </div>
          <div className="kpi-meter-track">
            <div
              className="kpi-meter-fill kpi-meter-fill--done"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>

        {/* Card 3: Pending (< 48h Open) */}
        <div className="kpi-card kpi-card--pending">
          <div className="kpi-card-top">
            <div className="kpi-icon-box kpi-icon-box--pending">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="kpi-badge kpi-badge--pending">{pendingPct}%</span>
          </div>
          <div className="kpi-card-mid">
            <div className="kpi-value">{pendingCount}</div>
            <span className="kpi-label">Pending</span>
          </div>
          <div className="kpi-meter-track">
            <div
              className="kpi-meter-fill kpi-meter-fill--pending"
              style={{ width: `${pendingPct}%` }}
            />
          </div>
        </div>

        {/* Card 4: Overdue / Delayed (> 48h) */}
        <div className="kpi-card kpi-card--delayed">
          <div className="kpi-card-top">
            <div className="kpi-icon-box kpi-icon-box--delayed">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="kpi-badge kpi-badge--delayed">&gt; 48h ({delayedPct}%)</span>
          </div>
          <div className="kpi-card-mid">
            <div className="kpi-value">{delayedCount}</div>
            <span className="kpi-label">Overdue</span>
          </div>
          <div className="kpi-meter-track">
            <div
              className="kpi-meter-fill kpi-meter-fill--delayed"
              style={{ width: `${delayedPct}%` }}
            />
          </div>
        </div>
      </section>

      {/* BOTTOM SECTION: Balanced 2x2 Dashboard Analytics Grid */}
      <section className="dashboard-bento-grid" aria-label="Visual Analytics Charts">
        {/* Panel 1: Pipeline Breakdown Column Chart */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h2 className="chart-card-title">Status Breakdown</h2>
            <span className="chart-card-tag">{totalCount} Total</span>
          </div>

          <div className="chart-column-visualizer" aria-label="Pipeline Stages Chart">
            <div className="column-chart-bars">
              <div className="column-bar-item">
                <span className="column-val-label">{uncheckedCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--unchecked"
                    style={{ height: `${calcBarHeight(uncheckedCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">New</span>
              </div>

              <div className="column-bar-item">
                <span className="column-val-label">{mgrDoneCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--mgr"
                    style={{ height: `${calcBarHeight(mgrDoneCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">Mgr Done</span>
              </div>

              <div className="column-bar-item">
                <span className="column-val-label">{doneCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--done"
                    style={{ height: `${calcBarHeight(doneCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">Verified</span>
              </div>

              <div className="column-bar-item">
                <span className="column-val-label">{delayedCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--delayed"
                    style={{ height: `${calcBarHeight(delayedCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">Overdue</span>
              </div>
            </div>
          </div>
        </div>

        {/* Panel 2: Dual Radial Gauges & Queue Split */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h2 className="chart-card-title">48h Response Speed</h2>
            <span
              className={`speed-status-badge ${
                delayedCount === 0
                  ? 'speed-status-badge--healthy'
                  : 'speed-status-badge--warning'
              }`}
            >
              {delayedCount === 0 ? 'On Track' : `${delayedCount} Overdue`}
            </span>
          </div>

          <div className="gauges-split-body">
            {/* Gauge 1: On-Time SLA */}
            <div className="gauge-unit">
              <div className="donut-chart-box">
                <svg className="donut-svg" viewBox="0 0 110 110">
                  <circle
                    className="donut-bg-circle"
                    cx="55"
                    cy="55"
                    r={donutRadius}
                  />
                  <circle
                    className={`donut-fill-circle ${
                      onTimePct >= 90
                        ? 'donut-fill-circle--healthy'
                        : onTimePct >= 70
                        ? 'donut-fill-circle--moderate'
                        : 'donut-fill-circle--alert'
                    }`}
                    cx="55"
                    cy="55"
                    r={donutRadius}
                    strokeDasharray={donutCircumference}
                    strokeDashoffset={donutDashOffset}
                  />
                </svg>
                <div className="donut-center-content">
                  <span className="donut-center-pct">{onTimePct}%</span>
                  <span className="donut-center-lbl">On-Time</span>
                </div>
              </div>
            </div>

            {/* Gauge 2: Resolution Rate */}
            <div className="gauge-unit">
              <div className="donut-chart-box">
                <svg className="donut-svg" viewBox="0 0 110 110">
                  <circle
                    className="donut-bg-circle"
                    cx="55"
                    cy="55"
                    r={donutRadius}
                  />
                  <circle
                    className="donut-fill-circle donut-fill-circle--moderate"
                    cx="55"
                    cy="55"
                    r={donutRadius}
                    strokeDasharray={donutCircumference}
                    strokeDashoffset={doneDashOffset}
                  />
                </svg>
                <div className="donut-center-content">
                  <span className="donut-center-pct">{completionPct}%</span>
                  <span className="donut-center-lbl">Resolved</span>
                </div>
              </div>
            </div>

            {/* Queue Action Tiles */}
            <div className="speed-action-tiles">
              <div className="speed-action-tile">
                <span className="tile-dot tile-dot--manager" />
                <span className="tile-name">Mgr Queue</span>
                <span className="tile-val tile-val--manager">{mgrQueueCount}</span>
              </div>
              <div className="speed-action-tile">
                <span className="tile-dot tile-dot--am" />
                <span className="tile-name">AM Queue</span>
                <span className="tile-val tile-val--am">{amQueueCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Panel 3: Team Workload Comparative Chart */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h2 className="chart-card-title">
              {currentUser.role === 'account_manager'
                ? 'Manager Metrics'
                : currentUser.role === 'manager'
                ? 'AM Metrics'
                : 'Team Metrics'}
            </h2>

            {currentUser.role === 'admin' && (
              <div className="chart-mini-tabs">
                <button
                  type="button"
                  className={`chart-mini-tab ${
                    adminTeamTab === 'managers' ? 'chart-mini-tab--active' : ''
                  }`}
                  onClick={() => setAdminTeamTab('managers')}
                >
                  Managers
                </button>
                <button
                  type="button"
                  className={`chart-mini-tab ${
                    adminTeamTab === 'account_managers'
                      ? 'chart-mini-tab--active'
                      : ''
                  }`}
                  onClick={() => setAdminTeamTab('account_managers')}
                >
                  AMs
                </button>
              </div>
            )}
          </div>

          <div className="team-bars-container">
            {teamStats.map((stat) => (
              <div key={stat.person.id} className="team-bar-row">
                <div className="team-bar-user">
                  <span className="team-bar-avatar">
                    {stat.person.avatarInitials}
                  </span>
                  <span className="team-bar-name">{stat.person.name}</span>
                </div>

                <div className="team-bar-track-wrap">
                  <div className="team-bar-track">
                    <div
                      className="team-bar-fill"
                      style={{ width: `${stat.rate}%` }}
                    />
                  </div>
                </div>

                <div className="team-bar-stat-nums">
                  <span className="team-bar-rate">{stat.rate}%</span>
                  <span className="team-bar-total">{stat.done}/{stat.total}</span>
                </div>
              </div>
            ))}
            {teamStats.length === 0 && (
              <div className="team-empty-state">No data</div>
            )}
          </div>
        </div>

        {/* Panel 4: Recent Queue Snapshot */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h2 className="chart-card-title">Recent Queue</h2>
            {onNavigate && (
              <button
                type="button"
                className="chart-link-btn"
                onClick={() => onNavigate('complaints')}
              >
                View All &rarr;
              </button>
            )}
          </div>

          <div className="recent-list-container">
            {recentComplaints.map((item) => {
              const isDone = isComplaintDone(item);
              const isLate = isComplaintDelayed(item, nowMs);
              const isMgrChecked = item.managerDone && !item.accountManagerDone;

              return (
                <div key={item.complaintId} className="recent-row-item">
                  <span className="recent-id-badge">{item.complaintId}</span>
                  <div className="recent-people-tags">
                    <span className="recent-person-chip">{item.accountManagerName}</span>
                    <span className="recent-arrow">&rarr;</span>
                    <span className="recent-person-chip">{item.managerName}</span>
                  </div>
                  <div className="recent-status-group">
                    {isDone ? (
                      <>
                        <span className="recent-status-pill recent-status-pill--done">
                          Done
                        </span>
                        {isLate && (
                          <span className="recent-status-pill recent-status-pill--late">
                            Overdue
                          </span>
                        )}
                      </>
                    ) : isMgrChecked ? (
                      <>
                        <span className="recent-status-pill recent-status-pill--mgr">
                          Mgr Done
                        </span>
                        {isLate && (
                          <span className="recent-status-pill recent-status-pill--late">
                            Overdue
                          </span>
                        )}
                      </>
                    ) : isLate ? (
                      <span className="recent-status-pill recent-status-pill--late">
                        Overdue
                      </span>
                    ) : (
                      <span className="recent-status-pill recent-status-pill--new">
                        New
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {recentComplaints.length === 0 && (
              <div className="team-empty-state">No active records</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
