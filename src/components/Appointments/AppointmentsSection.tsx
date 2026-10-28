import React, { useMemo, useState } from 'react';
import {
  Appointment,
  belongsToAppointment,
  getAppointmentAcceptedCount,
  getLinkedQueryForAppointment,
  hasUserAcceptedAppointment,
  isAppointmentActionNeeded,
  isAppointmentUpcoming,
  isUserAttendeeOfAppointment,
  isUserRequesterOfAppointment,
  Query,
  UserAccount,
} from '../../types';
import { AppointmentDetailsModal } from './AppointmentDetailsModal';
import './Appointments.css';

interface AppointmentsSectionProps {
  currentUser: UserAccount;
  appointments: Appointment[];
  queries: Query[];
  users: UserAccount[];
  onOpenBookModal: () => void;
  onAcceptAppointment: (appointmentId: string) => Promise<void>;
  onRescheduleClick: (appointment: Appointment) => void;
  onAcceptReschedule: (appointmentId: string) => Promise<void>;
  onDeclineAppointment: (appointmentId: string) => Promise<void>;
  onCancelAppointment?: (appointmentId: string) => Promise<void>;
  onEditAppointment?: (appointment: Appointment) => void;
  onCancelAppointmentWithRemark?: (
    appointmentId: string,
    remark: string
  ) => Promise<void>;
  onOpenCreateQueryForAppointment?: (appointment: Appointment) => void;
  onViewQuery?: (query: Query) => void;
}

export const AppointmentsSection: React.FC<AppointmentsSectionProps> = ({
  currentUser,
  appointments,
  queries,
  users,
  onOpenBookModal,
  onAcceptAppointment,
  onRescheduleClick,
  onAcceptReschedule,
  onDeclineAppointment,
  onEditAppointment,
  onCancelAppointmentWithRemark,
  onOpenCreateQueryForAppointment,
  onViewQuery,
}) => {
  const [filterTab, setFilterTab] = useState<'upcoming' | 'action_needed' | 'all'>('upcoming');
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [selectedAptForDetails, setSelectedAptForDetails] = useState<Appointment | null>(null);

  // Synchronize selected appointment with live updates in appointments list
  const activeSelectedApt = useMemo(() => {
    if (!selectedAptForDetails) return null;
    return (
      appointments.find((a) => a.id === selectedAptForDetails.id) ||
      selectedAptForDetails
    );
  }, [appointments, selectedAptForDetails]);

  // Filter appointments visible to current user (Admin sees all, AM/Manager see their own)
  const userAppointments = useMemo(() => {
    return appointments.filter((apt) => belongsToAppointment(apt, currentUser));
  }, [appointments, currentUser]);

  // Count items needing action by current user
  const actionNeededCount = useMemo(() => {
    return userAppointments.filter((apt) => isAppointmentActionNeeded(apt, currentUser)).length;
  }, [userAppointments, currentUser]);

  // Count upcoming
  const upcomingCount = useMemo(() => {
    return userAppointments.filter((apt) => isAppointmentUpcoming(apt)).length;
  }, [userAppointments]);

  // Filtered list based on active sub-tab
  const filteredAppointments = useMemo(() => {
    const list = [...userAppointments];
    // Sort chronologically (closest meeting first for upcoming, or by creation for others)
    list.sort((a, b) => a.scheduledAtMs - b.scheduledAtMs);

    if (filterTab === 'upcoming') {
      return list.filter((apt) => isAppointmentUpcoming(apt));
    }
    if (filterTab === 'action_needed') {
      return list.filter((apt) => isAppointmentActionNeeded(apt, currentUser));
    }
    return list;
  }, [userAppointments, filterTab, currentUser]);

  const handleAction = async (
    id: string,
    actionFn: (id: string) => Promise<void>
  ) => {
    setActionInProgressId(id);
    try {
      await actionFn(id);
    } finally {
      setActionInProgressId(null);
    }
  };

  // Helper to format date & time nicely: "Wed, 28 Oct 2026, 2:30 PM"
  const formatDateTimeDisplay = (scheduledAt: string, scheduledAtMs: number) => {
    const d = new Date(scheduledAtMs || Date.parse(scheduledAt.replace(' ', 'T')));
    if (Number.isNaN(d.getTime())) return scheduledAt;

    const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
    const dayMonthYear = d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return `${weekday}, ${dayMonthYear} • ${time}`;
  };

  // Relative timing tag: "Today", "Tomorrow", "In 3h", or "Past"
  const getRelativeTimeBadge = (scheduledAtMs: number) => {
    const now = Date.now();
    const diffMs = scheduledAtMs - now;
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));

    if (diffMs < -60 * 60 * 1000) {
      return { label: 'Past', className: 'apt-rel-tag--past' };
    }
    if (diffMs < 0) {
      return { label: 'Happening Now', className: 'apt-rel-tag--now' };
    }
    if (diffHours < 24) {
      const todayDate = new Date().toDateString();
      const targetDate = new Date(scheduledAtMs).toDateString();
      if (todayDate === targetDate) {
        return {
          label: diffHours <= 1 ? 'Starting Soon' : `Today (in ${diffHours}h)`,
          className: 'apt-rel-tag--today',
        };
      }
      return { label: 'Tomorrow', className: 'apt-rel-tag--tomorrow' };
    }
    const days = Math.ceil(diffHours / 24);
    return { label: `In ${days} days`, className: 'apt-rel-tag--future' };
  };

  return (
    <div className="chart-card appointments-bento-card" aria-label="Appointments & Discussions">
      {/* Header with Title, Tabs, and Action Button */}
      <div className="chart-card-header apt-section-header">
        <div className="apt-header-left">
          <div className="apt-header-title-wrap">
            <svg
              className="apt-header-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <h2 className="chart-card-title">Appointments &amp; Syncs</h2>
          </div>

          <div className="apt-filter-tabs">
            <button
              type="button"
              className={`apt-filter-tab ${
                filterTab === 'upcoming' ? 'apt-filter-tab--active' : ''
              }`}
              onClick={() => setFilterTab('upcoming')}
            >
              Upcoming
              <span className="apt-filter-tab-count">{upcomingCount}</span>
            </button>

            <button
              type="button"
              className={`apt-filter-tab ${
                filterTab === 'action_needed' ? 'apt-filter-tab--active' : ''
              }`}
              onClick={() => setFilterTab('action_needed')}
            >
              Action Needed
              {actionNeededCount > 0 && (
                <span className="apt-filter-tab-count apt-filter-tab-count--alert">
                  {actionNeededCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`apt-filter-tab ${
                filterTab === 'all' ? 'apt-filter-tab--active' : ''
              }`}
              onClick={() => setFilterTab('all')}
            >
              All
              <span className="apt-filter-tab-count">{userAppointments.length}</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          className="apt-btn apt-btn--primary apt-btn--header"
          onClick={onOpenBookModal}
          title="Book an appointment to discuss with team"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Book Appointment</span>
        </button>
      </div>

      {/* Appointment Cards Body */}
      <div className="apt-card-list">
        {filteredAppointments.length === 0 ? (
          <div className="apt-empty-state">
            <div className="apt-empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
              </svg>
            </div>
            <p className="apt-empty-title">
              {filterTab === 'action_needed'
                ? 'No pending actions right now'
                : filterTab === 'upcoming'
                ? 'No upcoming appointments scheduled'
                : 'No appointments on record'}
            </p>
            <p className="apt-empty-subtitle">
              Click <strong>&ldquo;+ Book Appointment&rdquo;</strong> to schedule a discussion with any manager or team member.
            </p>
          </div>
        ) : (
          filteredAppointments.map((apt) => {
            const isRequester = isUserRequesterOfAppointment(apt, currentUser);
            const isAttendee = isUserAttendeeOfAppointment(apt, currentUser);
            const needsAction = isAppointmentActionNeeded(apt, currentUser);
            const isBusy = actionInProgressId === apt.id;
            const relBadge = getRelativeTimeBadge(apt.scheduledAtMs);
            const linkedQuery = getLinkedQueryForAppointment(apt, queries);
            const linkedQueryId = linkedQuery?.queryId || apt.queryId;
            const {
              accepted: acceptedCount,
              total: totalAttendees,
              allAccepted,
              hasMultipleAttendees,
            } = getAppointmentAcceptedCount(apt);
            const hasCurrentAttendeeAccepted = hasUserAcceptedAppointment(apt, currentUser);

            return (
              <div
                key={apt.id}
                className={`apt-card apt-card--clickable ${
                  needsAction ? 'apt-card--action-needed' : ''
                } apt-card--${apt.status.toLowerCase()}`}
                onClick={() => setSelectedAptForDetails(apt)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedAptForDetails(apt);
                  }
                }}
                title="Click to view details, attendees, agenda, or edit"
              >
                {/* Top Row: Title + Status Badge */}
                <div className="apt-card-top">
                  <div className="apt-card-title-group">
                    <span className="apt-id-pill">{apt.id}</span>
                    <h3 className="apt-card-title">{apt.title}</h3>
                  </div>

                  <div className="apt-card-status-group">
                    <span className={relBadge.className}>{relBadge.label}</span>
                    <span className={`apt-status-pill apt-status-pill--${apt.status.toLowerCase()}`}>
                      {apt.status === 'CONFIRMED'
                        ? 'Confirmed'
                        : apt.status === 'PENDING'
                        ? hasMultipleAttendees
                          ? `Pending (${acceptedCount}/${totalAttendees})`
                          : 'Pending Acceptance'
                        : apt.status === 'RESCHEDULE_PROPOSED'
                        ? 'Reschedule Proposed'
                        : apt.status === 'DECLINED'
                        ? 'Declined'
                        : apt.status === 'CANCELLED'
                        ? 'Cancelled'
                        : 'Completed'}
                    </span>
                  </div>
                </div>

                {/* Second Row: Time & Meeting Type (Duration removed as requested) */}
                <div className="apt-card-meta-row">
                  <div className="apt-meta-item apt-meta-item--time">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 14 14" />
                    </svg>
                    <span>
                      {formatDateTimeDisplay(apt.scheduledAt, apt.scheduledAtMs)}
                    </span>
                  </div>

                  <div className="apt-meta-item apt-meta-item--type">
                    {apt.meetingType === 'Online Call' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    ) : apt.meetingType === 'Office/Desk' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 21h18" />
                        <path d="M5 21V7l8-4v18" />
                        <path d="M19 21V11l-6-4" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    )}
                    <span>{apt.meetingType}</span>
                  </div>

                  {apt.meetingLocation && (
                    <div className="apt-meta-item apt-meta-item--loc" title={apt.meetingLocation}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span className="apt-meta-loc-text">{apt.meetingLocation}</span>
                    </div>
                  )}
                </div>

                {/* Third Row: Host & Multiple Attendees Support */}
                <div className="apt-participants-row">
                  <div className="apt-participant-badge">
                    <span className="apt-participant-role-tag">Host</span>
                    <span className="apt-participant-name">
                      {apt.requesterName} {isRequester ? '(You)' : ''}
                    </span>
                  </div>

                  <span className="apt-participants-arrow">&rarr;</span>

                  <div className="apt-participant-badge apt-participant-badge--attendees">
                    <span className="apt-participant-role-tag">
                      {Array.isArray(apt.attendees) && apt.attendees.length > 1
                        ? `Attendees (${apt.attendees.length})`
                        : 'Attendee'}
                    </span>
                    <span className="apt-participant-name">
                      {Array.isArray(apt.attendees) && apt.attendees.length > 0
                        ? apt.attendees
                            .map((a) => {
                              const isAttConfirmed =
                                a.status === 'CONFIRMED' ||
                                (apt.status === 'CONFIRMED' && !a.status);
                              return `${a.name}${a.id === currentUser.id ? ' (You)' : ''}${
                                isAttConfirmed ? ' ✓' : ''
                              }`;
                            })
                            .join(', ')
                        : `${apt.receiverName}${isAttendee ? ' (You)' : ''}`}
                    </span>
                  </div>
                </div>

                {/* Mandatory Agenda Preview */}
                {apt.agenda && (
                  <div className="apt-agenda-box">
                    <span className="apt-agenda-label">Agenda:</span>
                    <span className="apt-agenda-text">{apt.agenda}</span>
                  </div>
                )}

                {/* Linked Query Link */}
                {linkedQueryId && (
                  <div className="apt-linked-query-box">
                    <span className="apt-linked-query-icon">🔗</span>
                    <span className="apt-linked-query-text">
                      Linked Query: <strong>{linkedQueryId}</strong>
                      {linkedQuery ? ` — ${linkedQuery.queryTitle || linkedQuery.queryText.slice(0, 60)}` : ''}
                    </span>
                    {linkedQuery && onViewQuery && (
                      <button
                        type="button"
                        className="apt-linked-query-view-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewQuery(linkedQuery);
                        }}
                      >
                        View Query &rarr;
                      </button>
                    )}
                  </div>
                )}

                {/* Reschedule Proposal Box */}
                {apt.status === 'RESCHEDULE_PROPOSED' && (
                  <div className="apt-reschedule-banner">
                    <div className="apt-reschedule-banner-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 14 14" />
                      </svg>
                    </div>
                    <div className="apt-reschedule-banner-content">
                      <div className="apt-reschedule-banner-title">
                        Reschedule proposed to:{' '}
                        <strong>
                          {formatDateTimeDisplay(
                            apt.proposedScheduledAt || '',
                            apt.proposedScheduledAtMs || 0
                          )}
                        </strong>
                      </div>
                      {apt.rescheduleReason && (
                        <div className="apt-reschedule-banner-reason">
                          &ldquo;{apt.rescheduleReason}&rdquo;
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions Footer */}
                <div className="apt-card-actions">
                  {/* Receiver pending response actions */}
                  {apt.status === 'PENDING' && isAttendee && (
                    <>
                      {hasCurrentAttendeeAccepted ? (
                        <div className="apt-badge-accepted">
                          <span className="apt-badge-accepted-icon">✓</span>
                          <span>
                            You Accepted
                            {hasMultipleAttendees && !allAccepted
                              ? ` (${acceptedCount}/${totalAttendees})`
                              : ''}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="apt-btn apt-btn--success apt-btn--sm"
                          disabled={isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction(apt.id, onAcceptAppointment);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Accept</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="apt-btn apt-btn--gold apt-btn--sm"
                        disabled={isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRescheduleClick(apt);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                        <span>Reschedule</span>
                      </button>

                      <button
                        type="button"
                        className="apt-btn apt-btn--danger-ghost apt-btn--sm"
                        disabled={isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction(apt.id, onDeclineAppointment);
                        }}
                      >
                        <span>Decline</span>
                      </button>
                    </>
                  )}

                  {/* Reschedule proposed response actions */}
                  {apt.status === 'RESCHEDULE_PROPOSED' &&
                    apt.rescheduleProposedBy !== currentUser.id && (
                      <>
                        <button
                          type="button"
                          className="apt-btn apt-btn--success apt-btn--sm"
                          disabled={isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction(apt.id, onAcceptReschedule);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Accept New Time</span>
                        </button>

                        <button
                          type="button"
                          className="apt-btn apt-btn--gold apt-btn--sm"
                          disabled={isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRescheduleClick(apt);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                          <span>Counter Time</span>
                        </button>
                      </>
                    )}

                  {/* Confirmed actions: Follow-up query (only if not already linked to a query) */}
                  {apt.status === 'CONFIRMED' && !linkedQueryId && onOpenCreateQueryForAppointment && (
                    <button
                      type="button"
                      className="apt-btn apt-btn--query-followup apt-btn--sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenCreateQueryForAppointment(apt);
                      }}
                      title="Raise a new query resulting from this discussion"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                      <span>+ New Query for this Sync</span>
                    </button>
                  )}

                  {/* Clickable details shortcut pill */}
                  <button
                    type="button"
                    className="apt-btn apt-btn--secondary apt-btn--sm apt-card-details-trigger"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAptForDetails(apt);
                    }}
                    title="View details, full agenda, attendees, or edit"
                  >
                    <span>Details &amp; Agenda &rarr;</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Appointment Details & Edit/Cancel Modal (Opens when card is clicked) */}
      <AppointmentDetailsModal
        isOpen={Boolean(activeSelectedApt)}
        onClose={() => setSelectedAptForDetails(null)}
        appointment={activeSelectedApt}
        currentUser={currentUser}
        queries={queries}
        onEditAppointment={(apt) => {
          setSelectedAptForDetails(null);
          onEditAppointment?.(apt);
        }}
        onCancelAppointmentWithRemark={async (appointmentId, remark) => {
          if (onCancelAppointmentWithRemark) {
            await onCancelAppointmentWithRemark(appointmentId, remark);
          }
        }}
        onAcceptAppointment={onAcceptAppointment}
        onRescheduleClick={onRescheduleClick}
        onAcceptReschedule={onAcceptReschedule}
        onOpenCreateQueryForAppointment={onOpenCreateQueryForAppointment}
        onViewQuery={onViewQuery}
      />
    </div>
  );
};
