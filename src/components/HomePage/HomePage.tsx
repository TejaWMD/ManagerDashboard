import React, { useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  isComplaintDelayed,
  isComplaintDone,
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
  const managers = AUTHORIZED_USERS.filter((u) => u.role === 'manager');
  const [selectedManagerId, setSelectedManagerId] = useState<string>('ALL');

  const selectedManagerObj = managers.find((m) => m.id === selectedManagerId);

  const scopedComplaints = complaints.filter((c) => {
    if (currentUser.role === 'account_manager') {
      return belongsToAccountManager(c, currentUser);
    }
    if (currentUser.role === 'manager') {
      return belongsToManager(c, currentUser);
    }
    if (selectedManagerId !== 'ALL' && selectedManagerObj) {
      return belongsToManager(c, selectedManagerObj);
    }
    return true;
  });

  const totalCount = scopedComplaints.length;
  const doneCount = scopedComplaints.filter((c) => isComplaintDone(c)).length;
  const pendingCount = scopedComplaints.filter((c) => !isComplaintDone(c)).length;
  const delayedCount = scopedComplaints.filter((c) => isComplaintDelayed(c)).length;

  const totalCardLabel =
    currentUser.role === 'account_manager'
      ? 'Created'
      : currentUser.role === 'manager'
      ? 'Received'
      : 'Total';

  return (
    <div className="homepage-container">
      <header className="hero-banner">
        <div>
          <span className="hero-role-tag">{currentUser.roleLabel}</span>
          <h1 className="hero-title">Welcome, {currentUser.name}</h1>
        </div>

        <div className="hero-banner-actions">
          {currentUser.role === 'admin' && (
            <select
              aria-label="Filter by Manager"
              className="admin-manager-select"
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
            >
              <option value="ALL">All Managers</option>
              {managers.map((mgr) => (
                <option key={mgr.id} value={mgr.id}>
                  {mgr.name} ({mgr.email})
                </option>
              ))}
            </select>
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

      <section className="kpi-grid" aria-label="Metrics">
        <div className="kpi-card">
          <span className="kpi-label">{totalCardLabel}</span>
          <div className="kpi-value">{totalCount}</div>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Done</span>
          <div className="kpi-value">{doneCount}</div>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Pending</span>
          <div className="kpi-value">{pendingCount}</div>
        </div>

        <div className="kpi-card kpi-card--delayed">
          <span className="kpi-label">Delayed</span>
          <div className="kpi-value">{delayedCount}</div>
        </div>
      </section>

      <section className="recent-section-card">
        <div className="recent-section-header">
          <h2>Recent Complaints</h2>
          <button
            type="button"
            className="view-all-link-btn"
            onClick={() => onNavigate('complaints')}
          >
            View All
          </button>
        </div>

        <div className="table-responsive-wrapper">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>ID</th>
                {currentUser.role !== 'account_manager' && <th>Account Manager</th>}
                {currentUser.role !== 'manager' && <th>Manager</th>}
                <th>Complaint</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {scopedComplaints.slice(0, 5).map((item) => {
                const done = isComplaintDone(item);
                const delayed = isComplaintDelayed(item);
                return (
                  <tr key={item.complaintId}>
                    <td className="td-date">{item.createdAt}</td>
                    <td className="td-ticket">{item.complaintId}</td>
                    {currentUser.role !== 'account_manager' && (
                      <td>{item.accountManagerName}</td>
                    )}
                    {currentUser.role !== 'manager' && (
                      <td>{item.managerName}</td>
                    )}
                    <td className="td-subject">{item.complaintText}</td>
                    <td>
                      <span
                        className={`status-badge ${
                          done
                            ? 'status-badge--resolved'
                            : delayed
                            ? 'status-badge--escalated'
                            : 'status-badge--in-progress'
                        }`}
                      >
                        {done ? 'Done' : delayed ? 'Delayed' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {scopedComplaints.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-table-cell">
                    No complaints yet.
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
