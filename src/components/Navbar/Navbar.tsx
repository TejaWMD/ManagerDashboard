import React from 'react';
import { PageView, UserAccount } from '../../types';
import './Navbar.css';

interface NavbarProps {
  currentUser: UserAccount;
  activePage: PageView;
  onNavigate: (page: PageView) => void;
  onLogout: () => void;
  tvMode: boolean;
  onToggleTvMode: () => void;
  openComplaintsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activePage,
  onNavigate,
  onLogout,
  tvMode,
  onToggleTvMode,
  openComplaintsCount,
}) => {
  return (
    <header className="top-navbar">
      <div className="navbar-inner">
        {/* Brand + Role Identity */}
        <div className="navbar-brand">
          <div className="navbar-logo" data-role={currentUser.role}>
            WM
          </div>
          <div className="navbar-brand-text">
            <div className="navbar-title-row">
              <span className="navbar-app-name">WM Portal</span>
              <span className="navbar-role-pill" data-role={currentUser.role}>
                {currentUser.roleLabel}
              </span>
            </div>
            <span className="navbar-dept">{currentUser.department}</span>
          </div>
        </div>

        {/* Navigation Links: Homepage & Complaint Page */}
        <nav className="navbar-links" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-link-btn ${activePage === 'home' ? 'nav-link-btn--active' : ''}`}
            onClick={() => onNavigate('home')}
          >
            <svg
              className="nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5z" />
            </svg>
            <span>Homepage</span>
          </button>

          <button
            type="button"
            className={`nav-link-btn ${
              activePage === 'complaints' ? 'nav-link-btn--active' : ''
            }`}
            onClick={() => onNavigate('complaints')}
          >
            <svg
              className="nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 12h6M9 16h6M13 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-5-5z" />
              <polyline points="13 4 13 9 18 9" />
            </svg>
            <span>Complaint Page</span>
            {openComplaintsCount > 0 && (
              <span className="nav-badge-count">{openComplaintsCount}</span>
            )}
          </button>
        </nav>

        {/* Right Controls: TV Mode Toggle, User Profile & Sign Out */}
        <div className="navbar-actions">
          <button
            type="button"
            className={`tv-mode-btn ${tvMode ? 'tv-mode-btn--active' : ''}`}
            onClick={onToggleTvMode}
            title="Toggle Large-Screen TV Display Scaling"
          >
            <svg
              className="nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span className="tv-mode-label">{tvMode ? 'TV Mode: ON' : 'TV View'}</span>
          </button>

          <div className="navbar-user-chip">
            <div className="user-avatar" data-role={currentUser.role}>
              {currentUser.avatarInitials}
            </div>
            <div className="user-details">
              <span className="user-name">{currentUser.name}</span>
              <span className="user-email">{currentUser.email}</span>
            </div>
          </div>

          <button type="button" className="logout-btn" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      </div>
    </header>
  );
};
