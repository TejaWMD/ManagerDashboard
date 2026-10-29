import React, { useState, useMemo, useEffect } from 'react';
import {
  ActivityCategory,
  Appointment,
  PageView,
  Query,
  UserAccount,
  UserActivity,
  UserPresence,
  UserRole,
} from '../../types';
import { formatRelativeTime } from '../../lib/activityTracker';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './TrackingPage.css';

interface TrackingPageProps {
  currentUser: UserAccount;
  users: UserAccount[];
  queries: Query[];
  appointments: Appointment[];
  activities: UserActivity[];
  presences: Record<string, UserPresence>;
  onNavigate: (page: PageView) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const TrackingPage: React.FC<TrackingPageProps> = ({
  currentUser,
  users,
  queries,
  appointments,
  activities,
  presences,
  onNavigate,
  onRefresh,
  isRefreshing = false,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'all' | UserRole>('all');
  const [selectedCategory, setSelectedCategory] = useState<ActivityCategory>('all');
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState<number>(40);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Compute live presence status for each user
  const userPresenceList = useMemo(() => {
    const nowMs = Date.now();
    return users.map((u) => {
      const pres = presences[u.id];
      const isCurrentUser = u.id === currentUser.id;

      if (isCurrentUser) {
        return {
          user: u,
          presence: pres || {
            userId: u.id,
            userName: u.name,
            userEmail: u.email,
            userRole: u.role,
            currentPage: 'tracking' as PageView,
            currentAction: 'Viewing Admin Tracking',
            deviceType: 'desktop',
            lastSeenAt: 'Just now',
            lastSeenAtMs: nowMs,
            isOnline: true,
          },
          status: 'online' as const,
          statusLabel: 'Active Now',
          page: 'tracking' as PageView,
        };
      }

      if (!pres || !pres.lastSeenAtMs) {
        return {
          user: u,
          presence: null,
          status: 'offline' as const,
          statusLabel: 'Offline',
          page: 'home' as PageView,
        };
      }

      const diffMin = Math.floor((nowMs - pres.lastSeenAtMs) / 60000);
      if (pres.isOnline && diffMin <= 2) {
        return {
          user: u,
          presence: pres,
          status: 'online' as const,
          statusLabel: 'Active Now',
          page: pres.currentPage,
        };
      } else if (pres.isOnline && diffMin <= 10) {
        return {
          user: u,
          presence: pres,
          status: 'idle' as const,
          statusLabel: `Idle (${diffMin}m)`,
          page: pres.currentPage,
        };
      } else {
        return {
          user: u,
          presence: pres,
          status: 'offline' as const,
          statusLabel: formatRelativeTime(pres.lastSeenAtMs),
          page: pres.currentPage,
        };
      }
    });
  }, [users, presences, currentUser]);

  // Quick stats
  const onlineCount = useMemo(() => {
    return userPresenceList.filter((item) => item.status === 'online').length;
  }, [userPresenceList]);

  const todayActivitiesCount = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    return activities.filter((a) => a.createdAtMs >= startMs).length;
  }, [activities]);

  const pendingQueriesCount = useMemo(() => {
    return queries.filter((q) => q.status === 'Pending').length;
  }, [queries]);

  // Filtered activities
  const filteredActivities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activities.filter((act) => {
      if (selectedRoleFilter !== 'all' && act.userRole !== selectedRoleFilter) {
        return false;
      }
      if (selectedCategory !== 'all' && act.category !== selectedCategory) {
        return false;
      }
      if (selectedUserId !== 'all' && act.userId !== selectedUserId) {
        return false;
      }
      if (q) {
        const matchesUser =
          act.userName.toLowerCase().includes(q) || act.userEmail.toLowerCase().includes(q);
        const matchesTitle = act.actionTitle.toLowerCase().includes(q);
        const matchesDetails = (act.actionDetails || '').toLowerCase().includes(q);
        const matchesTarget = (act.targetId || '').toLowerCase().includes(q);
        return matchesUser || matchesTitle || matchesDetails || matchesTarget;
      }
      return true;
    });
  }, [activities, searchQuery, selectedRoleFilter, selectedCategory, selectedUserId]);

  const visibleActivities = useMemo(() => {
    return filteredActivities.slice(0, visibleCount);
  }, [filteredActivities, visibleCount]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedRoleFilter !== 'all' ||
    selectedCategory !== 'all' ||
    selectedUserId !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedRoleFilter('all');
    setSelectedCategory('all');
    setSelectedUserId('all');
  };

  const handleUserCardClick = (userId: string) => {
    if (selectedUserId === userId) {
      setSelectedUserId('all');
    } else {
      setSelectedUserId(userId);
    }
  };

  const getActionBadgeClass = (actionType: string) => {
    if (actionType.includes('CREATED') || actionType.includes('BOOKED')) {
      return 'track-badge--create';
    }
    if (actionType.includes('DONE') || actionType.includes('ACCEPTED') || actionType.includes('COMPLETED')) {
      return 'track-badge--success';
    }
    if (actionType.includes('EXTENSION') || actionType.includes('RESCHEDULE')) {
      return 'track-badge--warning';
    }
    if (actionType.includes('DECLINED') || actionType.includes('CANCELLED')) {
      return 'track-badge--danger';
    }
    if (actionType.includes('LOGIN') || actionType.includes('LOGOUT')) {
      return 'track-badge--info';
    }
    return 'track-badge--neutral';
  };

  const getActionBadgeLabel = (actionType: string) => {
    switch (actionType) {
      case 'QUERY_CREATED':
        return 'Query Created';
      case 'QUERY_MANAGER_DONE':
        return 'Manager Done';
      case 'QUERY_ACCOUNT_MANAGER_DONE':
        return 'AM Verified';
      case 'QUERY_COMPLETED':
        return 'Completed';
      case 'QUERY_REMARK_ADDED':
        return 'Remark Added';
      case 'QUERY_EXTENSION_REQUESTED':
        return 'Extension Asked';
      case 'QUERY_EXTENSION_RESOLVED':
        return 'Extension Resolved';
      case 'QUERY_RATED':
        return 'Rating Given';
      case 'APPOINTMENT_BOOKED':
        return 'Meeting Booked';
      case 'APPOINTMENT_ACCEPTED':
        return 'Meeting Accepted';
      case 'APPOINTMENT_RESCHEDULED':
        return 'Rescheduled';
      case 'APPOINTMENT_DECLINED':
        return 'Meeting Declined';
      case 'APPOINTMENT_CANCELLED':
        return 'Cancelled';
      case 'USER_LOGIN':
        return 'Logged In';
      case 'USER_LOGOUT':
        return 'Logged Out';
      case 'PAGE_VIEW':
        return 'Navigation';
      default:
        return 'Action';
    }
  };

  if (currentUser.role !== 'admin') {
    return (
      <div className="track-unauthorized-card">
        <div className="track-unauthorized-icon">🔒</div>
        <h2>Admin Access Required</h2>
        <p>This tracking dashboard is restricted to administrators only.</p>
        <button
          type="button"
          className="track-hero-action-btn"
          onClick={() => onNavigate('home')}
        >
          Return to Home
        </button>
      </div>
    );
  }

  return (
    <div className="track-page-container">
      {/* 1. TOP HERO BANNER (Matches HomePage & KPIPage exactly) */}
      <header className="track-hero-banner">
        <div className="track-hero-left">
          <div className="track-brand-dot" />
          <div className="track-text-stack">
            <span className="track-role-tag">ADMIN EXECUTIVE MONITOR</span>
            <h1 className="track-title">Live Team Tracking</h1>
          </div>
        </div>

        <div className="track-hero-actions">
          <div className="track-live-pill" title="Real-Time WebSocket Sync Active Across All Devices">
            <span className="track-live-pulse-dot" />
            <span className="track-live-pill-text">LIVE SYNC ACTIVE</span>
          </div>

          {onRefresh && (
            <button
              type="button"
              className={`track-hero-action-btn ${isRefreshing ? 'track-hero-action-btn--spinning' : ''}`}
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh tracking data"
            >
              <svg
                className="track-action-icon"
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
              <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
            </button>
          )}

          <div className="track-company-logo-badge" title="WMD Portal">
            <img src={wmdLogo} alt="WMD" className="track-company-logo-img" />
          </div>
        </div>
      </header>

      {/* 2. EXECUTIVE METRIC CARDS */}
      <section className="track-kpi-grid">
        <div className="track-kpi-card track-kpi-card--green">
          <div className="track-kpi-header">
            <span className="track-kpi-label">Active Users Online</span>
            <div className="track-kpi-icon-bubble track-kpi-icon-bubble--green">🟢</div>
          </div>
          <div className="track-kpi-body">
            <span className="track-kpi-number">{onlineCount}</span>
            <span className="track-kpi-total">/ {users.length} Total</span>
          </div>
          <span className="track-kpi-subtext">Connected across portal right now</span>
        </div>

        <div className="track-kpi-card track-kpi-card--gold">
          <div className="track-kpi-header">
            <span className="track-kpi-label">Activities Today</span>
            <div className="track-kpi-icon-bubble track-kpi-icon-bubble--gold">⚡</div>
          </div>
          <div className="track-kpi-body">
            <span className="track-kpi-number">{todayActivitiesCount}</span>
          </div>
          <span className="track-kpi-subtext">Events logged since midnight</span>
        </div>

        <div className="track-kpi-card track-kpi-card--orange">
          <div className="track-kpi-header">
            <span className="track-kpi-label">Queries In Motion</span>
            <div className="track-kpi-icon-bubble track-kpi-icon-bubble--orange">📋</div>
          </div>
          <div className="track-kpi-body">
            <span className="track-kpi-number">{pendingQueriesCount}</span>
          </div>
          <span className="track-kpi-subtext">Pending manager action or AM close</span>
        </div>

        <div className="track-kpi-card track-kpi-card--russet">
          <div className="track-kpi-header">
            <span className="track-kpi-label">Appointments</span>
            <div className="track-kpi-icon-bubble track-kpi-icon-bubble--russet">📅</div>
          </div>
          <div className="track-kpi-body">
            <span className="track-kpi-number">{appointments.length}</span>
          </div>
          <span className="track-kpi-subtext">Scheduled, confirmed & completed</span>
        </div>
      </section>

      {/* 3. TEAM LIVE PRESENCE SECTION */}
      <section className="track-section-panel">
        <div className="track-panel-header">
          <div className="track-panel-title-wrap">
            <div className="track-panel-badge-icon">👥</div>
            <div>
              <h2 className="track-panel-title">Team Live Presence</h2>
              <p className="track-panel-desc">
                Real-time online status, active screen, and device. Click any team member to filter their activity timeline.
              </p>
            </div>
          </div>

          {selectedUserId !== 'all' && (
            <button
              type="button"
              className="track-clear-user-pill"
              onClick={() => setSelectedUserId('all')}
            >
              Showing Specific User • Click to Show All
            </button>
          )}
        </div>

        <div className="track-presence-grid">
          {userPresenceList.map(({ user, presence, status, statusLabel, page }) => {
            const isSelected = selectedUserId === user.id;
            const isSelf = user.id === currentUser.id;

            return (
              <button
                type="button"
                key={user.id}
                className={`track-user-card ${
                  status === 'online'
                    ? 'track-user-card--online'
                    : status === 'idle'
                    ? 'track-user-card--idle'
                    : 'track-user-card--offline'
                } ${isSelected ? 'track-user-card--selected' : ''}`}
                onClick={() => handleUserCardClick(user.id)}
                title={`Filter activities by ${user.name}`}
              >
                <div className="track-user-card-top">
                  <div className="track-user-avatar-wrap">
                    <div className={`track-user-avatar track-user-avatar--${user.role}`}>
                      {user.avatarInitials}
                    </div>
                    <span
                      className={`track-status-dot track-status-dot--${status}`}
                      title={statusLabel}
                    />
                  </div>

                  <div className="track-user-meta">
                    <div className="track-user-name-line">
                      <span className="track-user-name">{user.name}</span>
                      {isSelf && <span className="track-self-tag">YOU</span>}
                    </div>
                    <span className="track-user-role-tag">{user.roleLabel}</span>
                  </div>
                </div>

                <div className="track-user-card-bottom">
                  <div className="track-user-status-text">
                    <span className={`track-dot-indicator track-dot-indicator--${status}`}>
                      {status === 'online' ? '● Online' : status === 'idle' ? '◑ Idle' : '○ Offline'}
                    </span>
                    <span className="track-status-ago">• {statusLabel}</span>
                  </div>

                  <div className="track-user-location-row">
                    <span className="track-location-pill" title={presence?.currentAction}>
                      📍 {presence?.currentAction || `Viewing ${page.toUpperCase()}`}
                    </span>
                    <span className="track-device-tag">
                      {presence?.deviceType === 'mobile' ? '📱 Mobile' : '💻 PC'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. REAL-TIME ACTIVITY TIMELINE */}
      <section className="track-section-panel">
        <div className="track-panel-header">
          <div className="track-panel-title-wrap">
            <div className="track-panel-badge-icon">⚡</div>
            <div>
              <h2 className="track-panel-title">Real-Time Activity Audit Feed</h2>
              <p className="track-panel-desc">
                Live chronological audit of all user actions across queries, meetings, and team interactions.
              </p>
            </div>
          </div>

          <span className="track-activity-count-badge">
            {filteredActivities.length} {filteredActivities.length === 1 ? 'Activity' : 'Activities'}
          </span>
        </div>

        {/* Filter bar */}
        <div className="track-filters-wrap">
          <div className="track-search-field">
            <svg
              className="track-search-svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by user, query ID, meeting or action details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="track-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="track-clear-search-btn"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="track-dropdowns-group">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as ActivityCategory)}
              className="track-dropdown-select"
              aria-label="Filter by Category"
            >
              <option value="all">All Categories</option>
              <option value="query">Queries</option>
              <option value="appointment">Appointments</option>
              <option value="auth">Logins / Auth</option>
              <option value="navigation">Navigation</option>
            </select>

            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value as any)}
              className="track-dropdown-select"
              aria-label="Filter by Role"
            >
              <option value="all">All Roles</option>
              <option value="account_manager">Account Managers</option>
              <option value="manager">Managers</option>
              <option value="admin">Admins</option>
            </select>

            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="track-dropdown-select"
              aria-label="Filter by User"
            >
              <option value="all">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.roleLabel})
                </option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className="track-reset-btn"
                onClick={handleResetFilters}
                title="Clear all active filters"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

        {/* Activities List */}
        {visibleActivities.length === 0 ? (
          <div className="track-empty-feed">
            <div className="track-empty-icon">🔍</div>
            <h3>No Activities Found</h3>
            <p>No recent user actions matched your search or active filter criteria.</p>
            {hasActiveFilters && (
              <button
                type="button"
                className="track-empty-reset-btn"
                onClick={handleResetFilters}
              >
                Clear All Filters
              </button>
            )}
          </div>
        ) : (
          <div className="track-feed-items">
            {visibleActivities.map((act) => {
              const badgeClass = getActionBadgeClass(act.actionType);
              const badgeLabel = getActionBadgeLabel(act.actionType);

              return (
                <div key={act.id} className="track-feed-card">
                  <div className="track-feed-time-col">
                    <span className="track-feed-time-ago" title={act.createdAt}>
                      {formatRelativeTime(act.createdAtMs)}
                    </span>
                    <span className="track-feed-time-exact">{act.createdAt.split(' ')[1] || ''}</span>
                  </div>

                  <div className="track-feed-avatar-col">
                    <div className={`track-feed-user-avatar track-feed-user-avatar--${act.userRole}`}>
                      {act.userName
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase() || 'WM'}
                    </div>
                    <div className="track-feed-vertical-line" />
                  </div>

                  <div className="track-feed-card-main">
                    <div className="track-feed-main-top">
                      <div className="track-feed-user-tags">
                        <span className="track-feed-user-name">{act.userName}</span>
                        <span className="track-feed-role-pill">
                          {act.userRole === 'account_manager'
                            ? 'Account Mgr'
                            : act.userRole === 'manager'
                            ? 'Manager'
                            : 'Admin'}
                        </span>
                        <span className="track-feed-device-pill">
                          {act.deviceType === 'mobile' ? '📱 Mobile' : '💻 PC'}
                        </span>
                      </div>

                      <span className={`track-badge ${badgeClass}`}>{badgeLabel}</span>
                    </div>

                    <div className="track-feed-message">
                      <p className="track-feed-action-title">{act.actionTitle}</p>
                      {act.actionDetails && (
                        <p className="track-feed-action-details">{act.actionDetails}</p>
                      )}
                    </div>

                    {act.targetId && (
                      <div className="track-feed-card-footer">
                        <span className="track-feed-footer-label">Referenced Item:</span>
                        <button
                          type="button"
                          className="track-feed-target-pill"
                          onClick={() => {
                            if (act.targetType === 'query' || act.targetId?.startsWith('QRY-')) {
                              onNavigate('queries');
                            } else if (
                              act.targetType === 'appointment' ||
                              act.targetId?.startsWith('APT-')
                            ) {
                              onNavigate('home');
                            }
                          }}
                          title={`Navigate to ${act.targetId}`}
                        >
                          🔗 {act.targetId}
                          <svg
                            className="track-link-arrow"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {visibleCount < filteredActivities.length && (
              <div className="track-load-more-wrap">
                <button
                  type="button"
                  className="track-load-more-btn"
                  onClick={() => setVisibleCount((prev) => prev + 40)}
                >
                  Load More Activities ({filteredActivities.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
