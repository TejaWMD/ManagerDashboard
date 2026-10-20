import React, { useState } from 'react';
import {
  Complaint,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import './ComplaintPage.css';

interface ComplaintPageProps {
  currentUser: UserAccount;
  complaints: Complaint[];
  onCreateComplaint: (newComplaint: Omit<Complaint, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateComplaint: (
    id: string,
    updates: {
      status: ComplaintStatus;
      priority: ComplaintPriority;
      managerRemarks: string;
    }
  ) => void;
  onDeleteComplaint: (id: string) => void;
}

export const ComplaintPage: React.FC<ComplaintPageProps> = ({
  currentUser,
  complaints,
  onCreateComplaint,
  onUpdateComplaint,
  onDeleteComplaint,
}) => {
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [accountManagerFilter, setAccountManagerFilter] = useState<string>('ALL');

  // New Complaint Modal / Drawer state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [clientName, setClientName] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<ComplaintCategory>('Service Quality');
  const [priority, setPriority] = useState<ComplaintPriority>('Medium');
  const [description, setDescription] = useState('');
  const [selectedAmEmail, setSelectedAmEmail] = useState(
    currentUser.role === 'account_manager'
      ? currentUser.email
      : 'wmdklshakti@gmail.com'
  );

  // Manager / Admin Review Modal state
  const [editingComplaint, setEditingComplaint] = useState<Complaint | null>(null);
  const [editStatus, setEditStatus] = useState<ComplaintStatus>('Open');
  const [editPriority, setEditPriority] = useState<ComplaintPriority>('Medium');
  const [editRemarks, setEditRemarks] = useState('');

  const accountManagers = AUTHORIZED_USERS.filter((u) => u.role === 'account_manager');

  // Scope complaints based on role
  const roleScopedComplaints =
    currentUser.role === 'account_manager'
      ? complaints.filter(
          (c) => c.submittedByEmail.toLowerCase() === currentUser.email.toLowerCase()
        )
      : complaints;

  // Apply search and dropdown filters
  const filteredComplaints = roleScopedComplaints.filter((c) => {
    const matchesSearch =
      c.ticketNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
    const matchesPriority = priorityFilter === 'ALL' || c.priority === priorityFilter;
    const matchesAm =
      accountManagerFilter === 'ALL' ||
      c.submittedByEmail.toLowerCase() === accountManagerFilter.toLowerCase();

    return matchesSearch && matchesStatus && matchesPriority && matchesAm;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !subject.trim() || !description.trim()) return;

    const ownerEmail =
      currentUser.role === 'account_manager' ? currentUser.email : selectedAmEmail;
    const ownerAccount = AUTHORIZED_USERS.find(
      (u) => u.email.toLowerCase() === ownerEmail.toLowerCase()
    );
    const ownerShortName = ownerAccount
      ? ownerAccount.name.replace(' (Account Manager)', '')
      : currentUser.name;

    onCreateComplaint({
      clientName: clientName.trim(),
      subject: subject.trim(),
      category,
      priority,
      status: 'Open',
      description: description.trim(),
      submittedByEmail: ownerEmail,
      submittedByName: ownerShortName,
      assignedManagerEmail: 'wmgteja@gmail.com',
      managerRemarks: 'Awaiting manager review.',
    });

    setClientName('');
    setSubject('');
    setCategory('Service Quality');
    setPriority('Medium');
    setDescription('');
    setShowCreateForm(false);
  };

  const openEditModal = (complaint: Complaint) => {
    setEditingComplaint(complaint);
    setEditStatus(complaint.status);
    setEditPriority(complaint.priority);
    setEditRemarks(complaint.managerRemarks);
  };

  const handleSaveReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingComplaint) return;

    onUpdateComplaint(editingComplaint.id, {
      status: editStatus,
      priority: editPriority,
      managerRemarks: editRemarks.trim() || 'Reviewed by management.',
    });
    setEditingComplaint(null);
  };

  return (
    <div className="complaint-page-container">
      {/* Header Bar */}
      <div className="complaint-page-header">
        <div>
          <span className="complaint-page-eyebrow">
            {currentUser.roleLabel.toUpperCase()} COMPLAINT PORTAL
          </span>
          <h1 className="complaint-page-title">
            {currentUser.role === 'account_manager'
              ? 'My Client Complaints & SLA Tracker'
              : currentUser.role === 'manager'
              ? 'Manager Complaint Review & Resolution Center'
              : 'Admin Master Complaint Registry'}
          </h1>
          <p className="complaint-page-subtitle">
            {currentUser.role === 'account_manager'
              ? 'Submit new client complaints and monitor status updates from Manager Teja.'
              : currentUser.role === 'manager'
              ? 'Filter complaints across Shakti, Kavita, and Linda. Update resolution statuses and record manager remarks.'
              : 'Full administrative control to log, edit, resolve, or remove complaint records across all accounts.'}
          </p>
        </div>

        {(currentUser.role === 'account_manager' || currentUser.role === 'admin') && (
          <button
            type="button"
            className="new-complaint-btn"
            onClick={() => setShowCreateForm((prev) => !prev)}
          >
            {showCreateForm ? '✕ Close Form' : '+ Log New Complaint'}
          </button>
        )}
      </div>

      {/* Create New Complaint Form Panel */}
      {showCreateForm && (
        <section className="create-complaint-card">
          <div className="create-complaint-header">
            <h3>Submit New Client Complaint</h3>
            <p>All fields marked with * are required for SLA tracking.</p>
          </div>

          <form className="create-complaint-form" onSubmit={handleCreateSubmit}>
            <div className="form-grid-row">
              <div className="cp-form-group">
                <label htmlFor="cp-client">Client / Company Name *</label>
                <input
                  id="cp-client"
                  type="text"
                  placeholder="e.g. Apex Logistics Sdn Bhd"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="cp-subject">Complaint Subject *</label>
                <input
                  id="cp-subject"
                  type="text"
                  placeholder="Brief summary of the client issue"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-grid-row form-grid-row--three">
              <div className="cp-form-group">
                <label htmlFor="cp-category">Issue Category *</label>
                <select
                  id="cp-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ComplaintCategory)}
                >
                  <option value="Service Quality">Service Quality</option>
                  <option value="Billing & Invoice">Billing &amp; Invoice</option>
                  <option value="Delivery & SLA">Delivery &amp; SLA</option>
                  <option value="Technical Issue">Technical Issue</option>
                  <option value="Account Support">Account Support</option>
                </select>
              </div>

              <div className="cp-form-group">
                <label htmlFor="cp-priority">Priority Level *</label>
                <select
                  id="cp-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as ComplaintPriority)}
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>

              {currentUser.role === 'admin' ? (
                <div className="cp-form-group">
                  <label htmlFor="cp-am-owner">Assign Account Manager *</label>
                  <select
                    id="cp-am-owner"
                    value={selectedAmEmail}
                    onChange={(e) => setSelectedAmEmail(e.target.value)}
                  >
                    {accountManagers.map((am) => (
                      <option key={am.id} value={am.email}>
                        {am.name} ({am.email})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="cp-form-group">
                  <label>Submitted By (Account Manager)</label>
                  <input type="text" value={currentUser.email} disabled />
                </div>
              )}
            </div>

            <div className="cp-form-group">
              <label htmlFor="cp-desc">Detailed Description *</label>
              <textarea
                id="cp-desc"
                rows={3}
                placeholder="Provide full context, affected invoice/order numbers, and client expectations..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
              />
            </div>

            <div className="create-form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Submit Complaint Ticket
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Filter & Search Bar */}
      <section className="filter-bar-card">
        <div className="filter-search-box">
          <input
            type="text"
            placeholder="Search by Ticket ID, Client, Subject, or Description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-selects-group">
          {currentUser.role !== 'account_manager' && (
            <select
              value={accountManagerFilter}
              onChange={(e) => setAccountManagerFilter(e.target.value)}
              aria-label="Filter by Account Manager"
            >
              <option value="ALL">All Account Managers</option>
              {accountManagers.map((am) => (
                <option key={am.id} value={am.email}>
                  {am.name.replace(' (Account Manager)', '')} ({am.email})
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by Status"
          >
            <option value="ALL">All Statuses</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Escalated">Escalated</option>
            <option value="Resolved">Resolved</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by Priority"
          >
            <option value="ALL">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </section>

      {/* Complaints List / Cards Grid */}
      <section className="complaints-list-grid">
        {filteredComplaints.map((complaint) => (
          <article key={complaint.id} className="complaint-ticket-card">
            <div className="ticket-card-top">
              <div className="ticket-id-group">
                <span className="ticket-id-badge">{complaint.ticketNumber}</span>
                <span className="ticket-category-tag">{complaint.category}</span>
              </div>

              <div className="ticket-badges-group">
                <span
                  className={`priority-badge priority-badge--${complaint.priority.toLowerCase()}`}
                >
                  {complaint.priority} Priority
                </span>
                <span
                  className={`status-badge status-badge--${complaint.status
                    .toLowerCase()
                    .replace(/\s+/g, '-')}`}
                >
                  {complaint.status}
                </span>
              </div>
            </div>

            <div className="ticket-card-body">
              <div className="ticket-client-name">{complaint.clientName}</div>
              <h3 className="ticket-subject">{complaint.subject}</h3>
              <p className="ticket-description">{complaint.description}</p>
            </div>

            <div className="ticket-remarks-box">
              <div className="remarks-label">
                <span>Manager Remarks ({complaint.assignedManagerEmail})</span>
                <span>Updated: {complaint.updatedAt}</span>
              </div>
              <p className="remarks-text">{complaint.managerRemarks}</p>
            </div>

            <div className="ticket-card-footer">
              <div className="ticket-meta-info">
                <span>
                  <strong>Account Manager:</strong> {complaint.submittedByName} (
                  {complaint.submittedByEmail})
                </span>
                <span>
                  <strong>Logged:</strong> {complaint.createdAt}
                </span>
              </div>

              <div className="ticket-action-buttons">
                {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
                  <button
                    type="button"
                    className="btn-manage-ticket"
                    onClick={() => openEditModal(complaint)}
                  >
                    Update Status / Remarks
                  </button>
                )}

                {currentUser.role === 'admin' && (
                  <button
                    type="button"
                    className="btn-delete-ticket"
                    onClick={() => onDeleteComplaint(complaint.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}

        {filteredComplaints.length === 0 && (
          <div className="empty-complaints-state">
            <h3>No matching complaints found</h3>
            <p>Try adjusting your search filters or log a new client complaint.</p>
          </div>
        )}
      </section>

      {/* Manager / Admin Update Modal */}
      {editingComplaint && (
        <div className="modal-backdrop" onClick={() => setEditingComplaint(null)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <span className="modal-ticket-tag">{editingComplaint.ticketNumber}</span>
                <h3>Update Complaint Resolution</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingComplaint(null)}
              >
                ✕
              </button>
            </div>

            <div className="modal-summary-box">
              <strong>{editingComplaint.clientName}</strong> — {editingComplaint.subject}
              <div className="modal-summary-sub">
                Submitted by {editingComplaint.submittedByName} (
                {editingComplaint.submittedByEmail})
              </div>
            </div>

            <form className="modal-form" onSubmit={handleSaveReview}>
              <div className="form-grid-row">
                <div className="cp-form-group">
                  <label htmlFor="edit-status">Resolution Status</label>
                  <select
                    id="edit-status"
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ComplaintStatus)}
                  >
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Escalated">Escalated</option>
                    <option value="Resolved">Resolved</option>
                  </select>
                </div>

                <div className="cp-form-group">
                  <label htmlFor="edit-priority">Priority Level</label>
                  <select
                    id="edit-priority"
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as ComplaintPriority)}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="cp-form-group">
                <label htmlFor="edit-remarks">Manager Resolution Remarks</label>
                <textarea
                  id="edit-remarks"
                  rows={4}
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  placeholder="Enter resolution steps, escalation notes, or instructions for the Account Manager..."
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingComplaint(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Resolution Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
