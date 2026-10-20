import React, { useEffect, useState } from 'react';
import {
  Complaint,
  ComplaintPriority,
  ComplaintStatus,
  PageView,
  UserAccount,
} from './types';
import { AUTHORIZED_USERS } from './data/users';
import { INITIAL_COMPLAINTS } from './data/initialComplaints';
import { Login } from './components/Login/Login';
import { Navbar } from './components/Navbar/Navbar';
import { HomePage } from './components/HomePage/HomePage';
import { ComplaintPage } from './components/ComplaintPage/ComplaintPage';
import './App.css';

const STORAGE_KEY_COMPLAINTS = 'wm_portal_complaints_v1';
const STORAGE_KEY_SESSION = 'wm_portal_active_user_v1';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_SESSION);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as UserAccount;
      // Re-validate against authorized users list
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

  const [complaints, setComplaints] = useState<Complaint[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_COMPLAINTS);
      if (saved) {
        return JSON.parse(saved) as Complaint[];
      }
    } catch {
      // Fallback to initial data
    }
    return INITIAL_COMPLAINTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_COMPLAINTS, JSON.stringify(complaints));
    } catch {
      // Ignore storage quota errors
    }
  }, [complaints]);

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

  const formatTimestamp = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  };

  const handleCreateComplaint = (
    newComplaintData: Omit<Complaint, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>
  ) => {
    const nextNumber = complaints.length + 1;
    const paddedNumber = String(nextNumber).padStart(3, '0');
    const nowStr = formatTimestamp();

    const created: Complaint = {
      ...newComplaintData,
      id: `cmp-${Date.now()}`,
      ticketNumber: `WM-2026-${paddedNumber}`,
      createdAt: nowStr,
      updatedAt: nowStr,
    };

    setComplaints((prev) => [created, ...prev]);
  };

  const handleUpdateComplaint = (
    id: string,
    updates: {
      status: ComplaintStatus;
      priority: ComplaintPriority;
      managerRemarks: string;
    }
  ) => {
    const nowStr = formatTimestamp();
    setComplaints((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: updates.status,
              priority: updates.priority,
              managerRemarks: updates.managerRemarks,
              updatedAt: nowStr,
            }
          : item
      )
    );
  };

  const handleDeleteComplaint = (id: string) => {
    setComplaints((prev) => prev.filter((item) => item.id !== id));
  };

  if (!currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const openComplaintsCount =
    currentUser.role === 'account_manager'
      ? complaints.filter(
          (c) =>
            c.submittedByEmail.toLowerCase() === currentUser.email.toLowerCase() &&
            c.status !== 'Resolved'
        ).length
      : complaints.filter((c) => c.status !== 'Resolved').length;

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
            onCreateComplaint={handleCreateComplaint}
            onUpdateComplaint={handleUpdateComplaint}
            onDeleteComplaint={handleDeleteComplaint}
          />
        )}
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>
            WM Enterprise Management System &bull; Logged in as{' '}
            <strong>{currentUser.email}</strong> ({currentUser.roleLabel})
          </span>
          <span>Responsive Layout: TV &bull; Laptop &bull; Mobile</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
