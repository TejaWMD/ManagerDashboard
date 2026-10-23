import React, { useEffect, useMemo, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Query,
  isQueryDelayed,
  isQueryDone,
  isQueryPending,
  sortQueriesByStatusAndTimestamp,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './QueryPage.css';

interface QueryPageProps {
  currentUser: UserAccount;
  queries: Query[];
  savingQueryId: string | null;
  onCreateQuery: (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    queryTitle: string;
    queryText: string;
  }) => Promise<void>;
  onUpdateQuery: (
    queryId: string,
    updates: Partial<
      Pick<
        Query,
        | 'queryTitle'
        | 'queryText'
        | 'managerRemarkTitle'
        | 'managerRemark'
        | 'managerDone'
        | 'accountManagerRemarkTitle'
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

export const QueryPage: React.FC<QueryPageProps> = ({
  currentUser,
  queries,
  savingQueryId,
  onCreateQuery,
  onUpdateQuery,
}) => {
  // All potential senders (Account Managers + Managers)
  const senders = useMemo(
    () =>
      AUTHORIZED_USERS.filter(
        (u) => u.role === 'account_manager' || u.role === 'manager'
      ),
    []
  );

  // All managers (queries can ONLY be sent to managers)
  const managers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'manager'),
    []
  );

  // Available target managers when creating a new query
  // If currentUser is a manager, prioritize other managers so they send queries among themselves
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
  const [queryTitleInput, setQueryTitleInput] = useState<string>('');
  const [queryInput, setQueryInput] = useState<string>('');
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
  const [senderRemarkTitleDraft, setSenderRemarkTitleDraft] = useState<string>('');
  const [senderRemarkDraft, setSenderRemarkDraft] = useState<string>('');

  const [editingQueryTextId, setEditingQueryTextId] = useState<string | null>(null);
  const [queryTitleDraft, setQueryTitleDraft] = useState<string>('');
  const [queryTextDraft, setQueryTextDraft] = useState<string>('');

  const [editingMgrRemarkId, setEditingMgrRemarkId] = useState<string | null>(null);
  const [mgrRemarkTitleDraft, setMgrRemarkTitleDraft] = useState<string>('');
  const [mgrRemarkDraft, setMgrRemarkDraft] = useState<string>('');

  // Mandatory Solution Remark Modal state (Director Policy Requirement)
  const [remarkModalQuery, setRemarkModalQuery] = useState<Query | null>(null);
  const [mandatoryRemarkTitleDraft, setMandatoryRemarkTitleDraft] = useState<string>('');
  const [mandatoryRemarkDraft, setMandatoryRemarkDraft] = useState<string>('');
  const [remarkError, setRemarkError] = useState<string>('');

  // View Query Details Pop-up Modal state (for all users)
  const [viewingQuery, setViewingQuery] = useState<Query | null>(null);
  const activeViewingQuery = useMemo(() => {
    if (!viewingQuery) return null;
    return (
      queries.find((c) => c.queryId === viewingQuery.queryId) ||
      viewingQuery
    );
  }, [queries, viewingQuery]);

  // 1. Role-scoped queries
  // Account Managers see queries they created.
  // Managers see queries assigned to them AND queries they sent among themselves.
  // Admin sees all queries.
  const roleScopedQueries = useMemo(() => {
    return queries.filter((c) => {
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
  }, [queries, currentUser]);

  // 2. Apply header filters & automatic status + timestamp sorting
  const sortedAndFilteredQueries = useMemo(() => {
    const selectedSenderObj = senders.find((s) => s.id === filterSenderId);
    const selectedMgrObj = managers.find((m) => m.id === filterManagerId);

    const filtered = roleScopedQueries.filter((c) => {
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
        const done = isQueryDone(c);
        const delayed = isQueryDelayed(c, nowMs);
        const pendingUnder48h = isQueryPending(c, nowMs);

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

    return sortQueriesByStatusAndTimestamp(filtered, timestampOrder);
  }, [
    roleScopedQueries,
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
    if (
      !selectedManagerId ||
      !queryTitleInput.trim() ||
      !queryInput.trim() ||
      isSubmittingNew
    ) {
      return;
    }

    const targetManager = managers.find((m) => m.id === selectedManagerId);
    if (!targetManager) return;

    setIsSubmittingNew(true);
    try {
      await onCreateQuery({
        managerId: targetManager.id,
        managerEmail: targetManager.email,
        managerName: targetManager.name,
        queryTitle: queryTitleInput.trim(),
        queryText: queryInput.trim(),
      });

      setQueryTitleInput('');
      setQueryInput('');
      setShowCreateModal(false);
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const startEditSenderRemark = (item: Query) => {
    setEditingSenderRemarkId(item.queryId);
    setSenderRemarkTitleDraft(item.accountManagerRemarkTitle || '');
    setSenderRemarkDraft(item.accountManagerRemark || '');
  };

  const saveSenderRemark = async (queryId: string) => {
    await onUpdateQuery(queryId, {
      accountManagerRemarkTitle: senderRemarkTitleDraft.trim(),
      accountManagerRemark: senderRemarkDraft.trim(),
    });
    setEditingSenderRemarkId(null);
    setSenderRemarkTitleDraft('');
    setSenderRemarkDraft('');
  };

  const startEditQueryText = (item: Query) => {
    setEditingQueryTextId(item.queryId);
    setQueryTitleDraft(item.queryTitle || item.queryText || '');
    setQueryTextDraft(item.queryText || '');
  };

  const saveQueryText = async (queryId: string) => {
    const trimmedTitle = queryTitleDraft.trim();
    const trimmedDesc = queryTextDraft.trim();
    if (!trimmedTitle && !trimmedDesc) return;
    await onUpdateQuery(queryId, {
      queryTitle: trimmedTitle || trimmedDesc,
      queryText: trimmedDesc,
    });
    setEditingQueryTextId(null);
    setQueryTitleDraft('');
    setQueryTextDraft('');
  };

  const startEditMgrRemark = (item: Query) => {
    setEditingMgrRemarkId(item.queryId);
    setMgrRemarkTitleDraft(item.managerRemarkTitle || '');
    setMgrRemarkDraft(item.managerRemark || '');
  };

  const saveMgrRemark = async (queryId: string) => {
    await onUpdateQuery(queryId, {
      managerRemarkTitle: mgrRemarkTitleDraft.trim(),
      managerRemark: mgrRemarkDraft.trim(),
    });
    setEditingMgrRemarkId(null);
    setMgrRemarkTitleDraft('');
    setMgrRemarkDraft('');
  };

  const handleToggleManagerDone = async (item: Query) => {
    // Only assigned manager or admin can toggle Manager Done
    const isAssigned = item.managerId === currentUser.id;
    if (!isAssigned && currentUser.role !== 'admin') return;

    const nextManagerDone = !item.managerDone;

    // Director policy: Mandatory Solution Remark before marking Done
    const hasExistingMgrRemark = Boolean(
      (item.managerRemarkTitle && item.managerRemarkTitle.trim()) ||
        (item.managerRemark && item.managerRemark.trim())
    );
    if (nextManagerDone && !hasExistingMgrRemark) {
      setRemarkModalQuery(item);
      setMandatoryRemarkTitleDraft('');
      setMandatoryRemarkDraft('');
      setRemarkError('');
      return;
    }

    await onUpdateQuery(item.queryId, {
      managerDone: nextManagerDone,
      // If manager unchecks their box, also reset sender verification so sender only checks when resolved
      ...(!nextManagerDone && item.accountManagerDone
        ? { accountManagerDone: false }
        : {}),
    });
  };

  const handleConfirmRemarkAndDone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!remarkModalQuery) return;
    const trimmedTitle = mandatoryRemarkTitleDraft.trim();
    const trimmedDesc = mandatoryRemarkDraft.trim();
    if (!trimmedTitle && !trimmedDesc) {
      setRemarkError('A solution remark title and description are required before marking Done.');
      return;
    }
    await onUpdateQuery(remarkModalQuery.queryId, {
      managerRemarkTitle: trimmedTitle || trimmedDesc,
      managerRemark: trimmedDesc,
      managerDone: true,
    });
    setRemarkModalQuery(null);
    setMandatoryRemarkTitleDraft('');
    setMandatoryRemarkDraft('');
    setRemarkError('');
  };

  const handleToggleSenderDone = async (item: Query) => {
    // Only the creator/sender or admin can toggle Sender Done
    const isSender = item.accountManagerId === currentUser.id;
    if (!isSender && currentUser.role !== 'admin') return;

    // Sender will only check the box once the query is completed by assigned manager
    if (!item.accountManagerDone && !item.managerDone) return;

    await onUpdateQuery(item.queryId, {
      accountManagerDone: !item.accountManagerDone,
    });
  };

  // Helper to get role badge for sender
  const getSenderRoleBadge = (senderId: string) => {
    const userMatch = AUTHORIZED_USERS.find((u) => u.id === senderId);
    if (!userMatch) return null;
    return userMatch.role === 'manager' ? 'Mgr' : userMatch.role === 'account_manager' ? 'AM' : 'Admin';
  };

  // Can current user add a query? (AMs, Managers, and Admins)
  const canAddQuery =
    currentUser.role === 'account_manager' ||
    currentUser.role === 'manager' ||
    currentUser.role === 'admin';

  return (
    <div className="query-page-container">
      <header className="query-page-header">
        <div className="query-header-title-group">
          <h1 className="query-page-title">Queries</h1>
          <span className="query-count-pill">
            {sortedAndFilteredQueries.length} / {roleScopedQueries.length}
          </span>
        </div>

        <div className="query-header-controls">
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
                title="Filter queries by role: Received (Assigned to you) or Sent (Sent by you)"
              >
                <option value="ALL">All Queries</option>
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

          {/* Add Query Button: available for Managers & Account Managers */}
          {canAddQuery && (
            <button
              type="button"
              className="header-add-btn"
              onClick={handleOpenCreateModal}
              title="Submit a new query to a manager"
            >
              + Add Query
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

      <section className="queries-table-card">
        <div className="queries-table-wrapper">
          <table className="queries-table">
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
                <th>Query</th>
                <th>Manager Remark</th>
                <th className="th-center">Mgr Done</th>
                <th>Sender Remark</th>
                <th className="th-center">Sender Done</th>
                <th className="th-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredQueries.map((item) => {
                const completed = isQueryDone(item);
                const delayed = isQueryDelayed(item, nowMs);
                const managerOnlyChecked = item.managerDone && !item.accountManagerDone;
                const isRowSaving = savingQueryId === item.queryId;

                const isSender = currentUser.id === item.accountManagerId;
                const isAssignedManager = currentUser.id === item.managerId;
                const isAdmin = currentUser.role === 'admin';

                const canEditQueryText = isSender;
                const canEditMgrRemark = isAssignedManager;
                const canToggleMgrDone = (isAssignedManager) && !isRowSaving;
                const canEditSenderRemark = isSender;

                const senderCannotCheckYet =
                  !item.managerDone && !item.accountManagerDone;
                const isSenderCheckboxDisabled =
                  !(isSender) ||
                  isRowSaving ||
                  senderCannotCheckYet;

                const senderRoleBadge = getSenderRoleBadge(item.accountManagerId);

                const rowStateClass = completed
                  ? 'row-completed'
                  : managerOnlyChecked
                  ? 'row-manager-done'
                  : 'row-unchecked';

                return (
                  <tr
                    key={item.queryId}
                    className={`${rowStateClass} query-row-clickable`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.closest(
                          'button, input, textarea, select, label, .inline-edit-box'
                        )
                      ) {
                        return;
                      }
                      setViewingQuery(item);
                    }}
                    title="Click to view query details"
                  >
                    <td className="td-timestamp">{item.createdAt}</td>

                    <td className="td-query-id">
                      <span
                        className="query-id-badge query-id-badge--clickable"
                        onClick={() => setViewingQuery(item)}
                      >
                        {item.queryId}
                      </span>
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

                    {/* Query Text */}
                    <td className="td-query-text">
                      {canEditQueryText &&
                      editingQueryTextId === item.queryId ? (
                        <div className="inline-edit-box">
                          <input
                            type="text"
                            className="inline-edit-title-input"
                            value={queryTitleDraft}
                            onChange={(e) => setQueryTitleDraft(e.target.value)}
                            placeholder="Query title..."
                          />
                          <textarea
                            rows={2}
                            value={queryTextDraft}
                            onChange={(e) => setQueryTextDraft(e.target.value)}
                            placeholder="Query description..."
                          />
                          <div className="inline-edit-actions">
                            <button
                              type="button"
                              className="btn-inline-save"
                              disabled={isRowSaving}
                              onClick={() => saveQueryText(item.queryId)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-inline-cancel"
                              onClick={() => setEditingQueryTextId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="remark-display-row">
                          <p
                            className="query-body-text query-body-text--clickable"
                            onClick={() => setViewingQuery(item)}
                          >
                            {item.queryTitle || item.queryText}
                          </p>
                          {canEditQueryText && (
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditQueryText(item)}
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
                        editingMgrRemarkId === item.queryId ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              className="inline-edit-title-input"
                              value={mgrRemarkTitleDraft}
                              onChange={(e) => setMgrRemarkTitleDraft(e.target.value)}
                              placeholder="Remark title..."
                            />
                            <textarea
                              rows={2}
                              value={mgrRemarkDraft}
                              onChange={(e) => setMgrRemarkDraft(e.target.value)}
                              placeholder="Remark description..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveMgrRemark(item.queryId)}
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
                                item.managerRemarkTitle || item.managerRemark
                                  ? 'remark-value query-body-text--clickable'
                                  : 'remark-placeholder'
                              }
                              onClick={() => setViewingQuery(item)}
                            >
                              {item.managerRemarkTitle || item.managerRemark || '—'}
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
                            item.managerRemarkTitle || item.managerRemark
                              ? 'remark-value query-body-text--clickable'
                              : 'remark-placeholder'
                          }
                          onClick={() => setViewingQuery(item)}
                        >
                          {item.managerRemarkTitle || item.managerRemark || '—'}
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
                          !isAssignedManager
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
                        editingSenderRemarkId === item.queryId ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              className="inline-edit-title-input"
                              value={senderRemarkTitleDraft}
                              onChange={(e) => setSenderRemarkTitleDraft(e.target.value)}
                              placeholder="Remark title..."
                            />
                            <textarea
                              rows={2}
                              value={senderRemarkDraft}
                              onChange={(e) => setSenderRemarkDraft(e.target.value)}
                              placeholder="Remark description..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveSenderRemark(item.queryId)}
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
                                item.accountManagerRemarkTitle || item.accountManagerRemark
                                  ? 'remark-value query-body-text--clickable'
                                  : 'remark-placeholder'
                              }
                              onClick={() => setViewingQuery(item)}
                            >
                              {item.accountManagerRemarkTitle ||
                                item.accountManagerRemark ||
                                '—'}
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
                            item.accountManagerRemarkTitle || item.accountManagerRemark
                              ? 'remark-value query-body-text--clickable'
                              : 'remark-placeholder'
                          }
                          onClick={() => setViewingQuery(item)}
                        >
                          {item.accountManagerRemarkTitle ||
                            item.accountManagerRemark ||
                            '—'}
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
                          !(isSender)
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

              {sortedAndFilteredQueries.length === 0 && (
                <tr>
                  <td colSpan={10} className="empty-queries-cell">
                    No queries match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* New Query Modal - available to Managers and Account Managers */}
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
            aria-labelledby="create-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="create-query-modal-title">New Query</h3>
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
                <label htmlFor="select-manager">Send Query To (Manager)</label>
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
                  Anyone submitting a query can only send it to managers.
                </span> */}
              </div>

              <div className="cp-form-group">
                <label htmlFor="query-title-input">Query Title</label>
                <input
                  id="query-title-input"
                  type="text"
                  placeholder="Enter a short title for the query..."
                  value={queryTitleInput}
                  onChange={(e) => setQueryTitleInput(e.target.value)}
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="write-query">Query Description</label>
                <textarea
                  id="write-query"
                  rows={6}
                  placeholder="Describe the query in detail..."
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
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
                  {isSubmittingNew ? 'Submitting...' : 'Submit Query'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mandatory Solution Remark Modal (Director Policy) */}
      {remarkModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setRemarkModalQuery(null)}
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
                  Query: <strong>{remarkModalQuery.queryId}</strong> &bull; Assigned to: <strong>{remarkModalQuery.managerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRemarkModalQuery(null)}
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
                <strong>Director Policy:</strong> Managers cannot mark queries as Done without explaining the resolution or actions taken.
              </div> */}

              <div className="cp-form-group">
                <label htmlFor="mandatory-remark-title-input">Remark Title *</label>
                <input
                  id="mandatory-remark-title-input"
                  type="text"
                  placeholder="Enter a short title for the solution remark..."
                  value={mandatoryRemarkTitleDraft}
                  onChange={(e) => {
                    setMandatoryRemarkTitleDraft(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
                  autoFocus
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="mandatory-remark-input">Solution / Resolution Description *</label>
                <textarea
                  id="mandatory-remark-input"
                  rows={4}
                  placeholder="Explain what steps were taken to fix this issue or reference ticket details..."
                  value={mandatoryRemarkDraft}
                  onChange={(e) => {
                    setMandatoryRemarkDraft(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
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
                  onClick={() => setRemarkModalQuery(null)}
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

      {/* View Query Details Pop-up Modal (for all users) */}
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
            aria-labelledby="view-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <div className="query-view-title-row">
                  <h3 id="view-query-modal-title">
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
                    {getSenderRoleBadge(activeViewingQuery.accountManagerId) && (
                      <span
                        className={`person-role-tag person-role-tag--${getSenderRoleBadge(
                          activeViewingQuery.accountManagerId
                        )!.toLowerCase()}`}
                      >
                        {getSenderRoleBadge(activeViewingQuery.accountManagerId)}
                      </span>
                    )}
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
