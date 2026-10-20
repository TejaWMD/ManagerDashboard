import React from 'react';
import {
  Complaint,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
  PageView,
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
  // Account Managers view their own complaints; Manager and Admin view all complaints
  const scopedComplaints =
    currentUser.role === 'account_manager'
      ? complaints.filter(
          (c) => c.submittedByEmail.toLowerCase() === currentUser.email.toLowerCase()
        )
      : complaints;

  const totalCount = scopedComplaints.length;
  const openCount = scopedComplaints.filter((c) => c.status === 'Open').length;
  const inProgressCount = scopedComplaints.filter((c) => c.status === 'In Progress').length;
  const escalatedCount = scopedComplaints.filter((c) => c.status === 'Escalated').length;
  const resolvedCount = scopedComplaints.filter((c) => c.status === 'Resolved').length;

  const resolutionRate =
    totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0;

  const statusMetrics: { label: ComplaintStatus; count: number; color: string }[] = [
    { label: 'Open', count: openCount, color: '#3b82f6' },
    { label: 'In Progress', count: inProgressCount, color: '#f59e0b' },
    { label: 'Escalated', count: escalatedCount, color: '#ef4444' },
    { label: 'Resolved', count: resolvedCount, color: '#10b981' },
  ];

  const priorities: { label: ComplaintPriority; color: string }[] = [
    { label: 'Critical', color: '#dc2626' },
    { label: 'High', color: '#f97316' },
    { label: 'Medium', color: '#3b82f6' },
    { label: 'Low', color: '#64748b' },
  ];

  const priorityMetrics = priorities.map((p) => {
    const count = scopedComplaints.filter((c) => c.priority === p.label).length;
    const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    return { ...p, count, pct };
  });

  const categories: ComplaintCategory[] = [
    'Service Quality',
    'Billing & Invoice',
    'Delivery & SLA',
    'Technical Issue',
    'Account Support',
  ];

  const categoryMetrics = categories.map((cat) => {
    const count = scopedComplaints.filter((c) => c.category === cat).length;
    const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    return { label: cat, count, pct };
  });

  // Account Manager breakdown (for Manager & Admin views)
  const accountManagers = AUTHORIZED_USERS.filter((u) => u.role === 'account_manager');
  const amBreakdown = accountManagers.map((am) => {
    const amList = complaints.filter(
      (c) => c.submittedByEmail.toLowerCase() === am.email.toLowerCase()
    );
    const amResolved = amList.filter((c) => c.status === 'Resolved').length;
    const amActive = amList.length - amResolved;
    return {
      name: am.name.replace(' (Account Manager)', ''),
      email: am.email,
      total: amList.length,
      active: amActive,
      resolved: amResolved,
    };
  });

  return (
    <div className="homepage-container">
      {/* Welcome Hero Banner */}
      <section className="hero-banner" data-role={currentUser.role}>
        <div className="hero-banner-content">
          <div className="hero-badge-row">
            <span className="hero-role-tag">{currentUser.roleLabel} Workspace</span>
            <span className="hero-live-indicator">
              <span className="live-dot" /> Live Dashboard
            </span>
          </div>
          <h1 className="hero-title">Welcome back, {currentUser.name}</h1>
          <p className="hero-subtitle">
            {currentUser.role === 'account_manager'
              ? `You are viewing your dedicated Account Manager dashboard (${currentUser.email}). Track your client complaints and resolution progress in real time.`
              : currentUser.role === 'manager'
              ? 'Operations Manager overview across all Account Managers (Shakti, Kavita & Linda). Review active escalations and assign resolutions.'
              : 'System Administrator Command Center. Full visibility across all Account Managers, Manager operations, and SLA performance.'}
          </p>
        </div>

        <div className="hero-banner-actions">
          <button
            type="button"
            className="hero-primary-btn"
            onClick={() => onNavigate('complaints')}
          >
            {currentUser.role === 'account_manager'
              ? '+ Submit / View Complaints'
              : 'Open Complaint Management'}
          </button>
        </div>
      </section>

      {/* Top KPI Cards */}
      <section className="kpi-grid" aria-label="Key Performance Indicators">
        <div className="kpi-card kpi-card--total">
          <div className="kpi-card-top">
            <span className="kpi-label">
              {currentUser.role === 'account_manager'
                ? 'My Total Complaints'
                : 'Total System Complaints'}
            </span>
            <span className="kpi-icon kpi-icon--blue">#</span>
          </div>
          <div className="kpi-value">{totalCount}</div>
          <div className="kpi-foot">Resolution Rate: {resolutionRate}%</div>
        </div>

        <div className="kpi-card kpi-card--open">
          <div className="kpi-card-top">
            <span className="kpi-label">Open / Pending Review</span>
            <span className="kpi-icon kpi-icon--amber">!</span>
          </div>
          <div className="kpi-value">{openCount + inProgressCount}</div>
          <div className="kpi-foot">
            {openCount} New &bull; {inProgressCount} In Progress
          </div>
        </div>

        <div className="kpi-card kpi-card--escalated">
          <div className="kpi-card-top">
            <span className="kpi-label">Escalated / Urgent</span>
            <span className="kpi-icon kpi-icon--red">&uarr;</span>
          </div>
          <div className="kpi-value">{escalatedCount}</div>
          <div className="kpi-foot">Requires priority manager attention</div>
        </div>

        <div className="kpi-card kpi-card--resolved">
          <div className="kpi-card-top">
            <span className="kpi-label">Resolved Cases</span>
            <span className="kpi-icon kpi-icon--green">&check;</span>
          </div>
          <div className="kpi-value">{resolvedCount}</div>
          <div className="kpi-foot">Completed &amp; verified</div>
        </div>
      </section>

      {/* Visual Breakdown Charts Row */}
      <section className="charts-grid">
        {/* Chart 1: Complaints by Status */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div>
              <h3>Complaints by Status</h3>
              <p>Proportional breakdown of current ticket lifecycle states</p>
            </div>
          </div>

          {/* Multi-segment progress bar */}
          <div className="status-segmented-bar">
            {statusMetrics.map((s) => {
              const widthPct = totalCount > 0 ? (s.count / totalCount) * 100 : 25;
              return (
                <div
                  key={s.label}
                  className="status-segment"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: s.color,
                  }}
                  title={`${s.label}: ${s.count}`}
                />
              );
            })}
          </div>

          <div className="status-legend-grid">
            {statusMetrics.map((s) => {
              const pct = totalCount > 0 ? Math.round((s.count / totalCount) * 100) : 0;
              return (
                <div key={s.label} className="status-legend-item">
                  <div className="status-legend-left">
                    <span
                      className="status-dot"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="status-name">{s.label}</span>
                  </div>
                  <div className="status-legend-right">
                    <strong>{s.count}</strong>
                    <span>({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chart 2: Complaints by Priority */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div>
              <h3>Complaints by Priority</h3>
              <p>Severity distribution across logged client issues</p>
            </div>
          </div>

          <div className="bar-chart-list">
            {priorityMetrics.map((p) => (
              <div key={p.label} className="bar-chart-row">
                <div className="bar-chart-label-row">
                  <span className="bar-label-title">{p.label} Priority</span>
                  <span className="bar-label-value">
                    {p.count} ({p.pct}%)
                  </span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max(p.pct, p.count > 0 ? 8 : 0)}%`,
                      backgroundColor: p.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart 3: Role-specific 3rd Visual Card */}
        {currentUser.role === 'account_manager' ? (
          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>My Complaints by Category</h3>
                <p>Issue types reported under your account portfolio</p>
              </div>
            </div>
            <div className="bar-chart-list">
              {categoryMetrics.map((cat) => (
                <div key={cat.label} className="bar-chart-row">
                  <div className="bar-chart-label-row">
                    <span className="bar-label-title">{cat.label}</span>
                    <span className="bar-label-value">
                      {cat.count} ({cat.pct}%)
                    </span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${Math.max(cat.pct, cat.count > 0 ? 8 : 0)}%`,
                        backgroundColor: '#6366f1',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Complaints by Account Manager</h3>
                <p>Submission &amp; resolution volume across Shakti, Kavita &amp; Linda</p>
              </div>
            </div>
            <div className="am-breakdown-list">
              {amBreakdown.map((am) => (
                <div key={am.email} className="am-breakdown-item">
                  <div className="am-breakdown-top">
                    <div>
                      <strong>{am.name}</strong>
                      <span className="am-email-sub">{am.email}</span>
                    </div>
                    <span className="am-total-pill">{am.total} Total</span>
                  </div>
                  <div className="am-stats-pills">
                    <span className="am-stat-chip am-stat-chip--active">
                      Active: {am.active}
                    </span>
                    <span className="am-stat-chip am-stat-chip--resolved">
                      Resolved: {am.resolved}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Recent Complaints Preview Table */}
      <section className="recent-section-card">
        <div className="recent-section-header">
          <div>
            <h2>
              {currentUser.role === 'account_manager'
                ? 'My Recent Client Complaints'
                : 'Recent Complaints Across All Accounts'}
            </h2>
            <p>Latest logged tickets and current manager remarks</p>
          </div>
          <button
            type="button"
            className="view-all-link-btn"
            onClick={() => onNavigate('complaints')}
          >
            Go to Complaint Page &rarr;
          </button>
        </div>

        <div className="table-responsive-wrapper">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Client Name</th>
                <th>Subject</th>
                <th>Account Manager</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {scopedComplaints.slice(0, 5).map((item) => (
                <tr key={item.id}>
                  <td className="td-ticket">{item.ticketNumber}</td>
                  <td className="td-client">{item.clientName}</td>
                  <td className="td-subject">{item.subject}</td>
                  <td>
                    <span className="am-owner-tag">{item.submittedByName}</span>
                  </td>
                  <td>
                    <span
                      className={`priority-badge priority-badge--${item.priority.toLowerCase()}`}
                    >
                      {item.priority}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status-badge status-badge--${item.status
                        .toLowerCase()
                        .replace(/\s+/g, '-')}`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="td-date">{item.updatedAt}</td>
                </tr>
              ))}
              {scopedComplaints.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-table-cell">
                    No complaints logged yet. Click &ldquo;Complaint Page&rdquo; to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
