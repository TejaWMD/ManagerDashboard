import React, { useState, useEffect, useMemo } from 'react';
import {
  Appointment,
  AppointmentAttendee,
  MeetingType,
  Query,
  UserAccount,
  UserRole,
} from '../../types';
import './Appointments.css';

interface BookAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserAccount;
  users: UserAccount[];
  queries: Query[];
  preselectedQueryId?: string | null;
  preselectedUserId?: string | null;
  appointmentToEdit?: Appointment | null;
  onBookAppointment: (
    data: Omit<Appointment, 'id' | 'createdAt' | 'createdAtMs'>
  ) => Promise<void>;
  onUpdateAppointment?: (
    appointmentId: string,
    updates: Partial<Appointment>
  ) => Promise<void>;
}

export const BookAppointmentModal: React.FC<BookAppointmentModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  users,
  queries,
  preselectedQueryId,
  preselectedUserId,
  appointmentToEdit,
  onBookAppointment,
  onUpdateAppointment,
}) => {
  const isEditMode = Boolean(appointmentToEdit);

  // Candidate attendees (all users except current user)
  const candidateUsers = useMemo(() => {
    return users.filter((u) => u.id !== currentUser.id);
  }, [users, currentUser.id]);

  const availableQueries = useMemo(() => {
    return queries.slice(0, 50);
  }, [queries]);

  // Multiple selected attendees
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');

  const [title, setTitle] = useState<string>('');
  const [agenda, setAgenda] = useState<string>('');
  const [scheduledAtInput, setScheduledAtInput] = useState<string>('');
  const [meetingType, setMeetingType] = useState<MeetingType>('Online Call');
  const [meetingLocation, setMeetingLocation] = useState<string>('');
  const [selectedQueryId, setSelectedQueryId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize or reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setIsSubmitting(false);
      setUserSearchQuery('');

      if (appointmentToEdit) {
        // Edit mode pre-population
        setTitle(appointmentToEdit.title);
        setAgenda(appointmentToEdit.agenda || '');
        setMeetingType(appointmentToEdit.meetingType || 'Online Call');
        setMeetingLocation(appointmentToEdit.meetingLocation || '');
        setSelectedQueryId(appointmentToEdit.queryId || '');

        const existingAttendeeIds =
          Array.isArray(appointmentToEdit.attendees) && appointmentToEdit.attendees.length > 0
            ? appointmentToEdit.attendees.map((a) => a.id)
            : appointmentToEdit.receiverId
            ? [appointmentToEdit.receiverId]
            : [];
        setSelectedUserIds(existingAttendeeIds);

        // Convert scheduledAt to ISO local for datetime-local input
        const baseDate = new Date(
          appointmentToEdit.scheduledAtMs ||
            Date.parse(appointmentToEdit.scheduledAt.replace(' ', 'T')) ||
            Date.now()
        );
        const isoLocal = new Date(
          baseDate.getTime() - baseDate.getTimezoneOffset() * 60000
        )
          .toISOString()
          .slice(0, 16);
        setScheduledAtInput(isoLocal);
      } else {
        // New Appointment mode
        if (preselectedUserId) {
          setSelectedUserIds([preselectedUserId]);
        } else if (candidateUsers.length > 0) {
          setSelectedUserIds([candidateUsers[0].id]);
        } else {
          setSelectedUserIds([]);
        }

        if (preselectedQueryId) {
          setSelectedQueryId(preselectedQueryId);
          const q = queries.find((item) => item.queryId === preselectedQueryId);
          if (q) {
            setTitle(`Discussion: ${q.queryTitle || q.queryText.slice(0, 40)}`);
            if (currentUser.id === q.accountManagerId) {
              setSelectedUserIds([q.managerId]);
            } else if (currentUser.id === q.managerId) {
              setSelectedUserIds([q.accountManagerId]);
            }
          }
        } else {
          setSelectedQueryId('');
          setTitle('');
        }

        setAgenda('');
        setMeetingType('Online Call');
        setMeetingLocation('');

        // Default time: tomorrow at 10:00 AM local time
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        const isoLocal = new Date(
          tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000
        )
          .toISOString()
          .slice(0, 16);
        setScheduledAtInput(isoLocal);
      }
    }
  }, [
    isOpen,
    appointmentToEdit,
    preselectedQueryId,
    preselectedUserId,
    candidateUsers,
    queries,
    currentUser.id,
  ]);

  if (!isOpen) return null;

  // Toggle user in multi-select
  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSelectAllManagers = () => {
    const mgrIds = candidateUsers
      .filter((u) => u.role === 'manager')
      .map((u) => u.id);
    setSelectedUserIds((prev) => Array.from(new Set([...prev, ...mgrIds])));
  };

  const handleClearAttendees = () => {
    setSelectedUserIds([]);
  };

  // Filtered candidate users for search
  const filteredCandidates = candidateUsers.filter((u) => {
    if (!userSearchQuery.trim()) return true;
    const q = userSearchQuery.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.roleLabel.toLowerCase().includes(q)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (selectedUserIds.length === 0) {
      setErrorMessage('Please select at least one attendee / participant.');
      return;
    }

    if (!title.trim()) {
      setErrorMessage('Please enter an appointment subject / topic.');
      return;
    }

    // MANDATORY AGENDA REQUIREMENT
    if (!agenda.trim()) {
      setErrorMessage('Agenda / Discussion points are mandatory. Please provide discussion details.');
      return;
    }

    if (!scheduledAtInput) {
      setErrorMessage('Please select a date and time for the appointment.');
      return;
    }

    const scheduledDate = new Date(scheduledAtInput);
    if (Number.isNaN(scheduledDate.getTime())) {
      setErrorMessage('Invalid date and time selected.');
      return;
    }

    // Map selected user IDs to AppointmentAttendee objects
    const attendeeObjects: AppointmentAttendee[] = selectedUserIds
      .map((id) => {
        const u = users.find((user) => user.id === id);
        if (!u) return null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role as UserRole,
        };
      })
      .filter((a): a is AppointmentAttendee => Boolean(a));

    if (attendeeObjects.length === 0) {
      setErrorMessage('Could not resolve selected attendees.');
      return;
    }

    // Format readable timestamp string: YYYY-MM-DD HH:mm:ss
    const pad = (n: number) => String(n).padStart(2, '0');
    const formattedScheduledAt = `${scheduledDate.getFullYear()}-${pad(
      scheduledDate.getMonth() + 1
    )}-${pad(scheduledDate.getDate())} ${pad(scheduledDate.getHours())}:${pad(
      scheduledDate.getMinutes()
    )}:00`;

    setIsSubmitting(true);
    try {
      if (isEditMode && appointmentToEdit && onUpdateAppointment) {
        // Edit existing appointment
        await onUpdateAppointment(appointmentToEdit.id, {
          title: title.trim(),
          agenda: agenda.trim(),
          attendees: attendeeObjects,
          receiverId: attendeeObjects[0].id,
          receiverName: attendeeObjects.map((a) => a.name).join(', '),
          receiverEmail: attendeeObjects[0].email,
          receiverRole: attendeeObjects[0].role,
          scheduledAt: formattedScheduledAt,
          scheduledAtMs: scheduledDate.getTime(),
          meetingType,
          meetingLocation: meetingLocation.trim(),
          queryId: selectedQueryId.trim() ? selectedQueryId.trim() : null,
        });
      } else {
        // Create new appointment
        await onBookAppointment({
          title: title.trim(),
          agenda: agenda.trim(),
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          requesterEmail: currentUser.email,
          requesterRole: currentUser.role as UserRole,
          attendees: attendeeObjects,
          receiverId: attendeeObjects[0].id,
          receiverName: attendeeObjects.map((a) => a.name).join(', '),
          receiverEmail: attendeeObjects[0].email,
          receiverRole: attendeeObjects[0].role,
          scheduledAt: formattedScheduledAt,
          scheduledAtMs: scheduledDate.getTime(),
          meetingType,
          meetingLocation: meetingLocation.trim(),
          status: 'PENDING',
          queryId: selectedQueryId.trim() ? selectedQueryId.trim() : null,
        });
      }

      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : isEditMode
          ? 'Failed to update appointment.'
          : 'Failed to schedule appointment.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="apt-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="apt-modal-container" onClick={(e) => e.stopPropagation()}>
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
            <h3 className="apt-modal-title">
              {isEditMode ? 'Edit Appointment Details' : 'Book an Appointment'}
            </h3>
            <p className="apt-modal-subtitle">
              {isEditMode
                ? 'Update meeting attendees, timing, or agenda notes.'
                : 'Schedule a discussion with one or multiple team members. All will be notified.'}
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
          {/* Row 1: Multiple Attendees Selector */}
          <div className="apt-form-group">
            <div className="apt-attendee-header">
              <label className="apt-form-label">
                Attendees / Participants <span className="apt-required">*</span>
                <span className="apt-selected-count-badge">
                  {selectedUserIds.length} selected
                </span>
              </label>

              <div className="apt-attendee-quick-actions">
                <button
                  type="button"
                  className="apt-quick-link-btn"
                  onClick={handleSelectAllManagers}
                >
                  + All Managers
                </button>
                {selectedUserIds.length > 0 && (
                  <button
                    type="button"
                    className="apt-quick-link-btn apt-quick-link-btn--clear"
                    onClick={handleClearAttendees}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Selected attendee preview chips */}
            {selectedUserIds.length > 0 && (
              <div className="apt-selected-chips-row">
                {selectedUserIds.map((id) => {
                  const u = users.find((user) => user.id === id);
                  if (!u) return null;
                  return (
                    <span key={u.id} className="apt-selected-chip">
                      <span className="apt-chip-avatar">{u.avatarInitials}</span>
                      <span className="apt-chip-name">{u.name}</span>
                      <button
                        type="button"
                        className="apt-chip-remove-btn"
                        onClick={() => handleToggleUser(u.id)}
                        title={`Remove ${u.name}`}
                      >
                        &times;
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Search filter for attendees */}
            {candidateUsers.length > 5 && (
              <input
                type="text"
                className="apt-form-input apt-attendee-search"
                placeholder="Search team member by name or role..."
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
              />
            )}

            {/* Checklist of candidate attendees */}
            <div className="apt-attendees-checklist">
              {filteredCandidates.map((u) => {
                const isSelected = selectedUserIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className={`apt-attendee-item ${
                      isSelected ? 'apt-attendee-item--selected' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleUser(u.id)}
                      className="apt-checkbox"
                    />
                    <div className="apt-attendee-avatar-cell">
                      <span className="apt-avatar-initials">{u.avatarInitials}</span>
                    </div>
                    <div className="apt-attendee-info">
                      <div className="apt-attendee-name-row">
                        <span className="apt-attendee-name">{u.name}</span>
                        <span className={`apt-role-tag apt-role-tag--${u.role}`}>
                          {u.roleLabel}
                        </span>
                      </div>
                      <span className="apt-attendee-email">{u.email}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Row 2: Subject / Topic */}
          <div className="apt-form-group">
            <label htmlFor="apt-title-input" className="apt-form-label">
              Subject / Topic <span className="apt-required">*</span>
            </label>
            <input
              id="apt-title-input"
              type="text"
              className="apt-form-input"
              placeholder="e.g. KL Distribution Route Delay, Product Launch Planning..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Row 3: Date & Time (Duration REMOVED as requested) */}
          <div className="apt-form-group">
            <label htmlFor="apt-datetime-input" className="apt-form-label">
              Date &amp; Time <span className="apt-required">*</span>
            </label>
            <input
              id="apt-datetime-input"
              type="datetime-local"
              className="apt-form-input"
              value={scheduledAtInput}
              onChange={(e) => setScheduledAtInput(e.target.value)}
              required
            />
          </div>

          {/* Row 4: Meeting Type Selector */}
          <div className="apt-form-group">
            <label className="apt-form-label">
              Meeting Type <span className="apt-required">*</span>
            </label>
            <div className="apt-type-selector">
              <button
                type="button"
                className={`apt-type-pill ${
                  meetingType === 'Online Call' ? 'apt-type-pill--active' : ''
                }`}
                onClick={() => setMeetingType('Online Call')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <span>Online Call</span>
              </button>

              <button
                type="button"
                className={`apt-type-pill ${
                  meetingType === 'Office/Desk' ? 'apt-type-pill--active' : ''
                }`}
                onClick={() => setMeetingType('Office/Desk')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 21h18" />
                  <path d="M5 21V7l8-4v18" />
                  <path d="M19 21V11l-6-4" />
                </svg>
                <span>Office / Desk</span>
              </button>

              <button
                type="button"
                className={`apt-type-pill ${
                  meetingType === 'Phone' ? 'apt-type-pill--active' : ''
                }`}
                onClick={() => setMeetingType('Phone')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>Phone Call</span>
              </button>
            </div>
          </div>

          {/* Row 5: Meeting Location / Link */}
          <div className="apt-form-group">
            <label htmlFor="apt-location-input" className="apt-form-label">
              {meetingType === 'Online Call'
                ? 'Meeting Link (Optional)'
                : meetingType === 'Office/Desk'
                ? 'Room / Desk Location (Optional)'
                : 'Phone Number / WhatsApp (Optional)'}
            </label>
            <input
              id="apt-location-input"
              type="text"
              className="apt-form-input"
              placeholder={
                meetingType === 'Online Call'
                  ? 'e.g. Google Meet, Microsoft Teams, or Zoom URL'
                  : meetingType === 'Office/Desk'
                  ? 'e.g. Conference Room 3, Operations Desk B'
                  : 'e.g. +60 19-416 7570'
              }
              value={meetingLocation}
              onChange={(e) => setMeetingLocation(e.target.value)}
            />
          </div>

          {/* Row 6: Agenda / Discussion (MANDATORY) */}
          <div className="apt-form-group">
            <label htmlFor="apt-agenda-textarea" className="apt-form-label">
              Agenda &amp; Discussion Points <span className="apt-required">* Mandatory</span>
            </label>
            <textarea
              id="apt-agenda-textarea"
              className="apt-form-textarea"
              rows={4}
              placeholder="State the core issues, questions, and expected outcomes of this discussion (Required)..."
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              required
            />
            <span className="apt-form-hint">
              As per director policy, an agenda is required for all appointments.
            </span>
          </div>

          {/* Row 7: Link Existing Query (Optional) */}
          <div className="apt-form-group">
            <label htmlFor="apt-query-select" className="apt-form-label">
              Link to Existing Query <span className="apt-optional">(Optional)</span>
            </label>
            <select
              id="apt-query-select"
              className="apt-form-select"
              value={selectedQueryId}
              onChange={(e) => {
                const qId = e.target.value;
                setSelectedQueryId(qId);
                if (qId && !title) {
                  const q = queries.find((item) => item.queryId === qId);
                  if (q) {
                    setTitle(`Discussion: ${q.queryTitle || q.queryText.slice(0, 40)}`);
                  }
                }
              }}
            >
              <option value="">-- No linked query --</option>
              {availableQueries.map((q) => (
                <option key={q.queryId} value={q.queryId}>
                  [{q.queryId}] {q.queryTitle || q.queryText.slice(0, 50)} ({q.accountManagerName} &rarr; {q.managerName})
                </option>
              ))}
            </select>
          </div>

          {/* Modal Actions Footer */}
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
              className="apt-btn apt-btn--primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="apt-spinner" />
                  <span>{isEditMode ? 'Saving Changes...' : 'Scheduling...'}</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>{isEditMode ? 'Save Changes' : 'Send Appointment Request'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
