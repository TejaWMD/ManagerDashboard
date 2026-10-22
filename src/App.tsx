import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  DELAY_THRESHOLD_MS,
  getComplaintTimestampMs,
  isComplaintDelayed,
  isComplaintDone,
  PageView,
  UserAccount,
} from './types';
import { AUTHORIZED_USERS } from './data/users';
import { INITIAL_COMPLAINTS } from './data/initialComplaints';
import {
  ComplaintRow,
  ensureUsersSeededInDb,
  fetchComplaintsFromDb,
  fetchUsersFromDb,
  insertComplaintInDb,
  mapRowToComplaint,
  supabase,
  updateComplaintInDb,
} from './lib/supabase';
import {
  registerServiceWorker,
  showWebNotification,
} from './lib/notifications';
import { Login } from './components/Login/Login';
import { Navbar } from './components/Navbar/Navbar';
import { HomePage } from './components/HomePage/HomePage';
import { ComplaintPage } from './components/ComplaintPage/ComplaintPage';
import { NotificationModal } from './components/NotificationModal/NotificationModal';
import sqlSchemaText from '../supabase_schema.sql?raw';
import './App.css';

const OLD_DUMMY_STORAGE_KEY = 'wm_portal_complaints_v1';
const STORAGE_KEY_COMPLAINTS = 'wm_portal_complaints_v3';
const STORAGE_KEY_SESSION = 'wm_portal_active_user_v1';

function persistComplaintsCache(list: Complaint[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_COMPLAINTS, JSON.stringify(list));
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

  const [complaints, setComplaints] = useState<Complaint[]>(INITIAL_COMPLAINTS);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);
  const [dbTableMissing, setDbTableMissing] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [savingComplaintId, setSavingComplaintId] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Keep fresh references for realtime subscription closures
  const currentUserRef = useRef<UserAccount | null>(currentUser);
  currentUserRef.current = currentUser;
  const complaintsRef = useRef<Complaint[]>(complaints);
  complaintsRef.current = complaints;

  // Initialize Service Worker for Web Push and fetch updated user phone & keys
  useEffect(() => {
    registerServiceWorker();
    fetchUsersFromDb().then((users) => {
      if (users && users.length > 0) {
        setAllUsers(users);
      }
    });
  }, []);

  const loadComplaints = useCallback(async () => {
    setIsLoadingDb(true);
    try {
      localStorage.removeItem(OLD_DUMMY_STORAGE_KEY);
      localStorage.removeItem('wm_portal_complaints_v2');
    } catch {
      // Ignore storage errors
    }

    await ensureUsersSeededInDb();
    const result = await fetchComplaintsFromDb();
    if (result.error) {
      setDbTableMissing(result.tableMissing);
      setDbError(result.error);
      try {
        const cached = localStorage.getItem(STORAGE_KEY_COMPLAINTS);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setComplaints(parsed as Complaint[]);
          }
        }
      } catch {
        // Ignore
      }
    } else {
      setDbTableMissing(false);
      setDbError(null);
      setComplaints(result.data);
      persistComplaintsCache(result.data);
    }
    setIsLoadingDb(false);
  }, []);

  useEffect(() => {
    loadComplaints();

    const channel = supabase
      .channel('public:complaints')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'complaints' },
        (payload) => {
          const user = currentUserRef.current;

          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = mapRowToComplaint(payload.new as ComplaintRow);
            setComplaints((prev) => {
              const exists = prev.some((c) => c.complaintId === incoming.complaintId);
              const next = exists
                ? prev.map((c) =>
                    c.complaintId === incoming.complaintId ? incoming : c
                  )
                : [incoming, ...prev];
              persistComplaintsCache(next);
              return next;
            });

            // Trigger real-time browser/system notification on receiver's device
            if (user && incoming.accountManagerId !== user.id) {
              if (user.role === 'admin') {
                showWebNotification(
                  '🚨 New Complaint Created',
                  `${incoming.accountManagerName} submitted ${incoming.complaintId} to ${incoming.managerName}`
                );
              } else if (user.id === incoming.managerId) {
                showWebNotification(
                  '🚨 New Complaint Assigned',
                  `${incoming.accountManagerName} assigned ${incoming.complaintId} to you`
                );
              }
            }
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = mapRowToComplaint(payload.new as ComplaintRow);
            const prevItem = complaintsRef.current.find((c) => c.complaintId === updated.complaintId);

            setComplaints((prev) => {
              const next = prev.map((c) =>
                c.complaintId === updated.complaintId ? updated : c
              );
              persistComplaintsCache(next);
              return next;
            });

            // Trigger real-time browser/system notifications for relevant receivers
            if (prevItem && user) {
              if (updated.status === 'Completed' && prevItem.status !== 'Completed') {
                if (user.id === updated.managerId || user.role === 'admin') {
                  showWebNotification(
                    '🎉 Complaint Completed',
                    `${updated.complaintId} marked Completed by ${updated.accountManagerName}!`
                  );
                }
              } else if (updated.managerDone !== prevItem.managerDone) {
                if (user.id === updated.accountManagerId || user.role === 'admin') {
                  showWebNotification(
                    updated.managerDone ? '✅ Manager Marked Done' : '↩️ Manager Unmarked Done',
                    `Manager ${updated.managerName} ${updated.managerDone ? 'marked Done on' : 'unmarked'} ${updated.complaintId}`
                  );
                }
              } else if (updated.managerRemark !== prevItem.managerRemark) {
                if (user.id === updated.accountManagerId || user.role === 'admin') {
                  showWebNotification(
                    '💬 Manager Added Remark',
                    `Manager ${updated.managerName} on ${updated.complaintId}: "${updated.managerRemark}"`
                  );
                }
              } else if (updated.accountManagerRemark !== prevItem.accountManagerRemark) {
                if (user.id === updated.managerId || user.role === 'admin') {
                  showWebNotification(
                    '💬 AM Added Remark',
                    `AM ${updated.accountManagerName} on ${updated.complaintId}: "${updated.accountManagerRemark}"`
                  );
                }
              }
            }
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedId = (payload.old as { complaint_id?: string }).complaint_id;
            if (deletedId) {
              setComplaints((prev) => {
                const next = prev.filter((c) => c.complaintId !== deletedId);
                persistComplaintsCache(next);
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
  }, [loadComplaints]);

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

  const generateNextComplaintId = (list: Complaint[]): string => {
    let maxNum = 0;
    for (const item of list) {
      const match = item.complaintId.match(/CMP-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!Number.isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const nextNumber = maxNum + 1;
    return `CMP-${String(nextNumber).padStart(3, '0')}`;
  };

  const handleCreateComplaint = async (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    complaintText: string;
  }) => {
    if (!currentUser) return;
    const now = new Date();
    const tempComplaintId = generateNextComplaintId(complaints);

    const created: Complaint = {
      id: tempComplaintId,
      complaintId: tempComplaintId,
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
      complaintText: payload.complaintText,
      managerRemark: '',
      managerDone: false,
      accountManagerRemark: '',
      accountManagerDone: false,
      status: 'Pending',
    };

    setComplaints((prev) => {
      const next = [created, ...prev];
      persistComplaintsCache(next);
      return next;
    });

    const { data, error } = await insertComplaintInDb(created);
    if (error) {
      setDbError(error);
      // Roll back optimistic insert on error
      setComplaints((prev) => {
        const rolledBack = prev.filter((c) => c.complaintId !== tempComplaintId);
        persistComplaintsCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setComplaints((prev) => {
        const withoutTemp = prev.filter(
          (c) => c.complaintId !== tempComplaintId && c.complaintId !== data.complaintId
        );
        const next = [data, ...withoutTemp];
        persistComplaintsCache(next);
        return next;
      });
    }
  };

  const handleUpdateComplaint = async (
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
  ) => {
    if (!currentUser) return;
    const existing = complaints.find((c) => c.complaintId === complaintId);
    if (!existing) return;

    const now = new Date();
    const nowMs = now.getTime();
    const createdMs = getComplaintTimestampMs(existing);

    const nextManagerDone =
      updates.managerDone !== undefined
        ? updates.managerDone
        : existing.managerDone;

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

    // Once delayed (>24h), it stays delayed even when both Manager Done & AM Done are checked
    const wasAlreadyDelayed = isComplaintDelayed(existing, nowMs);
    const nextIsDelayed = nextIsCompleted
      ? Boolean(
          wasAlreadyDelayed ||
            (createdMs > 0 &&
              nextCompletedAtMs !== null &&
              nextCompletedAtMs - createdMs > DELAY_THRESHOLD_MS)
        )
      : Boolean(createdMs > 0 && nowMs - createdMs > DELAY_THRESHOLD_MS);

    const optimisticItem: Complaint = {
      ...existing,
      ...updates,
      managerDone: nextManagerDone,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      createdAt: existing.createdAt,
      createdAtMs: existing.createdAtMs,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
    };

    setSavingComplaintId(complaintId);

    setComplaints((prev) => {
      const next = prev.map((item) =>
        item.complaintId === complaintId ? optimisticItem : item
      );
      persistComplaintsCache(next);
      return next;
    });

    const { data, error } = await updateComplaintInDb(complaintId, {
      ...updates,
      managerDone: nextManagerDone,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
    });

    setSavingComplaintId(null);

    if (error) {
      setDbError(error);
      // Roll back optimistic update on error
      setComplaints((prev) => {
        const rolledBack = prev.map((item) =>
          item.complaintId === complaintId ? existing : item
        );
        persistComplaintsCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setComplaints((prev) => {
        const next = prev.map((item) =>
          item.complaintId === complaintId ? data : item
        );
        persistComplaintsCache(next);
        return next;
      });
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

  const openComplaintsCount = complaints.filter((c) => {
    if (isComplaintDone(c)) return false;
    if (currentUser.role === 'account_manager') {
      return belongsToAccountManager(c, currentUser);
    }
    if (currentUser.role === 'manager') {
      return belongsToManager(c, currentUser);
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
        openComplaintsCount={openComplaintsCount}
        onOpenNotifications={() => setIsNotifModalOpen(true)}
      />

      <div className="app-body-column">
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
                onClick={loadComplaints}
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
              onClick={loadComplaints}
            >
              Retry
            </button>
          </div>
        )}

        <main className="app-main-content">
          {activePage === 'home' ? (
            <HomePage
              currentUser={currentUser}
              complaints={complaints}
              users={allUsers}
              onNavigate={setActivePage}
            />
          ) : (
            <ComplaintPage
              currentUser={currentUser}
              complaints={complaints}
              savingComplaintId={savingComplaintId}
              onCreateComplaint={handleCreateComplaint}
              onUpdateComplaint={handleUpdateComplaint}
            />
          )}
        </main>
      </div>

      <NotificationModal
        isOpen={isNotifModalOpen}
        onClose={() => setIsNotifModalOpen(false)}
      />
    </div>
  );
};

export default App;
