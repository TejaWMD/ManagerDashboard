import React, { useEffect, useMemo, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  isComplaintDelayed,
  isComplaintDone,
  isComplaintPending,
  sortComplaintsByStatusAndTimestamp,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './ComplaintPage.css';

interface ComplaintPageProps {
  currentUser: UserAccount;
  complaints: Complaint[];
  savingComplaintId: string | null;
  onCreateComplaint: (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    complaintText: string;
  }) => Promise<void>;
  onUpdateComplaint: (
    complaintId: string,
    updates: Partial<
      Pick<
        Complaint,
        | 'complaintText'
        | 'managerRemark'
        | 'managerDone'
        | 'accountManagerRemark'
        | 'accountManagerDone'
      >
    >
  ) => Promise<void>;
}

type StatusFilterValue =
  | 'ALL'
  | 'Pending'
  | 'Unchecked'
  | 'ManagerDone'
  | 'Delayed'
  | 'Completed';

export const ComplaintPage: React.FC<ComplaintPageProps> = ({
  currentUser,
  complaints,
  savingComplaintId,
  onCreateComplaint,
  onUpdateComplaint,
}) => {
  const accountManagers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'account_manager'),
    []
  );
  const managers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'manager'),
    []
  );

  // Live clock so Delayed status updates automatically
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Header filter states
  const [filterAccountManagerId, setFilterAccountManagerId] = useState<string>('ALL');
  const [filterManagerId, setFilterManagerId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<StatusFilterValue>('ALL');
  const [timestampOrder, setTimestampOrder] = useState<'desc' | 'asc'>('desc');

  // Create modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    managers[0]?.id || ''
  );
  const [complaintInput, setComplaintInput] = useState<string>('');
  const [isSubmittingNew, setIsSubmittingNew] = useState<boolean>(false);

  // Inline editing states
  const [editingAmRemarkId, setEditingAmRemarkId] = useState<string | null>(null);
  const [amRemarkDraft, setAmRemarkDraft] = useState<string>('');

  const [editingComplaintTextId, setEditingComplaintTextId] = useState<string | null>(null);
  const [complaintTextDraft, setComplaintTextDraft] = useState<string>('');

  const [editingMgrRemarkId, setEditingMgrRemarkId] = useState<string | null>(null);
  const [mgrRemarkDraft, setMgrRemarkDraft] = useState<string>('');

  // 1. Role-scoped complaints
  const roleScopedComplaints = useMemo(() => {
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

  // 2. Apply header filters & automatic status + timestamp sorting
  const sortedAndFilteredComplaints = useMemo(() => {
    const selectedAmObj = accountManagers.find((am) => am.id === filterAccountManagerId);
    const selectedMgrObj = managers.find((m) => m.id === filterManagerId);

    const filtered = roleScopedComplaints.filter((c) => {
      // Account Manager filter (available to Manager & Admin)
      if (
        (currentUser.role === 'manager' || currentUser.role === 'admin') &&
        filterAccountManagerId !== 'ALL' &&
        selectedAmObj
      ) {
        if (!belongsToAccountManager(c, selectedAmObj)) {
          return false;
        }
      }

      // Manager filter (available to Account Manager & Admin)
      if (
        (currentUser.role === 'account_manager' || currentUser.role === 'admin') &&
        filterManagerId !== 'ALL' &&
        selectedMgrObj
      ) {
        if (!belongsToManager(c, selectedMgrObj)) {
          return false;
        }
      }

      // Status filter (available to all roles)
      if (filterStatus !== 'ALL') {
        const done = isComplaintDone(c);
        const delayed = isComplaintDelayed(c, nowMs);
        const pendingUnder24h = isComplaintPending(c, nowMs);

        if (filterStatus === 'Completed' && !done) return false;
        if (filterStatus === 'Pending' && !pendingUnder24h) return false;
        if (filterStatus === 'Delayed' && !delayed) return false;
        if (filterStatus === 'Unchecked' && (c.managerDone || c.accountManagerDone)) {
          return false;
        }
        if (filterStatus === 'ManagerDone' && (!c.managerDone || c.accountManagerDone)) {
          return false;
        }
      }

      return true;
    });

    return sortComplaintsByStatusAndTimestamp(filtered, timestampOrder);
  }, [
    roleScopedComplaints,
    currentUser.role,
    filterAccountManagerId,
    filterManagerId,
    filterStatus,
    accountManagers,
    managers,
    timestampOrder,
    nowMs,
  ]);

  const hasActiveFilters =
    filterAccountManagerId !== 'ALL' ||
    filterManagerId !== 'ALL' ||
    filterStatus !== 'ALL' ||
    timestampOrder !== 'desc';

  const handleResetFilters = () => {
    setFilterAccountManagerId('ALL');
    setFilterManagerId('ALL');
    setFilterStatus('ALL');
    setTimestampOrder('desc');
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedManagerId || !complaintInput.trim() || isSubmittingNew) return;

    const targetManager = managers.find((m) => m.id === selectedManagerId);
    if (!targetManager) return;

    setIsSubmittingNew(true);
    try {
      await onCreateComplaint({
        managerId: targetManager.id,
        managerEmail: targetManager.email,
        managerName: targetManager.name,
        complaintText: complaintInput.trim(),
      });

      setComplaintInput('');
      setShowCreateModal(false);
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const startEditAmRemark = (item: Complaint) => {
    setEditingAmRemarkId(item.complaintId);
    setAmRemarkDraft(item.accountManagerRemark);
  };

  const saveAmRemark = async (complaintId: string) => {
    await onUpdateComplaint(complaintId, {
      accountManagerRemark: amRemarkDraft.trim(),
    });
    setEditingAmRemarkId(null);
    setAmRemarkDraft('');
  };

  const startEditComplaintText = (item: Complaint) => {
    setEditingComplaintTextId(item.complaintId);
    setComplaintTextDraft(item.complaintText);
  };

  const saveComplaintText = async (complaintId: string) => {
    if (!complaintTextDraft.trim()) return;
    await onUpdateComplaint(complaintId, {
      complaintText: complaintTextDraft.trim(),
    });
    setEditingComplaintTextId(null);
    setComplaintTextDraft('');
  };

  const startEditMgrRemark = (item: Complaint) => {
    setEditingMgrRemarkId(item.complaintId);
    setMgrRemarkDraft(item.managerRemark);
  };

  const saveMgrRemark = async (complaintId: string) => {
    await onUpdateComplaint(complaintId, {
      managerRemark: mgrRemarkDraft.trim(),
    });
    setEditingMgrRemarkId(null);
    setMgrRemarkDraft('');
  };

  const handleToggleManagerDone = async (item: Complaint) => {
    if (currentUser.role !== 'manager') return;
    const nextManagerDone = !item.managerDone;
    await onUpdateComplaint(item.complaintId, {
      managerDone: nextManagerDone,
      // If manager unchecks their box, also reset accountManagerDone so AM only checks when fully completed
      ...(!nextManagerDone && item.accountManagerDone
        ? { accountManagerDone: false }
        : {}),
    });
  };

  const handleToggleAccountManagerDone = async (item: Complaint) => {
    if (currentUser.role !== 'account_manager') return;
    // Account manager will only check the box once the complaint is completed by manager
    if (!item.accountManagerDone && !item.managerDone) return;
    await onUpdateComplaint(item.complaintId, {
      accountManagerDone: !item.accountManagerDone,
    });
  };

  return (
    <div className="complaint-page-container">
      <header className="complaint-page-header">
        <div className="complaint-header-title-group">
          <h1 className="complaint-page-title">Complaints</h1>
          <span className="complaint-count-pill">
            {sortedAndFilteredComplaints.length} / {roleScopedComplaints.length}
          </span>
        </div>

        <div className="complaint-header-controls">
          {/* Account Manager Filter: shown for Managers & Admin */}
          {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
            <div className="header-filter-group">
              <label htmlFor="filter-am" className="header-filter-label">
                Account Mgr
              </label>
              <select
                id="filter-am"
                className="header-filter-select"
                value={filterAccountManagerId}
                onChange={(e) => setFilterAccountManagerId(e.target.value)}
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

          {/* Manager Filter: shown for Account Managers & Admin */}
          {(currentUser.role === 'account_manager' || currentUser.role === 'admin') && (
            <div className="header-filter-group">
              <label htmlFor="filter-mgr" className="header-filter-label">
                Manager
              </label>
              <select
                id="filter-mgr"
                className="header-filter-select"
                value={filterManagerId}
                onChange={(e) => setFilterManagerId(e.target.value)}
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

          {/* Status Filter: shown for all roles */}
          <div className="header-filter-group">
            <label htmlFor="filter-status" className="header-filter-label">
              Status
            </label>
            <select
              id="filter-status"
              className="header-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as StatusFilterValue)}
            >
              <option value="ALL">All Status</option>
              <option value="Pending">Pending (&lt;48h)</option>
              <option value="Unchecked">Unchecked</option>
              <option value="ManagerDone">Manager Checked</option>
              <option value="Delayed">Delayed (&gt;48h)</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="header-reset-btn"
              onClick={handleResetFilters}
              title="Reset Filters & Sorting"
            >
              Reset
            </button>
          )}

          {currentUser.role === 'account_manager' && (
            <button
              type="button"
              className="header-add-btn"
              onClick={() => setShowCreateModal(true)}
            >
              + Add Complaint
            </button>
          )}
        </div>

        {/* Company Logo at Top Right */}
        <div className="header-company-logo-badge" title="WMD">
          <img
            src={wmdLogo}
            alt="WMD Company Logo"
            className="header-company-logo-img"
          />
        </div>
      </header>

      <section className="complaints-table-card">
        <div className="complaints-table-wrapper">
          <table className="complaints-table">
            <thead>
              <tr>
                <th
                  className="th-sortable"
                  onClick={() =>
                    setTimestampOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                  }
                  title="Click to toggle timestamp order within each status group"
                >
                  <span>Date</span>
                  <span className="sort-indicator">
                    {timestampOrder === 'desc' ? '↓' : '↑'}
                  </span>
                </th>
                <th>ID</th>
                {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
                  <th>Account Manager</th>
                )}
                {(currentUser.role === 'account_manager' ||
                  currentUser.role === 'admin') && <th>Manager</th>}
                <th>Complaint</th>
                <th>Manager Remark</th>
                <th className="th-center">Manager Done</th>
                <th>AM Remark</th>
                <th className="th-center">AM Done</th>
                <th className="th-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredComplaints.map((item) => {
                const completed = isComplaintDone(item);
                const delayed = isComplaintDelayed(item, nowMs);
                const managerOnlyChecked = item.managerDone && !item.accountManagerDone;
                const isRowSaving = savingComplaintId === item.complaintId;

                const amCannotCheckYet =
                  !item.managerDone && !item.accountManagerDone;
                const isAmCheckboxDisabled =
                  currentUser.role !== 'account_manager' ||
                  isRowSaving ||
                  amCannotCheckYet;

                const rowStateClass = completed
                  ? 'row-completed'
                  : managerOnlyChecked
                  ? 'row-manager-done'
                  : 'row-unchecked';

                return (
                  <tr key={item.complaintId} className={rowStateClass}>
                    <td className="td-timestamp">{item.createdAt}</td>

                    <td className="td-complaint-id">
                      <span className="complaint-id-badge">{item.complaintId}</span>
                    </td>

                    {(currentUser.role === 'manager' ||
                      currentUser.role === 'admin') && (
                      <td className="td-person">{item.accountManagerName}</td>
                    )}

                    {(currentUser.role === 'account_manager' ||
                      currentUser.role === 'admin') && (
                      <td className="td-person">{item.managerName}</td>
                    )}

                    <td className="td-complaint-text">
                      {currentUser.role === 'account_manager' &&
                      editingComplaintTextId === item.complaintId ? (
                        <div className="inline-edit-box">
                          <textarea
                            rows={2}
                            value={complaintTextDraft}
                            onChange={(e) => setComplaintTextDraft(e.target.value)}
                            placeholder="Edit complaint..."
                          />
                          <div className="inline-edit-actions">
                            <button
                              type="button"
                              className="btn-inline-save"
                              disabled={isRowSaving}
                              onClick={() => saveComplaintText(item.complaintId)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-inline-cancel"
                              onClick={() => setEditingComplaintTextId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="remark-display-row">
                          <p className="complaint-body-text">{item.complaintText}</p>
                          {currentUser.role === 'account_manager' && (
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditComplaintText(item)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="td-remark">
                      {currentUser.role === 'manager' ? (
                        editingMgrRemarkId === item.complaintId ? (
                          <div className="inline-edit-box">
                            <textarea
                              rows={2}
                              value={mgrRemarkDraft}
                              onChange={(e) => setMgrRemarkDraft(e.target.value)}
                              placeholder="Remark..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveMgrRemark(item.complaintId)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-inline-cancel"
                                onClick={() => setEditingMgrRemarkId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="remark-display-row">
                            <span
                              className={
                                item.managerRemark
                                  ? 'remark-value'
                                  : 'remark-placeholder'
                              }
                            >
                              {item.managerRemark || '—'}
                            </span>
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditMgrRemark(item)}
                            >
                              Edit
                            </button>
                          </div>
                        )
                      ) : (
                        <span
                          className={
                            item.managerRemark ? 'remark-value' : 'remark-placeholder'
                          }
                        >
                          {item.managerRemark || '—'}
                        </span>
                      )}
                    </td>

                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.managerDone ? 'check-button-label--checked' : ''
                        } ${
                          currentUser.role !== 'manager'
                            ? 'check-button-label--readonly'
                            : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.managerDone}
                          disabled={currentUser.role !== 'manager' || isRowSaving}
                          onChange={() => handleToggleManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    <td className="td-remark">
                      {currentUser.role === 'account_manager' ? (
                        editingAmRemarkId === item.complaintId ? (
                          <div className="inline-edit-box">
                            <textarea
                              rows={2}
                              value={amRemarkDraft}
                              onChange={(e) => setAmRemarkDraft(e.target.value)}
                              placeholder="Remark..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveAmRemark(item.complaintId)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-inline-cancel"
                                onClick={() => setEditingAmRemarkId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="remark-display-row">
                            <span
                              className={
                                item.accountManagerRemark
                                  ? 'remark-value'
                                  : 'remark-placeholder'
                              }
                            >
                              {item.accountManagerRemark || '—'}
                            </span>
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditAmRemark(item)}
                            >
                              Edit
                            </button>
                          </div>
                        )
                      ) : (
                        <span
                          className={
                            item.accountManagerRemark
                              ? 'remark-value'
                              : 'remark-placeholder'
                          }
                        >
                          {item.accountManagerRemark || '—'}
                        </span>
                      )}
                    </td>

                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.accountManagerDone ? 'check-button-label--checked' : ''
                        } ${
                          isAmCheckboxDisabled ? 'check-button-label--readonly' : ''
                        }`}
                        title={
                          amCannotCheckYet
                            ? 'Manager must check Done before Account Manager can mark as completed'
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={item.accountManagerDone}
                          disabled={isAmCheckboxDisabled}
                          onChange={() => handleToggleAccountManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    <td className="td-status-cell">
                      <div className="td-status-pills-wrap">
                        {completed ? (
                          <>
                            <span className="table-status-pill table-status-pill--completed">
                              Completed
                            </span>
                            {delayed && (
                              <span className="table-status-pill table-status-pill--delayed">
                                Delayed
                              </span>
                            )}
                          </>
                        ) : managerOnlyChecked ? (
                          <>
                            <span className="table-status-pill table-status-pill--mgr-done">
                              Mgr Checked
                            </span>
                            {delayed && (
                              <span className="table-status-pill table-status-pill--delayed">
                                Delayed
                              </span>
                            )}
                          </>
                        ) : delayed ? (
                          <span className="table-status-pill table-status-pill--delayed">
                            Delayed
                          </span>
                        ) : (
                          <span className="table-status-pill table-status-pill--pending">
                            Pending
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {sortedAndFilteredComplaints.length === 0 && (
                <tr>
                  <td
                    colSpan={currentUser.role === 'admin' ? 10 : 9}
                    className="empty-complaints-cell"
                  >
                    No complaints match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {currentUser.role === 'account_manager' && showCreateModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-complaint-modal-title"
          >
            <div className="modal-header">
              <h3 id="create-complaint-modal-title">New Complaint</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="modal-form" onSubmit={handleCreateSubmit}>
              <div className="cp-form-group">
                <label htmlFor="select-manager">Manager</label>
                <select
                  id="select-manager"
                  value={selectedManagerId}
                  onChange={(e) => setSelectedManagerId(e.target.value)}
                  required
                >
                  {managers.map((mgr) => (
                    <option key={mgr.id} value={mgr.id}>
                      {mgr.name} ({mgr.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="cp-form-group">
                <label htmlFor="write-complaint">Complaint</label>
                <textarea
                  id="write-complaint"
                  rows={4}
                  placeholder="Write complaint..."
                  value={complaintInput}
                  onChange={(e) => setComplaintInput(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmittingNew}
                >
                  {isSubmittingNew ? '...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
