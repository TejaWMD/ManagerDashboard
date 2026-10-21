import React, { useMemo, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  isComplaintDelayed,
  isComplaintDone,
  PageView,
  sortComplaintsByStatusAndTimestamp,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import './HomePage.css';

interface HomePageProps {
  currentUser: UserAccount;
  complaints: Complaint[];
  onNavigate?: (page: PageView) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  complaints,
}) => {
  const accountManagers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'account_manager'),
    []
  );
  const managers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'manager'),
    []
  );

  const [selectedAccountManagerId, setSelectedAccountManagerId] =
    useState<string>('ALL');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('ALL');
  const [adminTeamTab, setAdminTeamTab] = useState<'managers' | 'account_managers'>(
    'managers'
  );

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

  // Core KPI metrics
  const totalCount = scopedComplaints.length;
  const doneCount = scopedComplaints.filter((c) => isComplaintDone(c)).length;
  const pendingCount = scopedComplaints.filter((c) => !isComplaintDone(c)).length;
  const uncheckedCount = scopedComplaints.filter(
    (c) => !c.managerDone && !c.accountManagerDone
  ).length;
  const mgrDoneCount = scopedComplaints.filter(
    (c) => c.managerDone && !c.accountManagerDone
  ).length;
  const delayedCount = scopedComplaints.filter((c) => isComplaintDelayed(c)).length;

  const pct = (value: number) =>
    totalCount > 0 ? Math.round((value / totalCount) * 100) : 0;

  const completionPct = pct(doneCount);
  const uncheckedPct = pct(uncheckedCount);
  const mgrDonePct = pct(mgrDoneCount);
  const delayedPct = pct(delayedCount);
  const onTimePct = totalCount > 0 ? Math.max(0, 100 - delayedPct) : 100;

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
      const delayed = personComplaints.filter((c) => isComplaintDelayed(c)).length;
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
  }, [targetPeopleList, baseRoleComplaints]);

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

  return (
    <div className="homepage-container">
      {/* Top Banner Header with Filters */}
      <header className="hero-banner">
        <div className="hero-banner-left">
          <span className="hero-role-tag">{currentUser.roleLabel} Dashboard</span>
          <h1 className="hero-title">Welcome, {currentUser.name}</h1>
        </div>

        {/* Filters preserved exactly as required */}
        <div className="hero-banner-actions">
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

      {/* TOP SECTION: Prominent, Bigger Symmetrical KPI Metric Cards */}
      <section className="kpi-grid" aria-label="KPI Overview">
        {/* Card 1: Total */}
        <div className="kpi-card kpi-card--total">
          <div className="kpi-card-header">
            <span className="kpi-label">{totalCardLabel}</span>
            <span className="kpi-badge kpi-badge--neutral">All Scoped</span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value">{totalCount}</div>
            <div className="kpi-mini-distribution">
              <div
                className="kpi-mini-dist-seg kpi-mini-dist-seg--done"
                style={{ width: `${completionPct}%` }}
                title={`Done: ${doneCount}`}
              />
              <div
                className="kpi-mini-dist-seg kpi-mini-dist-seg--pending"
                style={{ width: `${totalCount > 0 ? 100 - completionPct : 0}%` }}
                title={`Pending: ${pendingCount}`}
              />
            </div>
          </div>
          <div className="kpi-card-footer">
            <span>{uncheckedCount} New &bull; {mgrDoneCount} In Progress</span>
          </div>
        </div>

        {/* Card 2: Completed */}
        <div className="kpi-card kpi-card--done">
          <div className="kpi-card-header">
            <span className="kpi-label">Completed</span>
            <span className="kpi-badge kpi-badge--done">{completionPct}%</span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value">{doneCount}</div>
            <div className="kpi-meter-track">
              <div
                className="kpi-meter-fill kpi-meter-fill--done"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
          <div className="kpi-card-footer">
            <span>Verified by both</span>
          </div>
        </div>

        {/* Card 3: Pending */}
        <div className="kpi-card kpi-card--pending">
          <div className="kpi-card-header">
            <span className="kpi-label">Pending</span>
            <span className="kpi-badge kpi-badge--pending">
              {totalCount > 0 ? 100 - completionPct : 0}%
            </span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value">{pendingCount}</div>
            <div className="kpi-meter-track">
              <div
                className="kpi-meter-fill kpi-meter-fill--pending"
                style={{ width: `${totalCount > 0 ? 100 - completionPct : 0}%` }}
              />
            </div>
          </div>
          <div className="kpi-card-footer">
            <span>{uncheckedCount} New &bull; {mgrDoneCount} Awaiting AM</span>
          </div>
        </div>

        {/* Card 4: Overdue */}
        <div className="kpi-card kpi-card--delayed">
          <div className="kpi-card-header">
            <span className="kpi-label">Overdue</span>
            <span className="kpi-badge kpi-badge--delayed">&gt; 24h</span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value">{delayedCount}</div>
            <div className="kpi-meter-track">
              <div
                className="kpi-meter-fill kpi-meter-fill--delayed"
                style={{ width: `${delayedPct}%` }}
              />
            </div>
          </div>
          <div className="kpi-card-footer">
            <span>
              {delayedCount === 0 ? 'All within 24 hours' : `${delayedPct}% of total overdue`}
            </span>
          </div>
        </div>
      </section>

      {/* BOTTOM SECTION: Symmetrical Visual Analytics & Chart Panels */}
      <section className="dashboard-charts-grid" aria-label="Visual Analytics Charts">
        {/* Chart Card 1: Pipeline Breakdown Column Chart */}
        <div className="chart-card chart-card--pipeline">
          <div className="chart-card-header">
            <div className="chart-card-title-wrap">
              <h2 className="chart-card-title">Resolution Pipeline</h2>
              <span className="chart-card-tag">{completionPct}% Resolved</span>
            </div>
          </div>

          {/* Interactive Column Bar Chart */}
          <div className="chart-column-visualizer" aria-label="Pipeline Stages Chart">
            <div className="column-chart-bars">
              {/* Bar 1: New */}
              <div className="column-bar-item">
                <span className="column-val-label">{uncheckedCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--unchecked"
                    style={{ height: `${calcBarHeight(uncheckedCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">New</span>
                <span className="column-pct-pill">{uncheckedPct}%</span>
              </div>

              {/* Bar 2: Mgr Checked */}
              <div className="column-bar-item">
                <span className="column-val-label">{mgrDoneCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--mgr"
                    style={{ height: `${calcBarHeight(mgrDoneCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">Mgr Done</span>
                <span className="column-pct-pill">{mgrDonePct}%</span>
              </div>

              {/* Bar 3: Completed */}
              <div className="column-bar-item">
                <span className="column-val-label">{doneCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--done"
                    style={{ height: `${calcBarHeight(doneCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">Both Done</span>
                <span className="column-pct-pill">{completionPct}%</span>
              </div>

              {/* Bar 4: Overdue */}
              <div className="column-bar-item">
                <span className="column-val-label">{delayedCount}</span>
                <div className="column-bar-track">
                  <div
                    className="column-bar-fill column-bar-fill--delayed"
                    style={{ height: `${calcBarHeight(delayedCount)}%` }}
                  />
                </div>
                <span className="column-axis-label">Overdue</span>
                <span className="column-pct-pill">{delayedPct}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chart Card 2: 24h Response Speed with Visual SVG Gauge */}
        <div className="chart-card chart-card--speed">
          <div className="chart-card-header">
            <div className="chart-card-title-wrap">
              <h2 className="chart-card-title">24h Response Speed</h2>
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
          </div>

          {/* Central Donut Gauge Chart */}
          <div className="speed-chart-visual">
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

            {/* Quick Action Matrix Tiles */}
            <div className="speed-action-tiles">
              <div className="speed-action-tile">
                <div className="speed-action-header">
                  <span className="tile-dot tile-dot--manager" />
                  <span className="tile-name">Needs Mgr</span>
                </div>
                <span className="tile-val tile-val--manager">{uncheckedCount}</span>
              </div>

              <div className="speed-action-tile">
                <div className="speed-action-header">
                  <span className="tile-dot tile-dot--am" />
                  <span className="tile-name">Needs AM</span>
                </div>
                <span className="tile-val tile-val--am">{mgrDoneCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Chart Card 3: Team Workload Comparative Bar Chart */}
        <div className="chart-card chart-card--team">
          <div className="chart-card-header">
            <div className="chart-card-title-wrap">
              <h2 className="chart-card-title">
                {currentUser.role === 'account_manager'
                  ? 'Managers'
                  : currentUser.role === 'manager'
                  ? 'Account Managers'
                  : 'Team Performance'}
              </h2>
            </div>

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
                  Account Mgrs
                </button>
              </div>
            )}
          </div>

          {/* Comparative Workload List */}
          <div className="team-bars-container">
            {teamStats.map((stat) => (
              <div key={stat.person.id} className="team-bar-row">
                <div className="team-bar-top">
                  <div className="team-bar-user">
                    <span className="team-bar-avatar">
                      {stat.person.avatarInitials}
                    </span>
                    <span className="team-bar-name">{stat.person.name}</span>
                  </div>
                  <div className="team-bar-stat-nums">
                    <span className="team-bar-rate">{stat.rate}%</span>
                    <span className="team-bar-total">({stat.done}/{stat.total})</span>
                  </div>
                </div>

                {/* Comparative Horizontal Progress Bar */}
                <div className="team-bar-track">
                  <div
                    className="team-bar-fill"
                    style={{ width: `${stat.rate}%` }}
                  />
                </div>

                {/* Metric count pills */}
                <div className="team-bar-pills">
                  <span className="team-pill team-pill--new">New: {stat.unchecked}</span>
                  <span className="team-pill team-pill--mgr">Mgr: {stat.mgrDone}</span>
                  <span className="team-pill team-pill--done">Done: {stat.done}</span>
                  {stat.delayed > 0 && (
                    <span className="team-pill team-pill--late">Late: {stat.delayed}</span>
                  )}
                </div>
              </div>
            ))}
            {teamStats.length === 0 && (
              <div className="team-empty-state">No team members found.</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
