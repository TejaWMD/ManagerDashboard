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

type ManagerViewScope = 'ALL' | 'RECEIVED' | 'SENT';

export const ComplaintPage: React.FC<ComplaintPageProps> = ({
  currentUser,
  complaints,
  savingComplaintId,
  onCreateComplaint,
  onUpdateComplaint,
}) => {
  // All potential senders (Account Managers + Managers)
  const senders = useMemo(
    () =>
      AUTHORIZED_USERS.filter(
        (u) => u.role === 'account_manager' || u.role === 'manager'
      ),
    []
  );

  // All managers (complaints can ONLY be sent to managers)
  const managers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'manager'),
    []
  );

  // Available target managers when creating a new complaint
  // If currentUser is a manager, prioritize other managers so they send complaints among themselves
  const targetManagersForCreation = useMemo(() => {
    if (currentUser.role === 'manager') {
      const otherManagers = managers.filter((m) => m.id !== currentUser.id);
      return otherManagers.length > 0 ? otherManagers : managers;
    }
    return managers;
  }, [currentUser, managers]);

  // Live clock so Delayed status updates automatically
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Header filter states
  const [managerViewType, setManagerViewType] = useState<ManagerViewScope>('ALL');
  const [filterSenderId, setFilterSenderId] = useState<string>('ALL');
  const [filterManagerId, setFilterManagerId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<StatusFilterValue>('ALL');
  const [timestampOrder, setTimestampOrder] = useState<'desc' | 'asc'>('desc');

  // Create modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    targetManagersForCreation[0]?.id || ''
  );
  const [complaintInput, setComplaintInput] = useState<string>('');
  const [isSubmittingNew, setIsSubmittingNew] = useState<boolean>(false);

  // Keep target manager selection in sync when modal opens
  const handleOpenCreateModal = () => {
    if (targetManagersForCreation.length > 0) {
      setSelectedManagerId(targetManagersForCreation[0].id);
    }
    setShowCreateModal(true);
  };

  // Inline editing states
  const [editingSenderRemarkId, setEditingSenderRemarkId] = useState<string | null>(null);
  const [senderRemarkDraft, setSenderRemarkDraft] = useState<string>('');

  const [editingComplaintTextId, setEditingComplaintTextId] = useState<string | null>(null);
  const [complaintTextDraft, setComplaintTextDraft] = useState<string>('');

  const [editingMgrRemarkId, setEditingMgrRemarkId] = useState<string | null>(null);
  const [mgrRemarkDraft, setMgrRemarkDraft] = useState<string>('');

  // Mandatory Solution Remark Modal state (Director Policy Requirement)
  const [remarkModalComplaint, setRemarkModalComplaint] = useState<Complaint | null>(null);
  const [mandatoryRemarkDraft, setMandatoryRemarkDraft] = useState<string>('');
  const [remarkError, setRemarkError] = useState<string>('');

  // 1. Role-scoped complaints
  // Account Managers see complaints they created.
  // Managers see complaints assigned to them AND complaints they sent among themselves.
  // Admin sees all complaints.
  const roleScopedComplaints = useMemo(() => {
    return complaints.filter((c) => {
      if (currentUser.role === 'account_manager') {
        return belongsToAccountManager(c, currentUser);
      }
      if (currentUser.role === 'manager') {
        return (
          belongsToManager(c, currentUser) ||
          belongsToAccountManager(c, currentUser)
        );
      }
      return true;
    });
  }, [complaints, currentUser]);

  // 2. Apply header filters & automatic status + timestamp sorting
  const sortedAndFilteredComplaints = useMemo(() => {
    const selectedSenderObj = senders.find((s) => s.id === filterSenderId);
    const selectedMgrObj = managers.find((m) => m.id === filterManagerId);

    const filtered = roleScopedComplaints.filter((c) => {
      // Manager view scope: All, Received, or Sent
      if (currentUser.role === 'manager' && managerViewType !== 'ALL') {
        if (managerViewType === 'RECEIVED' && !belongsToManager(c, currentUser)) {
          return false;
        }
        if (managerViewType === 'SENT' && !belongsToAccountManager(c, currentUser)) {
          return false;
        }
      }

      // Sender filter (From)
      if (filterSenderId !== 'ALL' && selectedSenderObj) {
        if (!belongsToAccountManager(c, selectedSenderObj)) {
          return false;
        }
      }

      // Assigned Manager filter (To)
      if (filterManagerId !== 'ALL' && selectedMgrObj) {
        if (!belongsToManager(c, selectedMgrObj)) {
          return false;
        }
      }

      // Status filter
      if (filterStatus !== 'ALL') {
        const done = isComplaintDone(c);
        const delayed = isComplaintDelayed(c, nowMs);
        const pendingUnder48h = isComplaintPending(c, nowMs);

        if (filterStatus === 'Completed' && !done) return false;
        if (filterStatus === 'Pending' && !pendingUnder48h) return false;
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
    managerViewType,
    filterSenderId,
    filterManagerId,
    filterStatus,
    senders,
    managers,
    timestampOrder,
    nowMs,
    currentUser,
  ]);

  const hasActiveFilters =
    managerViewType !== 'ALL' ||
    filterSenderId !== 'ALL' ||
    filterManagerId !== 'ALL' ||
    filterStatus !== 'ALL' ||
    timestampOrder !== 'desc';

  const handleResetFilters = () => {
    setManagerViewType('ALL');
    setFilterSenderId('ALL');
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

  const startEditSenderRemark = (item: Complaint) => {
    setEditingSenderRemarkId(item.complaintId);
    setSenderRemarkDraft(item.accountManagerRemark);
  };

  const saveSenderRemark = async (complaintId: string) => {
    await onUpdateComplaint(complaintId, {
      accountManagerRemark: senderRemarkDraft.trim(),
    });
    setEditingSenderRemarkId(null);
    setSenderRemarkDraft('');
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
    // Only assigned manager or admin can toggle Manager Done
    const isAssigned = item.managerId === currentUser.id;
    if (!isAssigned && currentUser.role !== 'admin') return;

    const nextManagerDone = !item.managerDone;

    // Director policy: Mandatory Solution Remark before marking Done
    if (nextManagerDone && (!item.managerRemark || !item.managerRemark.trim())) {
      setRemarkModalComplaint(item);
      setMandatoryRemarkDraft('');
      setRemarkError('');
      return;
    }

    await onUpdateComplaint(item.complaintId, {
      managerDone: nextManagerDone,
      // If manager unchecks their box, also reset sender verification so sender only checks when resolved
      ...(!nextManagerDone && item.accountManagerDone
        ? { accountManagerDone: false }
        : {}),
    });
  };

  const handleConfirmRemarkAndDone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!remarkModalComplaint) return;
    const trimmed = mandatoryRemarkDraft.trim();
    if (!trimmed) {
      setRemarkError('A solution remark or reference is required by director policy before marking Done.');
      return;
    }
    await onUpdateComplaint(remarkModalComplaint.complaintId, {
      managerRemark: trimmed,
      managerDone: true,
    });
    setRemarkModalComplaint(null);
    setMandatoryRemarkDraft('');
    setRemarkError('');
  };

  const handleToggleSenderDone = async (item: Complaint) => {
    // Only the creator/sender or admin can toggle Sender Done
    const isSender = item.accountManagerId === currentUser.id;
    if (!isSender && currentUser.role !== 'admin') return;

    // Sender will only check the box once the complaint is completed by assigned manager
    if (!item.accountManagerDone && !item.managerDone) return;

    await onUpdateComplaint(item.complaintId, {
      accountManagerDone: !item.accountManagerDone,
    });
  };

  // Helper to get role badge for sender
  const getSenderRoleBadge = (senderId: string) => {
    const userMatch = AUTHORIZED_USERS.find((u) => u.id === senderId);
    if (!userMatch) return null;
    return userMatch.role === 'manager' ? 'Mgr' : userMatch.role === 'account_manager' ? 'AM' : 'Admin';
  };

  // Can current user add a complaint? (AMs, Managers, and Admins)
  const canAddComplaint =
    currentUser.role === 'account_manager' ||
    currentUser.role === 'manager' ||
    currentUser.role === 'admin';

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
          {/* Manager View Scope Filter: All, Received, Sent */}
          {currentUser.role === 'manager' && (
            <div className="header-filter-group">
              <label htmlFor="filter-view-scope" className="header-filter-label">
                View
              </label>
              <select
                id="filter-view-scope"
                className="header-filter-select"
                value={managerViewType}
                onChange={(e) => setManagerViewType(e.target.value as ManagerViewScope)}
                title="Filter complaints by role: Received (Assigned to you) or Sent (Sent by you)"
              >
                <option value="ALL">All Complaints</option>
                <option value="RECEIVED">Received (Assigned)</option>
                <option value="SENT">Sent (By Me)</option>
              </select>
            </div>
          )}

          {/* Sender Filter: shown for Managers & Admin */}
          {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
            <div className="header-filter-group">
              <label htmlFor="filter-sender" className="header-filter-label">
                From
              </label>
              <select
                id="filter-sender"
                className="header-filter-select"
                value={filterSenderId}
                onChange={(e) => setFilterSenderId(e.target.value)}
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

          {/* Assigned Manager Filter: shown for all roles */}
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

          {/* Status Filter */}
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

          {/* Add Complaint Button: available for Managers & Account Managers */}
          {canAddComplaint && (
            <button
              type="button"
              className="header-add-btn"
              onClick={handleOpenCreateModal}
              title="Submit a new complaint to a manager"
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
                <th>From (Sender)</th>
                <th>Assigned Mgr</th>
                <th>Complaint</th>
                <th>Manager Remark</th>
                <th className="th-center">Mgr Done</th>
                <th>Sender Remark</th>
                <th className="th-center">Sender Done</th>
                <th className="th-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredComplaints.map((item) => {
                const completed = isComplaintDone(item);
                const delayed = isComplaintDelayed(item, nowMs);
                const managerOnlyChecked = item.managerDone && !item.accountManagerDone;
                const isRowSaving = savingComplaintId === item.complaintId;

                const isSender = currentUser.id === item.accountManagerId;
                const isAssignedManager = currentUser.id === item.managerId;
                const isAdmin = currentUser.role === 'admin';

                const canEditComplaintText = isSender || isAdmin;
                const canEditMgrRemark = isAssignedManager || isAdmin;
                const canToggleMgrDone = (isAssignedManager || isAdmin) && !isRowSaving;
                const canEditSenderRemark = isSender || isAdmin;

                const senderCannotCheckYet =
                  !item.managerDone && !item.accountManagerDone;
                const isSenderCheckboxDisabled =
                  !(isSender || isAdmin) ||
                  isRowSaving ||
                  senderCannotCheckYet;

                const senderRoleBadge = getSenderRoleBadge(item.accountManagerId);

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

                    {/* Sender Cell */}
                    <td className="td-person">
                      <div className="person-cell-wrapper">
                        <span>{item.accountManagerName}</span>
                        {senderRoleBadge && (
                          <span
                            className={`person-role-tag person-role-tag--${senderRoleBadge.toLowerCase()}`}
                          >
                            {senderRoleBadge}
                          </span>
                        )}
                        {isSender && (
                          <span className="person-self-tag">(You)</span>
                        )}
                      </div>
                    </td>

                    {/* Assigned Manager Cell */}
                    <td className="td-person">
                      <div className="person-cell-wrapper">
                        <span>{item.managerName}</span>
                        {isAssignedManager && (
                          <span className="person-self-tag">(You)</span>
                        )}
                      </div>
                    </td>

                    {/* Complaint Text */}
                    <td className="td-complaint-text">
                      {canEditComplaintText &&
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
                          {canEditComplaintText && (
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

                    {/* Manager Remark */}
                    <td className="td-remark">
                      {canEditMgrRemark ? (
                        editingMgrRemarkId === item.complaintId ? (
                          <div className="inline-edit-box">
                            <textarea
                              rows={2}
                              value={mgrRemarkDraft}
                              onChange={(e) => setMgrRemarkDraft(e.target.value)}
                              placeholder="Manager remark..."
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

                    {/* Manager Done Checkbox */}
                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.managerDone ? 'check-button-label--checked' : ''
                        } ${
                          !canToggleMgrDone ? 'check-button-label--readonly' : ''
                        }`}
                        title={
                          !isAssignedManager && !isAdmin
                            ? `Only assigned manager (${item.managerName}) can mark Manager Done`
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={item.managerDone}
                          disabled={!canToggleMgrDone}
                          onChange={() => handleToggleManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    {/* Sender Remark (accountManagerRemark) */}
                    <td className="td-remark">
                      {canEditSenderRemark ? (
                        editingSenderRemarkId === item.complaintId ? (
                          <div className="inline-edit-box">
                            <textarea
                              rows={2}
                              value={senderRemarkDraft}
                              onChange={(e) => setSenderRemarkDraft(e.target.value)}
                              placeholder="Sender remark..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveSenderRemark(item.complaintId)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-inline-cancel"
                                onClick={() => setEditingSenderRemarkId(null)}
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
                              onClick={() => startEditSenderRemark(item)}
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

                    {/* Sender Done Checkbox (accountManagerDone) */}
                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.accountManagerDone ? 'check-button-label--checked' : ''
                        } ${
                          isSenderCheckboxDisabled ? 'check-button-label--readonly' : ''
                        }`}
                        title={
                          !(isSender || isAdmin)
                            ? `Only sender (${item.accountManagerName}) can mark verified completion`
                            : senderCannotCheckYet
                            ? 'Assigned Manager must mark Done before you can verify & complete'
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={item.accountManagerDone}
                          disabled={isSenderCheckboxDisabled}
                          onChange={() => handleToggleSenderDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    {/* Status Cell */}
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
                  <td colSpan={10} className="empty-complaints-cell">
                    No complaints match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* New Complaint Modal - available to Managers and Account Managers */}
      {showCreateModal && (
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
              <div className="modal-header-text">
                <h3 id="create-complaint-modal-title">New Complaint</h3>
                <span className="modal-sender-badge">
                  From: <strong>{currentUser.name}</strong> ({currentUser.roleLabel})
                </span>
              </div>
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
                <label htmlFor="select-manager">Send Complaint To (Manager)</label>
                <select
                  id="select-manager"
                  value={selectedManagerId}
                  onChange={(e) => setSelectedManagerId(e.target.value)}
                  required
                >
                  {targetManagersForCreation.map((mgr) => (
                    <option key={mgr.id} value={mgr.id}>
                      {mgr.name} ({mgr.email})
                    </option>
                  ))}
                </select>
                {/* <span className="form-helper-text">
                  Anyone submitting a complaint can only send it to managers.
                </span> */}
              </div>

              <div className="cp-form-group">
                <label htmlFor="write-complaint">Complaint Details</label>
                <textarea
                  id="write-complaint"
                  rows={8}
                  placeholder="Describe the complaint in detail..."
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
                  {isSubmittingNew ? 'Submitting...' : 'Submit Complaint'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mandatory Solution Remark Modal (Director Policy) */}
      {remarkModalComplaint && (
        <div
          className="modal-backdrop"
          onClick={() => setRemarkModalComplaint(null)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mandatory-remark-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="mandatory-remark-modal-title">Solution Remark Required</h3>
                <span className="modal-sender-badge">
                  Complaint: <strong>{remarkModalComplaint.complaintId}</strong> &bull; Assigned to: <strong>{remarkModalComplaint.managerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRemarkModalComplaint(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="modal-form" onSubmit={handleConfirmRemarkAndDone}>
              {/* <div
                style={{
                  background: 'rgba(214, 116, 43, 0.08)',
                  border: '1px solid rgba(214, 116, 43, 0.3)',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  fontSize: '0.86rem',
                  color: 'var(--c-russet, #844918)',
                  lineHeight: '1.45',
                }}
              >
                <strong>Director Policy:</strong> Managers cannot mark complaints as Done without explaining the resolution or actions taken.
              </div> */}

              <div className="cp-form-group">
                <label htmlFor="mandatory-remark-input">Solution / Resolution Notes *</label>
                <textarea
                  id="mandatory-remark-input"
                  rows={4}
                  placeholder="Explain what steps were taken to fix this issue or reference ticket details..."
                  value={mandatoryRemarkDraft}
                  onChange={(e) => {
                    setMandatoryRemarkDraft(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
                  autoFocus
                  required
                />
                {remarkError && (
                  <span style={{ color: '#dc2626', fontSize: '0.82rem', fontWeight: 600 }}>
                    {remarkError}
                  </span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRemarkModalComplaint(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Remark &amp; Mark Done
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
