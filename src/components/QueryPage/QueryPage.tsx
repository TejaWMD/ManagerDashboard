import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToAppointment,
  belongsToManager,
  getLinkedAppointmentForQuery,
  isUserParticipantInAppointment,
  isUserCcOnQuery,
  Query,
  QueryAttachment,
  QueryRemark,
  QueryCCUser,
  isQueryDelayed,
  isQueryDone,
  isQueryPending,
  isSenderDelayed,
  sortQueriesByStatusAndTimestamp,
  hasManagerRemark,
  isUrgentManagerRemarkOverdue,
  getQueryTimestampMs,
  UserAccount,
  Appointment,
} from '../../types';
import {
  formatFileSize,
  getFileIcon,
  validateAndReadAttachments,
  MAX_FILE_SIZE_LABEL,
  MAX_FILES_PER_UPLOAD,
  MAX_TOTAL_ATTACHMENTS_LABEL,
  downloadAttachment,
  openAttachment,
} from '../../lib/attachments';
import {
  formatDate,
  formatDateTime,
  formatTimestamp as formatTimestampUtil,
  parseDateToMs,
} from '../../lib/dateUtils';
import { dispatchQueryPushNotification } from '../../lib/pushDispatcher';
import { AUTHORIZED_USERS } from '../../data/users';
import {
  calculateReceiverOverallRating,
  calculateSenderOverallRating,
  RECEIVER_RATING_FEATURE_START_MS,
} from '../../lib/ratingUtils';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './QueryPage.css';

interface QueryPageProps {
  currentUser: UserAccount;
  queries: Query[];
  savingQueryId: string | null;
  appointments?: Appointment[];
  initialFollowupAppointment?: Appointment | null;
  onOpenBookAppointment?: (preselectedQueryId?: string | null, preselectedUserId?: string | null) => void;
  onCreateQuery: (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    queryTitle: string;
    queryText: string;
    linkedAppointmentId?: string | null;
    isUrgent?: boolean;
    attachments?: QueryAttachment[];
    ccUsers?: QueryCCUser[];
  }) => Promise<void>;
  onUpdateQuery: (
    queryId: string,
    updates: Partial<
      Pick<
        Query,
        | 'queryTitle'
        | 'queryText'
        | 'managerRemarkTitle'
        | 'managerRemark'
        | 'managerDone'
        | 'accountManagerRemarkTitle'
        | 'accountManagerRemark'
        | 'accountManagerDone'
        | 'rating'
        | 'targetDueAt'
        | 'targetDueAtMs'
        | 'extensionStatus'
        | 'extensionRequestedAt'
        | 'extensionProposedDueAt'
        | 'extensionProposedDueAtMs'
        | 'extensionReason'
        | 'extensionReviewNote'
        | 'extensionReviewedAt'
        | 'isDelayed'
        | 'isUrgent'
        | 'linkedAppointmentId'
        | 'attachments'
        | 'managerAttachments'
        | 'remarks'
        | 'completedAt'
        | 'completedAtMs'
        | 'adminCompletedBy'
        | 'adminCompletedAt'
        | 'adminCompletedAtMs'
        | 'autoCompletedAt'
        | 'autoCompletedAtMs'
        | 'completionNote'
        | 'ccUsers'
        | 'adminReceiverRating'
        | 'adminReceiverRemark'
        | 'adminReceiverRatedAt'
        | 'adminReceiverRatedAtMs'
        | 'senderReceiverRating'
        | 'senderReceiverRemark'
        | 'senderReceiverRatedAt'
        | 'senderReceiverRatedAtMs'
        | 'adminSenderRating'
        | 'adminSenderRemark'
        | 'adminSenderRatedAt'
        | 'adminSenderRatedAtMs'
        | 'receiverSenderRating'
        | 'receiverSenderRemark'
        | 'receiverSenderRatedAt'
        | 'receiverSenderRatedAtMs'
      >
    >
  ) => Promise<void>;
}

type StatusFilterValue =
  | 'ALL'
  | 'Urgent'
  | 'Pending'
  | 'ExtensionPending'
  | 'Unchecked'
  | 'ManagerDone'
  | 'Delayed'
  | 'Completed';

type ManagerViewScope = 'ALL' | 'RECEIVED' | 'SENT' | 'CC';

export const QueryPage: React.FC<QueryPageProps> = ({
  currentUser,
  queries,
  savingQueryId,
  appointments = [],
  initialFollowupAppointment,
  onOpenBookAppointment,
  onCreateQuery,
  onUpdateQuery,
}) => {
  // All potential senders (Account Managers + Managers)
  const senders = useMemo(
    () =>
      AUTHORIZED_USERS.filter(
        (u) => u.role === 'account_manager' || u.role === 'manager'
      ),
    []
  );

  // All managers (queries can ONLY be sent to managers)
  const managers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'manager'),
    []
  );

  // Available target managers when creating a new query
  // If currentUser is a manager, prioritize other managers so they send queries among themselves
  const targetManagersForCreation = useMemo(() => {
    if (currentUser.role === 'manager') {
      const otherManagers = managers.filter((m) => m.id !== currentUser.id);
      return otherManagers.length > 0 ? otherManagers : managers;
    }
    return managers;
  }, [currentUser, managers]);

  // Live clock so Delayed status updates automatically
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Header filter states
  const [managerViewType, setManagerViewType] = useState<ManagerViewScope>('ALL');
  const [filterSenderId, setFilterSenderId] = useState<string>('ALL');
  const [filterManagerId, setFilterManagerId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<StatusFilterValue>('ALL');
  const [timestampOrder, setTimestampOrder] = useState<'desc' | 'asc'>('desc');

  // Create modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [isUrgentDraft, setIsUrgentDraft] = useState<boolean>(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    targetManagersForCreation[0]?.id || ''
  );
  const [selectedCcUserIds, setSelectedCcUserIds] = useState<string[]>([]);
  const [queryTitleInput, setQueryTitleInput] = useState<string>('');
  const [queryInput, setQueryInput] = useState<string>('');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string>('');
  const [isSubmittingNew, setIsSubmittingNew] = useState<boolean>(false);

  // Attachment states for new query modal
  const [attachedFiles, setAttachedFiles] = useState<QueryAttachment[]>([]);
  const [isReadingFiles, setIsReadingFiles] = useState<boolean>(false);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesAdded = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsReadingFiles(true);
    try {
      const { added, errors } = await validateAndReadAttachments(files, attachedFiles, {
        uploadedBy: currentUser.name,
        uploaderRole: 'sender',
      });
      if (errors.length > 0) {
        alert(errors.join('\n\n'));
      }
      if (added.length > 0) {
        setAttachedFiles((prev) => [...prev, ...added]);
      }
    } finally {
      setIsReadingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFilesAdded(e.target.files);
    }
  };

  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleRemoveAttachedFile = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Query Details in-place editing (sender & admin)
  const [isEditingDescription, setIsEditingDescription] = useState<boolean>(false);
  const [detailTitleDraft, setDetailTitleDraft] = useState<string>('');
  const [detailDescDraft, setDetailDescDraft] = useState<string>('');
  const [detailAttachmentsDraft, setDetailAttachmentsDraft] = useState<QueryAttachment[]>([]);
  const [isReadingDetailFiles, setIsReadingDetailFiles] = useState<boolean>(false);
  const [isSavingDetailChanges, setIsSavingDetailChanges] = useState<boolean>(false);
  const [hasUnsavedDetailChanges, setHasUnsavedDetailChanges] = useState<boolean>(false);
  const [detailSaveSuccess, setDetailSaveSuccess] = useState<boolean>(false);
  const detailFileInputRef = useRef<HTMLInputElement | null>(null);
  const openInEditModeRef = useRef<boolean>(false);

  const handleDetailFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsReadingDetailFiles(true);
    try {
      const { added, errors } = await validateAndReadAttachments(files, detailAttachmentsDraft, {
        uploadedBy: currentUser.name,
        uploaderRole: 'sender',
      });
      if (errors.length > 0) {
        alert(errors.join('\n\n'));
      }
      if (added.length > 0) {
        setDetailAttachmentsDraft((prev) => [...prev, ...added]);
        setHasUnsavedDetailChanges(true);
      }
    } finally {
      setIsReadingDetailFiles(false);
      if (detailFileInputRef.current) {
        detailFileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveDetailAttachment = (id: string) => {
    setDetailAttachmentsDraft((prev) => prev.filter((a) => a.id !== id));
    setHasUnsavedDetailChanges(true);
  };

  const handleSaveDetailChanges = async () => {
    if (!activeViewingQuery) return;
    const fallbackTitle = (activeViewingQuery.queryTitle || activeViewingQuery.queryText || '').trim();
    const fallbackDesc = (activeViewingQuery.queryText || fallbackTitle).trim();
    const finalTitle = isEditingDescription
      ? detailTitleDraft.trim() || detailDescDraft.trim()
      : detailTitleDraft.trim() || fallbackTitle;
    const finalDesc = isEditingDescription
      ? detailDescDraft.trim() || finalTitle
      : detailDescDraft.trim() || fallbackDesc;

    if (!finalTitle && !finalDesc) {
      alert('Please provide a query title or description.');
      return;
    }

    setIsSavingDetailChanges(true);
    try {
      await onUpdateQuery(activeViewingQuery.queryId, {
        queryTitle: finalTitle,
        queryText: finalDesc,
        attachments: detailAttachmentsDraft,
      });

      // Update viewing query in state
      setViewingQuery((prev) =>
        prev
          ? {
              ...prev,
              queryTitle: finalTitle,
              queryText: finalDesc,
              attachments: detailAttachmentsDraft,
            }
          : null
      );

      setIsEditingDescription(false);
      setHasUnsavedDetailChanges(false);
      setDetailSaveSuccess(true);
      setTimeout(() => setDetailSaveSuccess(false), 3500);
    } finally {
      setIsSavingDetailChanges(false);
    }
  };

  const handleCancelDetailEdits = () => {
    if (!activeViewingQuery) return;
    setDetailTitleDraft(activeViewingQuery.queryTitle || activeViewingQuery.queryText || '');
    setDetailDescDraft(activeViewingQuery.queryText || '');
    setDetailAttachmentsDraft(activeViewingQuery.attachments ? [...activeViewingQuery.attachments] : []);
    setIsEditingDescription(false);
    setHasUnsavedDetailChanges(false);
  };

  const handleSaveModalCc = async () => {
    if (!activeViewingQuery) return;
    setIsSavingModalCc(true);
    try {
      const newCcUsers: QueryCCUser[] = modalCcDraftIds
        .map((id) => {
          const u = AUTHORIZED_USERS.find((usr) => usr.id === id);
          return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
        })
        .filter((u): u is QueryCCUser => u !== null);

      const previousIds = (activeViewingQuery.ccUsers || []).map((u) => u.id);
      const newlyAddedUsers = newCcUsers.filter((u) => !previousIds.includes(u.id));

      await onUpdateQuery(activeViewingQuery.queryId, {
        ccUsers: newCcUsers,
      });

      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? { ...prev, ccUsers: newCcUsers }
          : prev
      );

      setIsEditingModalCc(false);
      setModalCcSaveSuccess(true);
      setTimeout(() => setModalCcSaveSuccess(false), 3500);

      // Dispatch notification to newly CC'd users
      if (newlyAddedUsers.length > 0) {
        const updatedQuery = { ...activeViewingQuery, ccUsers: newCcUsers };
        dispatchQueryPushNotification({
          event: 'CC_ADDED',
          query: updatedQuery,
          actor: currentUser,
        });
      }
    } finally {
      setIsSavingModalCc(false);
    }
  };

  // Manager Remark in-place editing in Query View modal (receiving manager & admin)
  const [isEditingModalMgrRemark, setIsEditingModalMgrRemark] = useState<boolean>(false);
  const [modalMgrRemarkTitleDraft, setModalMgrRemarkTitleDraft] = useState<string>('');
  const [modalMgrRemarkDraft, setModalMgrRemarkDraft] = useState<string>('');
  const [modalMgrAttachmentsDraft, setModalMgrAttachmentsDraft] = useState<QueryAttachment[]>([]);
  const [isReadingMgrFiles, setIsReadingMgrFiles] = useState<boolean>(false);
  const [isSavingModalMgrRemark, setIsSavingModalMgrRemark] = useState<boolean>(false);
  const [modalMgrRemarkSaveSuccess, setModalMgrRemarkSaveSuccess] = useState<boolean>(false);
  const mgrFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleMgrFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsReadingMgrFiles(true);
    try {
      const { added, errors } = await validateAndReadAttachments(files, modalMgrAttachmentsDraft, {
        uploadedBy: currentUser.name,
        uploaderRole: 'manager',
      });
      if (errors.length > 0) {
        alert(errors.join('\n\n'));
      }

      if (added.length > 0) {
        const nextMgrAttachments = [...modalMgrAttachmentsDraft, ...added];
        setModalMgrAttachmentsDraft(nextMgrAttachments);
        if (activeViewingQuery) {
          await onUpdateQuery(activeViewingQuery.queryId, {
            managerAttachments: nextMgrAttachments,
          });
          setViewingQuery((prev) =>
            prev && prev.queryId === activeViewingQuery.queryId
              ? { ...prev, managerAttachments: nextMgrAttachments }
              : prev
          );
          setModalMgrRemarkSaveSuccess(true);
          setTimeout(() => setModalMgrRemarkSaveSuccess(false), 3000);
        }
      }
    } finally {
      setIsReadingMgrFiles(false);
      if (mgrFileInputRef.current) {
        mgrFileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveMgrAttachment = async (id: string) => {
    const nextMgrAttachments = modalMgrAttachmentsDraft.filter((a) => a.id !== id);
    setModalMgrAttachmentsDraft(nextMgrAttachments);
    if (activeViewingQuery) {
      await onUpdateQuery(activeViewingQuery.queryId, {
        managerAttachments: nextMgrAttachments,
      });
      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? { ...prev, managerAttachments: nextMgrAttachments }
          : prev
      );
    }
  };

  const handleSaveModalMgrRemark = async () => {
    if (!activeViewingQuery) return;
    setIsSavingModalMgrRemark(true);
    try {
      const finalTitle = modalMgrRemarkTitleDraft.trim();
      const finalDesc = modalMgrRemarkDraft.trim();
      await onUpdateQuery(activeViewingQuery.queryId, {
        managerRemarkTitle: finalTitle,
        managerRemark: finalDesc,
        managerAttachments: modalMgrAttachmentsDraft,
      });

      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? {
              ...prev,
              managerRemarkTitle: finalTitle,
              managerRemark: finalDesc,
              managerAttachments: modalMgrAttachmentsDraft,
            }
          : null
      );

      setIsEditingModalMgrRemark(false);
      setModalMgrRemarkSaveSuccess(true);
      setTimeout(() => setModalMgrRemarkSaveSuccess(false), 3500);
    } finally {
      setIsSavingModalMgrRemark(false);
    }
  };

  const handleCancelModalMgrRemark = () => {
    if (!activeViewingQuery) return;
    setModalMgrRemarkTitleDraft(activeViewingQuery.managerRemarkTitle || '');
    setModalMgrRemarkDraft(activeViewingQuery.managerRemark || '');
    setModalMgrAttachmentsDraft(
      activeViewingQuery.managerAttachments ? [...activeViewingQuery.managerAttachments] : []
    );
    setIsEditingModalMgrRemark(false);
  };

  // Sender Remark in-place editing in Query View modal (sender & admin)
  const [isEditingModalSenderRemark, setIsEditingModalSenderRemark] = useState<boolean>(false);
  const [modalSenderRemarkTitleDraft, setModalSenderRemarkTitleDraft] = useState<string>('');
  const [modalSenderRemarkDraft, setModalSenderRemarkDraft] = useState<string>('');
  const [isSavingModalSenderRemark, setIsSavingModalSenderRemark] = useState<boolean>(false);
  const [modalSenderRemarkSaveSuccess, setModalSenderRemarkSaveSuccess] = useState<boolean>(false);

  const handleSaveModalSenderRemark = async () => {
    if (!activeViewingQuery) return;
    setIsSavingModalSenderRemark(true);
    try {
      const finalTitle = modalSenderRemarkTitleDraft.trim();
      const finalDesc = modalSenderRemarkDraft.trim();
      await onUpdateQuery(activeViewingQuery.queryId, {
        accountManagerRemarkTitle: finalTitle,
        accountManagerRemark: finalDesc,
      });

      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? {
              ...prev,
              accountManagerRemarkTitle: finalTitle,
              accountManagerRemark: finalDesc,
            }
          : null
      );

      setIsEditingModalSenderRemark(false);
      setModalSenderRemarkSaveSuccess(true);
      setTimeout(() => setModalSenderRemarkSaveSuccess(false), 3500);
    } finally {
      setIsSavingModalSenderRemark(false);
    }
  };

  const handleCancelModalSenderRemark = () => {
    if (!activeViewingQuery) return;
    setModalSenderRemarkTitleDraft(activeViewingQuery.accountManagerRemarkTitle || '');
    setModalSenderRemarkDraft(activeViewingQuery.accountManagerRemark || '');
    setIsEditingModalSenderRemark(false);
  };

  // Timestamped Remarks Posting (for Manager & Sender)
  const [newMgrRemarkTitle, setNewMgrRemarkTitle] = useState<string>('');
  const [newMgrRemarkText, setNewMgrRemarkText] = useState<string>('');
  const [isPostingMgrRemark, setIsPostingMgrRemark] = useState<boolean>(false);

  const [newSenderRemarkTitle, setNewSenderRemarkTitle] = useState<string>('');
  const [newSenderRemarkText, setNewSenderRemarkText] = useState<string>('');
  const [isPostingSenderRemark, setIsPostingSenderRemark] = useState<boolean>(false);

  const handlePostManagerRemark = async () => {
    if (!activeViewingQuery || !newMgrRemarkText.trim()) return;
    setIsPostingMgrRemark(true);
    try {
      const now = new Date();
      const finalTitle = newMgrRemarkTitle.trim();
      const finalDesc = newMgrRemarkText.trim();
      const newRmk: QueryRemark = {
        id: `rmk-mgr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorRole: currentUser.role,
        type: 'manager',
        title: finalTitle || undefined,
        text: finalDesc,
        createdAt: formatDateTime(now, false),
        createdAtMs: now.getTime(),
      };

      const updatedRemarks = [...(activeViewingQuery.remarks || []), newRmk];
      await onUpdateQuery(activeViewingQuery.queryId, {
        remarks: updatedRemarks,
        managerRemarkTitle: finalTitle || activeViewingQuery.managerRemarkTitle,
        managerRemark: finalDesc,
        managerAttachments: modalMgrAttachmentsDraft,
      });

      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? {
              ...prev,
              remarks: updatedRemarks,
              managerRemarkTitle: finalTitle || prev.managerRemarkTitle,
              managerRemark: finalDesc,
              managerAttachments: modalMgrAttachmentsDraft,
            }
          : null
      );

      setNewMgrRemarkTitle('');
      setNewMgrRemarkText('');
      setModalMgrRemarkSaveSuccess(true);
      setTimeout(() => setModalMgrRemarkSaveSuccess(false), 3000);
    } finally {
      setIsPostingMgrRemark(false);
    }
  };

  const handlePostSenderRemark = async () => {
    if (!activeViewingQuery || !newSenderRemarkText.trim()) return;
    setIsPostingSenderRemark(true);
    try {
      const now = new Date();
      const finalTitle = newSenderRemarkTitle.trim();
      const finalDesc = newSenderRemarkText.trim();
      const newRmk: QueryRemark = {
        id: `rmk-sender-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorRole: currentUser.role,
        type: 'sender',
        title: finalTitle || undefined,
        text: finalDesc,
        createdAt: formatDateTime(now, false),
        createdAtMs: now.getTime(),
      };

      const updatedRemarks = [...(activeViewingQuery.remarks || []), newRmk];
      await onUpdateQuery(activeViewingQuery.queryId, {
        remarks: updatedRemarks,
        accountManagerRemarkTitle: finalTitle || activeViewingQuery.accountManagerRemarkTitle,
        accountManagerRemark: finalDesc,
      });

      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? {
              ...prev,
              remarks: updatedRemarks,
              accountManagerRemarkTitle: finalTitle || prev.accountManagerRemarkTitle,
              accountManagerRemark: finalDesc,
            }
          : null
      );

      setNewSenderRemarkTitle('');
      setNewSenderRemarkText('');
      setModalSenderRemarkSaveSuccess(true);
      setTimeout(() => setModalSenderRemarkSaveSuccess(false), 3000);
    } finally {
      setIsPostingSenderRemark(false);
    }
  };

  // If redirected from an appointment follow-up action, prefill the create query modal
  useEffect(() => {
    if (initialFollowupAppointment) {
      setShowCreateModal(true);
      setQueryTitleInput(`Follow-up [${initialFollowupAppointment.id}]: ${initialFollowupAppointment.title}`);
      setQueryInput(
        `Discussion summary from appointment ${initialFollowupAppointment.id} held on ${initialFollowupAppointment.scheduledAt}.\n\nAgenda / Points discussed:\n${initialFollowupAppointment.agenda || 'N/A'}`
      );
      setSelectedAppointmentId(initialFollowupAppointment.id);

      // Match target manager from the appointment
      const mgr = managers.find(
        (m) =>
          m.id === initialFollowupAppointment.receiverId ||
          m.id === initialFollowupAppointment.requesterId ||
          (Array.isArray(initialFollowupAppointment.attendees) &&
            initialFollowupAppointment.attendees.some((a) => a.id === m.id))
      );
      if (mgr) {
        setSelectedManagerId(mgr.id);
      }
    }
  }, [initialFollowupAppointment, managers]);

  // Keep target manager selection in sync when modal opens
  const handleOpenCreateModal = () => {
    if (targetManagersForCreation.length > 0) {
      setSelectedManagerId(targetManagersForCreation[0].id);
    }
    setSelectedCcUserIds([]);
    setShowCreateModal(true);
  };

  // Manager currently selected in Create Query modal
  const selectedManagerForCreation = useMemo(() => {
    return managers.find((m) => m.id === selectedManagerId) || null;
  }, [managers, selectedManagerId]);

  // Eligible CC users when creating a query: Any user except current sender and receiving manager
  const eligibleCcUsersForCreation = useMemo(() => {
    return AUTHORIZED_USERS.filter(
      (u) => u.id !== currentUser.id && u.id !== selectedManagerId
    );
  }, [currentUser.id, selectedManagerId]);

  // Requirement 1: In query list, if linking an existing appointment to the query,
  // the receiving manager should be one of the attendees in the appointment.
  const linkableAppointmentsForCreation = useMemo(() => {
    if (!selectedManagerForCreation) return [];
    return appointments.filter(
      (apt) =>
        belongsToAppointment(apt, currentUser) &&
        isUserParticipantInAppointment(apt, selectedManagerForCreation)
    );
  }, [appointments, currentUser, selectedManagerForCreation]);

  // If receiving manager changes and the selected appointment does not include this manager, clear selection
  useEffect(() => {
    if (selectedAppointmentId && selectedManagerForCreation) {
      const apt = appointments.find((a) => a.id === selectedAppointmentId);
      if (!apt || !isUserParticipantInAppointment(apt, selectedManagerForCreation)) {
        setSelectedAppointmentId('');
      }
    }
  }, [selectedManagerId, appointments, selectedManagerForCreation, selectedAppointmentId]);

  // Inline editing states
  const [editingSenderRemarkId, setEditingSenderRemarkId] = useState<string | null>(null);
  const [senderRemarkTitleDraft, setSenderRemarkTitleDraft] = useState<string>('');
  const [senderRemarkDraft, setSenderRemarkDraft] = useState<string>('');

  const [editingQueryTextId, setEditingQueryTextId] = useState<string | null>(null);
  const [queryTitleDraft, setQueryTitleDraft] = useState<string>('');
  const [queryTextDraft, setQueryTextDraft] = useState<string>('');

  const [editingMgrRemarkId, setEditingMgrRemarkId] = useState<string | null>(null);
  const [mgrRemarkTitleDraft, setMgrRemarkTitleDraft] = useState<string>('');
  const [mgrRemarkDraft, setMgrRemarkDraft] = useState<string>('');

  // Rating modal states (Sender rating for receiver)
  const [ratingModalQuery, setRatingModalQuery] = useState<Query | null>(null);
  const [ratingInput, setRatingInput] = useState<number>(0);
  const [ratingHover, setRatingHover] = useState<number>(0);
  const [ratingRemarkInput, setRatingRemarkInput] = useState<string>('');
  const [ratingRemarkError, setRatingRemarkError] = useState<string>('');
  const [ratingModalCompleteOnSubmit, setRatingModalCompleteOnSubmit] = useState<boolean>(false);

  // Receiver Rating modal states (Receiver rating for sender)
  const [receiverRatingModalQuery, setReceiverRatingModalQuery] = useState<Query | null>(null);
  const [receiverRatingInput, setReceiverRatingInput] = useState<number>(10);
  const [receiverRatingHover, setReceiverRatingHover] = useState<number>(0);
  const [receiverRatingRemarkInput, setReceiverRatingRemarkInput] = useState<string>('');
  const [receiverRatingRemarkError, setReceiverRatingRemarkError] = useState<string>('');

  // Admin Rating modal states (for Mr. Mani on Query Page)
  const [adminRatingQuery, setAdminRatingQuery] = useState<Query | null>(null);
  const [adminRatingTargetRole, setAdminRatingTargetRole] = useState<'receiver' | 'sender'>('receiver');
  const [adminRatingInput, setAdminRatingInput] = useState<number>(10);
  const [adminRemarkInput, setAdminRemarkInput] = useState<string>('');
  const [adminRemarkError, setAdminRemarkError] = useState<string>('');

  // Mandatory Solution Remark Modal state (Director Policy Requirement)
  const [remarkModalQuery, setRemarkModalQuery] = useState<Query | null>(null);
  const [mandatoryRemarkTitleDraft, setMandatoryRemarkTitleDraft] = useState<string>('');
  const [mandatoryRemarkDraft, setMandatoryRemarkDraft] = useState<string>('');
  const [mandatoryRemarkAttachmentsDraft, setMandatoryRemarkAttachmentsDraft] = useState<QueryAttachment[]>([]);
  const [isReadingMandatoryFiles, setIsReadingMandatoryFiles] = useState<boolean>(false);
  const [remarkError, setRemarkError] = useState<string>('');
  const mandatoryFileInputRef = useRef<HTMLInputElement | null>(null);

  // Completion Extension Modal states (for Manager requesting extra time)
  const [extensionModalQuery, setExtensionModalQuery] = useState<Query | null>(null);
  const [extensionProposedDateInput, setExtensionProposedDateInput] = useState<string>('');
  const [extensionReasonInput, setExtensionReasonInput] = useState<string>('');
  const [extensionError, setExtensionError] = useState<string>('');
  const [isSubmittingExtension, setIsSubmittingExtension] = useState<boolean>(false);

  // Review Extension Modal states (for Sender AM or Admin approving/declining)
  const [extensionReviewModalQuery, setExtensionReviewModalQuery] = useState<Query | null>(null);
  const [extensionReviewNoteInput, setExtensionReviewNoteInput] = useState<string>('');
  const [isReviewingExtension, setIsReviewingExtension] = useState<boolean>(false);

  const formatTimestamp = (date: Date): string => {
    return formatTimestampUtil(date);
  };

  const openExtensionModal = (query: Query) => {
    // Default proposed date to 3 days from now at 18:00
    const defaultDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    defaultDate.setHours(18, 0, 0, 0);
    const yyyy = defaultDate.getFullYear();
    const mm = String(defaultDate.getMonth() + 1).padStart(2, '0');
    const dd = String(defaultDate.getDate()).padStart(2, '0');
    const hh = String(defaultDate.getHours()).padStart(2, '0');
    const min = String(defaultDate.getMinutes()).padStart(2, '0');

    setExtensionProposedDateInput(`${yyyy}-${mm}-${dd}T${hh}:${min}`);
    setExtensionReasonInput('');
    setExtensionError('');
    setExtensionModalQuery(query);
  };

  const handleSubmitExtensionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extensionModalQuery) return;
    if (!extensionProposedDateInput) {
      setExtensionError('Please pick a proposed completion date & time.');
      return;
    }
    const proposedMs = Date.parse(extensionProposedDateInput);
    if (Number.isNaN(proposedMs) || proposedMs <= Date.now()) {
      setExtensionError('Proposed completion date must be in the future.');
      return;
    }
    const cleanReason = extensionReasonInput.trim();
    if (cleanReason.length < 5) {
      setExtensionError('Please explain why extra time is needed (min 5 chars).');
      return;
    }

    const proposedTimestamp = formatDateTime(extensionProposedDateInput.replace('T', ' ') + ':00');
    const nowTimestamp = formatTimestamp(new Date());

    setIsSubmittingExtension(true);
    try {
      await onUpdateQuery(extensionModalQuery.queryId, {
        extensionStatus: 'PENDING',
        extensionRequestedAt: nowTimestamp,
        extensionProposedDueAt: proposedTimestamp,
        extensionProposedDueAtMs: proposedMs,
        extensionReason: cleanReason,
      });
      setExtensionModalQuery(null);
      setExtensionReasonInput('');
      setExtensionProposedDateInput('');
      setExtensionError('');
    } finally {
      setIsSubmittingExtension(false);
    }
  };

  const handleApproveExtension = async (query: Query) => {
    const proposedDueAt = query.extensionProposedDueAt;
    const proposedDueAtMs =
      query.extensionProposedDueAtMs && query.extensionProposedDueAtMs > 0
        ? query.extensionProposedDueAtMs
        : proposedDueAt
        ? parseDateToMs(proposedDueAt)
        : null;

    if (!proposedDueAt || !proposedDueAtMs) {
      alert('Cannot approve extension: No proposed extension date specified.');
      return;
    }

    setIsReviewingExtension(true);
    try {
      const nowTimestamp = formatTimestamp(new Date());
      await onUpdateQuery(query.queryId, {
        extensionStatus: 'APPROVED',
        targetDueAt: proposedDueAt,
        targetDueAtMs: proposedDueAtMs,
        extensionReviewedAt: nowTimestamp,
        isDelayed: false,
      });
      setExtensionReviewModalQuery(null);
      if (viewingQuery && viewingQuery.queryId.toUpperCase() === query.queryId.toUpperCase()) {
        setViewingQuery((prev) =>
          prev
            ? {
                ...prev,
                extensionStatus: 'APPROVED',
                targetDueAt: proposedDueAt,
                targetDueAtMs: proposedDueAtMs,
                extensionReviewedAt: nowTimestamp,
                isDelayed: false,
              }
            : null
        );
      }
    } finally {
      setIsReviewingExtension(false);
    }
  };

  const handleDeclineExtension = async (query: Query) => {
    setIsReviewingExtension(true);
    try {
      const nowTimestamp = formatTimestamp(new Date());
      const reviewNote = extensionReviewNoteInput.trim() || 'Declined by sender';
      await onUpdateQuery(query.queryId, {
        extensionStatus: 'DECLINED',
        extensionReviewNote: reviewNote,
        extensionReviewedAt: nowTimestamp,
      });
      setExtensionReviewModalQuery(null);
      setExtensionReviewNoteInput('');
      if (viewingQuery && viewingQuery.queryId.toUpperCase() === query.queryId.toUpperCase()) {
        setViewingQuery((prev) =>
          prev
            ? {
                ...prev,
                extensionStatus: 'DECLINED',
                extensionReviewNote: reviewNote,
                extensionReviewedAt: nowTimestamp,
              }
            : null
        );
      }
    } finally {
      setIsReviewingExtension(false);
    }
  };

  // View Query Details Pop-up Modal state (for all users)
  const [viewingQuery, setViewingQuery] = useState<Query | null>(null);
  const activeViewingQuery = useMemo(() => {
    if (!viewingQuery) return null;
    return (
      queries.find((c) => c.queryId === viewingQuery.queryId) ||
      viewingQuery
    );
  }, [queries, viewingQuery]);

  const activeViewingLinkedAppointment = useMemo(() => {
    if (!activeViewingQuery) return null;
    return getLinkedAppointmentForQuery(activeViewingQuery, appointments);
  }, [activeViewingQuery, appointments]);

  // Linking an existing appointment to the currently viewed query
  const [isLinkingExistingApt, setIsLinkingExistingApt] = useState<boolean>(false);
  const [chosenExistingAptId, setChosenExistingAptId] = useState<string>('');
  const [linkExistingError, setLinkExistingError] = useState<string | null>(null);
  const [isSubmittingLinkApt, setIsSubmittingLinkApt] = useState<boolean>(false);

  // CC Editing in View Query Details Modal (for Sender AM & Admin)
  const [isEditingModalCc, setIsEditingModalCc] = useState<boolean>(false);
  const [modalCcDraftIds, setModalCcDraftIds] = useState<string[]>([]);
  const [isSavingModalCc, setIsSavingModalCc] = useState<boolean>(false);
  const [modalCcSaveSuccess, setModalCcSaveSuccess] = useState<boolean>(false);

  // Eligible existing appointments for the active viewing query:
  // Must belong to currentUser AND receiving manager of activeViewingQuery must be an attendee/participant
  const linkableAppointmentsForActiveQuery = useMemo(() => {
    if (!activeViewingQuery) return [];
    const receivingManager = {
      id: activeViewingQuery.managerId,
      email: activeViewingQuery.managerEmail,
      name: activeViewingQuery.managerName,
    };
    return appointments.filter(
      (apt) =>
        belongsToAppointment(apt, currentUser) &&
        isUserParticipantInAppointment(apt, receivingManager)
    );
  }, [activeViewingQuery, appointments, currentUser]);

  const lastSyncedQueryIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeViewingQuery) {
      lastSyncedQueryIdRef.current = null;
      return;
    }

    const isDifferentQuery = lastSyncedQueryIdRef.current !== activeViewingQuery.queryId;
    lastSyncedQueryIdRef.current = activeViewingQuery.queryId;

    if (isDifferentQuery) {
      setIsLinkingExistingApt(false);
      setChosenExistingAptId('');
      setLinkExistingError(null);

      const startInEdit = openInEditModeRef.current;
      openInEditModeRef.current = false;

      setIsEditingDescription(startInEdit);
      setDetailTitleDraft(activeViewingQuery.queryTitle || activeViewingQuery.queryText || '');
      setDetailDescDraft(activeViewingQuery.queryText || '');
      setDetailAttachmentsDraft(activeViewingQuery.attachments ? [...activeViewingQuery.attachments] : []);
      setHasUnsavedDetailChanges(startInEdit);
      setDetailSaveSuccess(false);

      setIsEditingModalMgrRemark(false);
      setModalMgrRemarkTitleDraft(activeViewingQuery.managerRemarkTitle || '');
      setModalMgrRemarkDraft(activeViewingQuery.managerRemark || '');
      setModalMgrAttachmentsDraft(
        activeViewingQuery.managerAttachments ? [...activeViewingQuery.managerAttachments] : []
      );
      setModalMgrRemarkSaveSuccess(false);

      setIsEditingModalSenderRemark(false);
      setModalSenderRemarkTitleDraft(activeViewingQuery.accountManagerRemarkTitle || '');
      setModalSenderRemarkDraft(activeViewingQuery.accountManagerRemark || '');
      setModalSenderRemarkSaveSuccess(false);

      setIsEditingModalCc(false);
      setModalCcDraftIds((activeViewingQuery.ccUsers || []).map((u) => u.id));
      setModalCcSaveSuccess(false);
      return;
    }

    // Same query updated via background polling/realtime: only sync fields the user is not currently editing
    if (!isEditingDescription && !hasUnsavedDetailChanges) {
      setDetailTitleDraft(activeViewingQuery.queryTitle || activeViewingQuery.queryText || '');
      setDetailDescDraft(activeViewingQuery.queryText || '');
      setDetailAttachmentsDraft(activeViewingQuery.attachments ? [...activeViewingQuery.attachments] : []);
    }
    if (!isEditingModalMgrRemark) {
      setModalMgrRemarkTitleDraft(activeViewingQuery.managerRemarkTitle || '');
      setModalMgrRemarkDraft(activeViewingQuery.managerRemark || '');
      setModalMgrAttachmentsDraft(
        activeViewingQuery.managerAttachments ? [...activeViewingQuery.managerAttachments] : []
      );
    }
    if (!isEditingModalSenderRemark) {
      setModalSenderRemarkTitleDraft(activeViewingQuery.accountManagerRemarkTitle || '');
      setModalSenderRemarkDraft(activeViewingQuery.accountManagerRemark || '');
    }
    if (!isEditingModalCc) {
      setModalCcDraftIds((activeViewingQuery.ccUsers || []).map((u) => u.id));
    }
  }, [
    activeViewingQuery?.queryId,
    activeViewingQuery?.queryTitle,
    activeViewingQuery?.queryText,
    activeViewingQuery?.managerRemarkTitle,
    activeViewingQuery?.managerRemark,
    activeViewingQuery?.accountManagerRemarkTitle,
    activeViewingQuery?.accountManagerRemark,
    activeViewingQuery?.attachments?.length,
    activeViewingQuery?.managerAttachments?.length,
    isEditingDescription,
    hasUnsavedDetailChanges,
    isEditingModalMgrRemark,
    isEditingModalSenderRemark,
  ]);

  // 1. Role-scoped queries
  // Account Managers see queries they created + queries where they are CC'd.
  // Managers see queries assigned to them, queries they sent, and queries where they are CC'd.
  // Admin sees all queries.
  const roleScopedQueries = useMemo(() => {
    return queries.filter((c) => {
      if (currentUser.role === 'account_manager') {
        return belongsToAccountManager(c, currentUser) || isUserCcOnQuery(c, currentUser);
      }
      if (currentUser.role === 'manager') {
        return (
          belongsToManager(c, currentUser) ||
          belongsToAccountManager(c, currentUser) ||
          isUserCcOnQuery(c, currentUser)
        );
      }
      return true;
    });
  }, [queries, currentUser]);

  // Count of queries where the current user is CC'd
  const ccCountForUser = useMemo(() => {
    return queries.filter((c) => isUserCcOnQuery(c, currentUser)).length;
  }, [queries, currentUser]);

  // 2. Apply header filters & automatic status + timestamp sorting
  const sortedAndFilteredQueries = useMemo(() => {
    const selectedSenderObj = senders.find((s) => s.id === filterSenderId);
    const selectedMgrObj = managers.find((m) => m.id === filterManagerId);

    const filtered = roleScopedQueries.filter((c) => {
      // View scope (All, Received, Sent, or CC'd to Me)
      if (managerViewType !== 'ALL') {
        if (managerViewType === 'RECEIVED' && !belongsToManager(c, currentUser)) {
          return false;
        }
        if (managerViewType === 'SENT' && !belongsToAccountManager(c, currentUser)) {
          return false;
        }
        if (managerViewType === 'CC' && !isUserCcOnQuery(c, currentUser)) {
          return false;
        }
      }

      // Sender filter (From)
      if (filterSenderId !== 'ALL' && selectedSenderObj) {
        if (!belongsToAccountManager(c, selectedSenderObj)) {
          return false;
        }
      }

      // Assigned Manager filter (To)
      if (filterManagerId !== 'ALL' && selectedMgrObj) {
        if (!belongsToManager(c, selectedMgrObj)) {
          return false;
        }
      }

      // Status filter
      if (filterStatus !== 'ALL') {
        const done = isQueryDone(c);
        const delayed = isQueryDelayed(c, nowMs);
        const pendingUnder48h = isQueryPending(c, nowMs);

        if (filterStatus === 'Urgent' && !c.isUrgent) return false;
        if (filterStatus === 'Completed' && !done) return false;
        if (filterStatus === 'Pending' && !pendingUnder48h) return false;
        if (filterStatus === 'ExtensionPending' && c.extensionStatus !== 'PENDING') return false;
        if (filterStatus === 'Delayed' && !delayed) return false;
        if (filterStatus === 'Unchecked' && (c.managerDone || c.accountManagerDone)) {
          return false;
        }
        if (filterStatus === 'ManagerDone' && (!c.managerDone || c.accountManagerDone)) {
          return false;
        }
      }

      return true;
    });

    return sortQueriesByStatusAndTimestamp(filtered, timestampOrder);
  }, [
    roleScopedQueries,
    currentUser.role,
    managerViewType,
    filterSenderId,
    filterManagerId,
    filterStatus,
    senders,
    managers,
    timestampOrder,
    nowMs,
    currentUser,
  ]);

  const hasActiveFilters =
    managerViewType !== 'ALL' ||
    filterSenderId !== 'ALL' ||
    filterManagerId !== 'ALL' ||
    filterStatus !== 'ALL' ||
    timestampOrder !== 'desc';

  const handleResetFilters = () => {
    setManagerViewType('ALL');
    setFilterSenderId('ALL');
    setFilterManagerId('ALL');
    setFilterStatus('ALL');
    setTimestampOrder('desc');
  };

  const handleCreateSubmit = async (e?: React.FormEvent, forceUrgent?: boolean) => {
    if (e) e.preventDefault();
    const effectiveIsUrgent = forceUrgent !== undefined ? forceUrgent : isUrgentDraft;

    if (
      !selectedManagerId ||
      !queryTitleInput.trim() ||
      !queryInput.trim() ||
      isSubmittingNew
    ) {
      if (!queryTitleInput.trim()) {
        document.getElementById('query-title-input')?.focus();
      } else if (!queryInput.trim()) {
        document.getElementById('write-query')?.focus();
      }
      return;
    }

    const targetManager = managers.find((m) => m.id === selectedManagerId);
    if (!targetManager) return;

    // Requirement 1: If linking an existing appointment to the query, the receiving manager must be an attendee in the appointment
    if (selectedAppointmentId) {
      const linkedApt = appointments.find((a) => a.id === selectedAppointmentId);
      if (!linkedApt || !isUserParticipantInAppointment(linkedApt, targetManager)) {
        alert(
          `The receiving manager (${targetManager.name}) must be one of the attendees in the linked appointment.`
        );
        return;
      }
    }

    setIsSubmittingNew(true);
    try {
      const ccUsersToAttach: QueryCCUser[] = selectedCcUserIds
        .map((id) => {
          const u = AUTHORIZED_USERS.find((usr) => usr.id === id);
          return u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null;
        })
        .filter((u): u is QueryCCUser => u !== null);

      await onCreateQuery({
        managerId: targetManager.id,
        managerEmail: targetManager.email,
        managerName: targetManager.name,
        queryTitle: queryTitleInput.trim(),
        queryText: queryInput.trim(),
        linkedAppointmentId: selectedAppointmentId ? selectedAppointmentId : null,
        isUrgent: effectiveIsUrgent,
        attachments: attachedFiles,
        ccUsers: ccUsersToAttach,
      });

      setQueryTitleInput('');
      setQueryInput('');
      setSelectedAppointmentId('');
      setSelectedCcUserIds([]);
      setAttachedFiles([]);
      setIsUrgentDraft(false);
      setShowCreateModal(false);
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const handleUrgentButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // If query fields are already filled, submit immediately as urgent
    if (queryTitleInput.trim() && queryInput.trim() && selectedManagerId) {
      handleCreateSubmit(undefined, true);
    } else {
      // Toggle urgent mode on and direct user to fill missing fields
      setIsUrgentDraft((prev) => !prev);
      if (!queryTitleInput.trim()) {
        document.getElementById('query-title-input')?.focus();
      } else if (!queryInput.trim()) {
        document.getElementById('write-query')?.focus();
      }
    }
  };

  const startEditSenderRemark = (item: Query) => {
    setEditingSenderRemarkId(item.queryId);
    setSenderRemarkTitleDraft(item.accountManagerRemarkTitle || '');
    setSenderRemarkDraft(item.accountManagerRemark || '');
  };

  const saveSenderRemark = async (queryId: string) => {
    const title = senderRemarkTitleDraft.trim();
    const desc = senderRemarkDraft.trim();
    const finalDesc = desc || title;
    const finalTitle = title || finalDesc;
    await onUpdateQuery(queryId, {
      accountManagerRemarkTitle: finalTitle,
      accountManagerRemark: finalDesc,
    });
    setEditingSenderRemarkId(null);
    setSenderRemarkTitleDraft('');
    setSenderRemarkDraft('');
  };

  const startEditQueryText = (item: Query) => {
    openInEditModeRef.current = true;
    setViewingQuery(item);
    setIsEditingDescription(true);
    setDetailTitleDraft(item.queryTitle || item.queryText || '');
    setDetailDescDraft(item.queryText || '');
    setDetailAttachmentsDraft(item.attachments ? [...item.attachments] : []);
    setHasUnsavedDetailChanges(true);
  };

  const saveQueryText = async (queryId: string) => {
    const trimmedTitle = queryTitleDraft.trim();
    const trimmedDesc = queryTextDraft.trim();
    if (!trimmedTitle && !trimmedDesc) return;
    await onUpdateQuery(queryId, {
      queryTitle: trimmedTitle || trimmedDesc,
      queryText: trimmedDesc,
    });
    setEditingQueryTextId(null);
    setQueryTitleDraft('');
    setQueryTextDraft('');
  };

  const startEditMgrRemark = (item: Query) => {
    setEditingMgrRemarkId(item.queryId);
    setMgrRemarkTitleDraft(item.managerRemarkTitle || '');
    setMgrRemarkDraft(item.managerRemark || '');
  };

  const saveMgrRemark = async (queryId: string) => {
    const title = mgrRemarkTitleDraft.trim();
    const desc = mgrRemarkDraft.trim();
    const finalDesc = desc || title;
    const finalTitle = title || finalDesc;
    await onUpdateQuery(queryId, {
      managerRemarkTitle: finalTitle,
      managerRemark: finalDesc,
    });
    setEditingMgrRemarkId(null);
    setMgrRemarkTitleDraft('');
    setMgrRemarkDraft('');
  };

  const handleToggleManagerDone = async (item: Query) => {
    // Only assigned manager or admin can toggle Manager Done
    const isAssigned = item.managerId === currentUser.id;
    if (!isAssigned && currentUser.role !== 'admin') return;

    const nextManagerDone = !item.managerDone;

    // Director policy: Mandatory Solution Remark before marking Done
    const hasExistingMgrRemark = Boolean(
      (item.managerRemarkTitle && item.managerRemarkTitle.trim()) ||
        (item.managerRemark && item.managerRemark.trim())
    );
    if (nextManagerDone && !hasExistingMgrRemark) {
      setRemarkModalQuery(item);
      setMandatoryRemarkTitleDraft('');
      setMandatoryRemarkDraft('');
      setMandatoryRemarkAttachmentsDraft(item.managerAttachments ? [...item.managerAttachments] : []);
      setRemarkError('');
      return;
    }

    await onUpdateQuery(item.queryId, {
      managerDone: nextManagerDone,
      // If manager unchecks their box, also reset sender verification so sender only checks when resolved
      ...(!nextManagerDone && item.accountManagerDone
        ? { accountManagerDone: false }
        : {}),
    });
  };

  const handleConfirmRemarkAndDone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!remarkModalQuery) return;
    const trimmedTitle = mandatoryRemarkTitleDraft.trim();
    const trimmedDesc = mandatoryRemarkDraft.trim();
    if (!trimmedTitle && !trimmedDesc) {
      setRemarkError('A solution remark title and description are required before marking Done.');
      return;
    }
    const newRmk: QueryRemark = {
      id: `rmk-mgr-done-${Date.now()}`,
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorRole: currentUser.role,
      type: 'manager',
      title: trimmedTitle || undefined,
      text: trimmedDesc,
      createdAt: formatDateTime(new Date(), false),
      createdAtMs: Date.now(),
    };
    const updatedRemarks = [...(remarkModalQuery.remarks || []), newRmk];
    await onUpdateQuery(remarkModalQuery.queryId, {
      remarks: updatedRemarks,
      managerRemarkTitle: trimmedTitle || trimmedDesc,
      managerRemark: trimmedDesc,
      managerAttachments: mandatoryRemarkAttachmentsDraft,
      managerDone: true,
    });
    setRemarkModalQuery(null);
    setMandatoryRemarkTitleDraft('');
    setMandatoryRemarkDraft('');
    setMandatoryRemarkAttachmentsDraft([]);
    setRemarkError('');
  };

  const handleToggleSenderDone = async (item: Query) => {
    // Only the creator/sender or admin can toggle Sender Done
    const isSender = item.accountManagerId === currentUser.id;
    if (!isSender && currentUser.role !== 'admin') return;

    // Sender will only check the box once the query is completed by assigned manager
    if (!item.accountManagerDone && !item.managerDone) return;

    // If sender is marking Done and has not rated yet, enforce mandatory rating
    if (!item.accountManagerDone && (!item.rating || item.rating < 1)) {
      setRatingModalQuery(item);
      setRatingInput(0);
      setRatingHover(0);
      setRatingModalCompleteOnSubmit(true);
      return;
    }

    await onUpdateQuery(item.queryId, {
      accountManagerDone: !item.accountManagerDone,
    });
  };

  // Helper to get role badge for sender
  const getSenderRoleBadge = (senderId: string) => {
    const userMatch = AUTHORIZED_USERS.find((u) => u.id === senderId);
    if (!userMatch) return null;
    return userMatch.role === 'manager' ? 'Mgr' : userMatch.role === 'account_manager' ? 'AM' : 'Admin';
  };

  // Can current user add a query? (AMs, Managers, and Admins)
  const canAddQuery =
    currentUser.role === 'account_manager' ||
    currentUser.role === 'manager' ||
    currentUser.role === 'admin';

  return (
    <div className="query-page-container">
      <header className="query-page-header">
        <div className="query-header-title-group">
          <h1 className="query-page-title">Queries</h1>
          <span className="query-count-pill">
            {sortedAndFilteredQueries.length} / {roleScopedQueries.length}
          </span>
        </div>

        <div className="query-header-controls">
          {/* Manager View Scope Filter: All, Received, Sent, CC */}
          {currentUser.role === 'manager' && (
            <div className="header-filter-group">
              <label htmlFor="filter-view-scope" className="header-filter-label">
                View
              </label>
              <select
                id="filter-view-scope"
                className="header-filter-select"
                value={managerViewType}
                onChange={(e) => setManagerViewType(e.target.value as ManagerViewScope)}
                title="Filter queries: All, Received (Assigned), Sent (By Me), or CC'd"
              >
                <option value="ALL">All Queries</option>
                <option value="RECEIVED">Received (Assigned)</option>
                <option value="SENT">Sent (By Me)</option>
                <option value="CC">CC'd to Me ({ccCountForUser})</option>
              </select>
            </div>
          )}

          {/* Account Manager View Scope Filter: All, Sent, CC */}
          {currentUser.role === 'account_manager' && (
            <div className="header-filter-group">
              <label htmlFor="filter-view-scope-am" className="header-filter-label">
                View
              </label>
              <select
                id="filter-view-scope-am"
                className="header-filter-select"
                value={managerViewType}
                onChange={(e) => setManagerViewType(e.target.value as ManagerViewScope)}
                title="Filter queries: All, Sent by Me, or CC'd to Me"
              >
                <option value="ALL">All (Mine &amp; CC'd)</option>
                <option value="SENT">Sent (By Me)</option>
                <option value="CC">CC'd to Me ({ccCountForUser})</option>
              </select>
            </div>
          )}

          {/* Quick CC Pill button for instant filtering */}
          {ccCountForUser > 0 && (
            <button
              type="button"
              className={`header-cc-quick-toggle ${managerViewType === 'CC' ? 'header-cc-quick-toggle--active' : ''}`}
              onClick={() => setManagerViewType((prev) => (prev === 'CC' ? 'ALL' : 'CC'))}
              title={managerViewType === 'CC' ? 'Show all queries' : 'Quick toggle to view only queries where you are CC\'d'}
            >
              ✉️ CC'd to Me ({ccCountForUser})
            </button>
          )}

          {/* Sender Filter: shown for Managers & Admin */}
          {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
            <div className="header-filter-group">
              <label htmlFor="filter-sender" className="header-filter-label">
                From
              </label>
              <select
                id="filter-sender"
                className="header-filter-select"
                value={filterSenderId}
                onChange={(e) => setFilterSenderId(e.target.value)}
              >
                <option value="ALL">All Senders</option>
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role === 'manager' ? 'Mgr' : 'AM'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Assigned Manager Filter: shown for all roles */}
          <div className="header-filter-group">
            <label htmlFor="filter-mgr" className="header-filter-label">
              Manager
            </label>
            <select
              id="filter-mgr"
              className="header-filter-select"
              value={filterManagerId}
              onChange={(e) => setFilterManagerId(e.target.value)}
            >
              <option value="ALL">All Managers</option>
              {managers.map((mgr) => (
                <option key={mgr.id} value={mgr.id}>
                  {mgr.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="header-filter-group">
            <label htmlFor="filter-status" className="header-filter-label">
              Status
            </label>
            <select
              id="filter-status"
              className="header-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as StatusFilterValue)}
            >
              <option value="ALL">All Status</option>
              <option value="Urgent">🚨 Urgent</option>
              <option value="Pending">Pending (On Track)</option>
              <option value="ExtensionPending">Extension Requested ⏳</option>
              <option value="Unchecked">Unchecked</option>
              <option value="ManagerDone">Manager Checked</option>
              <option value="Delayed">Delayed (Overdue)</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="header-reset-btn"
              onClick={handleResetFilters}
              title="Reset Filters & Sorting"
            >
              Reset
            </button>
          )}

          {/* Add Query Button: available for Managers & Account Managers */}
          {canAddQuery && (
            <button
              type="button"
              className="header-add-btn"
              onClick={handleOpenCreateModal}
              title="Submit a new query to a manager"
            >
              + Add Query
            </button>
          )}
        </div>

        {/* Company Logo at Top Right */}
        <div className="header-company-logo-badge" title="WMD">
          <img
            src={wmdLogo}
            alt="WMD Company Logo"
            className="header-company-logo-img"
          />
        </div>
      </header>

      <section className="queries-table-card">
        <div className="queries-table-wrapper">
          <table className="queries-table">
            <thead>
              <tr>
                <th
                  className="th-sortable"
                  onClick={() =>
                    setTimestampOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                  }
                  title="Click to toggle timestamp order within each status group"
                >
                  <span>Date</span>
                  <span className="sort-indicator">
                    {timestampOrder === 'desc' ? '↓' : '↑'}
                  </span>
                </th>
                <th>ID</th>
                <th>From (Sender)</th>
                <th>Assigned Mgr</th>
                <th>Query</th>
                <th>Manager Remark</th>
                <th className="th-center">Mgr Done</th>
                <th>Sender Remark</th>
                <th className="th-center">Sender Done</th>
                <th className="th-center">Rating</th>
                <th className="th-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredQueries.map((item) => {
                const completed = isQueryDone(item);
                const delayed = isQueryDelayed(item, nowMs);
                const managerOnlyChecked = item.managerDone && !item.accountManagerDone;
                const isRowSaving = savingQueryId === item.queryId;

                const isSender = currentUser.id === item.accountManagerId;
                const isAssignedManager = currentUser.id === item.managerId;
                const isAdmin = currentUser.role === 'admin';

                const canEditQueryText = isSender;
                const canEditMgrRemark = isAssignedManager;
                const canToggleMgrDone = (isAssignedManager) && !isRowSaving;
                const canEditSenderRemark = isSender;

                const senderCannotCheckYet =
                  !item.managerDone && !item.accountManagerDone;
                const isSenderCheckboxDisabled =
                  !(isSender) ||
                  isRowSaving ||
                  senderCannotCheckYet;

                const senderRoleBadge = getSenderRoleBadge(item.accountManagerId);

                const rowStateClass = completed
                  ? 'row-completed'
                  : item.isUrgent
                  ? 'row-urgent'
                  : managerOnlyChecked
                  ? 'row-manager-done'
                  : 'row-unchecked';

                const rowLinkedApt = getLinkedAppointmentForQuery(item, appointments);
                const rowLinkedAptId =
                  rowLinkedApt?.id ||
                  (item.linkedAppointmentId &&
                  appointments.some((a) => a.id === item.linkedAppointmentId)
                    ? item.linkedAppointmentId
                    : null);

                return (
                  <tr
                    key={item.queryId}
                    className={`${rowStateClass} query-row-clickable`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.closest(
                          'button, input, textarea, select, label, .inline-edit-box'
                        )
                      ) {
                        return;
                      }
                      setViewingQuery(item);
                    }}
                    title="Click to view query details"
                  >
                    <td className="td-timestamp">{formatDateTime(item.createdAt)}</td>

                    <td className="td-query-id">
                      <div className="query-id-stack">
                        <span
                          className="query-id-badge query-id-badge--clickable"
                          onClick={() => setViewingQuery(item)}
                        >
                          {item.queryId}
                        </span>
                        {isUserCcOnQuery(item, currentUser) ? (
                          <span
                            className="query-cc-tag"
                            title="You are CC'd on this query (View-Only)"
                          >
                            CC
                          </span>
                        ) : item.ccUsers && item.ccUsers.length > 0 ? (
                          <span
                            className="query-cc-tag query-cc-tag--other"
                            title={`CC: ${item.ccUsers.map((u) => u.name).join(', ')}`}
                          >
                            CC ({item.ccUsers.length})
                          </span>
                        ) : null}
                        {item.isUrgent && (
                          <span
                            className={`query-urgent-tag ${completed ? 'query-urgent-tag--completed' : ''}`}
                            title={completed ? 'Urgent query (Completed)' : '🚨 URGENT: Immediate response required!'}
                          >
                            🚨 URGENT
                          </span>
                        )}
                      </div>
                      {rowLinkedAptId && (
                        <span
                          className="query-linked-apt-chip"
                          title={`Linked to appointment ${rowLinkedAptId}${rowLinkedApt ? `: ${rowLinkedApt.title} (${rowLinkedApt.scheduledAt})` : ''}`}
                        >
                          📅 {rowLinkedAptId}
                        </span>
                      )}
                      {item.attachments && item.attachments.length > 0 && (
                        <span
                          className="query-attachment-badge"
                          title={`${item.attachments.length} attached document(s): ${item.attachments.map((a) => a.name).join(', ')}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingQuery(item);
                          }}
                        >
                          📎 {item.attachments.length} {item.attachments.length === 1 ? 'doc' : 'docs'}
                        </span>
                      )}
                    </td>

                    {/* Sender Cell */}
                    <td className="td-person">
                      <div className="person-cell-wrapper">
                        <span>{item.accountManagerName}</span>
                        {senderRoleBadge && (
                          <span
                            className={`person-role-tag person-role-tag--${senderRoleBadge.toLowerCase()}`}
                          >
                            {senderRoleBadge}
                          </span>
                        )}
                        {isSender && (
                          <span className="person-self-tag">(You)</span>
                        )}
                      </div>
                    </td>

                    {/* Assigned Manager Cell */}
                    <td className="td-person">
                      <div className="person-cell-wrapper">
                        <span>{item.managerName}</span>
                        {isAssignedManager && (
                          <span className="person-self-tag">(You)</span>
                        )}
                      </div>
                    </td>

                    {/* Query Text */}
                    <td className="td-query-text">
                      {canEditQueryText &&
                      editingQueryTextId === item.queryId ? (
                        <div className="inline-edit-box">
                          <input
                            type="text"
                            className="inline-edit-title-input"
                            value={queryTitleDraft}
                            onChange={(e) => setQueryTitleDraft(e.target.value)}
                            placeholder="Query title..."
                          />
                          <textarea
                            rows={2}
                            value={queryTextDraft}
                            onChange={(e) => setQueryTextDraft(e.target.value)}
                            placeholder="Query description..."
                          />
                          <div className="inline-edit-actions">
                            <button
                              type="button"
                              className="btn-inline-save"
                              disabled={isRowSaving}
                              onClick={() => saveQueryText(item.queryId)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-inline-cancel"
                              onClick={() => setEditingQueryTextId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="remark-display-row">
                          <p
                            className="query-body-text query-body-text--clickable"
                            onClick={() => setViewingQuery(item)}
                          >
                            {item.queryTitle || item.queryText}
                          </p>
                          {canEditQueryText && (
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditQueryText(item)}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Manager Remark */}
                    <td className="td-remark">
                      {canEditMgrRemark ? (
                        editingMgrRemarkId === item.queryId ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              className="inline-edit-title-input"
                              value={mgrRemarkTitleDraft}
                              onChange={(e) => setMgrRemarkTitleDraft(e.target.value)}
                              placeholder="Remark title..."
                            />
                            <textarea
                              rows={2}
                              value={mgrRemarkDraft}
                              onChange={(e) => setMgrRemarkDraft(e.target.value)}
                              placeholder="Remark description..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveMgrRemark(item.queryId)}
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
                                item.managerRemarkTitle || item.managerRemark
                                  ? 'remark-value query-body-text--clickable'
                                  : 'remark-placeholder'
                              }
                              onClick={() => setViewingQuery(item)}
                            >
                              {item.managerRemarkTitle || item.managerRemark || '—'}
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
                            item.managerRemarkTitle || item.managerRemark
                              ? 'remark-value query-body-text--clickable'
                              : 'remark-placeholder'
                          }
                          onClick={() => setViewingQuery(item)}
                        >
                          {item.managerRemarkTitle || item.managerRemark || '—'}
                        </span>
                      )}
                    </td>

                    {/* Manager Done Checkbox */}
                    <td className="td-check-cell">
                      <label
                        className={`check-button-label ${
                          item.managerDone ? 'check-button-label--checked' : ''
                        } ${
                          !canToggleMgrDone ? 'check-button-label--readonly' : ''
                        }`}
                        title={
                          !isAssignedManager
                            ? `Only assigned manager (${item.managerName}) can mark Manager Done`
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={item.managerDone}
                          disabled={!canToggleMgrDone}
                          onChange={() => handleToggleManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    {/* Sender Remark (accountManagerRemark) */}
                    <td className="td-remark">
                      {canEditSenderRemark ? (
                        editingSenderRemarkId === item.queryId ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              className="inline-edit-title-input"
                              value={senderRemarkTitleDraft}
                              onChange={(e) => setSenderRemarkTitleDraft(e.target.value)}
                              placeholder="Remark title..."
                            />
                            <textarea
                              rows={2}
                              value={senderRemarkDraft}
                              onChange={(e) => setSenderRemarkDraft(e.target.value)}
                              placeholder="Remark description..."
                            />
                            <div className="inline-edit-actions">
                              <button
                                type="button"
                                className="btn-inline-save"
                                disabled={isRowSaving}
                                onClick={() => saveSenderRemark(item.queryId)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn-inline-cancel"
                                onClick={() => setEditingSenderRemarkId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="remark-display-row">
                            <span
                              className={
                                item.accountManagerRemarkTitle || item.accountManagerRemark
                                  ? 'remark-value query-body-text--clickable'
                                  : 'remark-placeholder'
                              }
                              onClick={() => setViewingQuery(item)}
                            >
                              {item.accountManagerRemarkTitle ||
                                item.accountManagerRemark ||
                                '—'}
                            </span>
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => startEditSenderRemark(item)}
                            >
                              Edit
                            </button>
                          </div>
                        )
                      ) : (
                        <span
                          className={
                            item.accountManagerRemarkTitle || item.accountManagerRemark
                              ? 'remark-value query-body-text--clickable'
                              : 'remark-placeholder'
                          }
                          onClick={() => setViewingQuery(item)}
                        >
                          {item.accountManagerRemarkTitle ||
                            item.accountManagerRemark ||
                            '—'}
                        </span>
                      )}
                    </td>

                    {/* Sender Done Checkbox (accountManagerDone) */}
                    <td className="td-check-cell">
                      <div className="check-cell-flex-wrap">
                        <label
                          className={`check-button-label ${
                            item.accountManagerDone ? 'check-button-label--checked' : ''
                          } ${
                            isSenderCheckboxDisabled ? 'check-button-label--readonly' : ''
                          }`}
                          title={
                            !(isSender)
                              ? `Only sender (${item.accountManagerName}) can mark verified completion`
                              : senderCannotCheckYet
                              ? 'Assigned Manager must mark Done before you can verify & complete'
                              : undefined
                          }
                        >
                          <input
                            type="checkbox"
                            checked={item.accountManagerDone}
                            disabled={isSenderCheckboxDisabled}
                            onChange={() => handleToggleSenderDone(item)}
                          />
                          <span>Done</span>
                        </label>
                      </div>
                    </td>

                    {/* Rating Cell */}
                    <td className="td-rating th-center">
                      {isAdmin ? (() => {
                        const recBreakdown = calculateReceiverOverallRating(item);
                        const sndBreakdown = calculateSenderOverallRating(item);
                        return (
                          <div className="admin-rating-badge-pair">
                            <button
                              type="button"
                              className="rating-badge--composite"
                              onClick={() => {
                                setAdminRatingQuery(item);
                                setAdminRatingTargetRole('receiver');
                                setAdminRatingInput(item.adminReceiverRating ?? 10);
                                setAdminRemarkInput(item.adminReceiverRemark || 'Proper turnaround and response');
                                setAdminRemarkError('');
                              }}
                              title={`Receiver Rating: ${recBreakdown.overallRating}/10 stars\nAdmin (50%): ${recBreakdown.adminRating}★\nSystem (30%): ${recBreakdown.systemRating}★ (${recBreakdown.systemReason})\nSender (20%): ${recBreakdown.senderRating ?? 10}★\nClick to edit Admin Rating & Remark`}
                            >
                              <span style={{ color: '#0369a1', fontWeight: 800 }}>Rec:</span>
                              <span>⭐ {recBreakdown.overallRating}/10</span>
                            </button>
                            <button
                              type="button"
                              className="rating-badge--composite"
                              onClick={() => {
                                setAdminRatingQuery(item);
                                setAdminRatingTargetRole('sender');
                                setAdminRatingInput(item.adminSenderRating ?? 10);
                                setAdminRemarkInput(item.adminSenderRemark || 'Prompt responses to queries and requests');
                                setAdminRemarkError('');
                              }}
                              title={`Sender Rating: ${sndBreakdown.overallRating}/10 stars\nAdmin (50%): ${sndBreakdown.adminRating}★\nSystem (30%): ${sndBreakdown.systemRating}★ (${sndBreakdown.systemReason})\nReceiver (20%): ${sndBreakdown.receiverRating ?? 10}★\nClick to edit Admin Rating & Remark`}
                            >
                              <span style={{ color: '#92400e', fontWeight: 800 }}>Snd:</span>
                              <span>⭐ {sndBreakdown.overallRating}/10</span>
                            </button>
                          </div>
                        );
                      })() : isSender ? (
                        item.senderReceiverRating || item.rating ? (
                          <div className="rating-cell-sender-wrap">
                            <button
                              type="button"
                              className="rating-badge rating-badge--sender"
                              onClick={() => {
                                const currentRating =
                                  item.senderReceiverRating ||
                                  (item.rating ? (item.rating <= 5 ? item.rating * 2 : item.rating) : 10);
                                setRatingModalQuery(item);
                                setRatingInput(currentRating);
                                setRatingHover(0);
                                setRatingRemarkInput(item.senderReceiverRemark || '');
                                setRatingRemarkError('');
                                setRatingModalCompleteOnSubmit(false);
                              }}
                              title="Click to view/update your rating and remark for the receiving manager"
                            >
                              <span className="rating-stars-gold">⭐</span>
                              <span className="rating-score-num">
                                {item.senderReceiverRating ||
                                  (item.rating ? (item.rating <= 5 ? item.rating * 2 : item.rating) : 10)}
                                /10
                              </span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-rate-prompt"
                            onClick={() => {
                              setRatingModalQuery(item);
                              setRatingInput(10);
                              setRatingHover(0);
                              setRatingRemarkInput('');
                              setRatingRemarkError('');
                              setRatingModalCompleteOnSubmit(false);
                            }}
                            title="Click to rate the receiving manager (10-star scale with mandatory remark)"
                          >
                            ★ Rate Manager
                          </button>
                        )
                      ) : isAssignedManager ? (() => {
                        const recBreakdown = calculateReceiverOverallRating(item);
                        const isPostCutoff = Boolean(
                          (item.createdAtMs && item.createdAtMs > RECEIVER_RATING_FEATURE_START_MS) ||
                          (item.receiverSenderRating !== undefined && item.receiverSenderRating !== null)
                        );
                        return (
                          <div className="rating-cell-receiver-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                            {/* Receiver can see their own overall score */}
                            <span
                              className="rating-badge rating-badge--receiver-score"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                padding: '0.2rem 0.5rem',
                                borderRadius: '6px',
                                background: '#f0f9ff',
                                border: '1px solid #bae6fd',
                                fontSize: '0.78rem',
                                color: '#0369a1',
                                fontWeight: 700,
                              }}
                              title={`Your Rating as Receiver: ${recBreakdown.overallRating}/10 stars\nAdmin (50%): ${recBreakdown.adminRating}★\nSystem (30%): ${recBreakdown.systemRating}★ (${recBreakdown.systemReason})\nSender (20%): ${recBreakdown.senderRating ?? 10}★`}
                            >
                              <span>⭐ {recBreakdown.overallRating}/10</span>
                            </span>

                            {/* If query made after this cutoff, receiver rating for sender is shown */}
                            {isPostCutoff && (
                              item.receiverSenderRating ? (
                                <button
                                  type="button"
                                  className="rating-badge rating-badge--receiver"
                                  style={{
                                    fontSize: '0.74rem',
                                    padding: '0.15rem 0.45rem',
                                    background: '#fef3c7',
                                    color: '#92400e',
                                    border: '1px solid #fde68a',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                  }}
                                  onClick={() => {
                                    setReceiverRatingModalQuery(item);
                                    setReceiverRatingInput(item.receiverSenderRating || 10);
                                    setReceiverRatingHover(0);
                                    setReceiverRatingRemarkInput(item.receiverSenderRemark || '');
                                    setReceiverRatingRemarkError('');
                                  }}
                                  title={`Click to view/update rating for Sender (${item.accountManagerName}): ${item.receiverSenderRating}/10\nRemark: ${item.receiverSenderRemark || 'None'}`}
                                >
                                  ⭐ {item.receiverSenderRating}/10 (to Sender)
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-rate-prompt"
                                  style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem' }}
                                  onClick={() => {
                                    setReceiverRatingModalQuery(item);
                                    setReceiverRatingInput(10);
                                    setReceiverRatingHover(0);
                                    setReceiverRatingRemarkInput('');
                                    setReceiverRatingRemarkError('');
                                  }}
                                  title="Click to rate the sender (10-star scale with mandatory remark)"
                                >
                                  ★ Rate Sender
                                </button>
                              )
                            )}
                          </div>
                        );
                      })() : (
                        /* Senders or other users cannot see receiver ratings for senders */
                        <span className="rating-placeholder">—</span>
                      )}
                    </td>

                    {/* Status Cell */}
                    <td className="td-status-cell">
                      <div className="td-status-pills-wrap">
                        {completed ? (
                          <>
                            <span className="table-status-pill table-status-pill--completed">
                              Completed
                            </span>
                            {item.autoCompletedAt && (
                              <span className="table-status-pill table-status-pill--auto" title={`Auto-completed after 12h grace period on ${item.autoCompletedAt}`}>
                                ⚡ Auto
                              </span>
                            )}
                            {item.adminCompletedAt && (
                              <span className="table-status-pill table-status-pill--admin" title={`Admin force completed on ${item.adminCompletedAt}`}>
                                🛡️ Admin
                              </span>
                            )}
                            {item.isUrgent && (
                              <span
                                className="table-status-pill table-status-pill--urgent-tag"
                                title={delayed ? 'Urgent query completed late (No remark within 1 hour)' : 'Urgent query completed on-time'}
                              >
                                Urgent
                              </span>
                            )}
                            {delayed && (
                              <span
                                className="table-status-pill table-status-pill--delayed"
                                title={item.isUrgent ? 'Urgent query: Receiving manager did not put a remark within 1 hour - counted as Delayed' : undefined}
                              >
                                Delayed
                              </span>
                            )}
                          </>
                        ) : item.isUrgent ? (
                          managerOnlyChecked ? (
                            <>
                              <span className="table-status-pill table-status-pill--urgent-mgr" title="Urgent query checked by manager; awaiting sender verification">
                                🚨 Urgent - Mgr Checked
                              </span>
                              {delayed && (
                                <span className="table-status-pill table-status-pill--delayed" title="Receiving manager did not provide remark within 1 hour">
                                  Delayed
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="table-status-pill table-status-pill--urgent" title="Urgent query: Immediate priority, notifying every 10m until done">
                                🚨 URGENT (Due Now)
                              </span>
                              {(() => {
                                const isOverdue = isUrgentManagerRemarkOverdue(item, nowMs);
                                const hasRemark = hasManagerRemark(item);
                                if (isOverdue || delayed) {
                                  return (
                                    <>
                                      <span
                                        className="table-status-pill table-status-pill--remark-overdue"
                                        title="Receiving manager has not provided a remark within 1 hour!"
                                      >
                                        ⚠️ Remark Overdue (&gt;1h)
                                      </span>
                                      <span className="table-status-pill table-status-pill--delayed" title="Overdue on 1-hour remark SLA">
                                        Delayed
                                      </span>
                                    </>
                                  );
                                }
                                if (hasRemark) {
                                  return (
                                    <span
                                      className="table-status-pill table-status-pill--remark-done"
                                      title="Receiving manager provided remark within 1 hour (On-time track)"
                                    >
                                      ✅ Remark Added
                                    </span>
                                  );
                                }
                                const createdMs = getQueryTimestampMs(item);
                                const minsLeft = Math.max(1, Math.ceil((60 * 60 * 1000 - (nowMs - createdMs)) / 60000));
                                return (
                                  <span
                                    className="table-status-pill table-status-pill--remark-due"
                                    title={`Receiving manager must put in a remark within 1 hour (${minsLeft}m left)`}
                                  >
                                    ⏱️ Remark Due ({minsLeft}m)
                                  </span>
                                );
                              })()}
                            </>
                          )
                        ) : managerOnlyChecked ? (
                          <>
                            <span className="table-status-pill table-status-pill--mgr-done">
                              Mgr Checked
                            </span>
                            {delayed && (
                              <span className="table-status-pill table-status-pill--delayed">
                                Delayed
                              </span>
                            )}
                          </>
                        ) : delayed ? (
                          <span className="table-status-pill table-status-pill--delayed">
                            Delayed
                          </span>
                        ) : (
                          <span className="table-status-pill table-status-pill--pending">
                            Pending
                          </span>
                        )}

                        {item.extensionStatus === 'PENDING' && (
                          <span
                            className="table-status-pill table-status-pill--ext-pending"
                            title={`Extension requested until ${formatDateTime(item.extensionProposedDueAt) || 'new date'}: "${item.extensionReason || ''}"`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isSender || isAdmin) {
                                setExtensionReviewModalQuery(item);
                              } else {
                                setViewingQuery(item);
                              }
                            }}
                          >
                            ⏳ Ext Req
                          </span>
                        )}
                        {item.extensionStatus === 'APPROVED' && (
                          <span
                            className="table-status-pill table-status-pill--ext-approved"
                            title={`Completion deadline extended to ${formatDateTime(item.targetDueAt) || ''}`}
                          >
                            Extended
                          </span>
                        )}
                      </div>

                      {/* Quick contextual extension actions */}
                      {item.extensionStatus === 'PENDING' && (isSender || isAdmin || currentUser.role === 'account_manager') ? (
                        <button
                          type="button"
                          className="table-action-pill-btn table-action-pill-btn--review"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExtensionReviewModalQuery(item);
                          }}
                          title="Click to review and approve/decline this extension request"
                        >
                          Review Ext ⏳
                        </button>
                      ) : !completed &&
                        item.extensionStatus !== 'PENDING' &&
                        (isAssignedManager || isAdmin) ? (
                        <button
                          type="button"
                          className="table-action-link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openExtensionModal(item);
                          }}
                          title="Request completion date extension"
                        >
                          + Extend
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}

              {sortedAndFilteredQueries.length === 0 && (
                <tr>
                  <td colSpan={11} className="empty-queries-cell">
                    No queries match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* New Query Modal - available to Managers and Account Managers */}
      {showCreateModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="modal-dialog query-modal-unified"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <div className="query-view-title-row">
                  <h3 id="create-query-modal-title">📝 New Query</h3>
                  <span className="person-role-tag person-role-tag--sender">
                    From: {currentUser.name}
                  </span>
                </div>
                <span className="modal-sender-badge">
                  Logged in as <strong>{currentUser.name}</strong> ({currentUser.roleLabel}) &bull; Target completion: 24 hours
                </span>
              </div>
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
              <div className="query-modal-top-grid">
                <div className="cp-form-group">
                  <label htmlFor="select-manager">Send Query To (Manager) *</label>
                  <select
                    id="select-manager"
                    value={selectedManagerId}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                    required
                  >
                    {targetManagersForCreation.map((mgr) => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.name} ({mgr.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="cp-form-group">
                  <label htmlFor="select-appointment-link">Link Appointment (Optional)</label>
                  <select
                    id="select-appointment-link"
                    value={selectedAppointmentId}
                    onChange={(e) => setSelectedAppointmentId(e.target.value)}
                  >
                    <option value="">-- No linked appointment --</option>
                    {linkableAppointmentsForCreation.map((apt) => (
                      <option key={apt.id} value={apt.id}>
                        [{apt.id}] {apt.title} ({apt.scheduledAt})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* CC Selection Field (Optional) */}
              <div className="cp-form-group cc-form-group">
                <div className="cc-selection-label">
                  <span>👥 CC Other Team Members (Optional)</span>
                  <span className="cc-selection-subtext">
                    View-only awareness &bull; they receive notifications
                  </span>
                </div>

                {selectedCcUserIds.length > 0 && (
                  <div className="cc-chips-container">
                    {selectedCcUserIds.map((userId) => {
                      const u = AUTHORIZED_USERS.find((usr) => usr.id === userId);
                      if (!u) return null;
                      return (
                        <span key={userId} className="cc-chip">
                          <span className="cc-chip-name">{u.name}</span>
                          <span className="cc-chip-role">
                            ({u.role === 'manager' ? 'Mgr' : u.role === 'account_manager' ? 'AM' : 'Admin'})
                          </span>
                          <button
                            type="button"
                            className="cc-chip-remove"
                            onClick={() =>
                              setSelectedCcUserIds((prev) => prev.filter((id) => id !== userId))
                            }
                            aria-label={`Remove CC ${u.name}`}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                <select
                  className="cc-user-select"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !selectedCcUserIds.includes(id)) {
                      setSelectedCcUserIds((prev) => [...prev, id]);
                    }
                  }}
                  aria-label="Add user to CC"
                >
                  <option value="">+ Select team member to CC...</option>
                  {eligibleCcUsersForCreation
                    .filter((u) => !selectedCcUserIds.includes(u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role === 'manager' ? 'Manager' : u.role === 'account_manager' ? 'Account Manager' : 'Admin'}) &bull; {u.email}
                      </option>
                    ))}
                </select>
              </div>

              <div className="cp-form-group">
                <label htmlFor="query-title-input">Query Title *</label>
                <input
                  id="query-title-input"
                  type="text"
                  placeholder="Enter a clear title for this query..."
                  value={queryTitleInput}
                  onChange={(e) => setQueryTitleInput(e.target.value)}
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="write-query">Query Description *</label>
                <textarea
                  id="write-query"
                  rows={4}
                  placeholder="Describe the issue, clarification, or request in detail..."
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  required
                />
              </div>

              {/* Attachments Section in Create Query Modal */}
              <div className="cp-form-group attachment-form-group">
                <div className="attachment-header-row">
                  <label htmlFor="query-attachments-input" className="attachment-label">
                    <span>📎 Attach Documents</span>
                    <span className="attachment-subtext">
                      (Optional &bull; Max {MAX_FILE_SIZE_LABEL}/file, up to {MAX_FILES_PER_UPLOAD} files, {MAX_TOTAL_ATTACHMENTS_LABEL} total)
                    </span>
                  </label>
                  {attachedFiles.length > 0 && (
                    <span className="attachment-count-badge">
                      {attachedFiles.length}/{MAX_FILES_PER_UPLOAD} {attachedFiles.length === 1 ? 'file' : 'files'} attached
                    </span>
                  )}
                </div>

                <div
                  className={`attachment-dropzone ${isDraggingOver ? 'attachment-dropzone--active' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(false);
                  }}
                  onDrop={handleDropFiles}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  aria-label="Click or drag files here to attach documents"
                >
                  <input
                    ref={fileInputRef}
                    id="query-attachments-input"
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleFileInputChange}
                  />
                  <div className="attachment-dropzone-inner">
                    <span className="attachment-dropzone-icon">📎</span>
                    <div className="attachment-dropzone-prompts">
                      <span className="attachment-dropzone-cta">
                        {isReadingFiles
                          ? 'Reading & optimizing document(s)...'
                          : attachedFiles.length >= MAX_FILES_PER_UPLOAD
                          ? `Maximum ${MAX_FILES_PER_UPLOAD} files reached (remove a file to add another)`
                          : `Choose files or drag & drop here (Max ${MAX_FILE_SIZE_LABEL} per file)`}
                      </span>
                    </div>
                  </div>
                </div>

                {attachedFiles.length > 0 && (
                  <div className="attached-files-list">
                    {attachedFiles.map((att) => (
                      <div key={att.id} className="attached-file-pill">
                        <span className="attached-file-icon">
                          {getFileIcon(att.name, att.type)}
                        </span>
                        <div className="attached-file-info">
                          <span className="attached-file-name" title={att.name}>
                            {att.name}
                          </span>
                          <span className="attached-file-size">
                            {formatFileSize(att.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="attached-file-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveAttachedFile(att.id);
                          }}
                          aria-label={`Remove attachment ${att.name}`}
                          title="Remove file"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isUrgentDraft && (
                <div className="urgent-mode-notice">
                  <span className="urgent-mode-notice-icon">🚨</span>
                  <span>
                    <strong>URGENT Query Mode Active:</strong> Immediate priority! Manager must provide a remark within 1 hour. Sender, receiver, and admins will be notified every 10 minutes until finalized. The receiving manager&apos;s KPI drops 50% until completed.
                  </span>
                </div>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowCreateModal(false);
                    setIsUrgentDraft(false);
                    setAttachedFiles([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`btn-urgent-action ${isUrgentDraft ? 'btn-urgent-action--active' : ''}`}
                  onClick={handleUrgentButtonClick}
                  title="Mark and submit query as URGENT (Immediate priority, no 24h delay threshold)"
                  disabled={isSubmittingNew}
                >
                  🚨 URGENT
                </button>
                <button
                  type="submit"
                  className={`btn-primary ${isUrgentDraft ? 'btn-primary--urgent' : ''}`}
                  disabled={isSubmittingNew || isReadingFiles}
                >
                  {isSubmittingNew
                    ? 'Submitting...'
                    : isUrgentDraft
                    ? 'Submit Urgent Query'
                    : 'Submit Query'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mandatory Solution Remark Modal (Director Policy) */}
      {remarkModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setRemarkModalQuery(null)}
        >
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mandatory-remark-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="mandatory-remark-modal-title">Solution Remark Required</h3>
                <span className="modal-sender-badge">
                  Query: <strong>{remarkModalQuery.queryId}</strong> &bull; Assigned to: <strong>{remarkModalQuery.managerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRemarkModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="modal-form" onSubmit={handleConfirmRemarkAndDone}>
              {/* <div
                style={{
                  background: 'rgba(214, 116, 43, 0.08)',
                  border: '1px solid rgba(214, 116, 43, 0.3)',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  fontSize: '0.86rem',
                  color: 'var(--c-russet, #844918)',
                  lineHeight: '1.45',
                }}
              >
                <strong>Director Policy:</strong> Managers cannot mark queries as Done without explaining the resolution or actions taken.
              </div> */}

              <div className="cp-form-group">
                <label htmlFor="mandatory-remark-title-input">Remark Title *</label>
                <input
                  id="mandatory-remark-title-input"
                  type="text"
                  placeholder="Enter a short title for the solution remark..."
                  value={mandatoryRemarkTitleDraft}
                  onChange={(e) => {
                    setMandatoryRemarkTitleDraft(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
                  autoFocus
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="mandatory-remark-input">Solution / Resolution Description *</label>
                <textarea
                  id="mandatory-remark-input"
                  rows={4}
                  placeholder="Explain what steps were taken to fix this issue or reference ticket details..."
                  value={mandatoryRemarkDraft}
                  onChange={(e) => {
                    setMandatoryRemarkDraft(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
                  required
                />
                {remarkError && (
                  <span style={{ color: '#dc2626', fontSize: '0.82rem', fontWeight: 600 }}>
                    {remarkError}
                  </span>
                )}
              </div>

              <div className="cp-form-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <label htmlFor="mandatory-remark-file-btn" style={{ margin: 0 }}>
                    Resolution Document(s) (Optional &bull; Max {MAX_FILE_SIZE_LABEL}/file, up to {MAX_FILES_PER_UPLOAD} files)
                  </label>
                  <input
                    ref={mandatoryFileInputRef}
                    id="mandatory-remark-file-btn"
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length === 0) return;
                      setIsReadingMandatoryFiles(true);
                      try {
                        const { added, errors } = await validateAndReadAttachments(
                          files,
                          mandatoryRemarkAttachmentsDraft,
                          {
                            uploadedBy: currentUser.name,
                            uploaderRole: 'manager',
                          }
                        );
                        if (errors.length > 0) {
                          alert(errors.join('\n\n'));
                        }
                        if (added.length > 0) {
                          setMandatoryRemarkAttachmentsDraft((prev) => [...prev, ...added]);
                        }
                      } finally {
                        setIsReadingMandatoryFiles(false);
                        if (mandatoryFileInputRef.current) mandatoryFileInputRef.current.value = '';
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn-inline-edit"
                    onClick={() => mandatoryFileInputRef.current?.click()}
                    disabled={isReadingMandatoryFiles || mandatoryRemarkAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD}
                  >
                    {isReadingMandatoryFiles
                      ? 'Reading...'
                      : mandatoryRemarkAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD
                      ? `Max ${MAX_FILES_PER_UPLOAD} Files`
                      : '📎 Attach Document'}
                  </button>
                </div>

                {mandatoryRemarkAttachmentsDraft.length > 0 && (
                  <div className="attached-files-list">
                    {mandatoryRemarkAttachmentsDraft.map((att) => (
                      <div key={att.id} className="attached-file-pill">
                        <span className="attached-file-icon">
                          {getFileIcon(att.name, att.type)}
                        </span>
                        <div className="attached-file-info">
                          <span className="attached-file-name" title={att.name}>
                            {att.name}
                          </span>
                          <span className="attached-file-size">
                            {formatFileSize(att.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="attached-file-remove-btn"
                          onClick={() => {
                            setMandatoryRemarkAttachmentsDraft((prev) =>
                              prev.filter((a) => a.id !== att.id)
                            );
                          }}
                          aria-label={`Remove attachment ${att.name}`}
                          title="Remove file"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRemarkModalQuery(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Remark &amp; Mark Done
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Query Details Pop-up Modal (for all users) */}
      {activeViewingQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setViewingQuery(null)}
        >
          <div
            className="modal-dialog query-view-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <div className="query-view-title-row">
                  <h3 id="view-query-modal-title">
                    Query {activeViewingQuery.queryId}
                  </h3>
                  <div className="td-status-pills-wrap">
                    {isQueryDone(activeViewingQuery) ? (
                      <>
                        <span className="table-status-pill table-status-pill--completed">
                          Completed
                        </span>
                        {activeViewingQuery.isUrgent && (
                          <span className="table-status-pill table-status-pill--urgent-tag" title="Urgent Query (Resolved)">
                            Urgent
                          </span>
                        )}
                        {isQueryDelayed(activeViewingQuery, nowMs) && (
                          <span className="table-status-pill table-status-pill--delayed">
                            Delayed
                          </span>
                        )}
                      </>
                    ) : activeViewingQuery.isUrgent ? (
                      activeViewingQuery.managerDone && !activeViewingQuery.accountManagerDone ? (
                        <span className="table-status-pill table-status-pill--urgent-mgr">
                          🚨 Urgent - Mgr Checked
                        </span>
                      ) : (
                        <>
                          <span className="table-status-pill table-status-pill--urgent">
                            🚨 URGENT (Due Now)
                          </span>
                          {isUrgentManagerRemarkOverdue(activeViewingQuery, nowMs) ? (
                            <span className="table-status-pill table-status-pill--remark-overdue" title="Receiving manager has not provided a remark within 1 hour!">
                              ⚠️ Remark Overdue (&gt;1h)
                            </span>
                          ) : !hasManagerRemark(activeViewingQuery) ? (
                            <span className="table-status-pill table-status-pill--remark-due" title="Receiving manager must put in a remark within 1 hour">
                              ⏱️ Remark Due (&lt;1h)
                            </span>
                          ) : null}
                        </>
                      )
                    ) : activeViewingQuery.managerDone &&
                      !activeViewingQuery.accountManagerDone ? (
                      <>
                        <span className="table-status-pill table-status-pill--mgr-done">
                          Mgr Checked
                        </span>
                        {isQueryDelayed(activeViewingQuery, nowMs) && (
                          <span className="table-status-pill table-status-pill--delayed">
                            Delayed
                          </span>
                        )}
                      </>
                    ) : isQueryDelayed(activeViewingQuery, nowMs) ? (
                      <span className="table-status-pill table-status-pill--delayed">
                        Delayed
                      </span>
                    ) : (
                      <span className="table-status-pill table-status-pill--pending">
                        Pending
                      </span>
                    )}

                    {activeViewingQuery.extensionStatus === 'PENDING' && (
                      <span className="table-status-pill table-status-pill--ext-pending">
                        ⏳ Ext Req
                      </span>
                    )}
                    {activeViewingQuery.extensionStatus === 'APPROVED' && (
                      <span className="table-status-pill table-status-pill--ext-approved">
                        Extended
                      </span>
                    )}
                  </div>
                </div>
                <span className="modal-sender-badge">
                  Created: <strong>{formatDateTime(activeViewingQuery.createdAt)}</strong>
                  {activeViewingQuery.completedAt && (
                    <>
                      {' '}
                      &bull; Completed:{' '}
                      <strong>{formatDateTime(activeViewingQuery.completedAt)}</strong>
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setViewingQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="query-view-body">
              {/* CC View-Only Awareness Banner */}
              {(() => {
                const isSender = currentUser.id === activeViewingQuery.accountManagerId;
                const isAssignedMgr = currentUser.id === activeViewingQuery.managerId;
                const isCc = isUserCcOnQuery(activeViewingQuery, currentUser);
                const isCcOnly = isCc && !isSender && !isAssignedMgr && currentUser.role !== 'admin';

                if (!isCcOnly) return null;
                return (
                  <div className="query-view-cc-banner">
                    <span className="query-view-cc-banner-icon">ℹ️</span>
                    <div className="query-view-cc-banner-text">
                      <strong>You are CC'd on this query (View-Only Awareness).</strong>
                      <span> You can track resolution progress, view remarks, and access attachments. Remarks and status actions are managed by the assigned manager and sender.</span>
                    </div>
                  </div>
                );
              })()}

              {/* Awaiting Sender Verification Banner */}
              {activeViewingQuery.managerDone && !activeViewingQuery.accountManagerDone && activeViewingQuery.managerDoneAtMs && (
                <div className="query-view-grace-banner">
                  <div className="grace-banner-left">
                    <span className="grace-banner-icon">🛡️</span>
                    <div>
                      <div className="grace-banner-title">
                        Resolved by Manager &mdash; Awaiting Sender Verification
                      </div>
                      <div className="grace-banner-desc">
                        Manager marked this query as resolved on <strong>{formatDateTime(activeViewingQuery.managerDoneAt, false)}</strong>.
                        {isSenderDelayed(activeViewingQuery, nowMs) ? (
                          <>
                            <br />
                            <span style={{ color: '#b91c1c', fontWeight: 700 }}>
                              ⚠️ 24-hour due deadline has passed while waiting for Sender verification.
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Completion Note Audit Banner */}
              {activeViewingQuery.completionNote && (
                <div className="query-view-completion-note-card">
                  <span className="completion-note-icon">ℹ️</span>
                  <span>{activeViewingQuery.completionNote}</span>
                </div>
              )}

              <div className="query-view-meta-grid">
                <div className="query-view-meta-box">
                  <span className="query-view-meta-label">From (Sender)</span>
                  <div className="person-cell-wrapper">
                    <span className="query-view-meta-value">
                      {activeViewingQuery.accountManagerName}
                    </span>
                    {getSenderRoleBadge(activeViewingQuery.accountManagerId) && (
                      <span
                        className={`person-role-tag person-role-tag--${getSenderRoleBadge(
                          activeViewingQuery.accountManagerId
                        )!.toLowerCase()}`}
                      >
                        {getSenderRoleBadge(activeViewingQuery.accountManagerId)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="query-view-meta-box">
                  <span className="query-view-meta-label">Assigned Manager</span>
                  <div className="person-cell-wrapper">
                    <span className="query-view-meta-value">
                      {activeViewingQuery.managerName}
                    </span>
                  </div>
                </div>

                <div className="query-view-meta-box query-view-meta-box--cc" style={{ gridColumn: 'span 2' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span className="query-view-meta-label">👥 CC'd Members (View-Only)</span>
                    {(currentUser.id === activeViewingQuery.accountManagerId || currentUser.role === 'admin') && !isEditingModalCc && (
                      <button
                        type="button"
                        className="btn-meta-edit-cc"
                        onClick={() => {
                          setModalCcDraftIds((activeViewingQuery.ccUsers || []).map((u) => u.id));
                          setIsEditingModalCc(true);
                        }}
                        title="Add or remove team members CC'd on this query"
                      >
                        {activeViewingQuery.ccUsers && activeViewingQuery.ccUsers.length > 0 ? '✏️ Edit CC' : '+ Add CC'}
                      </button>
                    )}
                  </div>

                  {isEditingModalCc ? (
                    <div className="modal-cc-editor">
                      {modalCcDraftIds.length > 0 && (
                        <div className="cc-chips-container" style={{ marginBottom: '0.45rem' }}>
                          {modalCcDraftIds.map((userId) => {
                            const u = AUTHORIZED_USERS.find((usr) => usr.id === userId);
                            if (!u) return null;
                            return (
                              <span key={userId} className="cc-chip">
                                <span className="cc-chip-name">{u.name}</span>
                                <span className="cc-chip-role">
                                  ({u.role === 'manager' ? 'Mgr' : u.role === 'account_manager' ? 'AM' : 'Admin'})
                                </span>
                                <button
                                  type="button"
                                  className="cc-chip-remove"
                                  onClick={() =>
                                    setModalCcDraftIds((prev) => prev.filter((id) => id !== userId))
                                  }
                                  title="Remove"
                                >
                                  ✕
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <select
                        className="cc-user-select"
                        value=""
                        onChange={(e) => {
                          const id = e.target.value;
                          if (id && !modalCcDraftIds.includes(id)) {
                            setModalCcDraftIds((prev) => [...prev, id]);
                          }
                        }}
                        aria-label="Add user to CC"
                      >
                        <option value="">+ Add team member to CC...</option>
                        {AUTHORIZED_USERS
                          .filter(
                            (u) =>
                              u.id !== activeViewingQuery.accountManagerId &&
                              u.id !== activeViewingQuery.managerId &&
                              !modalCcDraftIds.includes(u.id)
                          )
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.role === 'manager' ? 'Manager' : u.role === 'account_manager' ? 'Account Manager' : 'Admin'}) &bull; {u.email}
                            </option>
                          ))}
                      </select>
                      <div className="modal-cc-editor-actions" style={{ marginTop: '0.5rem', display: 'flex', gap: '0.45rem' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                          onClick={() => setIsEditingModalCc(false)}
                          disabled={isSavingModalCc}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
                          onClick={handleSaveModalCc}
                          disabled={isSavingModalCc}
                        >
                          {isSavingModalCc ? 'Saving...' : '💾 Save CC'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="query-view-cc-list">
                      {activeViewingQuery.ccUsers && activeViewingQuery.ccUsers.length > 0 ? (
                        <div className="cc-view-pills">
                          {activeViewingQuery.ccUsers.map((u) => (
                            <span key={u.id} className="cc-view-pill" title={`${u.name} (${u.email})`}>
                              👤 {u.name}
                              <span className="cc-view-pill-role">
                                {u.role === 'manager' ? 'Mgr' : u.role === 'account_manager' ? 'AM' : 'Admin'}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="query-view-meta-empty">No one CC'd on this query.</span>
                      )}
                    </div>
                  )}

                  {modalCcSaveSuccess && (
                    <div className="query-view-save-toast" style={{ marginTop: '0.4rem' }}>
                      ✅ CC list updated and alerts sent!
                    </div>
                  )}
                </div>
              </div>

              {(() => {
                const isSenderOrAdmin =
                  currentUser.id === activeViewingQuery.accountManagerId ||
                  currentUser.role === 'admin';

                return (
                  <>
                    {/* Query Details Section */}
                    <div className="query-view-section">
                      <div className="query-view-section-header">
                        <span className="query-view-section-label">Query Details</span>
                        {isSenderOrAdmin && (
                          <button
                            type="button"
                            className={`btn-query-edit-action ${isEditingDescription ? 'btn-query-edit-action--active' : ''}`}
                            onClick={() => {
                              setIsEditingDescription((prev) => !prev);
                              if (!isEditingDescription) {
                                setHasUnsavedDetailChanges(true);
                              }
                            }}
                            title={isEditingDescription ? 'Close description editor' : 'Edit query title and description'}
                          >
                            {isEditingDescription ? '✓ Done Editing' : '✏️ Edit Description'}
                          </button>
                        )}
                      </div>
                      <div className="query-view-content-box">
                        {isEditingDescription ? (
                          <div className="query-view-edit-block">
                            <label htmlFor="detail-title-input" className="query-view-sub-label">
                              Query Title
                            </label>
                            <input
                              id="detail-title-input"
                              type="text"
                              className="inline-edit-title-input"
                              value={detailTitleDraft}
                              onChange={(e) => {
                                setDetailTitleDraft(e.target.value);
                                setHasUnsavedDetailChanges(true);
                              }}
                              placeholder="Enter query title..."
                            />
                            <label
                              htmlFor="detail-desc-input"
                              className="query-view-sub-label"
                              style={{ marginTop: '0.65rem' }}
                            >
                              Query Description
                            </label>
                            <textarea
                              id="detail-desc-input"
                              rows={6}
                              className="inline-edit-desc-textarea"
                              value={detailDescDraft}
                              onChange={(e) => {
                                setDetailDescDraft(e.target.value);
                                setHasUnsavedDetailChanges(true);
                              }}
                              placeholder="Enter query description..."
                            />
                          </div>
                        ) : (
                          <>
                            <div className="query-view-field-block">
                              <span className="query-view-sub-label">Title</span>
                              <div className="query-view-item-title">
                                {activeViewingQuery.queryTitle || activeViewingQuery.queryText}
                              </div>
                            </div>
                            <div className="query-view-field-block query-view-field-block--desc">
                              <span className="query-view-sub-label">Description</span>
                              <div className="query-view-item-desc">
                                {activeViewingQuery.queryText || '—'}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Attachments Section */}
                    <div className="query-view-section">
                      <div className="query-view-section-header">
                        <span className="query-view-section-label">
                          Attachments ({detailAttachmentsDraft.length}/{MAX_FILES_PER_UPLOAD} &bull; Max {MAX_FILE_SIZE_LABEL}/file)
                        </span>
                        {isSenderOrAdmin && (
                          <>
                            <input
                              ref={detailFileInputRef}
                              id="detail-attachments-file-input"
                              type="file"
                              multiple
                              style={{ display: 'none' }}
                              onChange={handleDetailFilesSelected}
                            />
                            <button
                              type="button"
                              className="btn-query-edit-action"
                              onClick={() => detailFileInputRef.current?.click()}
                              title={`Select documents from device to attach (Max ${MAX_FILE_SIZE_LABEL} per file, up to ${MAX_FILES_PER_UPLOAD} files)`}
                              disabled={isReadingDetailFiles || detailAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD}
                            >
                              {isReadingDetailFiles
                                ? 'Reading files...'
                                : detailAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD
                                ? `Max ${MAX_FILES_PER_UPLOAD} Files`
                                : '📎 Add Attachment'}
                            </button>
                          </>
                        )}
                      </div>

                      {detailAttachmentsDraft.length > 0 ? (
                        <div className="query-view-attachments-grid">
                          {detailAttachmentsDraft.map((att) => (
                            <div key={att.id} className="query-attachment-card">
                              <div className="query-attachment-card-main">
                                <span className="query-attachment-card-icon">
                                  {getFileIcon(att.name, att.type)}
                                </span>
                                <div className="query-attachment-card-details">
                                  <div className="query-attachment-card-name" title={att.name}>
                                    {att.name}
                                  </div>
                                  <div className="query-attachment-card-meta">
                                    <span className="query-attachment-card-size">
                                      {formatFileSize(att.size)}
                                    </span>
                                    {att.uploadedAt && (
                                      <span className="query-attachment-card-date">
                                        &bull; {formatDate(att.uploadedAt)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="query-attachment-card-actions">
                                <button
                                  type="button"
                                  className="btn-attachment-action btn-attachment-action--view"
                                  onClick={() => openAttachment(att)}
                                  title="Open or preview document in a new tab"
                                >
                                  👁️ Open
                                </button>
                                <button
                                  type="button"
                                  className="btn-attachment-action btn-attachment-action--download"
                                  onClick={() => downloadAttachment(att)}
                                  title="Download document to device"
                                >
                                  ⬇️ Download
                                </button>
                                {isSenderOrAdmin && (
                                  <button
                                    type="button"
                                    className="btn-attachment-action btn-attachment-action--remove"
                                    onClick={() => handleRemoveDetailAttachment(att.id)}
                                    title="Remove this attachment"
                                    aria-label={`Remove ${att.name}`}
                                  >
                                    ✕ Remove
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          className="query-view-content-box query-view-content-box--empty"
                          style={{
                            padding: '0.85rem 1rem',
                            fontSize: '0.84rem',
                            color: '#786e60',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '0.6rem',
                          }}
                        >
                          <span>No documents attached to this query yet.</span>
                          {isSenderOrAdmin && (
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => detailFileInputRef.current?.click()}
                            >
                              + Add Attachment from Device
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Save Changes Action Bar (visible when sender/admin has edited description or added/removed attachments) */}
                    {isSenderOrAdmin && (hasUnsavedDetailChanges || isEditingDescription) && (
                      <div className="query-view-save-bar">
                        <div className="query-view-save-info">
                          <span className="query-view-save-info-icon">ℹ️</span>
                          <span>
                            Original creation timestamp (<strong>{formatDateTime(activeViewingQuery.createdAt)}</strong>) and SLA target deadlines remain strictly preserved.
                          </span>
                        </div>
                        <div className="query-view-save-actions">
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={handleCancelDetailEdits}
                            disabled={isSavingDetailChanges}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-save-changes-highlight"
                            onClick={handleSaveDetailChanges}
                            disabled={isSavingDetailChanges || isReadingDetailFiles}
                          >
                            {isSavingDetailChanges ? 'Saving Changes...' : '💾 Save Changes'}
                          </button>
                        </div>
                      </div>
                    )}

                    {detailSaveSuccess && (
                      <div className="query-view-save-toast">
                        ✅ Query changes and attachments saved successfully!
                      </div>
                    )}
                  </>
                );
              })()}

              {(activeViewingLinkedAppointment || activeViewingQuery.linkedAppointmentId) && (
                <div className="query-view-section">
                  <span className="query-view-section-label">Linked Appointment</span>
                  <div
                    className="query-view-content-box"
                    style={{
                      background: 'rgba(132, 73, 24, 0.05)',
                      border: '1px solid rgba(132, 73, 24, 0.22)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.6rem',
                    }}
                  >
                    {activeViewingLinkedAppointment ? (
                      <>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '0.5rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span className="apt-id-pill">
                              📅 {activeViewingLinkedAppointment.id}
                            </span>
                            <strong style={{ fontSize: '0.94rem', color: '#1c1813' }}>
                              {activeViewingLinkedAppointment.title}
                            </strong>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <span
                              className={`apt-status-pill apt-status-pill--${activeViewingLinkedAppointment.status.toLowerCase()}`}
                            >
                              {activeViewingLinkedAppointment.status === 'CONFIRMED'
                                ? 'Confirmed'
                                : activeViewingLinkedAppointment.status === 'PENDING'
                                ? Array.isArray(activeViewingLinkedAppointment.attendees) &&
                                  activeViewingLinkedAppointment.attendees.length > 1
                                  ? `Pending (${
                                      activeViewingLinkedAppointment.attendees.filter(
                                        (a) => a.status === 'CONFIRMED'
                                      ).length
                                    }/${activeViewingLinkedAppointment.attendees.length} accepted)`
                                  : 'Pending Acceptance'
                                : activeViewingLinkedAppointment.status === 'RESCHEDULE_PROPOSED'
                                ? 'Reschedule Proposed'
                                : activeViewingLinkedAppointment.status === 'DECLINED'
                                ? 'Declined'
                                : activeViewingLinkedAppointment.status === 'CANCELLED'
                                ? 'Cancelled'
                                : 'Completed'}
                            </span>
                            <button
                              type="button"
                              style={{
                                background: '#ffffff',
                                border: '1px solid rgba(132, 73, 24, 0.25)',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                fontSize: '0.72rem',
                                color: '#78350f',
                                cursor: 'pointer',
                              }}
                              title="Unlink this appointment from the query"
                              onClick={async () => {
                                if (window.confirm(`Unlink appointment ${activeViewingLinkedAppointment.id} from query ${activeViewingQuery.queryId}?`)) {
                                  await onUpdateQuery(activeViewingQuery.queryId, { linkedAppointmentId: null });
                                }
                              }}
                            >
                              Unlink
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.85rem',
                            fontSize: '0.82rem',
                            color: '#4b4339',
                          }}
                        >
                          <span>
                            <strong>Scheduled:</strong> {activeViewingLinkedAppointment.scheduledAt}
                          </span>
                          <span>
                            <strong>Type:</strong> {activeViewingLinkedAppointment.meetingType}
                          </span>
                          {activeViewingLinkedAppointment.meetingLocation && (
                            <span>
                              <strong>Location:</strong> {activeViewingLinkedAppointment.meetingLocation}
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: '0.82rem', color: '#4b4339' }}>
                          <strong>Host:</strong> {activeViewingLinkedAppointment.requesterName} &rarr;{' '}
                          <strong>Attendees:</strong>{' '}
                          {Array.isArray(activeViewingLinkedAppointment.attendees) &&
                          activeViewingLinkedAppointment.attendees.length > 0
                            ? activeViewingLinkedAppointment.attendees
                                .map(
                                  (a) =>
                                    `${a.name}${
                                      a.status === 'CONFIRMED'
                                        ? ' (✓ Accepted)'
                                        : a.status === 'DECLINED'
                                        ? ' (✕ Declined)'
                                        : ' (⏳ Pending)'
                                    }`
                                )
                                .join(', ')
                            : activeViewingLinkedAppointment.receiverName}
                        </div>

                        {activeViewingLinkedAppointment.agenda && (
                          <div
                            style={{
                              fontSize: '0.82rem',
                              color: '#3a3228',
                              background: '#ffffff',
                              padding: '0.55rem 0.75rem',
                              borderRadius: '8px',
                              border: '1px solid rgba(190, 179, 161, 0.35)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            <strong>Agenda:</strong> {activeViewingLinkedAppointment.agenda}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="apt-id-pill">
                          📅 {activeViewingQuery.linkedAppointmentId}
                        </span>
                        <span style={{ fontSize: '0.85rem', color: '#4b4339' }}>
                          Linked to Appointment {activeViewingQuery.linkedAppointmentId}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Target Completion & Extension Management */}
              <div className="query-view-section query-view-section--extension">
                <div className="query-view-section-header">
                  <span className="query-view-section-label">Target Completion</span>
                  <span className="query-view-due-text">
                    {activeViewingQuery.isUrgent ? (
                      <span className="pill-urgent-badge-strong">
                        🚨 Immediately Due (10m Alerts &bull; 1h Remark Required)
                      </span>
                    ) : activeViewingQuery.targetDueAt ? (
                      <>
                        <strong>{formatDateTime(activeViewingQuery.targetDueAt)}</strong>{' '}
                        <span className="pill-extended-badge">Extended</span>
                      </>
                    ) : (
                      <>Standard: 24 hours from creation</>
                    )}
                  </span>
                </div>

                {activeViewingQuery.isUrgent && !isQueryDone(activeViewingQuery) && (
                  <div
                    className={`urgent-view-notice ${
                      isUrgentManagerRemarkOverdue(activeViewingQuery, nowMs)
                        ? 'urgent-view-notice--overdue'
                        : ''
                    }`}
                  >
                    <span className="urgent-view-notice-icon">
                      {isUrgentManagerRemarkOverdue(activeViewingQuery, nowMs) ? '⚠️' : '🚨'}
                    </span>
                    <div className="urgent-view-notice-text">
                      <div>
                        <strong>URGENT SLA Rules Active:</strong> Sender, Receiver, and Admins are alerted every 10 minutes until finalized. Manager ({activeViewingQuery.managerName}) KPI is reduced by 50% until completed.
                      </div>
                      {isUrgentManagerRemarkOverdue(activeViewingQuery, nowMs) ? (
                        <div className="urgent-notice-highlight urgent-notice-highlight--alert">
                          ⚠️ <strong>Action Required:</strong> The 1-hour initial remark window has expired without any manager remark!
                        </div>
                      ) : hasManagerRemark(activeViewingQuery) ? (
                        <div className="urgent-notice-highlight urgent-notice-highlight--ok">
                          ✅ Manager remark provided. Awaiting completion &amp; sender verification.
                        </div>
                      ) : (
                        <div className="urgent-notice-highlight">
                          ⏱️ Receiving manager must post a remark regarding this query within 1 hour.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeViewingQuery.extensionStatus === 'PENDING' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--pending">
                    <div className="ext-banner-top">
                      <span className="ext-banner-title">
                        ⏳ Extension Requested by Manager {activeViewingQuery.managerName}
                      </span>
                      <span className="ext-proposed-pill">
                        Proposed: {formatDateTime(activeViewingQuery.extensionProposedDueAt) || '—'}
                      </span>
                    </div>
                    <p className="ext-banner-reason">
                      <strong>Reason:</strong> {activeViewingQuery.extensionReason || '—'}
                    </p>
                    {(currentUser.id === activeViewingQuery.accountManagerId || currentUser.role === 'admin' || currentUser.role === 'account_manager') && (
                      <div className="ext-banner-actions">
                        <button
                          type="button"
                          className="btn-approve-ext"
                          onClick={() => handleApproveExtension(activeViewingQuery)}
                          disabled={isReviewingExtension}
                        >
                          ✓ Approve Extension
                        </button>
                        <button
                          type="button"
                          className="btn-decline-ext"
                          onClick={() => {
                            setExtensionReviewModalQuery(activeViewingQuery);
                          }}
                          disabled={isReviewingExtension}
                        >
                          ✕ Decline
                        </button>
                      </div>
                    )}
                  </div>
                ) : activeViewingQuery.extensionStatus === 'APPROVED' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--approved">
                    <span>
                      ✅ <strong>Extension Approved</strong> to {formatDateTime(activeViewingQuery.targetDueAt)}.
                      {activeViewingQuery.extensionReason && (
                        <span className="ext-reason-note"> (Reason: {activeViewingQuery.extensionReason})</span>
                      )}
                    </span>
                  </div>
                ) : activeViewingQuery.extensionStatus === 'DECLINED' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--declined">
                    <span>
                      ❌ <strong>Extension Request Declined</strong>.
                      {activeViewingQuery.extensionReviewNote && (
                        <span className="ext-reason-note"> Note: {activeViewingQuery.extensionReviewNote}</span>
                      )}
                    </span>
                  </div>
                ) : null}

                {/* Allow Assigned Manager or Admin to request extension if not currently pending and not yet done */}
                {!isQueryDone(activeViewingQuery) &&
                  activeViewingQuery.extensionStatus !== 'PENDING' &&
                  (currentUser.id === activeViewingQuery.managerId || currentUser.role === 'admin') && (
                    <div className="ext-request-btn-row">
                      <button
                        type="button"
                        className="btn-request-ext"
                        onClick={() => openExtensionModal(activeViewingQuery)}
                      >
                        ⏳ Request Completion Date Extension
                      </button>
                    </div>
                  )}
              </div>

              <div className="query-view-remarks-grid">
                {/* Manager Remark Card */}
                {(() => {
                  const isAssignedManagerOrAdmin =
                    belongsToManager(activeViewingQuery, currentUser) ||
                    currentUser.role === 'admin';
                  const mgrRemarks = (activeViewingQuery.remarks || []).filter((r) => r.type === 'manager');

                  return (
                    <div className="query-view-section query-view-section--card">
                      <div className="query-view-section-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span className="query-view-section-label">🛠️ Manager Remarks</span>
                          {isAssignedManagerOrAdmin && (
                            <>
                              <input
                                ref={mgrFileInputRef}
                                id="modal-mgr-attachments-file-input"
                                type="file"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleMgrFilesSelected}
                              />
                              <button
                                type="button"
                                className="btn-query-edit-action"
                                onClick={() => mgrFileInputRef.current?.click()}
                                title={`Attach resolution documents from device (Max ${MAX_FILE_SIZE_LABEL} per file, up to ${MAX_FILES_PER_UPLOAD} files)`}
                                disabled={isReadingMgrFiles || modalMgrAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD}
                              >
                                {isReadingMgrFiles
                                  ? 'Reading...'
                                  : modalMgrAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD
                                  ? `Max ${MAX_FILES_PER_UPLOAD} Files`
                                  : `📎 Attach File (Max ${MAX_FILE_SIZE_LABEL})`}
                              </button>
                            </>
                          )}
                        </div>
                        <span
                          className={`query-view-check-tag ${
                            activeViewingQuery.managerDone
                              ? 'query-view-check-tag--done'
                              : ''
                          }`}
                        >
                          {activeViewingQuery.managerDone ? '✓ Mgr Done' : 'Unchecked'}
                        </span>
                      </div>

                      {/* Timeline of Remarks made so far with timestamp */}
                      <div className="remark-timeline">
                        {mgrRemarks.length > 0 ? (
                          mgrRemarks.map((rmk, idx) => {
                            const isLatest = idx === mgrRemarks.length - 1;
                            const displayText = (rmk.text || rmk.title || '—').trim();
                            const displayTitle =
                              rmk.title && rmk.title.trim() !== displayText
                                ? rmk.title.trim()
                                : null;
                            return (
                              <div
                                key={rmk.id || idx}
                                className={`remark-timeline-item ${isLatest ? 'remark-timeline-item--latest' : ''}`}
                              >
                                <div className="remark-timeline-header">
                                  <div className="remark-author-info">
                                    <span className="remark-author-name">{rmk.authorName}</span>
                                    <span className={`person-role-tag person-role-tag--${rmk.authorRole}`}>
                                      {rmk.authorRole === 'manager' ? 'Manager' : rmk.authorRole === 'admin' ? 'Admin' : 'Sender'}
                                    </span>
                                  </div>
                                  <div className="remark-meta-right">
                                    <span className="remark-timestamp">🕒 {rmk.createdAt}</span>
                                    {isLatest && <span className="remark-badge-latest">LATEST</span>}
                                  </div>
                                </div>
                                {displayTitle && <div className="remark-title">{displayTitle}</div>}
                                <div className="remark-text">{displayText}</div>
                              </div>
                            );
                          })
                        ) : activeViewingQuery.managerRemarkTitle || activeViewingQuery.managerRemark ? (
                          <div className="remark-timeline-item remark-timeline-item--latest">
                            <div className="remark-timeline-header">
                              <div className="remark-author-info">
                                <span className="remark-author-name">{activeViewingQuery.managerName}</span>
                                <span className="person-role-tag person-role-tag--manager">Manager</span>
                              </div>
                              <div className="remark-meta-right">
                                <span className="remark-timestamp">🕒 {activeViewingQuery.managerDoneAt || activeViewingQuery.createdAt}</span>
                                <span className="remark-badge-latest">LATEST</span>
                              </div>
                            </div>
                            {activeViewingQuery.managerRemarkTitle &&
                              activeViewingQuery.managerRemarkTitle.trim() !== (activeViewingQuery.managerRemark || '').trim() && (
                                <div className="remark-title">{activeViewingQuery.managerRemarkTitle}</div>
                              )}
                            <div className="remark-text">
                              {activeViewingQuery.managerRemark || activeViewingQuery.managerRemarkTitle || '—'}
                            </div>
                          </div>
                        ) : (
                          <div className="remark-timeline-empty">
                            No manager remarks posted yet.
                          </div>
                        )}
                      </div>

                      {/* Display Manager Attachments */}
                      {modalMgrAttachmentsDraft.length > 0 && (
                        <div className="remark-attachments-wrap">
                          <span className="query-view-sub-label">
                            📎 Resolution Attachments ({modalMgrAttachmentsDraft.length}/{MAX_FILES_PER_UPLOAD} &bull; Max {MAX_FILE_SIZE_LABEL}/file)
                          </span>
                          <div className="query-view-attachments-grid" style={{ marginTop: '0.35rem' }}>
                            {modalMgrAttachmentsDraft.map((att) => (
                              <div key={att.id} className="query-attachment-card">
                                <div className="query-attachment-card-main">
                                  <span className="query-attachment-card-icon">
                                    {getFileIcon(att.name, att.type)}
                                  </span>
                                  <div className="query-attachment-card-details">
                                    <div className="query-attachment-card-name" title={att.name}>
                                      {att.name}
                                    </div>
                                    <span className="query-attachment-card-size">
                                      {formatFileSize(att.size)}
                                    </span>
                                  </div>
                                </div>
                                <div className="query-attachment-card-actions">
                                  <button
                                    type="button"
                                    className="btn-attachment-action btn-attachment-action--view"
                                    onClick={() => openAttachment(att)}
                                    title="Open document"
                                  >
                                    👁️ Open
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-attachment-action btn-attachment-action--download"
                                    onClick={() => downloadAttachment(att)}
                                    title="Download document"
                                  >
                                    ⬇️ Download
                                  </button>
                                  {isAssignedManagerOrAdmin && (
                                    <button
                                      type="button"
                                      className="btn-attachment-action btn-attachment-action--remove"
                                      onClick={() => handleRemoveMgrAttachment(att.id)}
                                      title="Remove this attachment"
                                      aria-label={`Remove ${att.name}`}
                                    >
                                      ✕ Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add New Manager Remark Area */}
                      {isAssignedManagerOrAdmin && (
                        <div className="remark-add-box">
                          <input
                            type="text"
                            className="remark-add-title-input"
                            value={newMgrRemarkTitle}
                            onChange={(e) => setNewMgrRemarkTitle(e.target.value)}
                            placeholder="Remark Title (Optional)..."
                          />
                          <textarea
                            className="remark-add-textarea"
                            rows={3}
                            value={newMgrRemarkText}
                            onChange={(e) => setNewMgrRemarkText(e.target.value)}
                            placeholder="Type a new manager remark or solution..."
                          />
                          <div className="remark-add-footer">
                            <button
                              type="button"
                              className="btn-primary btn-post-remark"
                              onClick={handlePostManagerRemark}
                              disabled={isPostingMgrRemark || !newMgrRemarkText.trim()}
                            >
                              {isPostingMgrRemark ? 'Posting...' : '+ Post Remark'}
                            </button>
                          </div>
                        </div>
                      )}

                      {modalMgrRemarkSaveSuccess && (
                        <div className="query-view-save-toast">
                          ✅ Manager remark added with timestamp!
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Sender Remark Card */}
                {(() => {
                  const isSenderOrAdmin =
                    belongsToAccountManager(activeViewingQuery, currentUser) ||
                    currentUser.role === 'admin';
                  const senderRemarks = (activeViewingQuery.remarks || []).filter((r) => r.type === 'sender');

                  return (
                    <div className="query-view-section query-view-section--card">
                      <div className="query-view-section-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span className="query-view-section-label">👤 Sender Remarks</span>
                        </div>
                        <span
                          className={`query-view-check-tag ${
                            activeViewingQuery.accountManagerDone
                              ? 'query-view-check-tag--done'
                              : ''
                          }`}
                        >
                          {activeViewingQuery.accountManagerDone ? '✓ Sender Done' : 'Unchecked'}
                        </span>
                      </div>

                      {/* Timeline of Remarks made so far with timestamp */}
                      <div className="remark-timeline">
                        {senderRemarks.length > 0 ? (
                          senderRemarks.map((rmk, idx) => {
                            const isLatest = idx === senderRemarks.length - 1;
                            const displayText = (rmk.text || rmk.title || '—').trim();
                            const displayTitle =
                              rmk.title && rmk.title.trim() !== displayText
                                ? rmk.title.trim()
                                : null;
                            return (
                              <div
                                key={rmk.id || idx}
                                className={`remark-timeline-item ${isLatest ? 'remark-timeline-item--latest' : ''}`}
                              >
                                <div className="remark-timeline-header">
                                  <div className="remark-author-info">
                                    <span className="remark-author-name">{rmk.authorName}</span>
                                    <span className={`person-role-tag person-role-tag--${rmk.authorRole}`}>
                                      {rmk.authorRole === 'admin' ? 'Admin' : 'Sender'}
                                    </span>
                                  </div>
                                  <div className="remark-meta-right">
                                    <span className="remark-timestamp">🕒 {rmk.createdAt}</span>
                                    {isLatest && <span className="remark-badge-latest">LATEST</span>}
                                  </div>
                                </div>
                                {displayTitle && <div className="remark-title">{displayTitle}</div>}
                                <div className="remark-text">{displayText}</div>
                              </div>
                            );
                          })
                        ) : activeViewingQuery.accountManagerRemarkTitle || activeViewingQuery.accountManagerRemark ? (
                          <div className="remark-timeline-item remark-timeline-item--latest">
                            <div className="remark-timeline-header">
                              <div className="remark-author-info">
                                <span className="remark-author-name">{activeViewingQuery.accountManagerName}</span>
                                <span className="person-role-tag person-role-tag--sender">Sender</span>
                              </div>
                              <div className="remark-meta-right">
                                <span className="remark-timestamp">🕒 {activeViewingQuery.completedAt || activeViewingQuery.createdAt}</span>
                                <span className="remark-badge-latest">LATEST</span>
                              </div>
                            </div>
                            {activeViewingQuery.accountManagerRemarkTitle &&
                              activeViewingQuery.accountManagerRemarkTitle.trim() !== (activeViewingQuery.accountManagerRemark || '').trim() && (
                                <div className="remark-title">{activeViewingQuery.accountManagerRemarkTitle}</div>
                              )}
                            <div className="remark-text">
                              {activeViewingQuery.accountManagerRemark || activeViewingQuery.accountManagerRemarkTitle || '—'}
                            </div>
                          </div>
                        ) : (
                          <div className="remark-timeline-empty">
                            No sender remarks posted yet.
                          </div>
                        )}
                      </div>

                      {/* Add New Sender Remark Area */}
                      {isSenderOrAdmin && (
                        <div className="remark-add-box">
                          <input
                            type="text"
                            className="remark-add-title-input"
                            value={newSenderRemarkTitle}
                            onChange={(e) => setNewSenderRemarkTitle(e.target.value)}
                            placeholder="Remark Title (Optional)..."
                          />
                          <textarea
                            className="remark-add-textarea"
                            rows={3}
                            value={newSenderRemarkText}
                            onChange={(e) => setNewSenderRemarkText(e.target.value)}
                            placeholder="Type a new sender feedback or verification remark..."
                          />
                          <div className="remark-add-footer">
                            <button
                              type="button"
                              className="btn-primary btn-post-remark"
                              onClick={handlePostSenderRemark}
                              disabled={isPostingSenderRemark || !newSenderRemarkText.trim()}
                            >
                              {isPostingSenderRemark ? 'Posting...' : '+ Post Remark'}
                            </button>
                          </div>
                        </div>
                      )}

                      {modalSenderRemarkSaveSuccess && (
                        <div className="query-view-save-toast">
                          ✅ Sender remark added with timestamp!
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Rating Section: strictly visible ONLY to Admin and the Sender (Hidden from Receiving Manager) */}
              {(currentUser.role === 'admin' ||
                currentUser.id === activeViewingQuery.accountManagerId) && (
                <div className="query-view-section query-view-section--rating">
                  <div className="query-view-section-header">
                    <span className="query-view-section-label">
                      {currentUser.role === 'admin' ? 'Sender Rating' : 'Your Rating'}
                    </span>
                  </div>
                  <div className="query-view-rating-card">
                    {activeViewingQuery.rating ? (
                      <div className="query-view-rating-display">
                        <span className="rating-stars-gold">
                          {'★'.repeat(activeViewingQuery.rating)}
                          <span className="rating-stars-dim">
                            {'★'.repeat(5 - activeViewingQuery.rating)}
                          </span>
                        </span>
                        <span className="query-view-rating-value">
                          {activeViewingQuery.rating} / 5 Stars
                        </span>
                        {(currentUser.id === activeViewingQuery.accountManagerId || currentUser.role === 'admin' || currentUser.role === 'account_manager') && (
                          <div className="query-view-rating-actions">
                            <button
                              type="button"
                              className="btn-inline-edit"
                              onClick={() => {
                                setRatingModalQuery(activeViewingQuery);
                                setRatingInput(activeViewingQuery.rating || 0);
                                setRatingHover(0);
                                setRatingModalCompleteOnSubmit(false);
                              }}
                            >
                              Change Rating
                            </button>
                            <button
                              type="button"
                              className="btn-inline-clear-rating"
                              onClick={async () => {
                                await onUpdateQuery(activeViewingQuery.queryId, {
                                  rating: null,
                                });
                              }}
                              title="Clear rating for this query"
                            >
                              Clear Rating
                            </button>
                          </div>
                        )}
                      </div>
                    ) : currentUser.id === activeViewingQuery.accountManagerId ? (
                      <div className="query-view-rating-prompt">
                        <span className="rating-pending-text">
                          You haven&apos;t rated this manager yet:
                        </span>
                        <button
                          type="button"
                          className="btn-rate-prompt"
                          onClick={() => {
                            setRatingModalQuery(activeViewingQuery);
                            setRatingInput(0);
                            setRatingHover(0);
                            setRatingModalCompleteOnSubmit(false);
                          }}
                        >
                          ★ Rate Manager (1-5 Stars)
                        </button>
                      </div>
                    ) : (
                      <span className="rating-placeholder">Not rated yet.</span>
                    )}
                  </div>
                </div>
              )}

              {/* Receiver Rating Section: visible to Receiver to rate the Sender */}
              {(currentUser.role === 'admin' || currentUser.id === activeViewingQuery.managerId) && (
                (() => {
                  const isPostCutoff = Boolean(
                    (activeViewingQuery.createdAtMs && activeViewingQuery.createdAtMs > RECEIVER_RATING_FEATURE_START_MS) ||
                    (activeViewingQuery.receiverSenderRating !== undefined && activeViewingQuery.receiverSenderRating !== null)
                  );
                  if (!isPostCutoff && currentUser.role !== 'admin') return null;

                  return (
                    <div className="query-view-section query-view-section--rating">
                      <div className="query-view-section-header">
                        <span className="query-view-section-label">
                          {currentUser.role === 'admin'
                            ? `Receiver Rating (for Sender: ${activeViewingQuery.accountManagerName})`
                            : `Your Rating (for Sender: ${activeViewingQuery.accountManagerName})`}
                        </span>
                      </div>
                      <div className="query-view-rating-card">
                        {activeViewingQuery.receiverSenderRating ? (
                          <div className="query-view-rating-display">
                            <span className="rating-stars-gold">
                              ⭐ {activeViewingQuery.receiverSenderRating} / 10 Stars
                            </span>
                            {activeViewingQuery.receiverSenderRemark && (
                              <div style={{ fontSize: '0.82rem', color: '#634a36', marginTop: '0.3rem', fontStyle: 'italic' }}>
                                &ldquo;{activeViewingQuery.receiverSenderRemark}&rdquo;
                              </div>
                            )}
                            {(currentUser.id === activeViewingQuery.managerId || currentUser.role === 'admin') && (
                              <div className="query-view-rating-actions" style={{ marginTop: '0.5rem' }}>
                                <button
                                  type="button"
                                  className="btn-inline-edit"
                                  onClick={() => {
                                    setReceiverRatingModalQuery(activeViewingQuery);
                                    setReceiverRatingInput(activeViewingQuery.receiverSenderRating || 10);
                                    setReceiverRatingHover(0);
                                    setReceiverRatingRemarkInput(activeViewingQuery.receiverSenderRemark || '');
                                    setReceiverRatingRemarkError('');
                                  }}
                                >
                                  Update Rating
                                </button>
                              </div>
                            )}
                          </div>
                        ) : currentUser.id === activeViewingQuery.managerId ? (
                          <div className="query-view-rating-prompt">
                            <span className="rating-pending-text">
                              You haven&apos;t rated the sender yet:
                            </span>
                            <button
                              type="button"
                              className="btn-rate-prompt"
                              onClick={() => {
                                setReceiverRatingModalQuery(activeViewingQuery);
                                setReceiverRatingInput(10);
                                setReceiverRatingHover(0);
                                setReceiverRatingRemarkInput('');
                                setReceiverRatingRemarkError('');
                              }}
                            >
                              ★ Rate Sender (1-10 Stars)
                            </button>
                          </div>
                        ) : (
                          <span className="rating-placeholder">Not rated by receiver yet (Default 10★).</span>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}

              {/* Requirement 1: Link Existing Appointment in Query List (Query Details Modal) */}
              {!activeViewingLinkedAppointment &&
                !activeViewingQuery.linkedAppointmentId &&
                isLinkingExistingApt && (
                  <div className="query-view-section">
                    <span className="query-view-section-label">Link Existing Appointment</span>
                    <div
                      className="query-view-content-box"
                      style={{
                        background: '#fefce8',
                        border: '1px solid #fef08a',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.65rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.82rem', color: '#854d0e', fontWeight: 600 }}>
                          Select an existing appointment where Manager <strong>{activeViewingQuery.managerName}</strong> is an attendee:
                        </span>
                        <button
                          type="button"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '1.1rem',
                            color: '#854d0e',
                            lineHeight: 1,
                          }}
                          onClick={() => {
                            setIsLinkingExistingApt(false);
                            setLinkExistingError(null);
                          }}
                          aria-label="Close"
                        >
                          ✕
                        </button>
                      </div>

                      {linkableAppointmentsForActiveQuery.length === 0 ? (
                        <div style={{ fontSize: '0.82rem', color: '#b91c1c', fontStyle: 'italic' }}>
                          No eligible appointments found where Manager {activeViewingQuery.managerName} is an attendee.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            style={{
                              flex: 1,
                              minWidth: '220px',
                              padding: '0.4rem 0.6rem',
                              borderRadius: '6px',
                              border: '1px solid #d4cbbd',
                              fontSize: '0.82rem',
                              background: '#ffffff',
                            }}
                            value={chosenExistingAptId}
                            onChange={(e) => {
                              setChosenExistingAptId(e.target.value);
                              setLinkExistingError(null);
                            }}
                          >
                            <option value="">-- Select an appointment --</option>
                            {linkableAppointmentsForActiveQuery.map((apt) => (
                              <option key={apt.id} value={apt.id}>
                                [{apt.id}] {apt.title} ({apt.scheduledAt})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-primary"
                            style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
                            disabled={isSubmittingLinkApt || !chosenExistingAptId}
                            onClick={async () => {
                              if (!chosenExistingAptId) {
                                setLinkExistingError('Please select an appointment.');
                                return;
                              }
                              const targetApt = appointments.find((a) => a.id === chosenExistingAptId);
                              if (
                                !targetApt ||
                                !isUserParticipantInAppointment(targetApt, {
                                  id: activeViewingQuery.managerId,
                                  email: activeViewingQuery.managerEmail,
                                  name: activeViewingQuery.managerName,
                                })
                              ) {
                                setLinkExistingError(
                                  `The receiving manager (${activeViewingQuery.managerName}) must be one of the attendees in this appointment.`
                                );
                                return;
                              }
                              setIsSubmittingLinkApt(true);
                              try {
                                await onUpdateQuery(activeViewingQuery.queryId, {
                                  linkedAppointmentId: chosenExistingAptId,
                                });
                                setIsLinkingExistingApt(false);
                                setChosenExistingAptId('');
                                setLinkExistingError(null);
                              } finally {
                                setIsSubmittingLinkApt(false);
                              }
                            }}
                          >
                            {isSubmittingLinkApt ? 'Linking...' : 'Confirm Link'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={() => {
                              setIsLinkingExistingApt(false);
                              setLinkExistingError(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      {linkExistingError && (
                        <div style={{ color: '#b91c1c', fontSize: '0.76rem', fontWeight: 600 }}>
                          {linkExistingError}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              <div className="modal-actions" style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {(() => {
                  const isSenderOrMgrOrAdmin =
                    currentUser.id === activeViewingQuery.accountManagerId ||
                    currentUser.id === activeViewingQuery.managerId ||
                    currentUser.role === 'admin';

                  if (!isSenderOrMgrOrAdmin) return null;

                  return (
                    <>
                      {!activeViewingLinkedAppointment &&
                        !activeViewingQuery.linkedAppointmentId &&
                        !isLinkingExistingApt && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setIsLinkingExistingApt(true);
                              setLinkExistingError(null);
                              if (linkableAppointmentsForActiveQuery.length > 0) {
                                setChosenExistingAptId(linkableAppointmentsForActiveQuery[0].id);
                              }
                            }}
                          >
                            🔗 Link Existing Appointment
                          </button>
                        )}
                      {!activeViewingLinkedAppointment &&
                        !activeViewingQuery.linkedAppointmentId &&
                        onOpenBookAppointment && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              const q = activeViewingQuery;
                              setViewingQuery(null);
                              const targetUserId =
                                currentUser.id === q.accountManagerId
                                  ? q.managerId
                                  : q.accountManagerId;
                              onOpenBookAppointment(q.queryId, targetUserId);
                            }}
                          >
                            📅 Book Appointment for this Query
                          </button>
                        )}
                    </>
                  );
                })()}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setViewingQuery(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rating Modal: allows sender to rate anytime and enforce mandatory rating before completion */}
      {ratingModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setRatingModalQuery(null)}
        >
          <div
            className="modal-dialog rating-prompt-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rating-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="rating-modal-title">
                  Rate Manager: {ratingModalQuery.managerName}
                </h3>
                <span className="modal-subtitle">
                  Query {ratingModalQuery.queryId} &bull;{' '}
                  {ratingModalQuery.queryTitle ||
                    ratingModalQuery.queryText.slice(0, 35)}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRatingModalQuery(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="rating-modal-body">
              <p className="rating-modal-desc">
                {ratingModalCompleteOnSubmit ? (
                  <>
                    Please rate <strong>{ratingModalQuery.managerName}</strong>&apos;s
                    resolution to complete this query. Ratings are <em>anonymous</em> to the
                    manager and contribute to their overall KPI score.
                  </>
                ) : (
                  <>
                    Rate <strong>{ratingModalQuery.managerName}</strong> for this query.
                    You can update this rating at any time. Ratings are <em>anonymous</em> to
                    the manager and contribute to their overall KPI score.
                  </>
                )}
              </p>

              <div className="star-rating-picker-10" role="radiogroup" aria-label="Rating from 1 to 10 stars">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-pick-btn-10 ${
                      (ratingHover || ratingInput) >= star
                        ? 'star-pick-btn-10--active'
                        : ''
                    }`}
                    onMouseEnter={() => setRatingHover(star)}
                    onMouseLeave={() => setRatingHover(0)}
                    onClick={() => setRatingInput(star)}
                    title={`${star} Star${star > 1 ? 's' : ''}`}
                    aria-label={`${star} Star${star > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="rating-score-label">
                {ratingInput > 0 ? (
                  <span className="rating-score-active">
                    ⭐ {ratingInput} of 10 Stars Selected
                  </span>
                ) : (
                  <span className="rating-score-hint">
                    Select 1 to 10 stars to proceed
                  </span>
                )}
              </div>

              <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#715b49',
                    marginBottom: '0.4rem',
                  }}
                >
                  Feedback Remark <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
                </label>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '75px',
                    padding: '0.65rem',
                    fontSize: '0.85rem',
                    border: '1.5px solid rgba(193, 128, 54, 0.4)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                  placeholder="Explain how the manager handled this query..."
                  value={ratingRemarkInput}
                  onChange={(e) => {
                    setRatingRemarkInput(e.target.value);
                    if (ratingRemarkError) setRatingRemarkError('');
                  }}
                />
                {ratingRemarkError && (
                  <span style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                    {ratingRemarkError}
                  </span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRatingModalQuery(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={ratingInput < 1 || savingQueryId === ratingModalQuery.queryId}
                  onClick={async () => {
                    if (ratingInput < 1) return;
                    if (!ratingRemarkInput.trim()) {
                      setRatingRemarkError('Remark is mandatory when rating');
                      return;
                    }

                    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
                    const nowMs = Date.now();

                    const updatesToSave: any = {
                      senderReceiverRating: ratingInput,
                      senderReceiverRemark: ratingRemarkInput.trim(),
                      senderReceiverRatedAt: nowIso,
                      senderReceiverRatedAtMs: nowMs,
                      rating: ratingInput, // backwards compatibility
                    };

                    if (ratingModalCompleteOnSubmit) {
                      updatesToSave.accountManagerDone = true;
                    }

                    await onUpdateQuery(ratingModalQuery.queryId, updatesToSave);
                    setRatingModalQuery(null);
                  }}
                >
                  {ratingModalCompleteOnSubmit
                    ? 'Submit Rating & Complete'
                    : 'Save Rating'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Receiver Rating Modal (Receiving Manager rating the Sender) */}
      {receiverRatingModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setReceiverRatingModalQuery(null)}
        >
          <div
            className="modal-dialog rating-prompt-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="receiver-rating-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="receiver-rating-modal-title">
                  Rate Sender: {receiverRatingModalQuery.accountManagerName}
                </h3>
                <span className="modal-subtitle">
                  Query {receiverRatingModalQuery.queryId} &bull;{' '}
                  {receiverRatingModalQuery.queryTitle ||
                    receiverRatingModalQuery.queryText.slice(0, 35)}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setReceiverRatingModalQuery(null)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            <div className="rating-modal-body">
              <p className="rating-modal-desc">
                Rate how well and promptly <strong>{receiverRatingModalQuery.accountManagerName}</strong> provided requirements and communication on this query. Receiver rating contributes <strong>20%</strong> to sender&apos;s overall performance score.
              </p>

              <div className="star-rating-picker-10" role="radiogroup" aria-label="Rating from 1 to 10 stars">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-pick-btn-10 ${
                      (receiverRatingHover || receiverRatingInput) >= star
                        ? 'star-pick-btn-10--active'
                        : ''
                    }`}
                    onMouseEnter={() => setReceiverRatingHover(star)}
                    onMouseLeave={() => setReceiverRatingHover(0)}
                    onClick={() => setReceiverRatingInput(star)}
                    title={`${star} Star${star > 1 ? 's' : ''}`}
                    aria-label={`${star} Star${star > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="rating-score-label">
                {receiverRatingInput > 0 ? (
                  <span className="rating-score-active">
                    ⭐ {receiverRatingInput} of 10 Stars Selected
                  </span>
                ) : (
                  <span className="rating-score-hint">
                    Select 1 to 10 stars to proceed
                  </span>
                )}
              </div>

              <div style={{ marginTop: '1rem', textAlign: 'left' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#715b49',
                    marginBottom: '0.4rem',
                  }}
                >
                  Feedback Remark <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
                </label>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '75px',
                    padding: '0.65rem',
                    fontSize: '0.85rem',
                    border: '1.5px solid rgba(193, 128, 54, 0.4)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                  placeholder="Explain your rating for the sender's clarity, responsiveness or requirements..."
                  value={receiverRatingRemarkInput}
                  onChange={(e) => {
                    setReceiverRatingRemarkInput(e.target.value);
                    if (receiverRatingRemarkError) setReceiverRatingRemarkError('');
                  }}
                />
                {receiverRatingRemarkError && (
                  <span style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                    {receiverRatingRemarkError}
                  </span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setReceiverRatingModalQuery(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={receiverRatingInput < 1 || savingQueryId === receiverRatingModalQuery.queryId}
                  onClick={async () => {
                    if (receiverRatingInput < 1) return;
                    if (!receiverRatingRemarkInput.trim()) {
                      setReceiverRatingRemarkError('Remark is mandatory when rating');
                      return;
                    }

                    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
                    const nowMs = Date.now();

                    await onUpdateQuery(receiverRatingModalQuery.queryId, {
                      receiverSenderRating: receiverRatingInput,
                      receiverSenderRemark: receiverRatingRemarkInput.trim(),
                      receiverSenderRatedAt: nowIso,
                      receiverSenderRatedAtMs: nowMs,
                    });
                    setReceiverRatingModalQuery(null);
                  }}
                >
                  {savingQueryId === receiverRatingModalQuery.queryId ? 'Saving...' : 'Save Rating'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Rating Editor Modal (Mr. Mani) */}
      {adminRatingQuery && (
        <div className="modal-backdrop" onClick={() => setAdminRatingQuery(null)}>
          <div
            className="modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: '540px' }}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-badge">Admin Performance Rating</span>
                <h3 className="modal-heading">
                  Query {adminRatingQuery.queryId} Rating
                </h3>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setAdminRatingQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Tab Selector between Receiver and Sender */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: '8px',
                    border: '1px solid #c18036',
                    background: adminRatingTargetRole === 'receiver' ? '#844918' : '#faf8f5',
                    color: adminRatingTargetRole === 'receiver' ? '#fff' : '#844918',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setAdminRatingTargetRole('receiver');
                    setAdminRatingInput(adminRatingQuery.adminReceiverRating ?? 10);
                    setAdminRemarkInput(adminRatingQuery.adminReceiverRemark || 'Proper turnaround and response');
                    setAdminRemarkError('');
                  }}
                >
                  Rate Receiver ({adminRatingQuery.managerName})
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: '0.5rem',
                    borderRadius: '8px',
                    border: '1px solid #c18036',
                    background: adminRatingTargetRole === 'sender' ? '#844918' : '#faf8f5',
                    color: adminRatingTargetRole === 'sender' ? '#fff' : '#844918',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setAdminRatingTargetRole('sender');
                    setAdminRatingInput(adminRatingQuery.adminSenderRating ?? 10);
                    setAdminRemarkInput(adminRatingQuery.adminSenderRemark || 'Prompt responses to queries and requests');
                    setAdminRemarkError('');
                  }}
                >
                  Rate Sender ({adminRatingQuery.accountManagerName})
                </button>
              </div>

              {/* Live System Rating display */}
              <div
                style={{
                  background: '#fbf9f4',
                  border: '1px solid rgba(239, 237, 206, 0.9)',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  marginBottom: '1rem',
                  fontSize: '0.82rem',
                }}
              >
                {adminRatingTargetRole === 'receiver' ? (() => {
                  const breakdown = calculateReceiverOverallRating(adminRatingQuery);
                  return (
                    <div>
                      <strong>Automated System Score:</strong> ⭐ {breakdown.systemRating} / 10 (30% weight)
                      <div style={{ color: '#715b49', marginTop: '0.2rem' }}>{breakdown.systemReason}</div>
                    </div>
                  );
                })() : (() => {
                  const breakdown = calculateSenderOverallRating(adminRatingQuery);
                  return (
                    <div>
                      <strong>Automated System Score:</strong> ⭐ {breakdown.systemRating} / 10 (30% weight)
                      <div style={{ color: '#715b49', marginTop: '0.2rem' }}>{breakdown.systemReason}</div>
                    </div>
                  );
                })()}
              </div>

              {/* 10 Star picker */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#715b49',
                    marginBottom: '0.4rem',
                  }}
                >
                  Admin Score (1 to 10 Stars) &bull; 50% Weight
                </label>
                <div className="star-rating-picker-10">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`star-pick-btn-10 ${
                        adminRatingInput >= star ? 'star-pick-btn-10--active' : ''
                      }`}
                      onClick={() => setAdminRatingInput(star)}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <div style={{ textAlign: 'center', marginTop: '0.4rem', fontWeight: 700, color: '#844918' }}>
                  ⭐ {adminRatingInput} of 10 Stars Selected
                </div>
              </div>

              {/* Mandatory Remark */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#715b49',
                    marginBottom: '0.4rem',
                  }}
                >
                  Admin Remark <span style={{ color: '#dc2626' }}>* (Mandatory)</span>
                </label>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '75px',
                    padding: '0.65rem',
                    fontSize: '0.85rem',
                    border: '1.5px solid rgba(193, 128, 54, 0.4)',
                    borderRadius: '8px',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                  placeholder="Provide admin feedback or reason for this rating..."
                  value={adminRemarkInput}
                  onChange={(e) => {
                    setAdminRemarkInput(e.target.value);
                    if (adminRemarkError) setAdminRemarkError('');
                  }}
                />
                {adminRemarkError && (
                  <span style={{ color: '#dc2626', fontSize: '0.78rem', marginTop: '0.25rem', display: 'block' }}>
                    {adminRemarkError}
                  </span>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setAdminRatingQuery(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={savingQueryId === adminRatingQuery.queryId}
                onClick={async () => {
                  if (!adminRemarkInput.trim()) {
                    setAdminRemarkError('Remark is mandatory for Admin ratings');
                    return;
                  }

                  const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
                  const nowMs = Date.now();

                  if (adminRatingTargetRole === 'receiver') {
                    await onUpdateQuery(adminRatingQuery.queryId, {
                      adminReceiverRating: adminRatingInput,
                      adminReceiverRemark: adminRemarkInput.trim(),
                      adminReceiverRatedAt: nowIso,
                      adminReceiverRatedAtMs: nowMs,
                    });
                  } else {
                    await onUpdateQuery(adminRatingQuery.queryId, {
                      adminSenderRating: adminRatingInput,
                      adminSenderRemark: adminRemarkInput.trim(),
                      adminSenderRatedAt: nowIso,
                      adminSenderRatedAtMs: nowMs,
                    });
                  }

                  setAdminRatingQuery(null);
                }}
              >
                {savingQueryId === adminRatingQuery.queryId ? 'Saving...' : 'Save Admin Rating'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extension Request Modal (for assigned manager) */}
      {extensionModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setExtensionModalQuery(null)}
        >
          <div
            className="modal-dialog extension-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="extension-modal-title">Request Completion Date Extension</h3>
                <span className="modal-sender-badge">
                  Query: <strong>{extensionModalQuery.queryId}</strong> &bull; Sender:{' '}
                  <strong>{extensionModalQuery.accountManagerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setExtensionModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form className="modal-form" onSubmit={handleSubmitExtensionRequest}>
              <div className="extension-modal-note">
                <strong>Peer Accountability:</strong> Your extension request will be sent to{' '}
                <strong>{extensionModalQuery.accountManagerName}</strong> for approval. If approved, the query&apos;s completion deadline will be extended and your completion rate will stay on-time!
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-proposed-date">Proposed New Completion Date &amp; Time *</label>
                <input
                  id="ext-proposed-date"
                  type="datetime-local"
                  value={extensionProposedDateInput}
                  onChange={(e) => {
                    setExtensionProposedDateInput(e.target.value);
                    if (extensionError) setExtensionError('');
                  }}
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-reason">Reason for Extension *</label>
                <textarea
                  id="ext-reason"
                  rows={4}
                  placeholder="Explain why extra time is needed (e.g. Waiting on bank statement, external vendor update, etc.)..."
                  value={extensionReasonInput}
                  onChange={(e) => {
                    setExtensionReasonInput(e.target.value);
                    if (extensionError) setExtensionError('');
                  }}
                  required
                />
                {extensionError && (
                  <span style={{ color: '#dc2626', fontSize: '0.82rem', fontWeight: 600 }}>
                    {extensionError}
                  </span>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setExtensionModalQuery(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={isSubmittingExtension}
                >
                  {isSubmittingExtension ? 'Submitting...' : 'Send Request to Sender'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extension Review Modal (when sender or admin wants to decline or review) */}
      {extensionReviewModalQuery && (
        <div
          className="modal-backdrop"
          onClick={() => setExtensionReviewModalQuery(null)}
        >
          <div
            className="modal-dialog extension-review-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-ext-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="review-ext-modal-title">Review Extension Request</h3>
                <span className="modal-sender-badge">
                  Query: <strong>{extensionReviewModalQuery.queryId}</strong> &bull; From Manager:{' '}
                  <strong>{extensionReviewModalQuery.managerName}</strong>
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setExtensionReviewModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="extension-review-body">
              <div className="review-meta-item">
                <span className="review-meta-label">Proposed New Deadline:</span>
                <span className="review-meta-val highlight">
                  {extensionReviewModalQuery.extensionProposedDueAt || '—'}
                </span>
              </div>

              <div className="review-meta-item">
                <span className="review-meta-label">Manager's Reason:</span>
                <p className="review-reason-box">
                  "{extensionReviewModalQuery.extensionReason || 'No reason provided'}"
                </p>
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-decline-note">Note / Feedback (Optional if declining)</label>
                <input
                  id="ext-decline-note"
                  type="text"
                  placeholder="e.g. Please expedite by tomorrow instead..."
                  value={extensionReviewNoteInput}
                  onChange={(e) => setExtensionReviewNoteInput(e.target.value)}
                />
              </div>

              <div className="modal-actions modal-actions--split">
                <button
                  type="button"
                  className="btn-secondary btn-decline-action"
                  disabled={isReviewingExtension}
                  onClick={() => handleDeclineExtension(extensionReviewModalQuery)}
                >
                  ✕ Decline Request
                </button>
                <button
                  type="button"
                  className="btn-primary btn-approve-action"
                  disabled={isReviewingExtension}
                  onClick={() => handleApproveExtension(extensionReviewModalQuery)}
                >
                  {isReviewingExtension ? 'Processing...' : '✓ Approve Extension'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
