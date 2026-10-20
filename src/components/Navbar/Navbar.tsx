import React, { useState } from 'react';
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
  // tvMode,
  // onToggleTvMode,
  openComplaintsCount,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  return (
    <aside
      className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''}`}
      aria-label="Sidebar Navigation"
    >
      <div className="sidebar-top">
        <div className="sidebar-brand">
          {/* <div className="sidebar-logo">WM</div> */}
          {!isCollapsed && (
            <div className="sidebar-brand-text">
              <span className="sidebar-app-name">WMD Query Portal</span>
              <span className="sidebar-role-pill">{currentUser.roleLabel}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={() => setIsCollapsed((prev) => !prev)}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        >
          <svg
            className={`collapse-icon ${isCollapsed ? 'collapse-icon--rotated' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main Navigation">
        <button
          type="button"
          className={`sidebar-link-btn ${
            activePage === 'home' ? 'sidebar-link-btn--active' : ''
          }`}
          onClick={() => onNavigate('home')}
          title="Home"
        >
          <svg
            className="sidebar-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5z" />
          </svg>
          {!isCollapsed && <span className="sidebar-link-text">Home</span>}
        </button>

        <button
          type="button"
          className={`sidebar-link-btn ${
            activePage === 'complaints' ? 'sidebar-link-btn--active' : ''
          }`}
          onClick={() => onNavigate('complaints')}
          title="Complaints"
        >
          <svg
            className="sidebar-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 12h6M9 16h6M13 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-5-5z" />
            <polyline points="13 4 13 9 18 9" />
          </svg>
          {!isCollapsed && <span className="sidebar-link-text">Complaints</span>}
          {openComplaintsCount > 0 && (
            <span
              className={`sidebar-badge-count ${
                isCollapsed ? 'sidebar-badge-count--collapsed' : ''
              }`}
            >
              {openComplaintsCount}
            </span>
          )}
        </button>

        {/* <button
          type="button"
          className={`sidebar-link-btn sidebar-tv-btn ${
            tvMode ? 'sidebar-tv-btn--active' : ''
          }`}
          onClick={onToggleTvMode}
          title="TV View"
        >
          <svg
            className="sidebar-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="4" width="20" height="13" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          {!isCollapsed && (
            <span className="sidebar-link-text">
              {tvMode ? 'TV: ON' : 'TV View'}
            </span>
          )}
        </button> */}
      </nav>

      <div className="sidebar-bottom">
        <div
          className="sidebar-user-card"
          title={`${currentUser.name} (${currentUser.email})`}
        >
          <div className="sidebar-user-icon">{currentUser.avatarInitials}</div>
          {!isCollapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{currentUser.name}</span>
              <span className="sidebar-user-email">{currentUser.email}</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-logout-btn"
          onClick={onLogout}
          title="Logout"
        >
          <svg
            className="sidebar-nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};
