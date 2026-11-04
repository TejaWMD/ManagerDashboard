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
  getTrelloDefaultToken,
  connectUserByEmail,
  connectUserWithToken,
  saveUserIntegration,
  fetchUserIntegration,
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
import './MyTrello.css';

interface MyTrelloProps {
  currentUser: UserAccount;
  onLogActivity?: (actionTitle: string, actionDetails: string) => void;
}

export const MyTrello: React.FC<MyTrelloProps> = ({
  currentUser,
  onLogActivity,
}) => {
  // Config & Auth State
  const [apiKey, setApiKey] = useState<string>(getTrelloApiKey());
  const [emailInput, setEmailInput] = useState<string>(currentUser.email || '');
  const [tokenInput, setTokenInput] = useState<string>('');
  const [integration, setIntegration] = useState<UserTrelloIntegration | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isSwitchingEmail, setIsSwitchingEmail] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const defaultEnvToken = getTrelloDefaultToken();

  // Board Data State
  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [cards, setCards] = useState<TrelloCard[]>([]);
  const [isLoadingBoards, setIsLoadingBoards] = useState<boolean>(false);
  const [isLoadingCards, setIsLoadingCards] = useState<boolean>(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMyCardsOnly, setFilterMyCardsOnly] = useState<boolean>(false);

  // Selected Card for Detail Modal
  const [selectedCard, setSelectedCard] = useState<TrelloCard | null>(null);
  const [cardActions, setCardActions] = useState<TrelloCardAction[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState<boolean>(false);
  const [newCommentText, setNewCommentText] = useState<string>('');
  const [isSubmittingComment, setIsSubmittingComment] = useState<boolean>(false);

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

  // Load existing integration on mount (auto-connect matching user's login email!)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const activeKey = getTrelloApiKey();
      setApiKey(activeKey);

      const existing = await fetchUserIntegration(currentUser.id, currentUser.email);
      if (mounted && existing) {
        if (
          currentUser.id === 'adm-2' &&
          (existing.trelloEmail?.toLowerCase().includes('ushal28') || !existing.trelloEmail)
        ) {
          existing.trelloEmail = currentUser.email || 'wmgteja@gmail.com';
          await saveUserIntegration(existing);
        }
        setIntegration(existing);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [currentUser.id, currentUser.email]);

  // Load boards when integration + apiKey ready
  const loadBoards = useCallback(async () => {
    if (!integration || !apiKey) return;
    setIsLoadingBoards(true);
    setBoardError(null);
    try {
      const data = await fetchMemberBoards(integration.trelloToken || '', apiKey);
      setBoards(data);
      if (data.length > 0 && !selectedBoardId) {
        setSelectedBoardId(data[0].id);
      }
    } catch (err: any) {
      setBoardError(err.message || 'Failed to load boards from Trello.');
    } finally {
      setIsLoadingBoards(false);
    }
  }, [integration, apiKey, selectedBoardId]);

  useEffect(() => {
    if (integration) {
      loadBoards();
    }
  }, [integration, loadBoards]);

  // Load lists and cards when board selected
  const loadBoardContent = useCallback(async (boardId: string) => {
    if (!boardId || !integration || !apiKey) return;
    setIsLoadingCards(true);
    setBoardError(null);
    try {
      const [fetchedLists, fetchedCards] = await Promise.all([
        fetchBoardLists(boardId, integration.trelloToken || '', apiKey),
        fetchBoardCards(boardId, integration.trelloToken || '', apiKey),
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
  }, [integration, apiKey, newCardListId]);

  useEffect(() => {
    if (selectedBoardId) {
      loadBoardContent(selectedBoardId);
    }
  }, [selectedBoardId, loadBoardContent]);

  // Load card actions when modal opens
  const loadCardDetails = async (card: TrelloCard) => {
    setSelectedCard(card);
    setCardActions([]);
    if (!integration || !apiKey) return;
    setIsLoadingActions(true);
    try {
      const actions = await fetchCardActions(card.id, integration.trelloToken || '', apiKey);
      setCardActions(actions);
    } catch {
      // ignore
    } finally {
      setIsLoadingActions(false);
    }
  };

  // Connect Handler with Token
  const handleConnectWithToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = tokenInput.trim();
    if (!cleanToken) {
      setAuthError('Please paste your Trello authorization token.');
      return;
    }
    setIsConnecting(true);
    setAuthError(null);
    try {
      const emailToUse = (emailInput.trim() || currentUser.email).toLowerCase();
      const newIntegration = await connectUserWithToken(
        currentUser.id,
        currentUser.name,
        emailToUse,
        cleanToken,
        apiKey
      );
      setIntegration(newIntegration);
      setTokenInput('');
      setIsSwitchingEmail(false);
      onLogActivity?.(
        'TRELLO_CONNECTED',
        `Connected Trello account (@${newIntegration.trelloUsername}) for ${currentUser.name}`
      );
    } catch (err: any) {
      setAuthError(err.message || 'Connection failed. Please check your token.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Quick Connect with Configured Admin Token (from .env)
  const handleConnectWithEnvToken = async () => {
    if (!defaultEnvToken) return;
    setIsConnecting(true);
    setAuthError(null);
    try {
      const newIntegration = await connectUserWithToken(
        currentUser.id,
        currentUser.name,
        currentUser.email,
        defaultEnvToken,
        apiKey
      );
      setIntegration(newIntegration);
      setIsSwitchingEmail(false);
      onLogActivity?.(
        'TRELLO_CONNECTED',
        `Connected Trello account with Admin Token for ${currentUser.name}`
      );
    } catch (err: any) {
      setAuthError(err.message || 'Failed to connect using Admin Token.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect Handler
  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect your Trello account?')) return;
    await deleteUserIntegration(currentUser.id);
    setIntegration(null);
    setBoards([]);
    setLists([]);
    setCards([]);
    setSelectedBoardId('');
    setTokenInput('');
    setEmailInput(currentUser.email || '');
    onLogActivity?.('TRELLO_DISCONNECTED', `Disconnected Trello account for ${currentUser.name}`);
  };

  // Card comment submit
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard || !newCommentText.trim() || !integration || !apiKey) return;
    setIsSubmittingComment(true);
    try {
      const newAction = await addCardComment(
        selectedCard.id,
        newCommentText.trim(),
        integration.trelloToken || '',
        apiKey
      );
      setCardActions((prev) => [newAction, ...prev]);
      setNewCommentText('');
      onLogActivity?.(
        'TRELLO_COMMENT',
        `Added update on card "${selectedCard.name}": "${newCommentText.trim().substring(0, 40)}..."`
      );
    } catch (err: any) {
      alert(`Error posting comment: ${err.message}`);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  // Move card
  const handleMoveCard = async (cardId: string, targetListId: string) => {
    if (!integration || !apiKey) return;
    try {
      const updated = await moveCardToList(cardId, targetListId, integration.trelloToken || '', apiKey);
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, idList: targetListId } : c)));
      if (selectedCard?.id === cardId) {
        setSelectedCard((prev) => (prev ? { ...prev, idList: targetListId } : null));
      }
      const listName = lists.find((l) => l.id === targetListId)?.name || 'another list';
      onLogActivity?.('TRELLO_CARD_MOVED', `Moved card "${updated.name}" to "${listName}"`);
    } catch (err: any) {
      alert(`Failed to move card: ${err.message}`);
    }
  };

  // Toggle card completion
  const handleToggleComplete = async (card: TrelloCard) => {
    if (!integration || !apiKey) return;
    const targetStatus = !card.dueComplete;
    try {
      await toggleCardCompletion(card.id, targetStatus, integration.trelloToken || '', apiKey);
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, dueComplete: targetStatus } : c))
      );
      if (selectedCard?.id === card.id) {
        setSelectedCard((prev) => (prev ? { ...prev, dueComplete: targetStatus } : null));
      }
      onLogActivity?.(
        'TRELLO_CARD_STATUS',
        `Marked card "${card.name}" as ${targetStatus ? 'Completed' : 'Pending'}`
      );
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  // Create card
  const handleCreateCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardTitle.trim() || !newCardListId || !integration || !apiKey) return;
    setIsCreatingCard(true);
    try {
      const created = await createNewCard(
        newCardListId,
        newCardTitle.trim(),
        newCardDesc.trim(),
        integration.trelloToken || '',
        apiKey
      );
      setCards((prev) => [...prev, created]);
      setIsNewCardModalOpen(false);
      setNewCardTitle('');
      setNewCardDesc('');
      onLogActivity?.('TRELLO_CARD_CREATED', `Created new card "${created.name}"`);
    } catch (err: any) {
      alert(`Failed to create card: ${err.message}`);
    } finally {
      setIsCreatingCard(false);
    }
  };

  // Load Member Report
  const handleOpenReportModal = async () => {
    setIsReportModalOpen(true);
    if (!integration || !apiKey) return;
    setIsLoadingReport(true);
    try {
      const actions = await fetchMemberRecentActions(
        integration.trelloMemberId,
        integration.trelloToken || '',
        apiKey,
        50
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
    if (filterMyCardsOnly && integration?.trelloMemberId) {
      if (!card.idMembers || !card.idMembers.includes(integration.trelloMemberId)) {
        return false;
      }
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

  // Access restricted to Account Managers and Admins only
  if (currentUser.role !== 'admin' && currentUser.role !== 'account_manager') {
    return (
      <div className="my-trello-container" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', background: '#fff', borderRadius: '16px', padding: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔒</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>
            Access Restricted
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.5', margin: 0 }}>
            The Trello workspace is currently in private testing and is only accessible to Account Managers and Admins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-trello-container">
      {/* Top Header */}
      <div className="my-trello-header">
        <div className="my-trello-title-group">
          <div className="trello-icon-badge">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zm-9 14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v10zm8-5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5z" />
            </svg>
          </div>
          <div>
            <h1 className="my-trello-heading">My Trello</h1>
            <p className="my-trello-subheading">
              Manage your client cards, post updates, and automatically compile reports
            </p>
          </div>
        </div>

        {integration && (
          <div className="my-trello-profile-bar">
            <div className="trello-user-pill">
              {integration.trelloAvatarUrl ? (
                <img
                  src={integration.trelloAvatarUrl}
                  alt={integration.trelloFullName}
                  className="trello-user-avatar"
                />
              ) : (
                <div className="trello-user-initials">
                  {integration.trelloFullName.substring(0, 2).toUpperCase()}
                </div>
              )}
              <div className="trello-user-info">
                <span className="trello-user-name">{integration.trelloFullName}</span>
                <span className="trello-user-tag">@{integration.trelloUsername}</span>
                {integration.trelloEmail && (
                  <span className="trello-user-email">✉️ {integration.trelloEmail}</span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="trello-btn trello-btn--outline"
              onClick={() => {
                setEmailInput(integration.trelloEmail || currentUser.email || '');
                setTokenInput('');
                setIsSwitchingEmail(true);
              }}
              title="Connect with a different Trello account"
            >
              🔄 Switch Account
            </button>

            <button
              type="button"
              className="trello-btn trello-btn--secondary"
              onClick={handleOpenReportModal}
              title="Generate summary report for this account"
            >
              📊 Generate Report
            </button>

            <button
              type="button"
              className="trello-btn trello-btn--outline"
              onClick={handleDisconnect}
              title="Disconnect account"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {!integration || isSwitchingEmail ? (
        /* CONNECT SCREEN */
        <div className="trello-connect-card">
          <div className="trello-connect-hero">
            <div className="trello-hero-icon">
              <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48">
                <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zm-9 14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v10zm8-5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5z" />
              </svg>
            </div>
            <h2>{isSwitchingEmail ? 'Switch Trello Account' : 'Connect Your Trello Account'}</h2>
            <p>
              Signed in as: <strong>{currentUser.name}</strong> ({currentUser.email})
              <br />
              Link your personal Trello account once. From then on, logging into the dashboard with your email will automatically load your Trello account!
            </p>
          </div>

          {authError && <div className="trello-alert trello-alert--danger">{authError}</div>}

          <div className="trello-auth-steps">
            {/* Step 1 */}
            <div className="trello-step">
              <div className="trello-step-num">1</div>
              <div className="trello-step-content">
                <h3>Authorize Trello Account</h3>
                <p>
                  Click below to open Trello in a new tab. Log in with your Trello account and click &ldquo;Allow&rdquo; to generate your personal token.
                </p>
                <a
                  href={getTrelloAuthUrl(apiKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="trello-btn trello-btn--primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
                >
                  🔑 Authorize on Trello ↗
                </a>
              </div>
            </div>

            {/* Step 2 */}
            <div className="trello-step">
              <div className="trello-step-num">2</div>
              <div className="trello-step-content">
                <h3>Paste Your Token &amp; Connect</h3>
                <p>
                  Copy the 64-character token from Trello and paste it below. It will be permanently linked to your login email (<strong>{currentUser.email}</strong>).
                </p>

                <form onSubmit={handleConnectWithToken} className="trello-token-form">
                  <div className="trello-email-input-row">
                    <input
                      type="password"
                      className="trello-input"
                      placeholder="Paste your 64-character Trello Token..."
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      required
                      disabled={isConnecting}
                    />
                    <button
                      type="submit"
                      className="trello-btn trello-btn--primary"
                      disabled={isConnecting || !tokenInput.trim()}
                    >
                      {isConnecting ? 'Connecting...' : 'Connect Account'}
                    </button>
                    {isSwitchingEmail && (
                      <button
                        type="button"
                        className="trello-btn trello-btn--outline"
                        onClick={() => setIsSwitchingEmail(false)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>
            </div>

            {/* Quick Admin Option if available */}
            {defaultEnvToken && (currentUser.role === 'admin' || !integration) && (
              <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Are you the dashboard admin whose token is pre-configured in .env?
                </p>
                <button
                  type="button"
                  className="trello-btn trello-btn--secondary"
                  onClick={handleConnectWithEnvToken}
                  disabled={isConnecting}
                >
                  ⚡ Connect with Configured Admin Token
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* CONNECTED BOARD VIEW */
        <div className="my-trello-board-view">
          {/* Controls Bar */}
          <div className="trello-board-controls">
            <div className="trello-board-selector">
              <label htmlFor="trello-board-select">Active Board:</label>
              <select
                id="trello-board-select"
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
                onClick={loadBoards}
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

              <label className="trello-checkbox-label">
                <input
                  type="checkbox"
                  checked={filterMyCardsOnly}
                  onChange={(e) => setFilterMyCardsOnly(e.target.checked)}
                />
                Assigned to me only
              </label>

              <button
                type="button"
                className="trello-btn trello-btn--primary"
                onClick={() => setIsNewCardModalOpen(true)}
              >
                + Add Card
              </button>
            </div>
          </div>

          {boardError && <div className="trello-alert trello-alert--danger">{boardError}</div>}

          {/* Kanban Board Columns */}
          {isLoadingCards ? (
            <div className="trello-loading-state">
              <span className="trello-spinner"></span>
              Loading cards from Trello...
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
                          const isAssignedToMe =
                            integration?.trelloMemberId &&
                            card.idMembers?.includes(integration.trelloMemberId);

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
                                        className={`trello-card-label trello-card-label--${lbl.color || 'blue'}`}
                                      >
                                        {lbl.name || lbl.color}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {isAssignedToMe && (
                                  <span className="trello-badge trello-badge--mine">Assigned to you</span>
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
                                  title={isComplete ? 'Mark pending' : 'Mark complete'}
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

      {/* CARD DETAIL & EDIT MODAL */}
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
              {/* Card Controls */}
              <div className="trello-card-quick-actions">
                <div className="trello-action-field">
                  <label>Move Status / List:</label>
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
                <h3>💬 Progress Updates & Remarks</h3>
                <form onSubmit={handleAddComment} className="trello-comment-form">
                  <textarea
                    className="trello-textarea"
                    placeholder="Add a progress update, remark, or client note..."
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
                      {isSubmittingComment ? 'Posting to Trello...' : 'Post Update to Trello'}
                    </button>
                  </div>
                </form>

                {/* Comment Feed */}
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

      {/* NEW CARD MODAL */}
      {isNewCardModalOpen && (
        <div className="trello-modal-backdrop" onClick={() => setIsNewCardModalOpen(false)}>
          <div className="trello-modal trello-modal--small" onClick={(e) => e.stopPropagation()}>
            <div className="trello-modal-header">
              <h2>+ Create New Card</h2>
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
                  placeholder="e.g. Prepare monthly review for Client X"
                  value={newCardTitle}
                  onChange={(e) => setNewCardTitle(e.target.value)}
                  required
                />
              </div>

              <div className="trello-form-group">
                <label>Description / Notes:</label>
                <textarea
                  className="trello-textarea"
                  rows={3}
                  placeholder="Task scope or details..."
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
                  {isCreatingCard ? 'Creating...' : 'Create Card in Trello'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REPORT SUMMARY MODAL */}
      {isReportModalOpen && (
        <div className="trello-modal-backdrop" onClick={() => setIsReportModalOpen(false)}>
          <div className="trello-modal trello-modal--report" onClick={(e) => e.stopPropagation()}>
            <div className="trello-modal-header">
              <div className="trello-modal-title-box">
                <span className="trello-modal-badge">Progress Report</span>
                <h2>{integration?.trelloFullName} - Work Summary</h2>
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

              {/* Metrics cards */}
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
                  <span className="trello-metric-lbl">In Progress / Pending</span>
                </div>
                <div className="trello-metric-box trello-metric-box--info">
                  <span className="trello-metric-val">{filteredReportActions.length}</span>
                  <span className="trello-metric-lbl">Updates Logged</span>
                </div>
              </div>

              {/* Updates Feed */}
              <div className="trello-report-section">
                <h3>Recent Work Updates & Comments</h3>
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
