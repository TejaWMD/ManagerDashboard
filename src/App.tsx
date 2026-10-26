import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Query,
  DELAY_THRESHOLD_MS,
  getQueryTimestampMs,
  isQueryDelayed,
  isQueryDone,
  PageView,
  UserAccount,
} from './types';
import { AUTHORIZED_USERS } from './data/users';
import { INITIAL_QUERIES } from './data/initialQueries';
import {
  QueryRow,
  ensureUsersSeededInDb,
  fetchQueriesFromDb,
  fetchUsersFromDb,
  insertQueryInDb,
  mapRowToQuery,
  supabase,
  updateQueryInDb,
} from './lib/supabase';
import {
  registerServiceWorker,
  showWebNotification,
} from './lib/notifications';
import { dispatchQueryPushNotification } from './lib/pushDispatcher';
import { checkAndNotifyDelayedQueries } from './lib/slaDelayChecker';
import { Login } from './components/Login/Login';
import { Navbar } from './components/Navbar/Navbar';
import { HomePage } from './components/HomePage/HomePage';
import { QueryPage } from './components/QueryPage/QueryPage';
import { KPIPage } from './components/KPIPage/KPIPage';
import { NotificationModal } from './components/NotificationModal/NotificationModal';
import { NotificationBanner } from './components/NotificationBanner/NotificationBanner';
import sqlSchemaText from '../supabase_schema.sql?raw';
import './App.css';

const OLD_DUMMY_STORAGE_KEY = 'wm_portal_queries_v1';
const STORAGE_KEY_QUERIES = 'wm_portal_queries_v3';
const STORAGE_KEY_SESSION = 'wm_portal_active_user_v1';

function persistQueriesCache(list: Query[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_QUERIES, JSON.stringify(list));
  } catch {
    // Ignore storage errors
  }
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_SESSION);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as UserAccount;
      const verified = AUTHORIZED_USERS.find(
        (u) =>
          u.email.toLowerCase() === parsed.email.toLowerCase() &&
          u.password === parsed.password &&
          u.role === parsed.role
      );
      return verified || null;
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState<PageView>('home');
  const [tvMode, setTvMode] = useState<boolean>(false);
  const [allUsers, setAllUsers] = useState<UserAccount[]>(AUTHORIZED_USERS);
  const [isNotifModalOpen, setIsNotifModalOpen] = useState<boolean>(false);

  const [queries, setQueries] = useState<Query[]>(INITIAL_QUERIES);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);
  const [dbTableMissing, setDbTableMissing] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [savingQueryId, setSavingQueryId] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  // Keep fresh references for realtime subscription closures
  const currentUserRef = useRef<UserAccount | null>(currentUser);
  currentUserRef.current = currentUser;
  const queriesRef = useRef<Query[]>(queries);
  queriesRef.current = queries;

  // Initialize Service Worker for Web Push and fetch updated user phone & keys
  useEffect(() => {
    registerServiceWorker();
    fetchUsersFromDb().then((users) => {
      if (users && users.length > 0) {
        setAllUsers(users);
      }
    });
  }, []);

  // Monitor for SLA delay breaches and dispatch push notifications
  useEffect(() => {
    if (queries.length === 0) return;
    checkAndNotifyDelayedQueries(queries);

    const delayTimer = window.setInterval(() => {
      if (queriesRef.current.length > 0) {
        checkAndNotifyDelayedQueries(queriesRef.current);
      }
    }, 60 * 1000); // Check every minute

    return () => window.clearInterval(delayTimer);
  }, [queries.length]);

  const loadQueries = useCallback(async () => {
    setIsLoadingDb(true);
    try {
      localStorage.removeItem(OLD_DUMMY_STORAGE_KEY);
      localStorage.removeItem('wm_portal_queries_v2');
    } catch {
      // Ignore storage errors
    }

    await ensureUsersSeededInDb();
    const result = await fetchQueriesFromDb();
    if (result.error) {
      setDbTableMissing(result.tableMissing);
      setDbError(result.error);
      try {
        const cached = localStorage.getItem(STORAGE_KEY_QUERIES);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setQueries(parsed as Query[]);
          }
        }
      } catch {
        // Ignore
      }
    } else {
      setDbTableMissing(false);
      setDbError(null);
      setQueries(result.data);
      persistQueriesCache(result.data);
    }
    setIsLoadingDb(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        loadQueries(),
        fetchUsersFromDb().then((users) => {
          if (users && users.length > 0) {
            setAllUsers(users);
          }
        }),
      ]);
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      setLastRefreshedAt(`${hh}:${mm}:${ss}`);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 450);
    }
  }, [loadQueries]);

  useEffect(() => {
    loadQueries();

    const channel = supabase
      .channel('public:queries')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queries' },
        (payload) => {
          const user = currentUserRef.current;

          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = mapRowToQuery(payload.new as QueryRow);
            setQueries((prev) => {
              const exists = prev.some((c) => c.queryId === incoming.queryId);
              const next = exists
                ? prev.map((c) =>
                    c.queryId === incoming.queryId ? incoming : c
                  )
                : [incoming, ...prev];
              persistQueriesCache(next);
              return next;
            });

            // Trigger real-time browser/system notification on receiver's device
            if (user && incoming.accountManagerId !== user.id) {
              const senderObj = AUTHORIZED_USERS.find(
                (u) => u.id === incoming.accountManagerId
              );
              const senderRolePrefix =
                senderObj?.role === 'manager'
                  ? 'Manager'
                  : senderObj?.role === 'account_manager'
                  ? 'Account Manager'
                  : '';
              const senderLabel = senderRolePrefix
                ? `${senderRolePrefix} ${incoming.accountManagerName}`
                : incoming.accountManagerName;

              if (user.role === 'admin') {
                showWebNotification(
                  '🚨 New Query Created',
                  `${senderLabel} submitted ${incoming.queryId} to Manager ${incoming.managerName}`
                );
              } else if (user.id === incoming.managerId) {
                showWebNotification(
                  '🚨 New Query Assigned',
                  `${senderLabel} assigned ${incoming.queryId} to you`
                );
              }
            }
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = mapRowToQuery(payload.new as QueryRow);
            const prevItem = queriesRef.current.find((c) => c.queryId === updated.queryId);

            setQueries((prev) => {
              const next = prev.map((c) =>
                c.queryId === updated.queryId ? updated : c
              );
              persistQueriesCache(next);
              return next;
            });

            // Trigger real-time browser/system notifications for relevant receivers
            if (prevItem && user) {
              const senderObj = AUTHORIZED_USERS.find(
                (u) => u.id === updated.accountManagerId
              );
              const senderRolePrefix =
                senderObj?.role === 'manager'
                  ? 'Manager'
                  : senderObj?.role === 'account_manager'
                  ? 'Account Manager'
                  : '';
              const senderLabel = senderRolePrefix
                ? `${senderRolePrefix} ${updated.accountManagerName}`
                : updated.accountManagerName;

              if (updated.status === 'Completed' && prevItem.status !== 'Completed') {
                if (user.id === updated.managerId || user.role === 'admin') {
                  showWebNotification(
                    '🎉 Query Completed',
                    `${updated.queryId} marked Completed by ${senderLabel}!`
                  );
                }
              } else if (updated.managerDone !== prevItem.managerDone) {
                if (user.id === updated.accountManagerId || user.role === 'admin') {
                  showWebNotification(
                    updated.managerDone ? '✅ Manager Marked Done' : '↩️ Manager Unmarked Done',
                    `Manager ${updated.managerName} ${updated.managerDone ? 'marked Done on' : 'unmarked'} ${updated.queryId}`
                  );
                }
              } else if (
                updated.managerRemarkTitle !== prevItem.managerRemarkTitle ||
                updated.managerRemark !== prevItem.managerRemark
              ) {
                if (user.id === updated.accountManagerId || user.role === 'admin') {
                  const mgrRemarkSummary =
                    updated.managerRemarkTitle || updated.managerRemark;
                  showWebNotification(
                    '💬 Manager Added Remark',
                    `Manager ${updated.managerName} on ${updated.queryId}: "${mgrRemarkSummary}"`
                  );
                }
              } else if (
                updated.accountManagerRemarkTitle !==
                  prevItem.accountManagerRemarkTitle ||
                updated.accountManagerRemark !== prevItem.accountManagerRemark
              ) {
                if (user.id === updated.managerId || user.role === 'admin') {
                  const amRemarkSummary =
                    updated.accountManagerRemarkTitle ||
                    updated.accountManagerRemark;
                  showWebNotification(
                    `💬 ${senderRolePrefix || 'Sender'} Added Remark`,
                    `${senderLabel} on ${updated.queryId}: "${amRemarkSummary}"`
                  );
                }
              }
            }
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedId = (payload.old as { query_id?: string }).query_id;
            if (deletedId) {
              setQueries((prev) => {
                const next = prev.filter((c) => c.queryId !== deletedId);
                persistQueriesCache(next);
                return next;
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadQueries]);

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    setActivePage('home');
    try {
      sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(user));
    } catch {
      // Ignore storage errors
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActivePage('home');
    try {
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // Ignore
    }
  };

  const formatTimestamp = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
  };

  const generateNextQueryId = (list: Query[]): string => {
    let maxNum = 0;
    for (const item of list) {
      const match = item.queryId.match(/QRY-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!Number.isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const nextNumber = maxNum + 1;
    return `QRY-${String(nextNumber).padStart(3, '0')}`;
  };

  const handleCreateQuery = async (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    queryTitle: string;
    queryText: string;
  }) => {
    if (!currentUser) return;
    const now = new Date();
    const tempQueryId = generateNextQueryId(queries);

    const created: Query = {
      id: tempQueryId,
      queryId: tempQueryId,
      createdAt: formatTimestamp(now),
      createdAtMs: now.getTime(),
      completedAt: null,
      completedAtMs: null,
      isDelayed: false,
      accountManagerId: currentUser.id,
      accountManagerEmail: currentUser.email,
      accountManagerName: currentUser.name,
      managerId: payload.managerId,
      managerEmail: payload.managerEmail,
      managerName: payload.managerName,
      queryTitle: payload.queryTitle,
      queryText: payload.queryText,
      managerRemarkTitle: '',
      managerRemark: '',
      managerDone: false,
      accountManagerRemarkTitle: '',
      accountManagerRemark: '',
      accountManagerDone: false,
      status: 'Pending',
    };

    setQueries((prev) => {
      const next = [created, ...prev];
      persistQueriesCache(next);
      return next;
    });

    const { data, error } = await insertQueryInDb(created);
    if (error) {
      setDbError(error);
      // Roll back optimistic insert on error
      setQueries((prev) => {
        const rolledBack = prev.filter((c) => c.queryId !== tempQueryId);
        persistQueriesCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setQueries((prev) => {
        const withoutTemp = prev.filter(
          (c) => c.queryId !== tempQueryId && c.queryId !== data.queryId
        );
        const next = [data, ...withoutTemp];
        persistQueriesCache(next);
        return next;
      });

      // Dispatch desktop background push notification to assigned Manager & Admin
      dispatchQueryPushNotification({
        event: 'NEW_QUERY',
        query: data,
        actor: currentUser,
      });
    }
  };

  const handleUpdateQuery = async (
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
      >
    >
  ) => {
    if (!currentUser) return;
    const existing = queries.find((c) => c.queryId === queryId);
    if (!existing) return;

    const now = new Date();
    const nowMs = now.getTime();
    const createdMs = getQueryTimestampMs(existing);

    const nextManagerDone =
      updates.managerDone !== undefined
        ? updates.managerDone
        : existing.managerDone;

    // Anti-cheat dedicated manager resolution timestamp
    const nextManagerDoneAt = nextManagerDone
      ? existing.managerDoneAt || formatTimestamp(now)
      : null;
    const nextManagerDoneAtMs = nextManagerDone
      ? existing.managerDoneAtMs || nowMs
      : null;

    // Account Manager cannot stay done if Manager Done is unchecked
    const nextAccountManagerDone = !nextManagerDone
      ? false
      : updates.accountManagerDone !== undefined
      ? updates.accountManagerDone
      : existing.accountManagerDone;

    const nextIsCompleted = Boolean(nextManagerDone && nextAccountManagerDone);
    const nextStatus = nextIsCompleted ? 'Completed' : 'Pending';

    const nextCompletedAt = nextIsCompleted
      ? existing.completedAt || formatTimestamp(now)
      : null;
    const nextCompletedAtMs = nextIsCompleted
      ? existing.completedAtMs || nowMs
      : null;

    // Once delayed (>48h), it stays delayed even when both Manager Done & AM Done are checked
    const wasAlreadyDelayed = isQueryDelayed(existing, nowMs);
    const nextIsDelayed = nextIsCompleted
      ? Boolean(
          wasAlreadyDelayed ||
            (createdMs > 0 &&
              nextCompletedAtMs !== null &&
              nextCompletedAtMs - createdMs > DELAY_THRESHOLD_MS)
        )
      : Boolean(createdMs > 0 && nowMs - createdMs > DELAY_THRESHOLD_MS);

    const optimisticItem: Query = {
      ...existing,
      ...updates,
      managerDone: nextManagerDone,
      managerDoneAt: nextManagerDoneAt,
      managerDoneAtMs: nextManagerDoneAtMs,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      createdAt: existing.createdAt,
      createdAtMs: existing.createdAtMs,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
    };

    setSavingQueryId(queryId);

    setQueries((prev) => {
      const next = prev.map((item) =>
        item.queryId === queryId ? optimisticItem : item
      );
      persistQueriesCache(next);
      return next;
    });

    const { data, error } = await updateQueryInDb(queryId, {
      ...updates,
      managerDone: nextManagerDone,
      managerDoneAt: nextManagerDoneAt,
      managerDoneAtMs: nextManagerDoneAtMs,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
    });

    setSavingQueryId(null);

    if (error) {
      setDbError(error);
      // Roll back optimistic update on error
      setQueries((prev) => {
        const rolledBack = prev.map((item) =>
          item.queryId === queryId ? existing : item
        );
        persistQueriesCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setQueries((prev) => {
        const next = prev.map((item) =>
          item.queryId === queryId ? data : item
        );
        persistQueriesCache(next);
        return next;
      });

      // Dispatch desktop background push notifications to involved users & admin
      if (
        updates.managerDone !== undefined &&
        updates.managerDone !== existing.managerDone &&
        updates.managerDone
      ) {
        dispatchQueryPushNotification({
          event: 'MANAGER_DONE',
          query: data,
          actor: currentUser,
          isDone: true,
        });
      } else if (
        updates.accountManagerDone !== undefined &&
        updates.accountManagerDone !== existing.accountManagerDone &&
        updates.accountManagerDone
      ) {
        dispatchQueryPushNotification({
          event: 'AM_DONE',
          query: data,
          actor: currentUser,
          isDone: true,
        });
      }

      if (
        (updates.managerRemarkTitle !== undefined ||
          updates.managerRemark !== undefined) &&
        ((updates.managerRemarkTitle ?? existing.managerRemarkTitle).trim() !==
          (existing.managerRemarkTitle || '').trim() ||
          (updates.managerRemark ?? existing.managerRemark).trim() !==
            (existing.managerRemark || '').trim()) &&
        ((updates.managerRemarkTitle ?? '').trim() ||
          (updates.managerRemark ?? '').trim())
      ) {
        dispatchQueryPushNotification({
          event: 'MANAGER_REMARK',
          query: data,
          actor: currentUser,
          remarkText:
            (updates.managerRemarkTitle ?? '').trim() ||
            (updates.managerRemark ?? '').trim(),
        });
      } else if (
        (updates.accountManagerRemarkTitle !== undefined ||
          updates.accountManagerRemark !== undefined) &&
        ((
          updates.accountManagerRemarkTitle ??
          existing.accountManagerRemarkTitle
        ).trim() !== (existing.accountManagerRemarkTitle || '').trim() ||
          (updates.accountManagerRemark ?? existing.accountManagerRemark).trim() !==
            (existing.accountManagerRemark || '').trim()) &&
        ((updates.accountManagerRemarkTitle ?? '').trim() ||
          (updates.accountManagerRemark ?? '').trim())
      ) {
        dispatchQueryPushNotification({
          event: 'AM_REMARK',
          query: data,
          actor: currentUser,
          remarkText:
            (updates.accountManagerRemarkTitle ?? '').trim() ||
            (updates.accountManagerRemark ?? '').trim(),
        });
      }
    }
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(sqlSchemaText);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      // Fallback
    }
  };

  if (!currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const openQueriesCount = queries.filter((c) => {
    if (isQueryDone(c)) return false;
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
  }).length;

  return (
    <div className={`app-shell ${tvMode ? 'app-shell--tv-mode' : ''}`}>
      <Navbar
        currentUser={currentUser}
        activePage={activePage}
        onNavigate={setActivePage}
        onLogout={handleLogout}
        tvMode={tvMode}
        onToggleTvMode={() => setTvMode((prev) => !prev)}
        openQueriesCount={openQueriesCount}
        onOpenNotifications={() => setIsNotifModalOpen(true)}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing || isLoadingDb}
        lastRefreshedAt={lastRefreshedAt}
      />

      <div className={`app-body-column app-body-column--${activePage}`}>
        {dbTableMissing && (
          <div className="db-setup-banner" role="alert">
            <span>Database tables not initialized.</span>
            <div className="db-setup-banner-actions">
              <button
                type="button"
                className="db-banner-btn db-banner-btn--primary"
                onClick={handleCopySql}
              >
                {copiedSql ? 'Copied SQL' : 'Copy SQL'}
              </button>
              <button
                type="button"
                className="db-banner-btn"
                onClick={loadQueries}
                disabled={isLoadingDb}
              >
                {isLoadingDb ? '...' : 'Retry'}
              </button>
            </div>
          </div>
        )}

        {!dbTableMissing && dbError && (
          <div className="db-error-banner" role="alert">
            <span>{dbError}</span>
            <button
              type="button"
              className="db-banner-btn"
              onClick={loadQueries}
            >
              Retry
            </button>
          </div>
        )}

        <NotificationBanner currentUser={currentUser} />

        <main className={`app-main-content app-main-content--${activePage}`}>
          {activePage === 'home' ? (
            <HomePage
              currentUser={currentUser}
              queries={queries}
              users={allUsers}
              onNavigate={setActivePage}
            />
          ) : activePage === 'kpi' ? (
            <KPIPage
              currentUser={currentUser}
              queries={queries}
              users={allUsers}
              onNavigate={setActivePage}
            />
          ) : (
            <QueryPage
              currentUser={currentUser}
              queries={queries}
              savingQueryId={savingQueryId}
              onCreateQuery={handleCreateQuery}
              onUpdateQuery={handleUpdateQuery}
            />
          )}
        </main>
      </div>

      <NotificationModal
        isOpen={isNotifModalOpen}
        onClose={() => setIsNotifModalOpen(false)}
        currentUser={currentUser}
      />
    </div>
  );
};

export default App;
