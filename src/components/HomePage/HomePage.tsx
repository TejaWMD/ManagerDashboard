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
  onNavigate: (page: PageView) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  complaints,
  onNavigate,
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

      // Admin
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

  const totalCardLabel =
    currentUser.role === 'account_manager'
      ? 'Created'
      : currentUser.role === 'manager'
      ? 'Received'
      : 'Total Complaints';

  // Team breakdown metrics (base role-scoped complaints so breakdown shows all team members clearly)
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

  return (
    <div className="homepage-container">
      {/* Top Banner */}
      <header className="hero-banner">
        <div className="hero-banner-left">
          <span className="hero-role-tag">{currentUser.roleLabel} Dashboard</span>
          <h1 className="hero-title">Welcome, {currentUser.name}</h1>
        </div>

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

          <button
            type="button"
            className="hero-primary-btn"
            onClick={() => onNavigate('complaints')}
          >
            Complaints &rarr;
          </button>
        </div>
      </header>

      {/* KPI Summary Cards */}
      <section className="kpi-grid" aria-label="Metrics">
        <div className="kpi-card">
          <div className="kpi-card-top">
            <span className="kpi-label">{totalCardLabel}</span>
            <span className="kpi-badge kpi-badge--neutral">All Scoped</span>
          </div>
          <div className="kpi-value">{totalCount}</div>
          <span className="kpi-subtext">
            {uncheckedCount} Unchecked &bull; {mgrDoneCount} Mgr Checked
          </span>
        </div>

        <div className="kpi-card kpi-card--done">
          <div className="kpi-card-top">
            <span className="kpi-label">Done</span>
            <span className="kpi-badge kpi-badge--done">{completionPct}%</span>
          </div>
          <div className="kpi-value">{doneCount}</div>
          <span className="kpi-subtext">Checked by both Manager &amp; AM</span>
        </div>

        <div className="kpi-card kpi-card--pending">
          <div className="kpi-card-top">
            <span className="kpi-label">Pending</span>
            <span className="kpi-badge kpi-badge--pending">
              {totalCount > 0 ? 100 - completionPct : 0}%
            </span>
          </div>
          <div className="kpi-value">{pendingCount}</div>
          <span className="kpi-subtext">
            {uncheckedCount} New &bull; {mgrDoneCount} Awaiting AM
          </span>
        </div>

        <div className="kpi-card kpi-card--delayed">
          <div className="kpi-card-top">
            <span className="kpi-label">Delayed</span>
            <span className="kpi-badge kpi-badge--delayed">&gt; 24h</span>
          </div>
          <div className="kpi-value">{delayedCount}</div>
          <span className="kpi-subtext">
            {delayedCount > 0
              ? `${delayedPct}% of total overdue`
              : 'All complaints within SLA'}
          </span>
        </div>
      </section>

      {/* Non-scrollable Dashboard Content Grid */}
      <div className="dashboard-main-grid">
        {/* Left Analytics Column */}
        <div className="dashboard-left-col">
          {/* Workflow Pipeline Breakdown Card */}
          <section className="dash-panel-card">
            <div className="dash-panel-header">
              <h2 className="dash-panel-title">Resolution Pipeline</h2>
              <span className="dash-panel-subtitle">
                {completionPct}% Completed
              </span>
            </div>

            <div className="pipeline-stacked-bar" aria-label="Status Distribution">
              <div
                className="pipeline-segment pipeline-segment--unchecked"
                style={{ width: `${uncheckedPct}%` }}
                title={`Unchecked: ${uncheckedCount} (${uncheckedPct}%)`}
              />
              <div
                className="pipeline-segment pipeline-segment--mgr"
                style={{ width: `${mgrDonePct}%` }}
                title={`Manager Checked: ${mgrDoneCount} (${mgrDonePct}%)`}
              />
              <div
                className="pipeline-segment pipeline-segment--done"
                style={{ width: `${completionPct}%` }}
                title={`Completed: ${doneCount} (${completionPct}%)`}
              />
            </div>

            <div className="pipeline-stages-list">
              <div className="pipeline-stage-item">
                <div className="pipeline-stage-info">
                  <span className="stage-dot stage-dot--unchecked" />
                  <span className="stage-name">1. Both Unchecked (Top)</span>
                </div>
                <div className="pipeline-stage-metrics">
                  <strong>{uncheckedCount}</strong>
                  <span>({uncheckedPct}%)</span>
                </div>
              </div>

              <div className="pipeline-stage-item">
                <div className="pipeline-stage-info">
                  <span className="stage-dot stage-dot--mgr" />
                  <span className="stage-name">2. Checked by Manager</span>
                </div>
                <div className="pipeline-stage-metrics">
                  <strong>{mgrDoneCount}</strong>
                  <span>({mgrDonePct}%)</span>
                </div>
              </div>

              <div className="pipeline-stage-item">
                <div className="pipeline-stage-info">
                  <span className="stage-dot stage-dot--done" />
                  <span className="stage-name">3. Checked by Both (Done)</span>
                </div>
                <div className="pipeline-stage-metrics">
                  <strong>{doneCount}</strong>
                  <span>({completionPct}%)</span>
                </div>
              </div>

              <div className="pipeline-stage-item pipeline-stage-item--delayed">
                <div className="pipeline-stage-info">
                  <span className="stage-dot stage-dot--delayed" />
                  <span className="stage-name">Delayed (&gt; 24 Hours)</span>
                </div>
                <div className="pipeline-stage-metrics">
                  <strong>{delayedCount}</strong>
                  <span>({delayedPct}%)</span>
                </div>
              </div>
            </div>
          </section>

          {/* Team Workload Breakdown Card */}
          <section className="dash-panel-card dash-panel-card--grow">
            <div className="dash-panel-header">
              <h2 className="dash-panel-title">
                {currentUser.role === 'account_manager'
                  ? 'Managers Overview'
                  : currentUser.role === 'manager'
                  ? 'Account Managers Overview'
                  : 'Team Breakdown'}
              </h2>

              {currentUser.role === 'admin' && (
                <div className="dash-mini-tabs">
                  <button
                    type="button"
                    className={`dash-mini-tab ${
                      adminTeamTab === 'managers' ? 'dash-mini-tab--active' : ''
                    }`}
                    onClick={() => setAdminTeamTab('managers')}
                  >
                    Managers
                  </button>
                  <button
                    type="button"
                    className={`dash-mini-tab ${
                      adminTeamTab === 'account_managers'
                        ? 'dash-mini-tab--active'
                        : ''
                    }`}
                    onClick={() => setAdminTeamTab('account_managers')}
                  >
                    Account Mgrs
                  </button>
                </div>
              )}
            </div>

            <div className="team-breakdown-list">
              {teamStats.map((stat) => (
                <div key={stat.person.id} className="team-stat-row">
                  <div className="team-stat-person">
                    <span className="team-avatar">{stat.person.avatarInitials}</span>
                    <div className="team-person-text">
                      <span className="team-person-name">{stat.person.name}</span>
                      <span className="team-person-sub">
                        {stat.total} total &bull; {stat.rate}% done
                      </span>
                    </div>
                  </div>

                  <div className="team-stat-pills">
                    <span
                      className="mini-stat-pill mini-stat-pill--unchecked"
                      title="Both Unchecked"
                    >
                      New: {stat.unchecked}
                    </span>
                    <span
                      className="mini-stat-pill mini-stat-pill--mgr"
                      title="Manager Checked"
                    >
                      Mgr: {stat.mgrDone}
                    </span>
                    <span
                      className="mini-stat-pill mini-stat-pill--done"
                      title="Completed"
                    >
                      Done: {stat.done}
                    </span>
                    {stat.delayed > 0 && (
                      <span
                        className="mini-stat-pill mini-stat-pill--delayed"
                        title="Delayed > 24h"
                      >
                        Late: {stat.delayed}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Priority Queue Table Column */}
        <section className="dash-panel-card dashboard-right-col">
          <div className="dash-panel-header">
            <div>
              <h2 className="dash-panel-title">Priority Queue &amp; Live Status</h2>
              <span className="dash-panel-subtitle">
                Auto-sorted: Unchecked &rarr; Manager Checked &rarr; Completed
              </span>
            </div>
            <button
              type="button"
              className="view-all-link-btn"
              onClick={() => onNavigate('complaints')}
            >
              Open Table &rarr;
            </button>
          </div>

          <div className="dashboard-table-scroll">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>ID</th>
                  {currentUser.role !== 'account_manager' && <th>Account Mgr</th>}
                  {currentUser.role !== 'manager' && <th>Manager</th>}
                  <th>Complaint</th>
                  <th className="th-center">Mgr</th>
                  <th className="th-center">AM</th>
                  <th className="th-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {scopedComplaints.map((item) => {
                  const done = isComplaintDone(item);
                  const delayed = isComplaintDelayed(item);
                  const mgrOnly = item.managerDone && !item.accountManagerDone;

                  return (
                    <tr
                      key={item.complaintId}
                      className={
                        done
                          ? 'dash-row-done'
                          : mgrOnly
                          ? 'dash-row-mgr'
                          : 'dash-row-unchecked'
                      }
                    >
                      <td className="td-date">{item.createdAt}</td>
                      <td className="td-ticket">
                        <span className="dash-id-pill">{item.complaintId}</span>
                      </td>
                      {currentUser.role !== 'account_manager' && (
                        <td className="td-person-cell">{item.accountManagerName}</td>
                      )}
                      {currentUser.role !== 'manager' && (
                        <td className="td-person-cell">{item.managerName}</td>
                      )}
                      <td className="td-subject">{item.complaintText}</td>
                      <td className="td-center">
                        <span
                          className={`mini-check-indicator ${
                            item.managerDone ? 'mini-check-indicator--on' : ''
                          }`}
                        >
                          {item.managerDone ? '✓' : '—'}
                        </span>
                      </td>
                      <td className="td-center">
                        <span
                          className={`mini-check-indicator ${
                            item.accountManagerDone ? 'mini-check-indicator--on' : ''
                          }`}
                        >
                          {item.accountManagerDone ? '✓' : '—'}
                        </span>
                      </td>
                      <td className="td-center">
                        <span
                          className={`status-badge ${
                            done
                              ? 'status-badge--resolved'
                              : delayed
                              ? 'status-badge--escalated'
                              : mgrOnly
                              ? 'status-badge--mgr-done'
                              : 'status-badge--in-progress'
                          }`}
                        >
                          {done
                            ? 'Completed'
                            : delayed
                            ? 'Delayed'
                            : mgrOnly
                            ? 'Mgr Checked'
                            : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {scopedComplaints.length === 0 && (
                  <tr>
                    <td
                      colSpan={currentUser.role === 'admin' ? 8 : 7}
                      className="empty-table-cell"
                    >
                      No complaints found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};
