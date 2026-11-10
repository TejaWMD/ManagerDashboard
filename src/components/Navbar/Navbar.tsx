import React, { useState } from 'react';
import { PageView, UserAccount } from '../../types';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './Navbar.css';

interface NavbarProps {
  currentUser: UserAccount;
  activePage: PageView;
  onNavigate: (page: PageView) => void;
  onLogout: () => void;
  tvMode: boolean;
  onToggleTvMode: () => void;
  openQueriesCount: number;
  onOpenNotifications?: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastRefreshedAt?: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activePage,
  onNavigate,
  onLogout,
  tvMode,
  onToggleTvMode,
  openQueriesCount,
  onOpenNotifications,
  onRefresh,
  isRefreshing = false,
  lastRefreshedAt,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

  // Close mobile drawer on Escape key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen]);

  // Automatically close mobile drawer when window is resized above 768px
  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768 && isMobileOpen) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMobileOpen]);

  const handleNav = (page: PageView) => {
    onNavigate(page);
    setIsMobileOpen(false);
  };

  const handleLogout = () => {
    setIsMobileOpen(false);
    onLogout();
  };

  const handleNotifications = () => {
    setIsMobileOpen(false);
    onOpenNotifications?.();
  };

  return (
    <>
      {/* Mobile Top Header Banner (Visible ONLY on screens <= 768px) */}
      <header className="mobile-header-bar" aria-label="Mobile Navigation Bar">
        <div
          className="mobile-header-brand"
          onClick={() => handleNav('home')}
          role="button"
          tabIndex={0}
          title="Go to Home"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleNav('home');
            }
          }}
        >
          <div className="mobile-header-logo">
            <img src={wmdLogo} alt="WMD" className="mobile-header-logo-img" />
          </div>
          <div className="mobile-header-brand-text">
            <span className="mobile-header-app-name">WMD Portal</span>
            <span className="mobile-header-role-pill">{currentUser.roleLabel}</span>
          </div>
        </div>

        <div className="mobile-header-actions">
          {onRefresh && (
            <button
              type="button"
              className={`mobile-header-action-btn ${
                isRefreshing ? 'mobile-header-action-btn--spinning' : ''
              }`}
              onClick={onRefresh}
              disabled={isRefreshing}
              title={
                isRefreshing
                  ? 'Syncing data...'
                  : lastRefreshedAt
                  ? `Sync & Refresh (${lastRefreshedAt})`
                  : 'Sync & Refresh'
              }
              aria-label="Sync data"
            >
              <svg
                className="mobile-header-action-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className="mobile-hamburger-btn"
            onClick={() => setIsMobileOpen((prev) => !prev)}
            aria-label={isMobileOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
            aria-expanded={isMobileOpen}
          >
            {isMobileOpen ? (
              <svg
                className="mobile-hamburger-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                className="mobile-hamburger-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}

            {openQueriesCount > 0 && !isMobileOpen && (
              <span className="mobile-hamburger-badge">{openQueriesCount}</span>
            )}
          </button>
        </div>
      </header>

      {/* Backdrop Overlay for Mobile Sidebar Drawer */}
      <div
        className={`sidebar-backdrop ${isMobileOpen ? 'sidebar-backdrop--visible' : ''}`}
        onClick={() => setIsMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Main Sidebar: Vertical in-flow on PC/Laptop, Slide-out Drawer on Mobile */}
      <aside
        className={`sidebar ${isCollapsed ? 'sidebar--collapsed' : ''} ${
          isMobileOpen ? 'sidebar--mobile-open' : ''
        }`}
        aria-label="Sidebar Navigation"
      >
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="sidebar-logo">
              <img src={wmdLogo} alt="WMD" className="sidebar-logo-img" />
            </div>
            {(!isCollapsed || isMobileOpen) && (
              <div className="sidebar-brand-text">
                <span className="sidebar-app-name">WMD Query Portal</span>
                <span className="sidebar-role-pill">{currentUser.roleLabel}</span>
              </div>
            )}
          </div>

          {/* Desktop Collapse / Expand Button */}
          <button
            type="button"
            className="sidebar-collapse-btn desktop-only"
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

          {/* Mobile Drawer Close Button */}
          <button
            type="button"
            className="sidebar-close-btn mobile-only"
            onClick={() => setIsMobileOpen(false)}
            title="Close navigation"
            aria-label="Close navigation"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Main Navigation">
          <button
            type="button"
            className={`sidebar-link-btn ${
              activePage === 'home' ? 'sidebar-link-btn--active' : ''
            }`}
            onClick={() => handleNav('home')}
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
            {(!isCollapsed || isMobileOpen) && (
              <span className="sidebar-link-text">Home</span>
            )}
          </button>

          <button
            type="button"
            className={`sidebar-link-btn ${
              activePage === 'queries' ? 'sidebar-link-btn--active' : ''
            }`}
            onClick={() => handleNav('queries')}
            title="Queries"
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
            {(!isCollapsed || isMobileOpen) && (
              <span className="sidebar-link-text">Queries</span>
            )}
            {openQueriesCount > 0 && (
              <span
                className={`sidebar-badge-count ${
                  isCollapsed && !isMobileOpen ? 'sidebar-badge-count--collapsed' : ''
                }`}
              >
                {openQueriesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`sidebar-link-btn ${
              activePage === 'kpi' ? 'sidebar-link-btn--active' : ''
            }`}
            onClick={() => handleNav('kpi')}
            title="Manager KPI Leaderboard"
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
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
            {(!isCollapsed || isMobileOpen) && (
              <span className="sidebar-link-text">KPI</span>
            )}
          </button>

          {currentUser.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-link-btn ${
                activePage === 'tracking' ? 'sidebar-link-btn--active' : ''
              }`}
              onClick={() => handleNav('tracking')}
              title="Live Team Tracking & Activity Audit"
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
                <circle cx="12" cy="12" r="3" />
                <path d="M3 12h1m16 0h1M12 3v1m0 16v1" />
                <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
              </svg>
              {(!isCollapsed || isMobileOpen) && (
                <span className="sidebar-link-text">Tracking</span>
              )}
            </button>
          )}

          {(currentUser.role === 'admin' || currentUser.role === 'account_manager') && (
            <button
              type="button"
              className={`sidebar-link-btn ${
                activePage === 'my-trello' ? 'sidebar-link-btn--active' : ''
              }`}
              onClick={() => handleNav('my-trello')}
              title="My Trello Boards & Reports"
            >
              <svg
                className="sidebar-nav-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zm-9 14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v10zm8-5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5z" />
              </svg>
              {(!isCollapsed || isMobileOpen) && (
                <span className="sidebar-link-text">My Trello</span>
              )}
            </button>
          )}

          {currentUser.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-link-btn ${
                activePage === 'ratings' ? 'sidebar-link-btn--active' : ''
              }`}
              onClick={() => handleNav('ratings')}
              title="Team Ratings & Performance Management"
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
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              {(!isCollapsed || isMobileOpen) && (
                <span className="sidebar-link-text">Ratings</span>
              )}
            </button>
          )}

          {currentUser.role === 'admin' && (
            <button
              type="button"
              className={`sidebar-link-btn ${
                activePage === 'admin-trello' ? 'sidebar-link-btn--active' : ''
              }`}
              onClick={() => handleNav('admin-trello')}
              title="Trello Team Management & Reports"
            >
              <svg
                className="sidebar-nav-icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M19.5 2h-15A2.5 2.5 0 0 0 2 4.5v15A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 2zm-9 14a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v10zm8-5a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5z" />
              </svg>
              {(!isCollapsed || isMobileOpen) && (
                <span className="sidebar-link-text">Trello (Team)</span>
              )}
            </button>
          )}

          {onOpenNotifications && (
            <button
              type="button"
              className="sidebar-link-btn"
              onClick={handleNotifications}
              title="Notification Settings (Browser Alerts)"
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
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {(!isCollapsed || isMobileOpen) && (
                <span className="sidebar-link-text">Notifications</span>
              )}
            </button>
          )}

          {onRefresh && (
            <button
              type="button"
              className={`sidebar-link-btn sidebar-refresh-btn ${
                isRefreshing ? 'sidebar-refresh-btn--loading' : ''
              }`}
              onClick={onRefresh}
              disabled={isRefreshing}
              title={
                isRefreshing
                  ? 'Checking for updates & syncing data...'
                  : lastRefreshedAt
                  ? `Sync & Refresh (Last synced: ${lastRefreshedAt})`
                  : 'Sync data & check for updates'
              }
              aria-label="Sync data & check for updates"
            >
              <svg
                className={`sidebar-nav-icon sidebar-refresh-icon ${
                  isRefreshing ? 'sidebar-refresh-icon--spinning' : ''
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              {(!isCollapsed || isMobileOpen) && (
                <span className="sidebar-link-text">
                  {isRefreshing ? 'Syncing...' : 'Sync & Refresh'}
                </span>
              )}
            </button>
          )}
        </nav>

        <div className="sidebar-bottom">
          <div
            className="sidebar-user-card"
            title={`${currentUser.name} (${currentUser.email})`}
          >
            <div className="sidebar-user-icon">{currentUser.avatarInitials}</div>
            {(!isCollapsed || isMobileOpen) && (
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">{currentUser.name}</span>
                <span className="sidebar-user-email">{currentUser.email}</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="sidebar-logout-btn"
            onClick={handleLogout}
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
            {(!isCollapsed || isMobileOpen) && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
};
