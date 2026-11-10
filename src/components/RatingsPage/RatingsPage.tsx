import React, { useState, useMemo } from 'react';
import { Query, UserAccount, UserRole } from '../../types';
import {
  calculateAllUsersRatingStats,
  calculateReceiverOverallRating,
  calculateSenderOverallRating,
  UserRatingStats,
} from '../../lib/ratingUtils';
import './RatingsPage.css';

interface RatingsPageProps {
  currentUser: UserAccount;
  allUsers: UserAccount[];
  queries: Query[];
  onUpdateQuery: (
    queryId: string,
    updates: {
      adminReceiverRating?: number | null;
      adminReceiverRemark?: string | null;
      adminReceiverRatedAt?: string | null;
      adminReceiverRatedAtMs?: number | null;
      adminSenderRating?: number | null;
      adminSenderRemark?: string | null;
      adminSenderRatedAt?: string | null;
      adminSenderRatedAtMs?: number | null;
    }
  ) => Promise<void>;
  savingQueryId?: string | null;
}

export const RatingsPage: React.FC<RatingsPageProps> = ({
  currentUser,
  allUsers,
  queries,
  onUpdateQuery,
  savingQueryId,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [selectedUserStats, setSelectedUserStats] = useState<UserRatingStats | null>(null);

  // Admin Rating Edit Modal state
  const [editingQuery, setEditingQuery] = useState<{
    query: Query;
    targetRole: 'receiver' | 'sender';
  } | null>(null);
  const [ratingInput, setRatingInput] = useState<number>(10);
  const [remarkInput, setRemarkInput] = useState<string>('');
  const [remarkError, setRemarkError] = useState<string>('');

  const nowMs = useMemo(() => Date.now(), []);

  // Compute all user rating statistics
  const userStats = useMemo(() => {
    return calculateAllUsersRatingStats(allUsers, queries, nowMs);
  }, [allUsers, queries, nowMs]);

  // Filtered users
  const filteredStats = useMemo(() => {
    return userStats.filter((stat) => {
      if (roleFilter !== 'all' && stat.user.role !== roleFilter) {
        return false;
      }
      if (searchTerm.trim() !== '') {
        const query = searchTerm.toLowerCase();
        const matchName = stat.user.name.toLowerCase().includes(query);
        const matchEmail = stat.user.email.toLowerCase().includes(query);
        const matchRole = (stat.user.roleLabel || stat.user.role).toLowerCase().includes(query);
        if (!matchName && !matchEmail && !matchRole) return false;
      }
      return true;
    });
  }, [userStats, roleFilter, searchTerm]);

  // Overall summary metrics
  const summaryMetrics = useMemo(() => {
    const validReceivers = userStats.filter((s) => s.avgReceiverRating !== null);
    const validSenders = userStats.filter((s) => s.avgSenderRating !== null);
    const validCombined = userStats.filter((s) => s.combinedAverageRating !== null);

    const teamReceiverAvg =
      validReceivers.length > 0
        ? Math.round(
            (validReceivers.reduce((acc, s) => acc + (s.avgReceiverRating || 0), 0) /
              validReceivers.length) *
              10
          ) / 10
        : null;

    const teamSenderAvg =
      validSenders.length > 0
        ? Math.round(
            (validSenders.reduce((acc, s) => acc + (s.avgSenderRating || 0), 0) /
              validSenders.length) *
              10
          ) / 10
        : null;

    const teamOverallAvg =
      validCombined.length > 0
        ? Math.round(
            (validCombined.reduce((acc, s) => acc + (s.combinedAverageRating || 0), 0) /
              validCombined.length) *
              10
          ) / 10
        : null;

    return {
      teamReceiverAvg,
      teamSenderAvg,
      teamOverallAvg,
      totalQueries: queries.length,
    };
  }, [userStats, queries]);

  // Open the Admin rating editor
  const handleOpenEditRating = (query: Query, targetRole: 'receiver' | 'sender') => {
    setEditingQuery({ query, targetRole });
    if (targetRole === 'receiver') {
      setRatingInput(query.adminReceiverRating ?? 10);
      setRemarkInput(query.adminReceiverRemark || 'Proper turnaround and communication');
    } else {
      setRatingInput(query.adminSenderRating ?? 10);
      setRemarkInput(query.adminSenderRemark || 'Prompt responses to queries and requests');
    }
    setRemarkError('');
  };

  // Submit Admin rating update
  const handleSaveAdminRating = async () => {
    if (!editingQuery) return;
    if (!remarkInput.trim()) {
      setRemarkError('Remark is mandatory for Admin ratings');
      return;
    }

    const now = new Date();
    const nowIso = now.toISOString().replace('T', ' ').substring(0, 19);
    const currentNowMs = now.getTime();

    if (editingQuery.targetRole === 'receiver') {
      await onUpdateQuery(editingQuery.query.queryId, {
        adminReceiverRating: ratingInput,
        adminReceiverRemark: remarkInput.trim(),
        adminReceiverRatedAt: nowIso,
        adminReceiverRatedAtMs: currentNowMs,
      });
    } else {
      await onUpdateQuery(editingQuery.query.queryId, {
        adminSenderRating: ratingInput,
        adminSenderRemark: remarkInput.trim(),
        adminSenderRatedAt: nowIso,
        adminSenderRatedAtMs: currentNowMs,
      });
    }

    setEditingQuery(null);
  };

  // Rating badge color helper
  const getScoreBadgeClass = (score: number | null) => {
    if (score === null) return '';
    if (score >= 8.5) return 'ratings-score-pill--high';
    if (score >= 6.0) return 'ratings-score-pill--medium';
    return 'ratings-score-pill--low';
  };

  // Queries related to selected user in modal
  const selectedUserQueries = useMemo(() => {
    if (!selectedUserStats) return [];
    const userId = selectedUserStats.user.id;
    const userEmail = selectedUserStats.user.email.toLowerCase().trim();

    return queries
      .filter((q) => {
        const isSender =
          q.accountManagerId === userId ||
          (q.accountManagerEmail || '').toLowerCase().trim() === userEmail;
        const isReceiver =
          q.managerId === userId ||
          (q.managerEmail || '').toLowerCase().trim() === userEmail;
        return isSender || isReceiver;
      })
      .map((q) => {
        const isSender =
          q.accountManagerId === userId ||
          (q.accountManagerEmail || '').toLowerCase().trim() === userEmail;
        const roleInQuery: 'Sender' | 'Receiving Manager' = isSender
          ? 'Sender'
          : 'Receiving Manager';
        const receiverBreakdown = calculateReceiverOverallRating(q, nowMs);
        const senderBreakdown = calculateSenderOverallRating(q, nowMs);

        return {
          query: q,
          roleInQuery,
          receiverBreakdown,
          senderBreakdown,
        };
      });
  }, [selectedUserStats, queries, nowMs]);

  if (currentUser.role !== 'admin') {
    return null;
  }

  return (
    <div className="ratings-page-container">
      {/* Header */}
      <div className="ratings-header-card">
        <div className="ratings-header-info">
          <h1>
            <span>⭐</span> Team Ratings & Performance Management
          </h1>
          
        </div>
      </div>


      {/* Filter and Search Bar */}
      <div className="ratings-controls-bar">
        <div className="ratings-search-wrap">
          <svg
            className="ratings-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="ratings-search-input"
            placeholder="Search by name, email or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="ratings-role-filters">
          <button
            type="button"
            className={`ratings-filter-pill ${
              roleFilter === 'all' ? 'ratings-filter-pill--active' : ''
            }`}
            onClick={() => setRoleFilter('all')}
          >
            All Members ({userStats.length})
          </button>
          <button
            type="button"
            className={`ratings-filter-pill ${
              roleFilter === 'manager' ? 'ratings-filter-pill--active' : ''
            }`}
            onClick={() => setRoleFilter('manager')}
          >
            Managers
          </button>
          <button
            type="button"
            className={`ratings-filter-pill ${
              roleFilter === 'account_manager' ? 'ratings-filter-pill--active' : ''
            }`}
            onClick={() => setRoleFilter('account_manager')}
          >
            Account Managers
          </button>
          <button
            type="button"
            className={`ratings-filter-pill ${
              roleFilter === 'admin' ? 'ratings-filter-pill--active' : ''
            }`}
            onClick={() => setRoleFilter('admin')}
          >
            Admins
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="ratings-table-card">
        <div className="ratings-table-wrapper">
          <table className="ratings-table">
            <thead>
              <tr>
                <th>Names</th>
                <th>Roles</th>
                <th className="th-center">Total Rating As Sender</th>
                <th className="th-center">Total Rating As Receiving Manager</th>
                <th className="th-center">Average Rating</th>
                <th className="th-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStats.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: '#8c7562' }}>
                    No team members found matching your search criteria.
                  </td>
                </tr>
              ) : (
                filteredStats.map((stat) => (
                  <tr key={stat.user.id}>
                    {/* Names */}
                    <td>
                      <div className="ratings-user-cell">
                        <div className="ratings-user-avatar">
                          {stat.user.avatarInitials || stat.user.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="ratings-user-details">
                          <span className="ratings-user-name">{stat.user.name}</span>
                          <span className="ratings-user-email">{stat.user.email}</span>
                        </div>
                      </div>
                    </td>

                    {/* Roles */}
                    <td>
                      <span className={`ratings-role-badge ratings-role-badge--${stat.user.role}`}>
                        {stat.user.roleLabel || stat.user.role.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Total Rating As Sender */}
                    <td className="td-center">
                      {stat.avgSenderRating !== null ? (
                        <div>
                          <span className={`ratings-score-pill ${getScoreBadgeClass(stat.avgSenderRating)}`}>
                            ⭐ {stat.avgSenderRating} / 10
                          </span>
                          <div className="ratings-score-sub">
                            {stat.senderQueriesCount} {stat.senderQueriesCount === 1 ? 'query' : 'queries'} sent
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#9c836e' }}>—</span>
                      )}
                    </td>

                    {/* Total Rating As Receiving Manager */}
                    <td className="td-center">
                      {stat.avgReceiverRating !== null ? (
                        <div>
                          <span className={`ratings-score-pill ${getScoreBadgeClass(stat.avgReceiverRating)}`}>
                            ⭐ {stat.avgReceiverRating} / 10
                          </span>
                          <div className="ratings-score-sub">
                            {stat.receiverQueriesCount} {stat.receiverQueriesCount === 1 ? 'query' : 'queries'} received
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#9c836e' }}>—</span>
                      )}
                    </td>

                    {/* Average Rating */}
                    <td className="td-center">
                      {stat.combinedAverageRating !== null ? (
                        <div>
                          <span
                            className={`ratings-score-pill ${getScoreBadgeClass(stat.combinedAverageRating)}`}
                            style={{ fontSize: '0.92rem', padding: '0.4rem 0.85rem' }}
                          >
                            ⭐ {stat.combinedAverageRating} / 10
                          </span>
                          <div className="ratings-score-sub">
                            {stat.totalQueriesInvolved} total queries
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#9c836e' }}>—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="td-center">
                      <button
                        type="button"
                        className="ratings-btn-breakdown"
                        onClick={() => setSelectedUserStats(stat)}
                        title="View individual query ratings & remarks"
                      >
                        🔍 View Breakdown
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Rating Breakdown Modal */}
      {selectedUserStats && (
        <div className="modal-backdrop" onClick={() => setSelectedUserStats(null)}>
          <div
            className="modal-dialog ratings-breakdown-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-badge">Query Performance Breakdown</span>
                <h3 className="modal-heading">{selectedUserStats.user.name}</h3>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setSelectedUserStats(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* User Summary Pill */}
              <div className="ratings-modal-user-summary">
                <div>
                  <strong style={{ color: '#2b1d0e', fontSize: '1rem' }}>
                    {selectedUserStats.user.name}
                  </strong>
                  <div style={{ color: '#8c7562', fontSize: '0.8rem' }}>
                    {selectedUserStats.user.email} · {selectedUserStats.user.roleLabel}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: '#715b49', textTransform: 'uppercase' }}>
                      As Sender
                    </div>
                    <div style={{ fontWeight: 800, color: '#2b1d0e', fontSize: '1.1rem' }}>
                      {selectedUserStats.avgSenderRating !== null
                        ? `${selectedUserStats.avgSenderRating}/10`
                        : '—'}
                    </div>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: '#715b49', textTransform: 'uppercase' }}>
                      As Receiver
                    </div>
                    <div style={{ fontWeight: 800, color: '#2b1d0e', fontSize: '1.1rem' }}>
                      {selectedUserStats.avgReceiverRating !== null
                        ? `${selectedUserStats.avgReceiverRating}/10`
                        : '—'}
                    </div>
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: '#715b49', textTransform: 'uppercase' }}>
                      Combined Avg
                    </div>
                    <div style={{ fontWeight: 800, color: '#844918', fontSize: '1.25rem' }}>
                      {selectedUserStats.combinedAverageRating !== null
                        ? `${selectedUserStats.combinedAverageRating}/10`
                        : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* List of queries */}
              <div className="ratings-breakdown-list">
                {selectedUserQueries.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#8c7562', padding: '2rem' }}>
                    No queries found for this team member.
                  </p>
                ) : (
                  selectedUserQueries.map(({ query, roleInQuery, receiverBreakdown, senderBreakdown }) => {
                    const isReceiver = roleInQuery === 'Receiving Manager';
                    const activeBreakdown = isReceiver ? receiverBreakdown : senderBreakdown;

                    return (
                      <div key={query.queryId} className="ratings-query-card">
                        <div className="ratings-query-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <strong style={{ color: '#844918' }}>{query.queryId}</strong>
                            <span className="ratings-query-title">{query.queryTitle}</span>
                            <span
                              className={`ratings-query-pill ${
                                query.isUrgent
                                  ? 'ratings-query-pill--urgent'
                                  : 'ratings-query-pill--normal'
                              }`}
                            >
                              {query.isUrgent ? '⚡ Urgent' : 'Normal 24h'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span
                              className="ratings-role-badge"
                              style={{
                                background: isReceiver ? '#e0f2fe' : '#fef3c7',
                                color: isReceiver ? '#0369a1' : '#92400e',
                              }}
                            >
                              Role: {roleInQuery}
                            </span>
                            <span
                              className={`ratings-score-pill ${getScoreBadgeClass(
                                activeBreakdown.overallRating
                              )}`}
                            >
                              ⭐ {activeBreakdown.overallRating} / 10
                            </span>
                          </div>
                        </div>

                        {/* Breakdown Columns */}
                        <div className="ratings-columns-grid">
                          {/* Admin Rating */}
                          <div className="ratings-col-item">
                            <span className="ratings-col-label">
                              Admin Rating (50%)
                            </span>
                            <div className="ratings-col-val" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <strong>⭐ {activeBreakdown.adminRating} / 10</strong>
                              {currentUser.role === 'admin' && (
                                <button
                                  type="button"
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#844918',
                                    cursor: 'pointer',
                                    fontSize: '0.78rem',
                                    textDecoration: 'underline',
                                  }}
                                  onClick={() => handleOpenEditRating(query, isReceiver ? 'receiver' : 'sender')}
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                            <div className="ratings-col-remark">
                              {activeBreakdown.adminRemark || 'Default 10★ rating'}
                            </div>
                          </div>

                          {/* System Rating */}
                          <div className="ratings-col-item">
                            <span className="ratings-col-label">System Rating (30%)</span>
                            <div className="ratings-col-val">
                              <strong>⭐ {activeBreakdown.systemRating} / 10</strong>
                            </div>
                            <div className="ratings-col-remark">{activeBreakdown.systemReason}</div>
                          </div>

                          {/* Peer Rating (Sender Rating for Receiver, Receiver Rating for Sender) */}
                          {isReceiver ? (
                            <div className="ratings-col-item">
                              <span className="ratings-col-label">Sender Rating (20%)</span>
                              <div className="ratings-col-val">
                                <strong>
                                  {activeBreakdown.senderRating !== null
                                    ? `⭐ ${activeBreakdown.senderRating} / 10`
                                    : '⭐ 10 / 10 (Default)'}
                                </strong>
                              </div>
                              <div className="ratings-col-remark">
                                {activeBreakdown.senderRemark || 'Pending sender completion review'}
                              </div>
                            </div>
                          ) : (
                            <div className="ratings-col-item">
                              <span className="ratings-col-label">Receiver Rating (20%)</span>
                              <div className="ratings-col-val">
                                <strong>
                                  {activeBreakdown.receiverRating !== null
                                    ? `⭐ ${activeBreakdown.receiverRating} / 10`
                                    : '⭐ 10 / 10 (Default)'}
                                </strong>
                              </div>
                              <div className="ratings-col-remark">
                                {activeBreakdown.receiverRemark || 'Default 10★ rating'}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedUserStats(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Rating Editor Modal */}
      {editingQuery && (
        <div className="modal-backdrop" onClick={() => setEditingQuery(null)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: '520px' }}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-badge">Admin Performance Rating</span>
                <h3 className="modal-heading">
                  Rate {editingQuery.targetRole === 'receiver' ? 'Receiving Manager' : 'Sender'} on{' '}
                  {editingQuery.query.queryId}
                </h3>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setEditingQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.86rem', color: '#553e2d', marginTop: 0 }}>
                Rate how quickly and effectively the{' '}
                <strong>
                  {editingQuery.targetRole === 'receiver'
                    ? editingQuery.query.managerName
                    : editingQuery.query.accountManagerName}
                </strong>{' '}
                responded on this query. Admin rating carries <strong>50%</strong> weight.
              </p>

              {/* 10 Star picker */}
              <div style={{ margin: '1.25rem 0' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#715b49',
                    marginBottom: '0.4rem',
                  }}
                >
                  Score (1 to 10 Stars)
                </label>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                    <button
                      key={star}
                      type="button"
                      style={{
                        background: ratingInput >= star ? '#c18036' : '#faf8f5',
                        color: ratingInput >= star ? '#fff' : '#634a36',
                        border: '1px solid rgba(193, 128, 54, 0.4)',
                        borderRadius: '8px',
                        padding: '0.45rem 0.65rem',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      onClick={() => setRatingInput(star)}
                    >
                      {star}★
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '0.5rem', fontWeight: 700, color: '#844918' }}>
                  ⭐ Selected: {ratingInput} of 10 Stars
                </div>
              </div>

              {/* Mandatory Remark */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#715b49',
                    marginBottom: '0.4rem',
                  }}
                >
                  Admin Remark <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
                </label>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '0.65rem',
                    fontSize: '0.85rem',
                    border: '1.5px solid rgba(193, 128, 54, 0.4)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                  placeholder="Provide constructive feedback or reason for this rating..."
                  value={remarkInput}
                  onChange={(e) => {
                    setRemarkInput(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
                />
                {remarkError && (
                  <span style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                    {remarkError}
                  </span>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditingQuery(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingQueryId === editingQuery.query.queryId}
                onClick={handleSaveAdminRating}
              >
                {savingQueryId === editingQuery.query.queryId ? 'Saving...' : 'Save Admin Rating'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
