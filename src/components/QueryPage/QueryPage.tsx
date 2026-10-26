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
        | 'rating'
        | 'targetDueAt'
        | 'targetDueAtMs'
        | 'extensionStatus'
        | 'extensionRequestedAt'
        | 'extensionProposedDueAt'
        | 'extensionProposedDueAtMs'
        | 'extensionReason'
        | 'extensionReviewNote'
        | 'extensionReviewedAt'
        | 'isDelayed'
      >
    >
  ) => Promise<void>;
}

type StatusFilterValue =
  | 'ALL'
  | 'Pending'
  | 'ExtensionPending'
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

  // Rating modal states
  const [ratingModalQuery, setRatingModalQuery] = useState<Query | null>(null);
  const [ratingInput, setRatingInput] = useState<number>(0);
  const [ratingHover, setRatingHover] = useState<number>(0);
  const [ratingModalCompleteOnSubmit, setRatingModalCompleteOnSubmit] = useState<boolean>(false);

  // Mandatory Solution Remark Modal state (Director Policy Requirement)
  const [remarkModalQuery, setRemarkModalQuery] = useState<Query | null>(null);
  const [mandatoryRemarkTitleDraft, setMandatoryRemarkTitleDraft] = useState<string>('');
  const [mandatoryRemarkDraft, setMandatoryRemarkDraft] = useState<string>('');
  const [remarkError, setRemarkError] = useState<string>('');

  // Completion Extension Modal states (for Manager requesting extra time)
  const [extensionModalQuery, setExtensionModalQuery] = useState<Query | null>(null);
  const [extensionProposedDateInput, setExtensionProposedDateInput] = useState<string>('');
  const [extensionReasonInput, setExtensionReasonInput] = useState<string>('');
  const [extensionError, setExtensionError] = useState<string>('');
  const [isSubmittingExtension, setIsSubmittingExtension] = useState<boolean>(false);

  // Review Extension Modal states (for Sender AM or Admin approving/declining)
  const [extensionReviewModalQuery, setExtensionReviewModalQuery] = useState<Query | null>(null);
  const [extensionReviewNoteInput, setExtensionReviewNoteInput] = useState<string>('');
  const [isReviewingExtension, setIsReviewingExtension] = useState<boolean>(false);

  const formatTimestamp = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
  };

  const openExtensionModal = (query: Query) => {
    // Default proposed date to 3 days from now at 18:00
    const defaultDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    defaultDate.setHours(18, 0, 0, 0);
    const yyyy = defaultDate.getFullYear();
    const mm = String(defaultDate.getMonth() + 1).padStart(2, '0');
    const dd = String(defaultDate.getDate()).padStart(2, '0');
    const hh = String(defaultDate.getHours()).padStart(2, '0');
    const min = String(defaultDate.getMinutes()).padStart(2, '0');

    setExtensionProposedDateInput(`${yyyy}-${mm}-${dd}T${hh}:${min}`);
    setExtensionReasonInput('');
    setExtensionError('');
    setExtensionModalQuery(query);
  };

  const handleSubmitExtensionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extensionModalQuery) return;
    if (!extensionProposedDateInput) {
      setExtensionError('Please pick a proposed completion date & time.');
      return;
    }
    const proposedMs = Date.parse(extensionProposedDateInput);
    if (Number.isNaN(proposedMs) || proposedMs <= Date.now()) {
      setExtensionError('Proposed completion date must be in the future.');
      return;
    }
    const cleanReason = extensionReasonInput.trim();
    if (cleanReason.length < 5) {
      setExtensionError('Please explain why extra time is needed (min 5 chars).');
      return;
    }

    const proposedTimestamp = extensionProposedDateInput.replace('T', ' ') + ':00';
    const nowTimestamp = formatTimestamp(new Date());

    setIsSubmittingExtension(true);
    try {
      await onUpdateQuery(extensionModalQuery.queryId, {
        extensionStatus: 'PENDING',
        extensionRequestedAt: nowTimestamp,
        extensionProposedDueAt: proposedTimestamp,
        extensionProposedDueAtMs: proposedMs,
        extensionReason: cleanReason,
      });
      setExtensionModalQuery(null);
      setExtensionReasonInput('');
      setExtensionProposedDateInput('');
      setExtensionError('');
    } finally {
      setIsSubmittingExtension(false);
    }
  };

  const handleApproveExtension = async (query: Query) => {
    if (!query.extensionProposedDueAtMs || !query.extensionProposedDueAt) return;
    setIsReviewingExtension(true);
    try {
      const nowTimestamp = formatTimestamp(new Date());
      await onUpdateQuery(query.queryId, {
        extensionStatus: 'APPROVED',
        targetDueAt: query.extensionProposedDueAt,
        targetDueAtMs: query.extensionProposedDueAtMs,
        extensionReviewedAt: nowTimestamp,
        isDelayed: false,
      });
      setExtensionReviewModalQuery(null);
    } finally {
      setIsReviewingExtension(false);
    }
  };

  const handleDeclineExtension = async (query: Query) => {
    setIsReviewingExtension(true);
    try {
      const nowTimestamp = formatTimestamp(new Date());
      await onUpdateQuery(query.queryId, {
        extensionStatus: 'DECLINED',
        extensionReviewNote: extensionReviewNoteInput.trim() || 'Declined by sender',
        extensionReviewedAt: nowTimestamp,
      });
      setExtensionReviewModalQuery(null);
      setExtensionReviewNoteInput('');
    } finally {
      setIsReviewingExtension(false);
    }
  };

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
        if (filterStatus === 'ExtensionPending' && c.extensionStatus !== 'PENDING') return false;
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

    // If sender is marking Done and has not rated yet, enforce mandatory rating
    if (!item.accountManagerDone && (!item.rating || item.rating < 1)) {
      setRatingModalQuery(item);
      setRatingInput(0);
      setRatingHover(0);
      setRatingModalCompleteOnSubmit(true);
      return;
    }

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
              <option value="Pending">Pending (On Track)</option>
              <option value="ExtensionPending">Extension Requested ⏳</option>
              <option value="Unchecked">Unchecked</option>
              <option value="ManagerDone">Manager Checked</option>
              <option value="Delayed">Delayed (Overdue)</option>
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
                <th className="th-center">Rating</th>
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

                    {/* Rating Cell */}
                    <td className="td-rating th-center">
                      {isAdmin ? (
                        item.rating ? (
                          <span
                            className="rating-badge rating-badge--admin"
                            title={`Rated ${item.rating}/5 stars by sender (${item.accountManagerName})`}
                          >
                            <span className="rating-stars-gold">
                              {'★'.repeat(item.rating)}
                              <span className="rating-stars-dim">{'★'.repeat(5 - item.rating)}</span>
                            </span>
                            <span className="rating-score-num">{item.rating}/5</span>
                          </span>
                        ) : (
                          <span className="rating-placeholder">—</span>
                        )
                      ) : isSender ? (
                        item.rating ? (
                          <button
                            type="button"
                            className="rating-badge rating-badge--sender"
                            onClick={() => {
                              setRatingModalQuery(item);
                              setRatingInput(item.rating || 0);
                              setRatingHover(0);
                              setRatingModalCompleteOnSubmit(false);
                            }}
                            title="Click to change your rating (can be updated anytime)"
                          >
                            <span className="rating-stars-gold">
                              {'★'.repeat(item.rating)}
                              <span className="rating-stars-dim">{'★'.repeat(5 - item.rating)}</span>
                            </span>
                            <span className="rating-score-num">{item.rating}/5</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-rate-prompt"
                            onClick={() => {
                              setRatingModalQuery(item);
                              setRatingInput(0);
                              setRatingHover(0);
                              setRatingModalCompleteOnSubmit(false);
                            }}
                            title="Click to rate the receiving manager (available anytime, can be updated later)"
                          >
                            ★ Rate
                          </button>
                        )
                      ) : (
                        /* Receiving Manager or other users CANNOT see individual ratings (Strict Anonymity) */
                        <span className="rating-placeholder">—</span>
                      )}
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

                        {item.extensionStatus === 'PENDING' && (
                          <span
                            className="table-status-pill table-status-pill--ext-pending"
                            title={`Extension requested until ${item.extensionProposedDueAt || 'new date'}: "${item.extensionReason || ''}"`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isSender || isAdmin) {
                                setExtensionReviewModalQuery(item);
                              } else {
                                setViewingQuery(item);
                              }
                            }}
                          >
                            ⏳ Ext Req
                          </span>
                        )}
                        {item.extensionStatus === 'APPROVED' && (
                          <span
                            className="table-status-pill table-status-pill--ext-approved"
                            title={`Completion deadline extended to ${item.targetDueAt || ''}`}
                          >
                            Extended
                          </span>
                        )}
                      </div>

                      {/* Quick contextual extension actions */}
                      {item.extensionStatus === 'PENDING' && (isSender || isAdmin) ? (
                        <button
                          type="button"
                          className="table-action-pill-btn table-action-pill-btn--review"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExtensionReviewModalQuery(item);
                          }}
                          title="Click to review and approve/decline this extension request"
                        >
                          Review Ext ⏳
                        </button>
                      ) : !completed &&
                        item.extensionStatus !== 'PENDING' &&
                        (isAssignedManager || isAdmin) ? (
                        <button
                          type="button"
                          className="table-action-link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openExtensionModal(item);
                          }}
                          title="Request completion date extension"
                        >
                          + Extend
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}

              {sortedAndFilteredQueries.length === 0 && (
                <tr>
                  <td colSpan={11} className="empty-queries-cell">
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

                    {activeViewingQuery.extensionStatus === 'PENDING' && (
                      <span className="table-status-pill table-status-pill--ext-pending">
                        ⏳ Ext Req
                      </span>
                    )}
                    {activeViewingQuery.extensionStatus === 'APPROVED' && (
                      <span className="table-status-pill table-status-pill--ext-approved">
                        Extended
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

              {/* Target Completion & Extension Management */}
              <div className="query-view-section query-view-section--extension">
                <div className="query-view-section-header">
                  <span className="query-view-section-label">Target Completion</span>
                  <span className="query-view-due-text">
                    {activeViewingQuery.targetDueAt ? (
                      <>
                        <strong>{activeViewingQuery.targetDueAt}</strong>{' '}
                        <span className="pill-extended-badge">Extended</span>
                      </>
                    ) : (
                      <>Standard: 48 hours from creation</>
                    )}
                  </span>
                </div>

                {activeViewingQuery.extensionStatus === 'PENDING' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--pending">
                    <div className="ext-banner-top">
                      <span className="ext-banner-title">
                        ⏳ Extension Requested by Manager {activeViewingQuery.managerName}
                      </span>
                      <span className="ext-proposed-pill">
                        Proposed: {activeViewingQuery.extensionProposedDueAt || '—'}
                      </span>
                    </div>
                    <p className="ext-banner-reason">
                      <strong>Reason:</strong> {activeViewingQuery.extensionReason || '—'}
                    </p>
                    {(currentUser.id === activeViewingQuery.accountManagerId || currentUser.role === 'admin') && (
                      <div className="ext-banner-actions">
                        <button
                          type="button"
                          className="btn-approve-ext"
                          onClick={() => handleApproveExtension(activeViewingQuery)}
                          disabled={isReviewingExtension}
                        >
                          ✓ Approve Extension
                        </button>
                        <button
                          type="button"
                          className="btn-decline-ext"
                          onClick={() => {
                            setExtensionReviewModalQuery(activeViewingQuery);
                          }}
                          disabled={isReviewingExtension}
                        >
                          ✕ Decline
                        </button>
                      </div>
                    )}
                  </div>
                ) : activeViewingQuery.extensionStatus === 'APPROVED' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--approved">
                    <span>
                      ✅ <strong>Extension Approved</strong> to {activeViewingQuery.targetDueAt}.
                      {activeViewingQuery.extensionReason && (
                        <span className="ext-reason-note"> (Reason: {activeViewingQuery.extensionReason})</span>
                      )}
                    </span>
                  </div>
                ) : activeViewingQuery.extensionStatus === 'DECLINED' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--declined">
                    <span>
                      ❌ <strong>Extension Request Declined</strong>.
                      {activeViewingQuery.extensionReviewNote && (
                        <span className="ext-reason-note"> Note: {activeViewingQuery.extensionReviewNote}</span>
                      )}
                    </span>
                  </div>
                ) : null}

                {/* Allow Assigned Manager or Admin to request extension if not currently pending and not yet done */}
                {!isQueryDone(activeViewingQuery) &&
                  activeViewingQuery.extensionStatus !== 'PENDING' &&
                  (currentUser.id === activeViewingQuery.managerId || currentUser.role === 'admin') && (
                    <div className="ext-request-btn-row">
                      <button
                        type="button"
                        className="btn-request-ext"
                        onClick={() => openExtensionModal(activeViewingQuery)}
                      >
                        ⏳ Request Completion Date Extension
                      </button>
                    </div>
                  )}
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

              {/* Rating Section: strictly visible ONLY to Admin and the Sender (Hidden from Receiving Manager) */}
              {(currentUser.role === 'admin' ||
                currentUser.id === activeViewingQuery.accountManagerId) && (
                <div className="query-view-section query-view-section--rating">
                  <div className="query-view-section-header">
                    <span className="query-view-section-label">
                      {currentUser.role === 'admin' ? 'Sender Rating' : 'Your Rating'}
                    </span>
                  </div>
                  <div className="query-view-rating-card">
                    {activeViewingQuery.rating ? (
                      <div className="query-view-rating-display">
                        <span className="rating-stars-gold">
                          {'★'.repeat(activeViewingQuery.rating)}
                          <span className="rating-stars-dim">
                            {'★'.repeat(5 - activeViewingQuery.rating)}
                          </span>
                        </span>
                        <span className="query-view-rating-value">
                          {activeViewingQuery.rating} / 5 Stars
                        </span>
                        {currentUser.id === activeViewingQuery.accountManagerId && (
                          <button
                            type="button"
                            className="btn-inline-edit"
                            onClick={() => {
                              setRatingModalQuery(activeViewingQuery);
                              setRatingInput(activeViewingQuery.rating || 0);
                              setRatingHover(0);
                              setRatingModalCompleteOnSubmit(false);
                            }}
                          >
                            Change Rating
                          </button>
                        )}
                      </div>
                    ) : currentUser.id === activeViewingQuery.accountManagerId ? (
                      <div className="query-view-rating-prompt">
                        <span className="rating-pending-text">
                          You haven&apos;t rated this manager yet:
                        </span>
                        <button
                          type="button"
                          className="btn-rate-prompt"
                          onClick={() => {
                            setRatingModalQuery(activeViewingQuery);
                            setRatingInput(0);
                            setRatingHover(0);
                            setRatingModalCompleteOnSubmit(false);
                          }}
                        >
                          ★ Rate Manager (1-5 Stars)
                        </button>
                      </div>
                    ) : (
                      <span className="rating-placeholder">Not rated yet.</span>
                    )}
                  </div>
                </div>
              )}

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

      {/* Rating Modal: allows sender to rate anytime and enforce mandatory rating before completion */}
      {ratingModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setRatingModalQuery(null)}
        >
          <div
            className="modal-dialog rating-prompt-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rating-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="rating-modal-title">
                  Rate Manager: {ratingModalQuery.managerName}
                </h3>
                <span className="modal-subtitle">
                  Query {ratingModalQuery.queryId} &bull;{' '}
                  {ratingModalQuery.queryTitle ||
                    ratingModalQuery.queryText.slice(0, 35)}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRatingModalQuery(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="rating-modal-body">
              <p className="rating-modal-desc">
                {ratingModalCompleteOnSubmit ? (
                  <>
                    Please rate <strong>{ratingModalQuery.managerName}</strong>&apos;s
                    resolution to complete this query. Ratings are <em>anonymous</em> to the
                    manager and contribute to their overall KPI score.
                  </>
                ) : (
                  <>
                    Rate <strong>{ratingModalQuery.managerName}</strong> for this query.
                    You can update this rating at any time. Ratings are <em>anonymous</em> to
                    the manager and contribute to their overall KPI score.
                  </>
                )}
              </p>

              <div className="star-rating-picker" role="radiogroup" aria-label="Rating from 1 to 5 stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-pick-btn ${
                      (ratingHover || ratingInput) >= star
                        ? 'star-pick-btn--active'
                        : ''
                    }`}
                    onMouseEnter={() => setRatingHover(star)}
                    onMouseLeave={() => setRatingHover(0)}
                    onClick={() => setRatingInput(star)}
                    title={`${star} Star${star > 1 ? 's' : ''}`}
                    aria-label={`${star} Star${star > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="rating-score-label">
                {ratingInput > 0 ? (
                  <span className="rating-score-active">
                    ⭐ {ratingInput} of 5 Stars Selected
                  </span>
                ) : (
                  <span className="rating-score-hint">
                    Select 1 to 5 stars to proceed
                  </span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRatingModalQuery(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={ratingInput < 1 || savingQueryId === ratingModalQuery.queryId}
                  onClick={async () => {
                    if (ratingInput < 1) return;
                    if (ratingModalCompleteOnSubmit) {
                      await onUpdateQuery(ratingModalQuery.queryId, {
                        rating: ratingInput,
                        accountManagerDone: true,
                      });
                    } else {
                      await onUpdateQuery(ratingModalQuery.queryId, {
                        rating: ratingInput,
                      });
                    }
                    setRatingModalQuery(null);
                  }}
                >
                  {ratingModalCompleteOnSubmit
                    ? 'Submit Rating & Complete'
                    : ratingModalQuery.rating
                    ? 'Update Rating'
                    : 'Save Rating'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Extension Request Modal (for assigned manager) */}
      {extensionModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setExtensionModalQuery(null)}
        >
          <div
            className="modal-dialog extension-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="extension-modal-title">Request Completion Date Extension</h3>
                <span className="modal-sender-badge">
                  Query: <strong>{extensionModalQuery.queryId}</strong> &bull; Sender:{' '}
                  <strong>{extensionModalQuery.accountManagerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setExtensionModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="modal-form" onSubmit={handleSubmitExtensionRequest}>
              <div className="extension-modal-note">
                <strong>Peer Accountability:</strong> Your extension request will be sent to{' '}
                <strong>{extensionModalQuery.accountManagerName}</strong> for approval. If approved, the query&apos;s completion deadline will be extended and your completion rate will stay on-time!
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-proposed-date">Proposed New Completion Date &amp; Time *</label>
                <input
                  id="ext-proposed-date"
                  type="datetime-local"
                  value={extensionProposedDateInput}
                  onChange={(e) => {
                    setExtensionProposedDateInput(e.target.value);
                    if (extensionError) setExtensionError('');
                  }}
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-reason">Reason for Extension *</label>
                <textarea
                  id="ext-reason"
                  rows={4}
                  placeholder="Explain why extra time is needed (e.g. Waiting on bank statement, external vendor update, etc.)..."
                  value={extensionReasonInput}
                  onChange={(e) => {
                    setExtensionReasonInput(e.target.value);
                    if (extensionError) setExtensionError('');
                  }}
                  required
                />
                {extensionError && (
                  <span style={{ color: '#dc2626', fontSize: '0.82rem', fontWeight: 600 }}>
                    {extensionError}
                  </span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setExtensionModalQuery(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmittingExtension}
                >
                  {isSubmittingExtension ? 'Submitting...' : 'Send Request to Sender'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extension Review Modal (when sender or admin wants to decline or review) */}
      {extensionReviewModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setExtensionReviewModalQuery(null)}
        >
          <div
            className="modal-dialog extension-review-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-ext-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="review-ext-modal-title">Review Extension Request</h3>
                <span className="modal-sender-badge">
                  Query: <strong>{extensionReviewModalQuery.queryId}</strong> &bull; From Manager:{' '}
                  <strong>{extensionReviewModalQuery.managerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setExtensionReviewModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="extension-review-body">
              <div className="review-meta-item">
                <span className="review-meta-label">Proposed New Deadline:</span>
                <span className="review-meta-val highlight">
                  {extensionReviewModalQuery.extensionProposedDueAt || '—'}
                </span>
              </div>

              <div className="review-meta-item">
                <span className="review-meta-label">Manager's Reason:</span>
                <p className="review-reason-box">
                  "{extensionReviewModalQuery.extensionReason || 'No reason provided'}"
                </p>
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-decline-note">Note / Feedback (Optional if declining)</label>
                <input
                  id="ext-decline-note"
                  type="text"
                  placeholder="e.g. Please expedite by tomorrow instead..."
                  value={extensionReviewNoteInput}
                  onChange={(e) => setExtensionReviewNoteInput(e.target.value)}
                />
              </div>

              <div className="modal-actions modal-actions--split">
                <button
                  type="button"
                  className="btn-secondary btn-decline-action"
                  disabled={isReviewingExtension}
                  onClick={() => handleDeclineExtension(extensionReviewModalQuery)}
                >
                  ✕ Decline Request
                </button>
                <button
                  type="button"
                  className="btn-primary btn-approve-action"
                  disabled={isReviewingExtension}
                  onClick={() => handleApproveExtension(extensionReviewModalQuery)}
                >
                  {isReviewingExtension ? 'Processing...' : '✓ Approve Extension'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
