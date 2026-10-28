import React, { useState } from 'react';
import {
  Appointment,
  getLinkedQueryForAppointment,
  isUserAttendeeOfAppointment,
  isUserRequesterOfAppointment,
  Query,
  UserAccount,
} from '../../types';
import './Appointments.css';

interface AppointmentDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  currentUser: UserAccount;
  queries: Query[];
  onEditAppointment: (appointment: Appointment) => void;
  onCancelAppointmentWithRemark: (
    appointmentId: string,
    remark: string
  ) => Promise<void>;
  onAcceptAppointment?: (appointmentId: string) => Promise<void>;
  onRescheduleClick?: (appointment: Appointment) => void;
  onAcceptReschedule?: (appointmentId: string) => Promise<void>;
  onOpenCreateQueryForAppointment?: (appointment: Appointment) => void;
  onViewQuery?: (query: Query) => void;
}

export const AppointmentDetailsModal: React.FC<AppointmentDetailsModalProps> = ({
  isOpen,
  onClose,
  appointment,
  currentUser,
  queries,
  onEditAppointment,
  onCancelAppointmentWithRemark,
  onAcceptAppointment,
  onRescheduleClick,
  onAcceptReschedule,
  onOpenCreateQueryForAppointment,
  onViewQuery,
}) => {
  // Cancellation confirmation flow state
  const [showCancelPrompt, setShowCancelPrompt] = useState<boolean>(false);
  const [cancellationRemark, setCancellationRemark] = useState<string>('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [isProcessingAction, setIsProcessingAction] = useState<boolean>(false);

  // Reset cancellation prompt when appointment or modal opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setShowCancelPrompt(false);
      setCancellationRemark('');
      setCancelError(null);
      setIsCancelling(false);
      setIsProcessingAction(false);
    }
  }, [isOpen, appointment?.id]);

  if (!isOpen || !appointment) return null;

  const isRequester = isUserRequesterOfAppointment(appointment, currentUser);
  const isAdmin = currentUser.role === 'admin';
  const canEditOrCancel = isRequester || isAdmin;

  const isAttendee = isUserAttendeeOfAppointment(appointment, currentUser);

  const linkedQuery = getLinkedQueryForAppointment(appointment, queries);
  const linkedQueryId = linkedQuery?.queryId || appointment.queryId;

  // Format date & time
  const formatDateTime = (scheduledAt: string, scheduledAtMs: number) => {
    const d = new Date(scheduledAtMs || Date.parse(scheduledAt.replace(' ', 'T')));
    if (Number.isNaN(d.getTime())) return scheduledAt;

    const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
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

    return `${weekday}, ${dayMonthYear} at ${time}`;
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    setCancelError(null);

    if (!cancellationRemark.trim()) {
      setCancelError('Please enter a cancellation remark explaining the reason.');
      return;
    }

    setIsCancelling(true);
    try {
      await onCancelAppointmentWithRemark(
        appointment.id,
        cancellationRemark.trim()
      );
      setShowCancelPrompt(false);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to cancel appointment.';
      setCancelError(msg);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleAction = async (actionFn?: (id: string) => Promise<void>) => {
    if (!actionFn) return;
    setIsProcessingAction(true);
    try {
      await actionFn(appointment.id);
      onClose();
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div className="apt-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="apt-modal-container apt-details-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="apt-modal-header">
          <div className="apt-modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div className="apt-modal-header-text">
            <div className="apt-details-title-row">
              <span className="apt-id-pill">{appointment.id}</span>
              <h3 className="apt-modal-title">{appointment.title}</h3>
            </div>
            <span className={`apt-status-pill apt-status-pill--${appointment.status.toLowerCase()}`}>
              {appointment.status === 'CONFIRMED'
                ? 'Confirmed'
                : appointment.status === 'PENDING'
                ? 'Pending Acceptance'
                : appointment.status === 'RESCHEDULE_PROPOSED'
                ? 'Reschedule Proposed'
                : appointment.status === 'DECLINED'
                ? 'Declined'
                : appointment.status === 'CANCELLED'
                ? 'Cancelled'
                : 'Completed'}
            </span>
          </div>
          <button
            type="button"
            className="apt-modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        <div className="apt-details-body">
          {/* Section 1: Time, Type & Location */}
          <div className="apt-details-grid">
            <div className="apt-details-info-tile">
              <span className="apt-details-label">Date &amp; Time</span>
              <div className="apt-details-val apt-details-val--time">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 14 14" />
                </svg>
                <span>{formatDateTime(appointment.scheduledAt, appointment.scheduledAtMs)}</span>
              </div>
            </div>

            <div className="apt-details-info-tile">
              <span className="apt-details-label">Meeting Type</span>
              <div className="apt-details-val">
                {appointment.meetingType === 'Online Call' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                ) : appointment.meetingType === 'Office/Desk' ? (
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
                <span>{appointment.meetingType}</span>
              </div>
            </div>
          </div>

          {appointment.meetingLocation && (
            <div className="apt-details-section">
              <span className="apt-details-label">Location / Link</span>
              <div className="apt-details-location-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {appointment.meetingLocation.startsWith('http') ? (
                  <a
                    href={appointment.meetingLocation}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="apt-details-link"
                  >
                    {appointment.meetingLocation}
                  </a>
                ) : (
                  <span>{appointment.meetingLocation}</span>
                )}
              </div>
            </div>
          )}

          {/* Section 2: Host & Multiple Attendees */}
          <div className="apt-details-section">
            <span className="apt-details-label">Host &amp; Attendees</span>
            <div className="apt-details-people-card">
              <div className="apt-details-host-row">
                <span className="apt-people-role-pill apt-people-role-pill--host">Host</span>
                <span className="apt-details-person-name">
                  {appointment.requesterName} {isRequester ? '(You)' : ''}
                </span>
                <span className="apt-details-person-email">({appointment.requesterEmail})</span>
              </div>

              <div className="apt-details-attendees-list">
                <span className="apt-people-role-pill">Attendees:</span>
                <div className="apt-details-attendees-chips">
                  {Array.isArray(appointment.attendees) && appointment.attendees.length > 0 ? (
                    appointment.attendees.map((att) => (
                      <span key={att.id} className="apt-attendee-badge-chip">
                        <span className="apt-attendee-badge-name">
                          {att.name} {att.id === currentUser.id ? '(You)' : ''}
                        </span>
                        <span className="apt-attendee-badge-role">
                          {att.role === 'manager' ? 'Manager' : att.role === 'account_manager' ? 'Account Manager' : 'Admin'}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="apt-attendee-badge-chip">
                      <span className="apt-attendee-badge-name">
                        {appointment.receiverName}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Mandatory Agenda / Discussion */}
          <div className="apt-details-section">
            <div className="apt-details-agenda-header">
              <span className="apt-details-label">Agenda &amp; Discussion Points</span>
              <span className="apt-mandatory-tag">Mandatory</span>
            </div>
            <div className="apt-details-agenda-box">
              {appointment.agenda || '(No agenda text provided)'}
            </div>
          </div>

          {/* Section 4: Linked Query (if any) */}
          {linkedQueryId && (
            <div className="apt-details-section">
              <span className="apt-details-label">Linked Query</span>
              <div className="apt-details-query-card">
                <div className="apt-details-query-info">
                  <span className="apt-details-query-id">{linkedQueryId}</span>
                  <span className="apt-details-query-title">
                    {linkedQuery
                      ? linkedQuery.queryTitle || linkedQuery.queryText
                      : 'Referenced ticket'}
                  </span>
                </div>
                {linkedQuery && onViewQuery && (
                  <button
                    type="button"
                    className="apt-details-query-btn"
                    onClick={() => {
                      onClose();
                      onViewQuery(linkedQuery);
                    }}
                  >
                    View Query Details &rarr;
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Reschedule Proposal Details (if any) */}
          {appointment.status === 'RESCHEDULE_PROPOSED' && (
            <div className="apt-reschedule-banner">
              <div className="apt-reschedule-banner-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 14 14" />
                </svg>
              </div>
              <div className="apt-reschedule-banner-content">
                <div className="apt-reschedule-banner-title">
                  Reschedule Proposed To:{' '}
                  <strong>{appointment.proposedScheduledAt}</strong>
                </div>
                {appointment.rescheduleReason && (
                  <div className="apt-reschedule-banner-reason">
                    Reason: &ldquo;{appointment.rescheduleReason}&rdquo;
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cancellation Notice (if cancelled) */}
          {appointment.status === 'CANCELLED' && (
            <div className="apt-cancelled-banner">
              <div className="apt-cancelled-banner-title">
                ❌ Appointment Cancelled by Host
              </div>
              {appointment.cancellationRemark && (
                <div className="apt-cancelled-banner-remark">
                  <strong>Cancellation Remark:</strong> &ldquo;{appointment.cancellationRemark}&rdquo;
                </div>
              )}
            </div>
          )}

          {/* Cancellation Remark Flow for Requester (Requirement 5) */}
          {showCancelPrompt && (
            <form onSubmit={handleConfirmCancel} className="apt-cancel-confirm-box">
              <div className="apt-cancel-confirm-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <strong>Mandatory Cancellation Policy</strong>
                  <p>
                    Please ensure you have communicated with all attendees first. Enter your
                    cancellation remark below to proceed with cancelling.
                  </p>
                </div>
              </div>

              {cancelError && (
                <div className="apt-modal-alert apt-modal-alert--error">
                  {cancelError}
                </div>
              )}

              <div className="apt-form-group">
                <label className="apt-form-label" htmlFor="apt-cancel-remark-input">
                  Cancellation Remark <span className="apt-required">* Mandatory</span>
                </label>
                <textarea
                  id="apt-cancel-remark-input"
                  className="apt-form-textarea"
                  rows={3}
                  placeholder="Explain why this appointment is being cancelled (e.g. Discussed with team; resolved in morning standup)..."
                  value={cancellationRemark}
                  onChange={(e) => setCancellationRemark(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="apt-cancel-confirm-actions">
                <button
                  type="button"
                  className="apt-btn apt-btn--secondary apt-btn--sm"
                  onClick={() => setShowCancelPrompt(false)}
                  disabled={isCancelling}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="apt-btn apt-btn--danger apt-btn--sm"
                  disabled={isCancelling}
                >
                  {isCancelling ? 'Cancelling...' : 'Confirm & Cancel Appointment'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="apt-modal-footer">
          {/* Attendee Actions (Accept / Reschedule) */}
          {isAttendee && appointment.status === 'PENDING' && !showCancelPrompt && (
            <>
              <button
                type="button"
                className="apt-btn apt-btn--success"
                disabled={isProcessingAction}
                onClick={() => handleAction(onAcceptAppointment)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Accept Meeting</span>
              </button>

              <button
                type="button"
                className="apt-btn apt-btn--gold"
                disabled={isProcessingAction}
                onClick={() => {
                  onClose();
                  onRescheduleClick?.(appointment);
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                <span>Reschedule</span>
              </button>
            </>
          )}

          {/* Reschedule proposed actions */}
          {appointment.status === 'RESCHEDULE_PROPOSED' &&
            appointment.rescheduleProposedBy !== currentUser.id &&
            !showCancelPrompt && (
              <>
                <button
                  type="button"
                  className="apt-btn apt-btn--success"
                  disabled={isProcessingAction}
                  onClick={() => handleAction(onAcceptReschedule)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Accept Proposed Time</span>
                </button>

                <button
                  type="button"
                  className="apt-btn apt-btn--gold"
                  disabled={isProcessingAction}
                  onClick={() => {
                    onClose();
                    onRescheduleClick?.(appointment);
                  }}
                >
                  <span>Counter Time</span>
                </button>
              </>
            )}

          {/* Follow-up Query Shortcut (only if not already linked to a query) */}
          {appointment.status === 'CONFIRMED' && !linkedQueryId && onOpenCreateQueryForAppointment && !showCancelPrompt && (
            <button
              type="button"
              className="apt-btn apt-btn--query-followup"
              onClick={() => {
                onClose();
                onOpenCreateQueryForAppointment(appointment);
              }}
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

          {/* SENDER ONLY ACTIONS: Edit & Cancel with Remark (Requirements 3 & 5) */}
          {canEditOrCancel && appointment.status !== 'CANCELLED' && !showCancelPrompt && (
            <>
              <button
                type="button"
                className="apt-btn apt-btn--secondary"
                onClick={() => {
                  onClose();
                  onEditAppointment(appointment);
                }}
                title="Edit appointment details, timing, or attendees"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Edit Appointment</span>
              </button>

              <button
                type="button"
                className="apt-btn apt-btn--danger-ghost"
                onClick={() => setShowCancelPrompt(true)}
                title="Cancel this appointment with mandatory remark"
              >
                <span>Cancel Appointment</span>
              </button>
            </>
          )}

          {!showCancelPrompt && (
            <button
              type="button"
              className="apt-btn apt-btn--secondary"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
