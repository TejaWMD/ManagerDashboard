import React, { useEffect, useMemo, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  getLinkedAppointmentForQuery,
  Query,
  isQueryDelayed,
  isQueryDone,
  isQueryPending,
  PageView,
  sortQueriesByStatusAndTimestamp,
  UserAccount,
  Appointment,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import { AppointmentsSection } from '../Appointments/AppointmentsSection';
import { generateWeeklyManagerReportPdf } from '../../lib/pdfReport';
import {
  calculateAllManagersKpi,
  calculateManagerKpi,
  filterQueriesByWindow,
  KpiTimeWindow,
} from '../../lib/kpi';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './HomePage.css';

interface HomePageProps {
  currentUser: UserAccount;
  queries: Query[];
  onNavigate?: (page: PageView) => void;
  users?: UserAccount[];
  appointments?: Appointment[];
  onOpenBookAppointment?: (preselectedQueryId?: string | null, preselectedUserId?: string | null) => void;
  onAcceptAppointment?: (appointmentId: string) => Promise<void>;
  onRescheduleClick?: (appointment: Appointment) => void;
  onAcceptReschedule?: (appointmentId: string) => Promise<void>;
  onDeclineAppointment?: (appointmentId: string) => Promise<void>;
  onCancelAppointment?: (appointmentId: string) => Promise<void>;
  onEditAppointment?: (appointment: Appointment) => void;
  onCancelAppointmentWithRemark?: (
    appointmentId: string,
    remark: string
  ) => Promise<void>;
  onOpenCreateQueryForAppointment?: (appointment: Appointment) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  currentUser,
  queries,
  onNavigate,
  users,
  appointments = [],
  onOpenBookAppointment,
  onAcceptAppointment = async () => {},
  onRescheduleClick = () => {},
  onAcceptReschedule = async () => {},
  onDeclineAppointment = async () => {},
  onCancelAppointment = async () => {},
  onEditAppointment,
  onCancelAppointmentWithRemark,
  onOpenCreateQueryForAppointment,
}) => {
  const userList = users && users.length > 0 ? users : AUTHORIZED_USERS;
  const senders = useMemo(
    () => userList.filter((u) => u.role === 'account_manager' || u.role === 'manager'),
    [userList]
  );
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
  const [teamTab, setTeamTab] = useState<'managers' | 'account_managers'>('managers');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  const [reportTimeWindow, setReportTimeWindow] = useState<KpiTimeWindow>('7d');
  const [viewingQuery, setViewingQuery] = useState<Query | null>(null);
  const activeViewingQuery = useMemo(() => {
    if (!viewingQuery) return null;
    return (
      queries.find((c) => c.queryId === viewingQuery.queryId) ||
      viewingQuery
    );
  }, [queries, viewingQuery]);

  const activeViewingLinkedAppointment = useMemo(() => {
    if (!activeViewingQuery) return null;
    return getLinkedAppointmentForQuery(activeViewingQuery, appointments);
  }, [activeViewingQuery, appointments]);

  // Dynamic preview range string for report modal
  const previewRangeStr = useMemo(() => {
    const endStr = new Date(nowMs).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    if (reportTimeWindow === '7d') {
      const startMs = nowMs - 7 * 24 * 60 * 60 * 1000;
      const startStr = new Date(startMs).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      return `${startStr} – ${endStr} (7 Days)`;
    }
    if (reportTimeWindow === '14d') {
      const startMs = nowMs - 14 * 24 * 60 * 60 * 1000;
      const startStr = new Date(startMs).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      return `${startStr} – ${endStr} (14 Days)`;
    }
    if (reportTimeWindow === '30d') {
      const startMs = nowMs - 30 * 24 * 60 * 60 * 1000;
      const startStr = new Date(startMs).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      return `${startStr} – ${endStr} (30 Days)`;
    }
    return `All Recorded Queries up to ${endStr}`;
  }, [reportTimeWindow, nowMs]);

  const scopedReportQueriesCount = useMemo(() => {
    return filterQueriesByWindow(queries, reportTimeWindow, nowMs).length;
  }, [queries, reportTimeWindow, nowMs]);

  // Rolling 7-day weighted KPI (Director Policy)
  const manager7dKpi = useMemo(() => {
    if (currentUser.role === 'manager') {
      return calculateManagerKpi(queries, currentUser, {
        window: '7d',
        nowMs,
      });
    }
    if (currentUser.role === 'admin') {
      const allMgrs = userList.filter((u) => u.role === 'manager');
      return calculateAllManagersKpi(queries, allMgrs, {
        window: '7d',
        nowMs,
      });
    }
    return null;
  }, [queries, currentUser, userList, nowMs]);

  const handleDownloadPdfReport = (selectedWindow: KpiTimeWindow = reportTimeWindow) => {
    try {
      setIsGeneratingPdf(true);
      generateWeeklyManagerReportPdf({
        queries,
        managers,
        adminUser: currentUser,
        nowMs,
        timeWindow: selectedWindow,
      });
      setShowReportModal(false);
    } catch (err) {
      console.error('Failed to generate weekly PDF report:', err);
    } finally {
      setTimeout(() => {
        setIsGeneratingPdf(false);
      }, 600);
    }
  };

  const selectedAmObj = senders.find(
    (am) => am.id === selectedAccountManagerId
  );
  const selectedManagerObj = managers.find((m) => m.id === selectedManagerId);

  // Filter queries based on user role and active dropdown filters
  const scopedQueries = useMemo(() => {
    const filtered = queries.filter((c) => {
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

    return sortQueriesByStatusAndTimestamp(filtered, 'desc');
  }, [
    queries,
    currentUser,
    selectedAccountManagerId,
    selectedAmObj,
    selectedManagerId,
    selectedManagerObj,
  ]);

  // Core KPI metrics:
  // - Completed: both Manager Done & AM Done are checked
  // - Pending: open queries under 24h (!done && !delayed)
  // - Delayed / Overdue: queries that exceeded 24h (stays Delayed even after Completed so KPIs are accurate)
  const totalCount = scopedQueries.length;
  const doneCount = scopedQueries.filter((c) => isQueryDone(c)).length;
  const pendingCount = scopedQueries.filter((c) =>
    isQueryPending(c, nowMs)
  ).length;
  const delayedCount = scopedQueries.filter((c) =>
    isQueryDelayed(c, nowMs)
  ).length;
  const openDelayedCount = scopedQueries.filter(
    (c) => !isQueryDone(c) && isQueryDelayed(c, nowMs)
  ).length;

  // Stage breakdown counts
  const uncheckedCount = scopedQueries.filter(
    (c) => !c.managerDone && !c.accountManagerDone && !isQueryDelayed(c, nowMs)
  ).length;
  const mgrDoneCount = scopedQueries.filter(
    (c) => c.managerDone && !c.accountManagerDone && !isQueryDelayed(c, nowMs)
  ).length;

  // Action queues (all open items waiting on Manager or AM)
  const mgrQueueCount = scopedQueries.filter(
    (c) => !c.managerDone && !c.accountManagerDone
  ).length;
  const amQueueCount = scopedQueries.filter(
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
  const baseRoleQueries = useMemo(() => {
    return queries.filter((c) => {
      if (currentUser.role === 'account_manager') {
        return belongsToAccountManager(c, currentUser);
      }
      if (currentUser.role === 'manager' && teamTab === 'account_managers') {
        return belongsToManager(c, currentUser);
      }
      return true;
    });
  }, [queries, currentUser, teamTab]);

  const targetPeopleList = useMemo(() => {
    if (currentUser.role === 'account_manager') {
      return managers;
    }
    return teamTab === 'managers' ? managers : accountManagers;
  }, [currentUser.role, managers, accountManagers, teamTab]);

  const teamStats = useMemo(() => {
    return targetPeopleList.map((person) => {
      const personQueries = baseRoleQueries.filter((c) =>
        person.role === 'manager'
          ? belongsToManager(c, person)
          : belongsToAccountManager(c, person)
      );
      const total = personQueries.length;
      const done = personQueries.filter((c) => isQueryDone(c)).length;
      const mgrDone = personQueries.filter(
        (c) => c.managerDone && !c.accountManagerDone
      ).length;
      const unchecked = personQueries.filter(
        (c) => !c.managerDone && !c.accountManagerDone
      ).length;
      const delayed = personQueries.filter((c) =>
        isQueryDelayed(c, nowMs)
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
  }, [targetPeopleList, baseRoleQueries, nowMs]);

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

  const recentQueries = useMemo(
    () => scopedQueries.slice(0, 4),
    [scopedQueries]
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
              onClick={() => setShowReportModal(true)}
              disabled={isGeneratingPdf}
              title="Configure and download Executive KPI Summary Report as PDF"
            >
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
            </button>
          )}

          {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
            <div className="hero-filter-item">
              <label htmlFor="home-am-select" className="hero-filter-label">
                From
              </label>
              <select
                id="home-am-select"
                aria-label="Filter by Sender"
                className="admin-manager-select"
                value={selectedAccountManagerId}
                onChange={(e) => setSelectedAccountManagerId(e.target.value)}
              >
                <option value="ALL">All Senders</option>
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role === 'manager' ? 'Mgr' : 'AM'})
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

        <div className="header-company-logo-badge" title="WMD">
          <img
            src={wmdLogo}
            alt="WMD Company Logo"
            className="header-company-logo-img"
          />
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

        {/* Card 5: Manager 7-Day Rolling Average KPI (Director Policy) */}
        {currentUser.role === 'manager' && manager7dKpi && 'kpiScore' in manager7dKpi && (
          <div
            className="kpi-card kpi-card--weighted-score"
            onClick={() => onNavigate && onNavigate('kpi')}
            title="Click to view detailed Manager KPI Leaderboard & peer stats"
          >
            <div className="kpi-card-top">
              <div className="kpi-icon-box kpi-icon-box--weighted">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <span className="kpi-badge kpi-badge--weighted">Rolling 7d</span>
            </div>
            <div className="kpi-card-mid">
              <div className="kpi-value">{manager7dKpi.kpiScore}%</div>
              <span className="kpi-label">Average KPI</span>
            </div>
            <div className="kpi-weighted-footer">
              <span className="kpi-pts-text">
                {manager7dKpi.earnedPoints} / {manager7dKpi.totalEvaluated} pts
              </span>
              <span className="kpi-detail-link">KPI Page &rarr;</span>
            </div>
          </div>
        )}

        {/* Card 5 (Admin): Team 7-Day Rolling Average KPI */}
        {currentUser.role === 'admin' && manager7dKpi && 'teamAverageKpi' in manager7dKpi && (
          <div
            className="kpi-card kpi-card--weighted-score"
            onClick={() => onNavigate && onNavigate('kpi')}
            title="Click to view detailed Manager KPI Leaderboard"
          >
            <div className="kpi-card-top">
              <div className="kpi-icon-box kpi-icon-box--weighted">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M18 20V10" />
                  <path d="M12 20V4" />
                  <path d="M6 20v-6" />
                </svg>
              </div>
              <span className="kpi-badge kpi-badge--weighted">Rolling 7d</span>
            </div>
            <div className="kpi-card-mid">
              <div className="kpi-value">{manager7dKpi.teamAverageKpi}%</div>
              <span className="kpi-label">Team Avg KPI</span>
            </div>
            <div className="kpi-weighted-footer">
              <span className="kpi-pts-text">3 Managers</span>
              <span className="kpi-detail-link">KPI Page &rarr;</span>
            </div>
          </div>
        )}
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

        {/* Panel 2: Team Workload Comparative Chart */}
        <div className="chart-card">
          <div className="chart-card-header">
            <h2 className="chart-card-title">
              {currentUser.role === 'account_manager'
                ? 'Manager Metrics'
                : teamTab === 'managers'
                ? 'Peer Managers'
                : 'Account Managers'}
            </h2>

            {(currentUser.role === 'admin' || currentUser.role === 'manager') && (
              <div className="chart-mini-tabs">
                <button
                  type="button"
                  className={`chart-mini-tab ${
                    teamTab === 'managers' ? 'chart-mini-tab--active' : ''
                  }`}
                  onClick={() => setTeamTab('managers')}
                >
                  Managers
                </button>
                <button
                  type="button"
                  className={`chart-mini-tab ${
                    teamTab === 'account_managers'
                      ? 'chart-mini-tab--active'
                      : ''
                  }`}
                  onClick={() => setTeamTab('account_managers')}
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

        {/* Panel 3: Appointments & Discussions (Replaces Completion Rate & Recent Queue) */}
        <AppointmentsSection
          currentUser={currentUser}
          appointments={appointments}
          queries={queries}
          users={userList}
          onOpenBookModal={() => onOpenBookAppointment?.(null, null)}
          onAcceptAppointment={onAcceptAppointment}
          onRescheduleClick={onRescheduleClick}
          onAcceptReschedule={onAcceptReschedule}
          onDeclineAppointment={onDeclineAppointment}
          onCancelAppointment={onCancelAppointment}
          onEditAppointment={onEditAppointment}
          onCancelAppointmentWithRemark={onCancelAppointmentWithRemark}
          onOpenCreateQueryForAppointment={onOpenCreateQueryForAppointment}
          onViewQuery={setViewingQuery}
        />
      </section>

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
            aria-labelledby="home-view-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <div className="query-view-title-row">
                  <h3 id="home-view-query-modal-title">
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

              {(activeViewingLinkedAppointment || activeViewingQuery.linkedAppointmentId) && (
                <div className="query-view-section">
                  <span className="query-view-section-label">Linked Appointment</span>
                  <div
                    className="query-view-content-box"
                    style={{
                      background: 'rgba(132, 73, 24, 0.05)',
                      border: '1px solid rgba(132, 73, 24, 0.22)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.6rem',
                    }}
                  >
                    {activeViewingLinkedAppointment ? (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '0.5rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span className="apt-id-pill">
                              📅 {activeViewingLinkedAppointment.id}
                            </span>
                            <strong style={{ fontSize: '0.94rem', color: '#1c1813' }}>
                              {activeViewingLinkedAppointment.title}
                            </strong>
                          </div>
                          <span
                            className={`apt-status-pill apt-status-pill--${activeViewingLinkedAppointment.status.toLowerCase()}`}
                          >
                            {activeViewingLinkedAppointment.status === 'CONFIRMED'
                              ? 'Confirmed'
                              : activeViewingLinkedAppointment.status === 'PENDING'
                              ? 'Pending Acceptance'
                              : activeViewingLinkedAppointment.status === 'RESCHEDULE_PROPOSED'
                              ? 'Reschedule Proposed'
                              : activeViewingLinkedAppointment.status === 'DECLINED'
                              ? 'Declined'
                              : activeViewingLinkedAppointment.status === 'CANCELLED'
                              ? 'Cancelled'
                              : 'Completed'}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.85rem',
                            fontSize: '0.82rem',
                            color: '#4b4339',
                          }}
                        >
                          <span>
                            <strong>Scheduled:</strong> {activeViewingLinkedAppointment.scheduledAt}
                          </span>
                          <span>
                            <strong>Type:</strong> {activeViewingLinkedAppointment.meetingType}
                          </span>
                          {activeViewingLinkedAppointment.meetingLocation && (
                            <span>
                              <strong>Location:</strong> {activeViewingLinkedAppointment.meetingLocation}
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: '0.82rem', color: '#4b4339' }}>
                          <strong>Host:</strong> {activeViewingLinkedAppointment.requesterName} &rarr;{' '}
                          <strong>Attendees:</strong>{' '}
                          {Array.isArray(activeViewingLinkedAppointment.attendees) &&
                          activeViewingLinkedAppointment.attendees.length > 0
                            ? activeViewingLinkedAppointment.attendees.map((a) => a.name).join(', ')
                            : activeViewingLinkedAppointment.receiverName}
                        </div>

                        {activeViewingLinkedAppointment.agenda && (
                          <div
                            style={{
                              fontSize: '0.82rem',
                              color: '#3a3228',
                              background: '#ffffff',
                              padding: '0.55rem 0.75rem',
                              borderRadius: '8px',
                              border: '1px solid rgba(190, 179, 161, 0.35)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            <strong>Agenda:</strong> {activeViewingLinkedAppointment.agenda}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="apt-id-pill">
                          📅 {activeViewingQuery.linkedAppointmentId}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#4b4339' }}>
                          Linked to Appointment {activeViewingQuery.linkedAppointmentId}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

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

              <div className="modal-actions" style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {!activeViewingLinkedAppointment &&
                  !activeViewingQuery.linkedAppointmentId &&
                  onOpenBookAppointment && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        const q = activeViewingQuery;
                        setViewingQuery(null);
                        const targetUserId =
                          currentUser.id === q.accountManagerId
                            ? q.managerId
                            : q.accountManagerId;
                        onOpenBookAppointment(q.queryId, targetUserId);
                      }}
                    >
                      📅 Book Appointment for this Query
                    </button>
                  )}
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

      {/* Executive KPI Report Configuration & Download Modal (Admin Only) */}
      {showReportModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowReportModal(false)}
        >
          <div
            className="modal-dialog report-config-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <div className="report-modal-icon-badge">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="report-modal-icon"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                </div>
                <div>
                  <h3 id="report-modal-title" className="report-modal-title">
                    Executive KPI Summary Report
                  </h3>
                  <p className="report-modal-sub">
                    2-page briefing document formatted for Director weekly submission.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowReportModal(false)}
                aria-label="Close report configuration"
              >
                &times;
              </button>
            </div>

            <div className="report-modal-body">
              {/* Period Selector Radio Options */}
              <div className="report-section-label">
                <span>Select Reporting Period:</span>
              </div>
              <div className="report-period-grid">
                <button
                  type="button"
                  className={`report-period-option ${
                    reportTimeWindow === '7d' ? 'report-period-option--active' : ''
                  }`}
                  onClick={() => setReportTimeWindow('7d')}
                >
                  <div className="period-option-radio">
                    <span className="radio-dot" />
                  </div>
                  <div className="period-option-text">
                    <span className="period-option-title">Last 7 Days (Weekly)</span>
                    <span className="period-option-desc">Official weekly director submission (Recommended)</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`report-period-option ${
                    reportTimeWindow === '14d' ? 'report-period-option--active' : ''
                  }`}
                  onClick={() => setReportTimeWindow('14d')}
                >
                  <div className="period-option-radio">
                    <span className="radio-dot" />
                  </div>
                  <div className="period-option-text">
                    <span className="period-option-title">Last 14 Days (Bi-Weekly)</span>
                    <span className="period-option-desc">Two-week operational trend comparison</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`report-period-option ${
                    reportTimeWindow === '30d' ? 'report-period-option--active' : ''
                  }`}
                  onClick={() => setReportTimeWindow('30d')}
                >
                  <div className="period-option-radio">
                    <span className="radio-dot" />
                  </div>
                  <div className="period-option-text">
                    <span className="period-option-title">Last 30 Days (Monthly)</span>
                    <span className="period-option-desc">Comprehensive monthly operations audit</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`report-period-option ${
                    reportTimeWindow === 'all' ? 'report-period-option--active' : ''
                  }`}
                  onClick={() => setReportTimeWindow('all')}
                >
                  <div className="period-option-radio">
                    <span className="radio-dot" />
                  </div>
                  <div className="period-option-text">
                    <span className="period-option-title">All-Time Cumulative</span>
                    <span className="period-option-desc">Full historical record since portal inception</span>
                  </div>
                </button>
              </div>

              {/* Scope & Parameter Preview Card */}
              <div className="report-preview-box">
                <div className="report-preview-header">
                  <span className="preview-header-lbl">Report Scope & Parameters</span>
                  <span className="preview-header-period">{previewRangeStr}</span>
                </div>
                <div className="report-preview-stats">
                  <div className="preview-stat-item">
                    <span className="preview-stat-val">{managers.length}</span>
                    <span className="preview-stat-lbl">Managers Evaluated</span>
                  </div>
                  <div className="preview-stat-item">
                    <span className="preview-stat-val">{scopedReportQueriesCount}</span>
                    <span className="preview-stat-lbl">Queries in Period</span>
                  </div>
                  <div className="preview-stat-item">
                    <span className="preview-stat-val">2 Pages</span>
                    <span className="preview-stat-lbl">Portrait Briefing</span>
                  </div>
                </div>
                <div className="report-preview-notice">
                  <span className="preview-notice-icon">🔒</span>
                  <span>General Tracking Mode: Confidential query bodies & internal remarks are withheld to allow transparent team-wide distribution.</span>
                </div>
              </div>
            </div>

            <div className="modal-actions report-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowReportModal(false)}
                disabled={isGeneratingPdf}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary report-generate-btn"
                onClick={() => handleDownloadPdfReport(reportTimeWindow)}
                disabled={isGeneratingPdf}
              >
                {isGeneratingPdf ? (
                  <>
                    <svg
                      className="admin-report-spinner"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
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
                    <span>Generating Executive PDF...</span>
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
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <polyline points="9 15 12 18 15 15" />
                    </svg>
                    <span>Download 2-Page Executive PDF</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
