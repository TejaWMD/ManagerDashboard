import React, { useState, useEffect } from 'react';
import { Appointment, UserAccount } from '../../types';
import './Appointments.css';

interface RescheduleAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  currentUser: UserAccount;
  onConfirmReschedule: (
    appointmentId: string,
    proposedDate: string,
    reason: string
  ) => Promise<void>;
}

export const RescheduleAppointmentModal: React.FC<RescheduleAppointmentModalProps> = ({
  isOpen,
  onClose,
  appointment,
  currentUser,
  onConfirmReschedule,
}) => {
  const [proposedDateTime, setProposedDateTime] = useState<string>('');
  const [rescheduleReason, setRescheduleReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && appointment) {
      setErrorMessage(null);
      setIsSubmitting(false);
      setRescheduleReason('');

      // Default proposed time: current scheduled date plus 2 hours or next business day
      const baseDate = new Date(appointment.scheduledAtMs || Date.now());
      baseDate.setHours(baseDate.getHours() + 2);
      const isoLocal = new Date(
        baseDate.getTime() - baseDate.getTimezoneOffset() * 60000
      )
        .toISOString()
        .slice(0, 16);
      setProposedDateTime(isoLocal);
    }
  }, [isOpen, appointment]);

  if (!isOpen || !appointment) return null;

  const otherPersonName =
    currentUser.id === appointment.requesterId
      ? appointment.receiverName
      : appointment.requesterName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!proposedDateTime) {
      setErrorMessage('Please select a proposed new date and time.');
      return;
    }

    if (!rescheduleReason.trim()) {
      setErrorMessage('Please provide a short reason for rescheduling.');
      return;
    }

    const proposedDateObj = new Date(proposedDateTime);
    if (Number.isNaN(proposedDateObj.getTime())) {
      setErrorMessage('Invalid date and time selected.');
      return;
    }

    // Format readable timestamp string: YYYY-MM-DD HH:mm:ss
    const pad = (n: number) => String(n).padStart(2, '0');
    const formattedProposed = `${proposedDateObj.getFullYear()}-${pad(
      proposedDateObj.getMonth() + 1
    )}-${pad(proposedDateObj.getDate())} ${pad(proposedDateObj.getHours())}:${pad(
      proposedDateObj.getMinutes()
    )}:00`;

    setIsSubmitting(true);
    try {
      await onConfirmReschedule(
        appointment.id,
        formattedProposed,
        rescheduleReason.trim()
      );
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to propose reschedule.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="apt-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="apt-modal-container apt-modal-container--sm" onClick={(e) => e.stopPropagation()}>
        <div className="apt-modal-header">
          <div className="apt-modal-header-icon apt-modal-header-icon--gold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 14 14" />
            </svg>
          </div>
          <div className="apt-modal-header-text">
            <h3 className="apt-modal-title">Reschedule Appointment</h3>
            <p className="apt-modal-subtitle">
              Propose an alternate time to <strong>{otherPersonName}</strong>.
            </p>
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

        {errorMessage && (
          <div className="apt-modal-alert apt-modal-alert--error" role="alert">
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="apt-modal-form">
          <div className="apt-reschedule-context-box">
            <div className="apt-reschedule-context-title">{appointment.title}</div>
            <div className="apt-reschedule-context-time">
              Current scheduled time: <strong>{appointment.scheduledAt}</strong> ({appointment.durationMinutes} mins)
            </div>
          </div>

          <div className="apt-form-group">
            <label htmlFor="apt-reschedule-datetime" className="apt-form-label">
              Proposed New Date & Time <span className="apt-required">*</span>
            </label>
            <input
              id="apt-reschedule-datetime"
              type="datetime-local"
              className="apt-form-input"
              value={proposedDateTime}
              onChange={(e) => setProposedDateTime(e.target.value)}
              required
            />
          </div>

          <div className="apt-form-group">
            <label htmlFor="apt-reschedule-reason" className="apt-form-label">
              Reason for Reschedule <span className="apt-required">*</span>
            </label>
            <textarea
              id="apt-reschedule-reason"
              className="apt-form-textarea"
              rows={3}
              placeholder="e.g. Conflict with client meeting at that hour; free anytime after 3:30 PM..."
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              required
            />
          </div>

          <div className="apt-modal-footer">
            <button
              type="button"
              className="apt-btn apt-btn--secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="apt-btn apt-btn--gold"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="apt-spinner" />
                  <span>Proposing...</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span>Send Reschedule Proposal</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
