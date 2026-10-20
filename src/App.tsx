import React, { useCallback, useEffect, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  isComplaintDone,
  PageView,
  UserAccount,
} from './types';
import { AUTHORIZED_USERS } from './data/users';
import { INITIAL_COMPLAINTS } from './data/initialComplaints';
import {
  ComplaintRow,
  fetchComplaintsFromDb,
  insertComplaintInDb,
  mapRowToComplaint,
  supabase,
  updateComplaintInDb,
} from './lib/supabase';
import { Login } from './components/Login/Login';
import { Navbar } from './components/Navbar/Navbar';
import { HomePage } from './components/HomePage/HomePage';
import { ComplaintPage } from './components/ComplaintPage/ComplaintPage';
import sqlSchemaText from '../supabase_schema.sql?raw';
import './App.css';

const OLD_DUMMY_STORAGE_KEY = 'wm_portal_complaints_v1';
const STORAGE_KEY_COMPLAINTS = 'wm_portal_complaints_v3';
const STORAGE_KEY_SESSION = 'wm_portal_active_user_v1';

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

  const [complaints, setComplaints] = useState<Complaint[]>(INITIAL_COMPLAINTS);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);
  const [dbTableMissing, setDbTableMissing] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [savingComplaintId, setSavingComplaintId] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const loadComplaints = useCallback(async () => {
    setIsLoadingDb(true);
    try {
      localStorage.removeItem(OLD_DUMMY_STORAGE_KEY);
      localStorage.removeItem('wm_portal_complaints_v2');
    } catch {
      // Ignore storage errors
    }

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
      try {
        localStorage.setItem(STORAGE_KEY_COMPLAINTS, JSON.stringify(result.data));
      } catch {
        // Ignore
      }
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
          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = mapRowToComplaint(payload.new as ComplaintRow);
            setComplaints((prev) => {
              const exists = prev.some((c) => c.complaintId === incoming.complaintId);
              if (exists) {
                return prev.map((c) =>
                  c.complaintId === incoming.complaintId ? incoming : c
                );
              }
              return [incoming, ...prev];
            });
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = mapRowToComplaint(payload.new as ComplaintRow);
            setComplaints((prev) =>
              prev.map((c) =>
                c.complaintId === updated.complaintId ? updated : c
              )
            );
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedId = (payload.old as { complaint_id?: string }).complaint_id;
            if (deletedId) {
              setComplaints((prev) =>
                prev.filter((c) => c.complaintId !== deletedId)
              );
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
    const nextComplaintId = generateNextComplaintId(complaints);

    const created: Complaint = {
      id: nextComplaintId,
      complaintId: nextComplaintId,
      createdAt: formatTimestamp(now),
      createdAtMs: now.getTime(),
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
      try {
        localStorage.setItem(STORAGE_KEY_COMPLAINTS, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });

    const { data, error } = await insertComplaintInDb(created);
    if (error) {
      setDbError(error);
    } else if (data) {
      setDbError(null);
      setComplaints((prev) =>
        prev.map((c) => (c.complaintId === data.complaintId ? data : c))
      );
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
    const existing = complaints.find((c) => c.complaintId === complaintId);
    if (!existing) return;

    const nextManagerDone =
      updates.managerDone !== undefined
        ? updates.managerDone
        : existing.managerDone;
    const nextAccountManagerDone =
      updates.accountManagerDone !== undefined
        ? updates.accountManagerDone
        : existing.accountManagerDone;

    const nextStatus =
      nextManagerDone && nextAccountManagerDone ? 'Completed' : 'Pending';

    const optimisticItem: Complaint = {
      ...existing,
      ...updates,
      managerDone: nextManagerDone,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      createdAt: existing.createdAt,
      createdAtMs: existing.createdAtMs,
    };

    setSavingComplaintId(complaintId);

    setComplaints((prev) => {
      const next = prev.map((item) =>
        item.complaintId === complaintId ? optimisticItem : item
      );
      try {
        localStorage.setItem(STORAGE_KEY_COMPLAINTS, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });

    const { data, error } = await updateComplaintInDb(complaintId, {
      ...updates,
      status: nextStatus,
    });

    setSavingComplaintId(null);

    if (error) {
      setDbError(error);
    } else if (data) {
      setDbError(null);
      setComplaints((prev) =>
        prev.map((item) => (item.complaintId === complaintId ? data : item))
      );
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
    </div>
  );
};

export default App;
