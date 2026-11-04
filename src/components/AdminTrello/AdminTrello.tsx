import React, { useState, useEffect, useCallback } from 'react';
import {
  UserAccount,
  UserTrelloIntegration,
  TrelloBoard,
  TrelloList,
  TrelloCard,
  TrelloCardAction,
} from '../../types';
import {
  getTrelloApiKey,
  getTrelloAuthUrl,
  connectUserByEmail,
  verifyTrelloToken,
  saveUserIntegration,
  fetchAllUserIntegrations,
  deleteUserIntegration,
  fetchMemberBoards,
  fetchBoardLists,
  fetchBoardCards,
  fetchCardActions,
  fetchMemberRecentActions,
  addCardComment,
  moveCardToList,
  toggleCardCompletion,
  createNewCard,
} from '../../lib/trello';
import './AdminTrello.css';

interface AdminTrelloProps {
  currentUser: UserAccount;
  allUsers: UserAccount[];
  onLogActivity?: (actionTitle: string, actionDetails: string) => void;
}

export const AdminTrello: React.FC<AdminTrelloProps> = ({
  currentUser,
  allUsers,
  onLogActivity,
}) => {
  // Global API Key
  const [apiKey] = useState<string>(getTrelloApiKey());

  // All team integrations dictionary: userId -> UserTrelloIntegration
  const [integrations, setIntegrations] = useState<Record<string, UserTrelloIntegration>>({});
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState<boolean>(true);

  // Filter team members: Account Managers, Managers, and Admins
  const teamMembers = allUsers.filter(
    (u) => u.role === 'account_manager' || u.role === 'manager' || u.role === 'admin'
  );

  // Selected team member tab
  const [selectedUserId, setSelectedUserId] = useState<string>(
    teamMembers[0]?.id || ''
  );
  const selectedUser = teamMembers.find((u) => u.id === selectedUserId);
  const currentIntegration = integrations[selectedUserId] || null;

  // Board Data for the selected user
  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [cards, setCards] = useState<TrelloCard[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState<boolean>(false);
  const [isLoadingCards, setIsLoadingCards] = useState<boolean>(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Card Modal
  const [selectedCard, setSelectedCard] = useState<TrelloCard | null>(null);
  const [cardActions, setCardActions] = useState<TrelloCardAction[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState<boolean>(false);
  const [newCommentText, setNewCommentText] = useState<string>('');
  const [isSubmittingComment, setIsSubmittingComment] = useState<boolean>(false);

  // Admin Manual Connect for Member
  const [adminEmailInput, setAdminEmailInput] = useState<string>(
    selectedUser?.email || ''
  );
  const [manualTokenInput, setManualTokenInput] = useState<string>('');
  const [isVerifyingManual, setIsVerifyingManual] = useState<boolean>(false);
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedUser) {
      setAdminEmailInput(currentIntegration?.trelloEmail || selectedUser.email || '');
      setManualError(null);
    }
  }, [selectedUserId, selectedUser, currentIntegration]);

  // New Card Modal
  const [isNewCardModalOpen, setIsNewCardModalOpen] = useState<boolean>(false);
  const [newCardTitle, setNewCardTitle] = useState<string>('');
  const [newCardDesc, setNewCardDesc] = useState<string>('');
  const [newCardListId, setNewCardListId] = useState<string>('');
  const [isCreatingCard, setIsCreatingCard] = useState<boolean>(false);

  // Report Modal
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [memberRecentActions, setMemberRecentActions] = useState<TrelloCardAction[]>([]);
  const [isLoadingReport, setIsLoadingReport] = useState<boolean>(false);
  const [reportDateFilter, setReportDateFilter] = useState<'7days' | '30days' | 'all'>('7days');

  // Load all integrations on mount
  const loadAllIntegrations = useCallback(async () => {
    setIsLoadingIntegrations(true);
    try {
      const all = await fetchAllUserIntegrations();
      setIntegrations(all);
    } catch {
      // ignore
    } finally {
      setIsLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => {
    loadAllIntegrations();
  }, [loadAllIntegrations]);

  // Load boards when selected team member has an integration
  const loadSelectedUserBoards = useCallback(async () => {
    if (!currentIntegration || !apiKey) {
      setBoards([]);
      setLists([]);
      setCards([]);
      setSelectedBoardId('');
      return;
    }
    setIsLoadingBoards(true);
    setBoardError(null);
    try {
      const data = await fetchMemberBoards(currentIntegration.trelloToken || '', apiKey);
      setBoards(data);
      if (data.length > 0) {
        setSelectedBoardId(data[0].id);
      } else {
        setSelectedBoardId('');
        setLists([]);
        setCards([]);
      }
    } catch (err: any) {
      setBoardError(err.message || 'Failed to load boards for this member.');
    } finally {
      setIsLoadingBoards(false);
    }
  }, [currentIntegration, apiKey]);

  useEffect(() => {
    loadSelectedUserBoards();
  }, [loadSelectedUserBoards]);

  // Load lists and cards when board selected
  const loadBoardContent = useCallback(async (boardId: string) => {
    if (!boardId || !currentIntegration || !apiKey) return;
    setIsLoadingCards(true);
    setBoardError(null);
    try {
      const [fetchedLists, fetchedCards] = await Promise.all([
        fetchBoardLists(boardId, currentIntegration.trelloToken || '', apiKey),
        fetchBoardCards(boardId, currentIntegration.trelloToken || '', apiKey),
      ]);
      setLists(fetchedLists);
      setCards(fetchedCards);
      if (fetchedLists.length > 0 && !newCardListId) {
        setNewCardListId(fetchedLists[0].id);
      }
    } catch (err: any) {
      setBoardError(err.message || 'Failed to load board details.');
    } finally {
      setIsLoadingCards(false);
    }
  }, [currentIntegration, apiKey, newCardListId]);

  useEffect(() => {
    if (selectedBoardId) {
      loadBoardContent(selectedBoardId);
    }
  }, [selectedBoardId, loadBoardContent]);

  // Load card actions when modal opens
  const loadCardDetails = async (card: TrelloCard) => {
    setSelectedCard(card);
    setCardActions([]);
    if (!currentIntegration || !apiKey) return;
    setIsLoadingActions(true);
    try {
      const actions = await fetchCardActions(card.id, currentIntegration.trelloToken || '', apiKey);
      setCardActions(actions);
    } catch {
      // ignore
    } finally {
      setIsLoadingActions(false);
    }
  };

  // Card comment submit (Admin posting)
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard || !newCommentText.trim() || !currentIntegration || !apiKey)
      return;
    setIsSubmittingComment(true);
    try {
      const formattedText = `[Admin Note - ${currentUser.name}]: ${newCommentText.trim()}`;
      const newAction = await addCardComment(
        selectedCard.id,
        formattedText,
        currentIntegration.trelloToken || '',
        apiKey
      );
      setCardActions((prev) => [newAction, ...prev]);
      setNewCommentText('');
      onLogActivity?.(
        'TRELLO_ADMIN_COMMENT',
        `Admin ${currentUser.name} commented on "${selectedCard.name}" on behalf of ${selectedUser?.name}`
      );
    } catch (err: any) {
      alert(`Error posting comment: ${err.message}`);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  // Move card
  const handleMoveCard = async (cardId: string, targetListId: string) => {
    if (!currentIntegration || !apiKey) return;
    try {
      const updated = await moveCardToList(
        cardId,
        targetListId,
        currentIntegration.trelloToken || '',
        apiKey
      );
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, idList: targetListId } : c)));
      if (selectedCard?.id === cardId) {
        setSelectedCard((prev) => (prev ? { ...prev, idList: targetListId } : null));
      }
      onLogActivity?.(
        'TRELLO_ADMIN_CARD_MOVED',
        `Admin moved card "${updated.name}" for ${selectedUser?.name}`
      );
    } catch (err: any) {
      alert(`Failed to move card: ${err.message}`);
    }
  };

  // Toggle card completion
  const handleToggleComplete = async (card: TrelloCard) => {
    if (!currentIntegration || !apiKey) return;
    const targetStatus = !card.dueComplete;
    try {
      await toggleCardCompletion(card.id, targetStatus, currentIntegration.trelloToken || '', apiKey);
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, dueComplete: targetStatus } : c))
      );
      if (selectedCard?.id === card.id) {
        setSelectedCard((prev) => (prev ? { ...prev, dueComplete: targetStatus } : null));
      }
      onLogActivity?.(
        'TRELLO_ADMIN_STATUS',
        `Admin updated "${card.name}" to ${targetStatus ? 'Completed' : 'Pending'}`
      );
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  // Create card
  const handleCreateCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !newCardTitle.trim() ||
      !newCardListId ||
      !currentIntegration ||
      !apiKey
    )
      return;
    setIsCreatingCard(true);
    try {
      const created = await createNewCard(
        newCardListId,
        newCardTitle.trim(),
        newCardDesc.trim(),
        currentIntegration.trelloToken || '',
        apiKey
      );
      setCards((prev) => [...prev, created]);
      setIsNewCardModalOpen(false);
      setNewCardTitle('');
      setNewCardDesc('');
      onLogActivity?.(
        'TRELLO_ADMIN_CARD_CREATED',
        `Admin created card "${created.name}" for ${selectedUser?.name}`
      );
    } catch (err: any) {
      alert(`Failed to create card: ${err.message}`);
    } finally {
      setIsCreatingCard(false);
    }
  };

  // Connect on behalf of user via email
  const handleAdminConnectByEmail = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedUser) return;
    const emailToUse = (adminEmailInput || selectedUser.email).trim().toLowerCase();
    if (!emailToUse) {
      setManualError('Please enter an email address.');
      return;
    }
    setIsVerifyingManual(true);
    setManualError(null);
    try {
      const newIntegration = await connectUserByEmail(
        selectedUser.id,
        selectedUser.name,
        emailToUse,
        apiKey
      );
      setIntegrations((prev) => ({ ...prev, [selectedUser.id]: newIntegration }));
      onLogActivity?.(
        'TRELLO_ADMIN_LINK',
        `Admin connected Trello for ${selectedUser.name} (${emailToUse})`
      );
    } catch (err: any) {
      setManualError(err.message || 'Failed to connect member.');
    } finally {
      setIsVerifyingManual(false);
    }
  };

  // Connect on behalf of user via Token
  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (!apiKey) {
      alert('Trello API Key not found. Please ensure VITE_TRELLO_API_KEY is configured in .env.');
      return;
    }
    if (!manualTokenInput.trim()) return;

    setIsVerifyingManual(true);
    setManualError(null);
    try {
      const member = await verifyTrelloToken(apiKey, manualTokenInput.trim());
      const newIntegration: UserTrelloIntegration = {
        userId: selectedUser.id,
        trelloMemberId: member.id,
        trelloUsername: member.username,
        trelloFullName: member.fullName,
        trelloEmail: member.email || selectedUser.email,
        trelloAvatarUrl: member.avatarUrl,
        trelloToken: manualTokenInput.trim(),
        updatedAt: new Date().toISOString(),
      };
      await saveUserIntegration(newIntegration);
      setIntegrations((prev) => ({ ...prev, [selectedUser.id]: newIntegration }));
      setManualTokenInput('');
      onLogActivity?.(
        'TRELLO_ADMIN_LINK',
        `Admin linked Trello account @${member.username} for ${selectedUser.name}`
      );
    } catch (err: any) {
      setManualError(err.message || 'Verification failed. Please check token.');
    } finally {
      setIsVerifyingManual(false);
    }
  };

  // Disconnect member
  const handleDisconnectMember = async () => {
    if (!selectedUser) return;
    if (
      !window.confirm(
        `Are you sure you want to disconnect Trello for ${selectedUser.name}?`
      )
    )
      return;
    await deleteUserIntegration(selectedUser.id);
    setIntegrations((prev) => {
      const next = { ...prev };
      delete next[selectedUser.id];
      return next;
    });
    setBoards([]);
    setLists([]);
    setCards([]);
    onLogActivity?.(
      'TRELLO_ADMIN_UNLINK',
      `Admin disconnected Trello account for ${selectedUser.name}`
    );
  };

  // Open Report Modal
  const handleOpenReportModal = async () => {
    setIsReportModalOpen(true);
    if (!currentIntegration || !apiKey || !currentIntegration.trelloMemberId)
      return;
    setIsLoadingReport(true);
    try {
      const actions = await fetchMemberRecentActions(
        currentIntegration.trelloMemberId,
        currentIntegration.trelloToken || '',
        apiKey,
        60
      );
      setMemberRecentActions(actions);
    } catch {
      // ignore
    } finally {
      setIsLoadingReport(false);
    }
  };

  // Filter cards
  const displayedCards = cards.filter((card) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = card.name.toLowerCase().includes(q);
      const matchDesc = card.desc?.toLowerCase().includes(q);
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  // Calculate report metrics
  const filterDateMs =
    reportDateFilter === '7days'
      ? Date.now() - 7 * 86400000
      : reportDateFilter === '30days'
      ? Date.now() - 30 * 86400000
      : 0;

  const filteredReportActions = memberRecentActions.filter((act) => {
    if (!filterDateMs) return true;
    return new Date(act.date).getTime() >= filterDateMs;
  });

  const completedCardsCount = cards.filter((c) => c.dueComplete).length;
  const pendingCardsCount = cards.length - completedCardsCount;

  return (
    <div className="admin-trello-container">
      {/* Top Header */}
      <div className="admin-trello-header">
        <div className="admin-trello-title-group">
          <div className="trello-icon-badge">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zm-9 14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v10zm8-5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5z" />
            </svg>
          </div>
          <div>
            <h1 className="admin-trello-heading">Trello Team Management & Reports</h1>
            <p className="admin-trello-subheading">
              View and manage Account Managers, Managers, and Admins Trello boards, read/write updates, and compile reports
            </p>
          </div>
        </div>
      </div>

      {/* Team Member Tabs */}
      <div className="admin-trello-tabs-scroll">
        <div className="admin-trello-tabs">
          {teamMembers.map((member) => {
            const isLinked = Boolean(integrations[member.id]);
            const isSelected = member.id === selectedUserId;
            return (
              <button
                key={member.id}
                type="button"
                className={`admin-team-tab ${
                  isSelected ? 'admin-team-tab--active' : ''
                }`}
                onClick={() => setSelectedUserId(member.id)}
              >
                <div className="admin-tab-avatar">
                  {member.avatarInitials}
                </div>
                <div className="admin-tab-info">
                  <span className="admin-tab-name">{member.name}</span>
                  <span className="admin-tab-role">
                    {member.role === 'account_manager'
                      ? 'Account Mgr'
                      : member.role === 'admin'
                      ? 'Admin'
                      : 'Manager'}
                  </span>
                </div>
                <span
                  className={`admin-status-dot ${
                    isLinked ? 'admin-status-dot--linked' : 'admin-status-dot--unlinked'
                  }`}
                  title={isLinked ? 'Trello Connected' : 'Not Connected'}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Member Panel */}
      {selectedUser && (
        <div className="admin-member-panel">
          {/* Member Banner */}
          <div className="admin-member-banner">
            <div className="admin-member-details">
              <h2>{selectedUser.name}</h2>
              <span className="admin-member-email">{selectedUser.email}</span>
              <span className="admin-member-pill">{selectedUser.roleLabel}</span>
            </div>

            {currentIntegration ? (
              <div className="admin-member-trello-meta">
                <div className="trello-user-pill">
                  {currentIntegration.trelloAvatarUrl ? (
                    <img
                      src={currentIntegration.trelloAvatarUrl}
                      alt={currentIntegration.trelloFullName}
                      className="trello-user-avatar"
                    />
                  ) : (
                    <div className="trello-user-initials">
                      {currentIntegration.trelloFullName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="trello-user-info">
                    <span className="trello-user-name">
                      {currentIntegration.trelloFullName}
                    </span>
                    <span className="trello-user-tag">
                      @{currentIntegration.trelloUsername}
                    </span>
                    {currentIntegration.trelloEmail && (
                      <span className="trello-user-email">
                        ✉️ {currentIntegration.trelloEmail}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  className="trello-btn trello-btn--secondary"
                  onClick={handleOpenReportModal}
                >
                  📊 Generate Report for {selectedUser.name}
                </button>

                <button
                  type="button"
                  className="trello-btn trello-btn--outline"
                  onClick={handleDisconnectMember}
                >
                  Unlink Trello
                </button>
              </div>
            ) : (
              <div className="admin-unlinked-badge">
                ⚪ Trello Not Linked
              </div>
            )}
          </div>

          {/* Member Content: If not linked vs linked */}
          {!currentIntegration ? (
            <div className="admin-not-linked-box">
              <div className="admin-not-linked-icon">📋</div>
              <h3>{selectedUser.name} has not linked their Trello account yet</h3>
              <p>
                Each team member requires their own personal Trello authorization token. Once linked to their email (<strong>{selectedUser.email}</strong>), they will connect automatically every time they log into the dashboard!
              </p>

              <div className="admin-manual-connect-box">
                <h4>Link Trello Account for {selectedUser.name}:</h4>
                <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Have {selectedUser.name} authorize the app, or paste their personal Trello token below:
                </p>

                {manualError && (
                  <div className="trello-alert trello-alert--danger">{manualError}</div>
                )}

                <div style={{ marginBottom: '1.25rem', textAlign: 'left' }}>
                  <a
                    href={getTrelloAuthUrl(apiKey)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="trello-btn trello-btn--outline"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    🔑 Open Trello Authorization Page ↗
                  </a>
                  <span style={{ display: 'block', fontSize: '0.78rem', color: '#64748b', marginTop: '0.35rem' }}>
                    Tip: Send this authorization link to {selectedUser.name} to generate their personal token.
                  </span>
                </div>

                <form onSubmit={handleManualConnect} className="admin-manual-form" style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                    Paste Trello Token for {selectedUser.name}:
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      type="password"
                      className="trello-input"
                      placeholder={`Paste 64-character token for ${selectedUser.name}...`}
                      value={manualTokenInput}
                      onChange={(e) => setManualTokenInput(e.target.value)}
                      required
                      style={{ flex: 1, minWidth: '220px' }}
                    />
                    <button
                      type="submit"
                      className="trello-btn trello-btn--primary"
                      disabled={isVerifyingManual || !manualTokenInput.trim()}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {isVerifyingManual ? 'Verifying...' : `Link with Token`}
                    </button>
                  </div>
                </form>

                <form onSubmit={handleAdminConnectByEmail}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                    Or Link from Existing Registered Email:
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      type="email"
                      className="trello-input"
                      placeholder={`Enter Trello email for ${selectedUser.name}...`}
                      value={adminEmailInput}
                      onChange={(e) => setAdminEmailInput(e.target.value)}
                      required
                      style={{ flex: 1, minWidth: '220px' }}
                    />
                    <button
                      type="submit"
                      className="trello-btn trello-btn--outline"
                      disabled={isVerifyingManual}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {isVerifyingManual ? 'Connecting...' : `Find & Link Email`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="admin-linked-board-area">
              {/* Controls */}
              <div className="trello-board-controls">
                <div className="trello-board-selector">
                  <label htmlFor="admin-board-select">Select Board:</label>
                  <select
                    id="admin-board-select"
                    className="trello-select"
                    value={selectedBoardId}
                    onChange={(e) => setSelectedBoardId(e.target.value)}
                    disabled={isLoadingBoards}
                  >
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        📋 {b.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="trello-icon-btn"
                    onClick={loadSelectedUserBoards}
                    title="Refresh boards"
                    disabled={isLoadingBoards}
                  >
                    🔄
                  </button>
                </div>

                <div className="trello-board-filters">
                  <input
                    type="text"
                    className="trello-search-input"
                    placeholder="Search cards..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />

                  <button
                    type="button"
                    className="trello-btn trello-btn--primary"
                    onClick={() => setIsNewCardModalOpen(true)}
                  >
                    + Add Card
                  </button>
                </div>
              </div>

              {boardError && (
                <div className="trello-alert trello-alert--danger">{boardError}</div>
              )}

              {/* Kanban Columns */}
              {isLoadingCards ? (
                <div className="trello-loading-state">
                  <span className="trello-spinner"></span>
                  Loading {selectedUser.name}&apos;s cards from Trello...
                </div>
              ) : lists.length === 0 ? (
                <div className="trello-empty-state">
                  <p>No lists found on this board.</p>
                </div>
              ) : (
                <div className="trello-kanban-board">
                  {lists.map((list) => {
                    const listCards = displayedCards.filter((c) => c.idList === list.id);
                    return (
                      <div key={list.id} className="trello-kanban-col">
                        <div className="trello-col-header">
                          <span className="trello-col-title">{list.name}</span>
                          <span className="trello-col-count">{listCards.length}</span>
                        </div>

                        <div className="trello-col-cards">
                          {listCards.length === 0 ? (
                            <div className="trello-empty-col">No cards</div>
                          ) : (
                            listCards.map((card) => {
                              const isComplete = Boolean(card.dueComplete);
                              return (
                                <div
                                  key={card.id}
                                  className={`trello-card-item ${
                                    isComplete ? 'trello-card-item--complete' : ''
                                  }`}
                                  onClick={() => loadCardDetails(card)}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <div className="trello-card-top">
                                    {card.labels && card.labels.length > 0 && (
                                      <div className="trello-card-labels">
                                        {card.labels.map((lbl) => (
                                          <span
                                            key={lbl.id}
                                            className={`trello-card-label trello-card-label--${
                                              lbl.color || 'blue'
                                            }`}
                                          >
                                            {lbl.name || lbl.color}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div className="trello-card-title">{card.name}</div>

                                  <div className="trello-card-footer">
                                    {card.due && (
                                      <span
                                        className={`trello-card-due ${
                                          isComplete
                                            ? 'trello-card-due--done'
                                            : new Date(card.due).getTime() < Date.now()
                                            ? 'trello-card-due--overdue'
                                            : ''
                                        }`}
                                      >
                                        🕒 {new Date(card.due).toLocaleDateString()}
                                      </span>
                                    )}

                                    <button
                                      type="button"
                                      className={`trello-check-btn ${
                                        isComplete ? 'trello-check-btn--active' : ''
                                      }`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleComplete(card);
                                      }}
                                    >
                                      {isComplete ? '✓ Done' : '○'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* CARD DETAIL & EDIT MODAL (ADMIN) */}
      {selectedCard && (
        <div className="trello-modal-backdrop" onClick={() => setSelectedCard(null)}>
          <div
            className="trello-modal trello-modal--card-detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="trello-modal-header">
              <div className="trello-modal-title-box">
                <span className="trello-modal-badge">
                  {lists.find((l) => l.id === selectedCard.idList)?.name || 'List'}
                </span>
                <h2>{selectedCard.name}</h2>
              </div>
              <button
                type="button"
                className="trello-modal-close"
                onClick={() => setSelectedCard(null)}
              >
                ✕
              </button>
            </div>

            <div className="trello-modal-body">
              <div className="trello-card-quick-actions">
                <div className="trello-action-field">
                  <label>Change Status / List:</label>
                  <select
                    className="trello-select"
                    value={selectedCard.idList}
                    onChange={(e) => handleMoveCard(selectedCard.id, e.target.value)}
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="trello-action-field">
                  <label>Completion:</label>
                  <button
                    type="button"
                    className={`trello-btn ${
                      selectedCard.dueComplete ? 'trello-btn--success' : 'trello-btn--secondary'
                    }`}
                    onClick={() => handleToggleComplete(selectedCard)}
                  >
                    {selectedCard.dueComplete ? '✓ Completed' : 'Mark Completed'}
                  </button>
                </div>

                {selectedCard.shortUrl && (
                  <div className="trello-action-field">
                    <label>Trello:</label>
                    <a
                      href={selectedCard.shortUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="trello-btn trello-btn--outline"
                    >
                      Open in Trello ↗
                    </a>
                  </div>
                )}
              </div>

              {selectedCard.desc && (
                <div className="trello-card-desc-box">
                  <h4>Description:</h4>
                  <p>{selectedCard.desc}</p>
                </div>
              )}

              {/* Progress Update & Comments */}
              <div className="trello-comments-section">
                <h3>💬 Admin Remark / Response</h3>
                <form onSubmit={handleAddComment} className="trello-comment-form">
                  <textarea
                    className="trello-textarea"
                    placeholder={`Post an Admin note or reply on behalf of ${currentUser.name}...`}
                    rows={3}
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    required
                  />
                  <div className="trello-form-actions">
                    <button
                      type="submit"
                      className="trello-btn trello-btn--primary"
                      disabled={isSubmittingComment}
                    >
                      {isSubmittingComment ? 'Posting to Trello...' : 'Post Admin Note'}
                    </button>
                  </div>
                </form>

                <div className="trello-actions-list">
                  {isLoadingActions ? (
                    <div className="trello-loading-text">Loading activity...</div>
                  ) : cardActions.length === 0 ? (
                    <div className="trello-empty-text">No updates recorded yet on this card.</div>
                  ) : (
                    cardActions.map((act) => (
                      <div key={act.id} className="trello-action-item">
                        <div className="trello-action-meta">
                          <strong>{act.memberCreator?.fullName || 'User'}</strong>
                          <span>{new Date(act.date).toLocaleString()}</span>
                        </div>
                        {act.data.text && (
                          <div className="trello-action-text">{act.data.text}</div>
                        )}
                        {act.data.listBefore && act.data.listAfter && (
                          <div className="trello-action-move">
                            Moved card from <em>{act.data.listBefore.name}</em> to{' '}
                            <em>{act.data.listAfter.name}</em>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW CARD MODAL (ADMIN) */}
      {isNewCardModalOpen && (
        <div className="trello-modal-backdrop" onClick={() => setIsNewCardModalOpen(false)}>
          <div className="trello-modal trello-modal--small" onClick={(e) => e.stopPropagation()}>
            <div className="trello-modal-header">
              <h2>+ Add Card for {selectedUser?.name}</h2>
              <button
                type="button"
                className="trello-modal-close"
                onClick={() => setIsNewCardModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateCardSubmit} className="trello-modal-body">
              <div className="trello-form-group">
                <label>List / Column:</label>
                <select
                  className="trello-select"
                  value={newCardListId}
                  onChange={(e) => setNewCardListId(e.target.value)}
                  required
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="trello-form-group">
                <label>Card Title:</label>
                <input
                  type="text"
                  className="trello-input"
                  placeholder="Task title..."
                  value={newCardTitle}
                  onChange={(e) => setNewCardTitle(e.target.value)}
                  required
                />
              </div>

              <div className="trello-form-group">
                <label>Description:</label>
                <textarea
                  className="trello-textarea"
                  rows={3}
                  placeholder="Details..."
                  value={newCardDesc}
                  onChange={(e) => setNewCardDesc(e.target.value)}
                />
              </div>

              <div className="trello-modal-actions">
                <button
                  type="button"
                  className="trello-btn trello-btn--outline"
                  onClick={() => setIsNewCardModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="trello-btn trello-btn--primary"
                  disabled={isCreatingCard}
                >
                  {isCreatingCard ? 'Creating...' : 'Create in Trello'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIN REPORT MODAL */}
      {isReportModalOpen && (
        <div className="trello-modal-backdrop" onClick={() => setIsReportModalOpen(false)}>
          <div className="trello-modal trello-modal--report" onClick={(e) => e.stopPropagation()}>
            <div className="trello-modal-header">
              <div className="trello-modal-title-box">
                <span className="trello-modal-badge">Account Manager Report</span>
                <h2>{selectedUser?.name} ({currentIntegration?.trelloFullName})</h2>
              </div>
              <button
                type="button"
                className="trello-modal-close"
                onClick={() => setIsReportModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="trello-modal-body">
              <div className="trello-report-controls">
                <div className="trello-filter-group">
                  <label>Period:</label>
                  <select
                    className="trello-select"
                    value={reportDateFilter}
                    onChange={(e: any) => setReportDateFilter(e.target.value)}
                  >
                    <option value="7days">Last 7 Days</option>
                    <option value="30days">Last 30 Days</option>
                    <option value="all">All Time</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="trello-btn trello-btn--primary"
                  onClick={() => window.print()}
                >
                  🖨️ Print / Save PDF
                </button>
              </div>

              <div className="trello-metrics-row">
                <div className="trello-metric-box">
                  <span className="trello-metric-val">{cards.length}</span>
                  <span className="trello-metric-lbl">Total Tasks</span>
                </div>
                <div className="trello-metric-box trello-metric-box--success">
                  <span className="trello-metric-val">{completedCardsCount}</span>
                  <span className="trello-metric-lbl">Completed</span>
                </div>
                <div className="trello-metric-box trello-metric-box--warning">
                  <span className="trello-metric-val">{pendingCardsCount}</span>
                  <span className="trello-metric-lbl">In Progress</span>
                </div>
                <div className="trello-metric-box trello-metric-box--info">
                  <span className="trello-metric-val">{filteredReportActions.length}</span>
                  <span className="trello-metric-lbl">Updates Logged</span>
                </div>
              </div>

              <div className="trello-report-section">
                <h3>Work Activity & Updates Feed</h3>
                {isLoadingReport ? (
                  <div className="trello-loading-text">Loading updates from Trello...</div>
                ) : filteredReportActions.length === 0 ? (
                  <div className="trello-empty-text">No updates recorded in this period.</div>
                ) : (
                  <div className="trello-report-feed">
                    {filteredReportActions.map((act) => (
                      <div key={act.id} className="trello-report-feed-item">
                        <div className="trello-feed-date">
                          {new Date(act.date).toLocaleDateString()} at{' '}
                          {new Date(act.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div className="trello-feed-title">
                          Card: <strong>{act.data.card?.name || 'Untitled Card'}</strong>
                        </div>
                        {act.data.text && (
                          <div className="trello-feed-comment">&ldquo;{act.data.text}&rdquo;</div>
                        )}
                        {act.data.listBefore && act.data.listAfter && (
                          <div className="trello-feed-move">
                            Status changed: <em>{act.data.listBefore.name}</em> ➔{' '}
                            <em>{act.data.listAfter.name}</em>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
