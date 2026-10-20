import React, { useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Complaint,
  isComplaintDelayed,
  isComplaintDone,
  UserAccount,
} from '../../types';
import { AUTHORIZED_USERS } from '../../data/users';
import './ComplaintPage.css';

interface ComplaintPageProps {
  currentUser: UserAccount;
  complaints: Complaint[];
  savingComplaintId: string | null;
  onCreateComplaint: (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    complaintText: string;
  }) => Promise<void>;
  onUpdateComplaint: (
    complaintId: string,
    updates: Partial<
      Pick<
        Complaint,
        | 'complaintText'
        | 'managerRemark'
        | 'managerDone'
        | 'accountManagerRemark'
        | 'accountManagerDone'
      >
    >
  ) => Promise<void>;
}

export const ComplaintPage: React.FC<ComplaintPageProps> = ({
  currentUser,
  complaints,
  savingComplaintId,
  onCreateComplaint,
  onUpdateComplaint,
}) => {
  const managers = AUTHORIZED_USERS.filter((u) => u.role === 'manager');

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    managers[0]?.id || ''
  );
  const [complaintInput, setComplaintInput] = useState<string>('');
  const [isSubmittingNew, setIsSubmittingNew] = useState<boolean>(false);

  const [editingAmRemarkId, setEditingAmRemarkId] = useState<string | null>(null);
  const [amRemarkDraft, setAmRemarkDraft] = useState<string>('');

  const [editingComplaintTextId, setEditingComplaintTextId] = useState<string | null>(null);
  const [complaintTextDraft, setComplaintTextDraft] = useState<string>('');

  const [editingMgrRemarkId, setEditingMgrRemarkId] = useState<string | null>(null);
  const [mgrRemarkDraft, setMgrRemarkDraft] = useState<string>('');

  const scopedComplaints = complaints.filter((c) => {
    if (currentUser.role === 'account_manager') {
      return belongsToAccountManager(c, currentUser);
    }
    if (currentUser.role === 'manager') {
      return belongsToManager(c, currentUser);
    }
    return true;
  });

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedManagerId || !complaintInput.trim() || isSubmittingNew) return;

    const targetManager = managers.find((m) => m.id === selectedManagerId);
    if (!targetManager) return;

    setIsSubmittingNew(true);
    try {
      await onCreateComplaint({
        managerId: targetManager.id,
        managerEmail: targetManager.email,
        managerName: targetManager.name,
        complaintText: complaintInput.trim(),
      });

      setComplaintInput('');
      setShowCreateModal(false);
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const startEditAmRemark = (item: Complaint) => {
    setEditingAmRemarkId(item.complaintId);
    setAmRemarkDraft(item.accountManagerRemark);
  };

  const saveAmRemark = async (complaintId: string) => {
    await onUpdateComplaint(complaintId, {
      accountManagerRemark: amRemarkDraft.trim(),
    });
    setEditingAmRemarkId(null);
    setAmRemarkDraft('');
  };

  const startEditComplaintText = (item: Complaint) => {
    setEditingComplaintTextId(item.complaintId);
    setComplaintTextDraft(item.complaintText);
  };

  const saveComplaintText = async (complaintId: string) => {
    if (!complaintTextDraft.trim()) return;
    await onUpdateComplaint(complaintId, {
      complaintText: complaintTextDraft.trim(),
    });
    setEditingComplaintTextId(null);
    setComplaintTextDraft('');
  };

  const startEditMgrRemark = (item: Complaint) => {
    setEditingMgrRemarkId(item.complaintId);
    setMgrRemarkDraft(item.managerRemark);
  };

  const saveMgrRemark = async (complaintId: string) => {
    await onUpdateComplaint(complaintId, {
      managerRemark: mgrRemarkDraft.trim(),
    });
    setEditingMgrRemarkId(null);
    setMgrRemarkDraft('');
  };

  const handleToggleManagerDone = async (item: Complaint) => {
    if (currentUser.role !== 'manager') return;
    await onUpdateComplaint(item.complaintId, {
      managerDone: !item.managerDone,
    });
  };

  const handleToggleAccountManagerDone = async (item: Complaint) => {
    if (currentUser.role !== 'account_manager') return;
    await onUpdateComplaint(item.complaintId, {
      accountManagerDone: !item.accountManagerDone,
    });
  };

  return (
    <div className="complaint-page-container">
      <div className="complaint-page-header">
        <h1 className="complaint-page-title">Complaints</h1>
        {currentUser.role === 'account_manager' && (
          <button
            type="button"
            className="header-add-btn"
            onClick={() => setShowCreateModal(true)}
          >
            + Add Complaint
          </button>
        )}
      </div>

      <section className="complaints-table-card">
        <div className="complaints-table-wrapper">
          <table className="complaints-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>ID</th>
                {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
                  <th>Account Manager</th>
                )}
                {(currentUser.role === 'account_manager' ||
                  currentUser.role === 'admin') && <th>Manager</th>}
                <th>Complaint</th>
                <th>Manager Remark</th>
                <th className="th-center">Manager Done</th>
                <th>AM Remark</th>
                <th className="th-center">AM Done</th>
                <th className="th-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {scopedComplaints.map((item) => {
                const completed = isComplaintDone(item);
                const delayed = isComplaintDelayed(item);
                const isRowSaving = savingComplaintId === item.complaintId;

                return (
                  <tr
                    key={item.complaintId}
                    className={completed ? 'row-completed' : 'row-pending'}
                  >
                    <td className="td-timestamp">{item.createdAt}</td>

                    <td className="td-complaint-id">
                      <span className="complaint-id-badge">{item.complaintId}</span>
                    </td>

                    {(currentUser.role === 'manager' ||
                      currentUser.role === 'admin') && (
                      <td className="td-person">{item.accountManagerName}</td>
                    )}

                    {(currentUser.role === 'account_manager' ||
                      currentUser.role === 'admin') && (
                      <td className="td-person">{item.managerName}</td>
                    )}

                    <td className="td-complaint-text">
                      {currentUser.role === 'account_manager' &&
                      editingComplaintTextId === item.complaintId ? (
                        <div className="inline-edit-box">
                          <textarea
                            rows={2}
                            value={complaintTextDraft}
                            onChange={(e) => setComplaintTextDraft(e.target.value)}
                            placeholder="Edit complaint..."
                          />
                          <div className="inline-edit-actions">
                            <button
                              type="button"
                              className="btn-inline-save"
                              disabled={isRowSaving}
                              onClick={() => saveComplaintText(item.complaintId)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-inline-cancel"
                              onClick={() => setEditingComplaintTextId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="remark-display-row">
                          <p className="complaint-body-text">{item.complaintText}</p>
                          {currentUser.role === 'account_manager' && (
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditComplaintText(item)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="td-remark">
                      {currentUser.role === 'manager' ? (
                        editingMgrRemarkId === item.complaintId ? (
                          <div className="inline-edit-box">
                            <textarea
                              rows={2}
                              value={mgrRemarkDraft}
                              onChange={(e) => setMgrRemarkDraft(e.target.value)}
                              placeholder="Remark..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveMgrRemark(item.complaintId)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-inline-cancel"
                                onClick={() => setEditingMgrRemarkId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="remark-display-row">
                            <span
                              className={
                                item.managerRemark
                                  ? 'remark-value'
                                  : 'remark-placeholder'
                              }
                            >
                              {item.managerRemark || '—'}
                            </span>
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditMgrRemark(item)}
                            >
                              Edit
                            </button>
                          </div>
                        )
                      ) : (
                        <span
                          className={
                            item.managerRemark ? 'remark-value' : 'remark-placeholder'
                          }
                        >
                          {item.managerRemark || '—'}
                        </span>
                      )}
                    </td>

                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.managerDone ? 'check-button-label--checked' : ''
                        } ${
                          currentUser.role !== 'manager'
                            ? 'check-button-label--readonly'
                            : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.managerDone}
                          disabled={currentUser.role !== 'manager' || isRowSaving}
                          onChange={() => handleToggleManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    <td className="td-remark">
                      {currentUser.role === 'account_manager' ? (
                        editingAmRemarkId === item.complaintId ? (
                          <div className="inline-edit-box">
                            <textarea
                              rows={2}
                              value={amRemarkDraft}
                              onChange={(e) => setAmRemarkDraft(e.target.value)}
                              placeholder="Remark..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveAmRemark(item.complaintId)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-inline-cancel"
                                onClick={() => setEditingAmRemarkId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="remark-display-row">
                            <span
                              className={
                                item.accountManagerRemark
                                  ? 'remark-value'
                                  : 'remark-placeholder'
                              }
                            >
                              {item.accountManagerRemark || '—'}
                            </span>
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditAmRemark(item)}
                            >
                              Edit
                            </button>
                          </div>
                        )
                      ) : (
                        <span
                          className={
                            item.accountManagerRemark
                              ? 'remark-value'
                              : 'remark-placeholder'
                          }
                        >
                          {item.accountManagerRemark || '—'}
                        </span>
                      )}
                    </td>

                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.accountManagerDone ? 'check-button-label--checked' : ''
                        } ${
                          currentUser.role !== 'account_manager'
                            ? 'check-button-label--readonly'
                            : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.accountManagerDone}
                          disabled={currentUser.role !== 'account_manager' || isRowSaving}
                          onChange={() => handleToggleAccountManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    <td className="td-status-cell">
                      <span
                        className={`table-status-pill ${
                          completed
                            ? 'table-status-pill--completed'
                            : delayed
                            ? 'table-status-pill--delayed'
                            : 'table-status-pill--pending'
                        }`}
                      >
                        {completed ? 'Completed' : delayed ? 'Delayed' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {scopedComplaints.length === 0 && (
                <tr>
                  <td
                    colSpan={currentUser.role === 'admin' ? 10 : 9}
                    className="empty-complaints-cell"
                  >
                    No complaints found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* {currentUser.role === 'account_manager' && (
        <button
          type="button"
          className="floating-add-complaint-btn"
          onClick={() => setShowCreateModal(true)}
          title="Add Complaint"
          aria-label="Add Complaint"
        >
          <span className="floating-plus-icon">+</span>
        </button>
      )} */}

      {currentUser.role === 'account_manager' && showCreateModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-complaint-modal-title"
          >
            <div className="modal-header">
              <h3 id="create-complaint-modal-title">New Complaint</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="modal-form" onSubmit={handleCreateSubmit}>
              <div className="cp-form-group">
                <label htmlFor="select-manager">Manager</label>
                <select
                  id="select-manager"
                  value={selectedManagerId}
                  onChange={(e) => setSelectedManagerId(e.target.value)}
                  required
                >
                  {managers.map((mgr) => (
                    <option key={mgr.id} value={mgr.id}>
                      {mgr.name} ({mgr.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="cp-form-group">
                <label htmlFor="write-complaint">Complaint</label>
                <textarea
                  id="write-complaint"
                  rows={4}
                  placeholder="Write complaint..."
                  value={complaintInput}
                  onChange={(e) => setComplaintInput(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmittingNew}
                >
                  {isSubmittingNew ? '...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
