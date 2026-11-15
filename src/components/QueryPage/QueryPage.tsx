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
  getQueryDeadlineMs,
  UserAccount,
  Appointment,
} from '../../types';
import {
  formatFileSize,
  getFileIcon,
  validateAndReadAttachments,
  MAX_FILE_SIZE_LABEL,
  MAX_FILES_PER_UPLOAD,
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
import { fetchQueryAttachmentsFromDb } from '../../lib/supabase';
import {
  calculateReceiverOverallRating,
  calculateSenderOverallRating,
  RECEIVER_RATING_FEATURE_START_MS,
} from '../../lib/ratingUtils';
import { redirectToMainApp } from '../../lib/sso';
import wmdLogo from '../../assets/wmd-logo.jpg';
import './QueryPage.css';

interface QueryPageProps {
  currentUser: UserAccount;
  queries: Query[];
  savingQueryId: string | null;
  appointments?: Appointment[];
  initialFollowupAppointment?: Appointment | null;
  onOpenBookAppointment?: (preselectedQueryId?: string | null, preselectedUserId?: string | null) => void;
  hasMoreQueries?: boolean;
  isAllQueriesLoaded?: boolean;
  onLoadAllQueries?: () => void;
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
  hasMoreQueries = false,
  isAllQueriesLoaded = false,
  onLoadAllQueries,
  onCreateQuery,
  onUpdateQuery,
}) => {
  const senders = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'account_manager' || u.role === 'manager'),
    []
  );

  const managers = useMemo(
    () => AUTHORIZED_USERS.filter((u) => u.role === 'manager'),
    []
  );

  const targetManagersForCreation = useMemo(() => {
    if (currentUser.role === 'manager') {
      const otherManagers = managers.filter((m) => m.id !== currentUser.id);
      return otherManagers.length > 0 ? otherManagers : managers;
    }
    return managers;
  }, [currentUser, managers]);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Header & Collapsible Filter states
  const [showFiltersPanel, setShowFiltersPanel] = useState<boolean>(false);
  const [managerViewType, setManagerViewType] = useState<ManagerViewScope>('ALL');
  const [filterSenderId, setFilterSenderId] = useState<string>('ALL');
  const [filterManagerId, setFilterManagerId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<StatusFilterValue>('ALL');
  const [timestampOrder, setTimestampOrder] = useState<'desc' | 'asc'>('desc');

  // Create modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [isUrgentDraft, setIsUrgentDraft] = useState<boolean>(false);
  const [selectedManagerId, setSelectedManagerId] = useState<string>(targetManagersForCreation[0]?.id || '');
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
      if (errors.length > 0) alert(errors.join('\n\n'));
      if (added.length > 0) setAttachedFiles((prev) => [...prev, ...added]);
    } finally {
      setIsReadingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleFilesAdded(e.target.files);
  };

  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFilesAdded(e.dataTransfer.files);
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
      if (errors.length > 0) alert(errors.join('\n\n'));
      if (added.length > 0) {
        setDetailAttachmentsDraft((prev) => [...prev, ...added]);
        setHasUnsavedDetailChanges(true);
      }
    } finally {
      setIsReadingDetailFiles(false);
      if (detailFileInputRef.current) detailFileInputRef.current.value = '';
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

      await onUpdateQuery(activeViewingQuery.queryId, { ccUsers: newCcUsers });

      setViewingQuery((prev) =>
        prev && prev.queryId === activeViewingQuery.queryId
          ? { ...prev, ccUsers: newCcUsers }
          : prev
      );

      setIsEditingModalCc(false);
      setModalCcSaveSuccess(true);
      setTimeout(() => setModalCcSaveSuccess(false), 3500);

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

  // Manager Remark in-place editing
  const [isEditingModalMgrRemark, setIsEditingModalMgrRemark] = useState<boolean>(false);
  const [modalMgrRemarkTitleDraft, setModalMgrRemarkTitleDraft] = useState<string>('');
  const [modalMgrRemarkDraft, setModalMgrRemarkDraft] = useState<string>('');
  const [modalMgrAttachmentsDraft, setModalMgrAttachmentsDraft] = useState<QueryAttachment[]>([]);
  const [isReadingMgrFiles, setIsReadingMgrFiles] = useState<boolean>(false);
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
      if (errors.length > 0) alert(errors.join('\n\n'));

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
      if (mgrFileInputRef.current) mgrFileInputRef.current.value = '';
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

  // Sender Remark in-place editing
  const [isEditingModalSenderRemark, setIsEditingModalSenderRemark] = useState<boolean>(false);
  const [modalSenderRemarkTitleDraft, setModalSenderRemarkTitleDraft] = useState<string>('');
  const [modalSenderRemarkDraft, setModalSenderRemarkDraft] = useState<string>('');
  const [modalSenderRemarkSaveSuccess, setModalSenderRemarkSaveSuccess] = useState<boolean>(false);

  // Timestamped Remarks Posting
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

  useEffect(() => {
    if (initialFollowupAppointment) {
      setShowCreateModal(true);
      setQueryTitleInput(`Follow-up [${initialFollowupAppointment.id}]: ${initialFollowupAppointment.title}`);
      setQueryInput(
        `Discussion summary from appointment ${initialFollowupAppointment.id} held on ${initialFollowupAppointment.scheduledAt}.\n\nAgenda / Points discussed:\n${initialFollowupAppointment.agenda || 'N/A'}`
      );
      setSelectedAppointmentId(initialFollowupAppointment.id);

      const mgr = managers.find(
        (m) =>
          m.id === initialFollowupAppointment.receiverId ||
          m.id === initialFollowupAppointment.requesterId ||
          (Array.isArray(initialFollowupAppointment.attendees) &&
            initialFollowupAppointment.attendees.some((a) => a.id === m.id))
      );
      if (mgr) setSelectedManagerId(mgr.id);
    }
  }, [initialFollowupAppointment, managers]);

  const handleOpenCreateModal = () => {
    if (targetManagersForCreation.length > 0) {
      setSelectedManagerId(targetManagersForCreation[0].id);
    }
    setSelectedCcUserIds([]);
    setShowCreateModal(true);
  };

  const selectedManagerForCreation = useMemo(() => {
    return managers.find((m) => m.id === selectedManagerId) || null;
  }, [managers, selectedManagerId]);

  const eligibleCcUsersForCreation = useMemo(() => {
    return AUTHORIZED_USERS.filter((u) => u.id !== currentUser.id && u.id !== selectedManagerId);
  }, [currentUser.id, selectedManagerId]);

  const linkableAppointmentsForCreation = useMemo(() => {
    if (!selectedManagerForCreation) return [];
    return appointments.filter(
      (apt) =>
        belongsToAppointment(apt, currentUser) &&
        isUserParticipantInAppointment(apt, selectedManagerForCreation)
    );
  }, [appointments, currentUser, selectedManagerForCreation]);

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

  // Rating modal states
  const [ratingModalQuery, setRatingModalQuery] = useState<Query | null>(null);
  const [ratingInput, setRatingInput] = useState<number>(0);
  const [ratingHover, setRatingHover] = useState<number>(0);
  const [ratingRemarkInput, setRatingRemarkInput] = useState<string>('');
  const [ratingRemarkError, setRatingRemarkError] = useState<string>('');
  const [ratingModalCompleteOnSubmit, setRatingModalCompleteOnSubmit] = useState<boolean>(false);

  const [receiverRatingModalQuery, setReceiverRatingModalQuery] = useState<Query | null>(null);
  const [receiverRatingInput, setReceiverRatingInput] = useState<number>(10);
  const [receiverRatingHover, setReceiverRatingHover] = useState<number>(0);
  const [receiverRatingRemarkInput, setReceiverRatingRemarkInput] = useState<string>('');
  const [receiverRatingRemarkError, setReceiverRatingRemarkError] = useState<string>('');

  const [adminRatingQuery, setAdminRatingQuery] = useState<Query | null>(null);
  const [adminRatingTargetRole, setAdminRatingTargetRole] = useState<'receiver' | 'sender'>('receiver');
  const [adminRatingInput, setAdminRatingInput] = useState<number>(10);
  const [adminRemarkInput, setAdminRemarkInput] = useState<string>('');
  const [adminRemarkError, setAdminRemarkError] = useState<string>('');

  // Mandatory Solution Remark Modal state
  const [remarkModalQuery, setRemarkModalQuery] = useState<Query | null>(null);
  const [mandatoryRemarkTitleDraft, setMandatoryRemarkTitleDraft] = useState<string>('');
  const [mandatoryRemarkDraft, setMandatoryRemarkDraft] = useState<string>('');
  const [mandatoryRemarkAttachmentsDraft, setMandatoryRemarkAttachmentsDraft] = useState<QueryAttachment[]>([]);
  const [isReadingMandatoryFiles, setIsReadingMandatoryFiles] = useState<boolean>(false);
  const [remarkError, setRemarkError] = useState<string>('');
  const mandatoryFileInputRef = useRef<HTMLInputElement | null>(null);

  // Extension Modals
  const [extensionModalQuery, setExtensionModalQuery] = useState<Query | null>(null);
  const [extensionProposedDateInput, setExtensionProposedDateInput] = useState<string>('');
  const [extensionReasonInput, setExtensionReasonInput] = useState<string>('');
  const [extensionError, setExtensionError] = useState<string>('');
  const [isSubmittingExtension, setIsSubmittingExtension] = useState<boolean>(false);

  const [extensionReviewModalQuery, setExtensionReviewModalQuery] = useState<Query | null>(null);
  const [extensionReviewNoteInput, setExtensionReviewNoteInput] = useState<string>('');
  const [isReviewingExtension, setIsReviewingExtension] = useState<boolean>(false);

  const formatTimestamp = (date: Date): string => formatTimestampUtil(date);

  const openExtensionModal = (query: Query) => {
    let initialDateStr = '';
    const existingMs =
      query.extensionProposedDueAtMs && query.extensionProposedDueAtMs > Date.now()
        ? query.extensionProposedDueAtMs
        : query.extensionProposedDueAt
        ? parseDateToMs(query.extensionProposedDueAt)
        : 0;

    if (existingMs > Date.now()) {
      const d = new Date(existingMs);
      initialDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      const defaultDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      defaultDate.setHours(18, 0, 0, 0);
      initialDateStr = `${defaultDate.getFullYear()}-${String(defaultDate.getMonth() + 1).padStart(2, '0')}-${String(
        defaultDate.getDate()
      ).padStart(2, '0')}T${String(defaultDate.getHours()).padStart(2, '0')}:${String(
        defaultDate.getMinutes()
      ).padStart(2, '0')}`;
    }

    setExtensionProposedDateInput(initialDateStr);
    setExtensionReasonInput(query.extensionReason || '');
    setExtensionError('');
    setExtensionModalQuery(query);
  };

  const handleSubmitExtensionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extensionModalQuery) return;
    if (!extensionProposedDateInput) {
      setExtensionError('Please select a new date & time.');
      return;
    }
    const proposedMs = Date.parse(extensionProposedDateInput);
    if (Number.isNaN(proposedMs) || proposedMs <= Date.now()) {
      setExtensionError('Proposed date must be in the future.');
      return;
    }
    const cleanReason = extensionReasonInput.trim();
    if (cleanReason.length < 5) {
      setExtensionError('Please provide a reason (min 5 characters).');
      return;
    }

    const proposedTimestamp = formatDateTime(extensionProposedDateInput.replace('T', ' ') + ':00');
    const nowTimestamp = formatTimestamp(new Date());

    setIsSubmittingExtension(true);
    try {
      const qId = extensionModalQuery.queryId;
      await onUpdateQuery(qId, {
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

      setViewingQuery((prev) =>
        prev && prev.queryId.toUpperCase() === qId.toUpperCase()
          ? {
              ...prev,
              extensionStatus: 'PENDING',
              extensionRequestedAt: nowTimestamp,
              extensionProposedDueAt: proposedTimestamp,
              extensionProposedDueAtMs: proposedMs,
              extensionReason: cleanReason,
            }
          : prev
      );
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
      alert('No proposed extension date specified.');
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
      setViewingQuery((prev) =>
        prev && prev.queryId.toUpperCase() === query.queryId.toUpperCase()
          ? {
              ...prev,
              extensionStatus: 'APPROVED',
              targetDueAt: proposedDueAt,
              targetDueAtMs: proposedDueAtMs,
              extensionReviewedAt: nowTimestamp,
              isDelayed: false,
            }
          : prev
      );
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
      setViewingQuery((prev) =>
        prev && prev.queryId.toUpperCase() === query.queryId.toUpperCase()
          ? {
              ...prev,
              extensionStatus: 'DECLINED',
              extensionReviewNote: reviewNote,
              extensionReviewedAt: nowTimestamp,
            }
          : prev
      );
    } finally {
      setIsReviewingExtension(false);
    }
  };

  const [viewingQuery, setViewingQuery] = useState<Query | null>(null);

  useEffect(() => {
    if (!viewingQuery?.queryId) return;
    const qId = viewingQuery.queryId;
    const hasAtt = Boolean(viewingQuery.attachments && viewingQuery.attachments.length > 0);
    const hasMgrAtt = Boolean(viewingQuery.managerAttachments && viewingQuery.managerAttachments.length > 0);
    if (!hasAtt && !hasMgrAtt) {
      fetchQueryAttachmentsFromDb(qId).then(({ attachments, managerAttachments }) => {
        if (attachments.length > 0 || managerAttachments.length > 0) {
          setViewingQuery((prev) =>
            prev && prev.queryId === qId ? { ...prev, attachments, managerAttachments } : prev
          );
        }
      });
    }
  }, [viewingQuery?.queryId]);

  const activeViewingQuery = useMemo(() => {
    if (!viewingQuery) return null;
    const fromList = queries.find((c) => c.queryId.toUpperCase() === viewingQuery.queryId.toUpperCase());
    if (!fromList) return viewingQuery;
    return {
      ...viewingQuery,
      ...fromList,
      attachments:
        fromList.attachments && fromList.attachments.length > 0
          ? fromList.attachments
          : viewingQuery.attachments || [],
      managerAttachments:
        fromList.managerAttachments && fromList.managerAttachments.length > 0
          ? fromList.managerAttachments
          : viewingQuery.managerAttachments || [],
    };
  }, [queries, viewingQuery]);

  const activeViewingLinkedAppointment = useMemo(() => {
    if (!activeViewingQuery) return null;
    return getLinkedAppointmentForQuery(activeViewingQuery, appointments);
  }, [activeViewingQuery, appointments]);

  const [isLinkingExistingApt, setIsLinkingExistingApt] = useState<boolean>(false);
  const [chosenExistingAptId, setChosenExistingAptId] = useState<string>('');
  const [linkExistingError, setLinkExistingError] = useState<string | null>(null);
  const [isSubmittingLinkApt, setIsSubmittingLinkApt] = useState<boolean>(false);

  const [isEditingModalCc, setIsEditingModalCc] = useState<boolean>(false);
  const [modalCcDraftIds, setModalCcDraftIds] = useState<string[]>([]);
  const [isSavingModalCc, setIsSavingModalCc] = useState<boolean>(false);
  const [modalCcSaveSuccess, setModalCcSaveSuccess] = useState<boolean>(false);

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

  const ccCountForUser = useMemo(() => {
    return queries.filter((c) => isUserCcOnQuery(c, currentUser)).length;
  }, [queries, currentUser]);

  const sortedAndFilteredQueries = useMemo(() => {
    const selectedSenderObj = senders.find((s) => s.id === filterSenderId);
    const selectedMgrObj = managers.find((m) => m.id === filterManagerId);

    const filtered = roleScopedQueries.filter((c) => {
      if (managerViewType !== 'ALL') {
        if (managerViewType === 'RECEIVED' && !belongsToManager(c, currentUser)) return false;
        if (managerViewType === 'SENT' && !belongsToAccountManager(c, currentUser)) return false;
        if (managerViewType === 'CC' && !isUserCcOnQuery(c, currentUser)) return false;
      }

      if (filterSenderId !== 'ALL' && selectedSenderObj && !belongsToAccountManager(c, selectedSenderObj)) {
        return false;
      }

      if (filterManagerId !== 'ALL' && selectedMgrObj && !belongsToManager(c, selectedMgrObj)) {
        return false;
      }

      if (filterStatus !== 'ALL') {
        const done = isQueryDone(c);
        const delayed = isQueryDelayed(c, nowMs);
        const pendingUnder48h = isQueryPending(c, nowMs);

        if (filterStatus === 'Urgent' && !c.isUrgent) return false;
        if (filterStatus === 'Completed' && !done) return false;
        if (filterStatus === 'Pending' && !pendingUnder48h) return false;
        if (filterStatus === 'ExtensionPending' && c.extensionStatus !== 'PENDING') return false;
        if (filterStatus === 'Delayed' && !delayed) return false;
        if (filterStatus === 'Unchecked' && (c.managerDone || c.accountManagerDone)) return false;
        if (filterStatus === 'ManagerDone' && (!c.managerDone || c.accountManagerDone)) return false;
      }

      return true;
    });

    return sortQueriesByStatusAndTimestamp(filtered, timestampOrder);
  }, [
    roleScopedQueries,
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

  const activeFilterCount = [
    managerViewType !== 'ALL',
    filterSenderId !== 'ALL',
    filterManagerId !== 'ALL',
    filterStatus !== 'ALL',
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0 || timestampOrder !== 'desc';

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

    if (!selectedManagerId || !queryTitleInput.trim() || !queryInput.trim() || isSubmittingNew) {
      if (!queryTitleInput.trim()) document.getElementById('query-title-input')?.focus();
      else if (!queryInput.trim()) document.getElementById('write-query')?.focus();
      return;
    }

    const targetManager = managers.find((m) => m.id === selectedManagerId);
    if (!targetManager) return;

    if (selectedAppointmentId) {
      const linkedApt = appointments.find((a) => a.id === selectedAppointmentId);
      if (!linkedApt || !isUserParticipantInAppointment(linkedApt, targetManager)) {
        alert(`Manager ${targetManager.name} must be an attendee in the linked appointment.`);
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
    if (queryTitleInput.trim() && queryInput.trim() && selectedManagerId) {
      handleCreateSubmit(undefined, true);
    } else {
      setIsUrgentDraft((prev) => !prev);
      if (!queryTitleInput.trim()) document.getElementById('query-title-input')?.focus();
      else if (!queryInput.trim()) document.getElementById('write-query')?.focus();
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
    const isAssigned = belongsToManager(item, currentUser);
    if (!isAssigned && currentUser.role !== 'admin') return;

    const nextManagerDone = !item.managerDone;

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
      ...(!nextManagerDone && item.accountManagerDone ? { accountManagerDone: false } : {}),
    });
  };

  const handleConfirmRemarkAndDone = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!remarkModalQuery) return;
    const trimmedTitle = mandatoryRemarkTitleDraft.trim();
    const trimmedDesc = mandatoryRemarkDraft.trim();
    if (!trimmedTitle && !trimmedDesc) {
      setRemarkError('Please enter a solution remark before marking Done.');
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
    const isSender = belongsToAccountManager(item, currentUser);
    if (!isSender && currentUser.role !== 'admin') return;
    if (!item.accountManagerDone && !item.managerDone) return;

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

  const getSenderRoleBadge = (senderId: string) => {
    const userMatch = AUTHORIZED_USERS.find((u) => u.id === senderId);
    if (!userMatch) return null;
    return userMatch.role === 'manager' ? 'Mgr' : userMatch.role === 'account_manager' ? 'AM' : 'Admin';
  };

  const canAddQuery =
    currentUser.role === 'account_manager' ||
    currentUser.role === 'manager' ||
    currentUser.role === 'admin';

  // Reusable status pill renderer for both table rows and detail modal
  const renderStatusPills = (item: Query, interactiveExt = false) => {
    const completed = isQueryDone(item);
    const delayed = isQueryDelayed(item, nowMs);
    const managerOnlyChecked = item.managerDone && !item.accountManagerDone;
    const isSender = belongsToAccountManager(item, currentUser);
    const isAdmin = currentUser.role === 'admin';

    return (
      <div className="td-status-pills-wrap">
        {completed ? (
          <>
            <span className="table-status-pill table-status-pill--completed">Completed</span>
            {item.autoCompletedAt && (
              <span className="table-status-pill table-status-pill--auto" title={`Auto-completed on ${item.autoCompletedAt}`}>
                ⚡ Auto
              </span>
            )}
            {item.adminCompletedAt && (
              <span className="table-status-pill table-status-pill--admin" title={`Admin completed on ${item.adminCompletedAt}`}>
                🛡️ Admin
              </span>
            )}
            {item.isUrgent && <span className="table-status-pill table-status-pill--urgent-tag">Urgent</span>}
            {delayed && <span className="table-status-pill table-status-pill--delayed">Delayed</span>}
          </>
        ) : item.isUrgent ? (
          managerOnlyChecked ? (
            <>
              <span className="table-status-pill table-status-pill--urgent-mgr">🚨 Urgent • Mgr Checked</span>
              {delayed && <span className="table-status-pill table-status-pill--delayed">Delayed</span>}
            </>
          ) : (
            <>
              <span className="table-status-pill table-status-pill--urgent">🚨 Urgent</span>
              {(() => {
                const isOverdue = isUrgentManagerRemarkOverdue(item, nowMs);
                const hasRemark = hasManagerRemark(item);
                if (isOverdue || delayed) {
                  return (
                    <>
                      <span className="table-status-pill table-status-pill--remark-overdue">⚠️ Remark Overdue</span>
                      <span className="table-status-pill table-status-pill--delayed">Delayed</span>
                    </>
                  );
                }
                if (hasRemark) {
                  return <span className="table-status-pill table-status-pill--remark-done">✅ Remark Added</span>;
                }
                const createdMs = getQueryTimestampMs(item);
                const minsLeft = Math.max(1, Math.ceil((60 * 60 * 1000 - (nowMs - createdMs)) / 60000));
                return <span className="table-status-pill table-status-pill--remark-due">⏱️ {minsLeft}m left</span>;
              })()}
            </>
          )
        ) : managerOnlyChecked ? (
          <>
            <span className="table-status-pill table-status-pill--mgr-done">Mgr Checked</span>
            {delayed && <span className="table-status-pill table-status-pill--delayed">Delayed</span>}
          </>
        ) : delayed ? (
          <span className="table-status-pill table-status-pill--delayed">Delayed</span>
        ) : (
          <span className="table-status-pill table-status-pill--pending">Pending</span>
        )}

        {item.extensionStatus === 'PENDING' && (
          <span
            className="table-status-pill table-status-pill--ext-pending"
            onClick={
              interactiveExt
                ? (e) => {
                    e.stopPropagation();
                    if (isSender || isAdmin || currentUser.role === 'account_manager') {
                      setExtensionReviewModalQuery(item);
                    } else {
                      openExtensionModal(item);
                    }
                  }
                : undefined
            }
          >
            ⏳ Ext Req
          </span>
        )}
        {item.extensionStatus === 'APPROVED' && (
          <span className="table-status-pill table-status-pill--ext-approved">✅ Extended</span>
        )}
        {item.extensionStatus === 'DECLINED' && (
          <span className="table-status-pill table-status-pill--ext-declined">❌ Declined</span>
        )}
      </div>
    );
  };

  // Reusable attachment card renderer
  const renderAttachmentCard = (
    att: QueryAttachment,
    canRemove: boolean,
    onRemove: (id: string) => void,
    showDate = false
  ) => (
    <div key={att.id} className="query-attachment-card">
      <div className="query-attachment-card-main">
        <span className="query-attachment-card-icon">{getFileIcon(att.name, att.type)}</span>
        <div className="query-attachment-card-details">
          <div className="query-attachment-card-name" title={att.name}>
            {att.name}
          </div>
          <div className="query-attachment-card-meta">
            <span className="query-attachment-card-size">{formatFileSize(att.size)}</span>
            {showDate && att.uploadedAt && (
              <span className="query-attachment-card-date">&bull; {formatDate(att.uploadedAt)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="query-attachment-card-actions">
        <button
          type="button"
          className="btn-attachment-action btn-attachment-action--view"
          onClick={() => openAttachment(att)}
        >
          👁️ Open
        </button>
        <button
          type="button"
          className="btn-attachment-action btn-attachment-action--download"
          onClick={() => downloadAttachment(att)}
        >
          ⬇️ Save
        </button>
        {canRemove && (
          <button
            type="button"
            className="btn-attachment-action btn-attachment-action--remove"
            onClick={() => onRemove(att.id)}
            aria-label={`Remove ${att.name}`}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="query-page-container">
      {/* Compact, Clean & Responsive Header */}
      <header className="query-page-header">
        <div className="query-header-title-group">
          <h1 className="query-page-title">Queries</h1>
          <span className="query-count-pill">
            {sortedAndFilteredQueries.length} / {roleScopedQueries.length}
          </span>
        </div>

        <div className="query-header-actions">
          {ccCountForUser > 0 && (
            <button
              type="button"
              className={`header-pill-btn ${managerViewType === 'CC' ? 'header-pill-btn--active' : ''}`}
              onClick={() => setManagerViewType((prev) => (prev === 'CC' ? 'ALL' : 'CC'))}
            >
              ✉️ CC ({ccCountForUser})
            </button>
          )}

          <button
            type="button"
            className={`header-pill-btn ${showFiltersPanel || hasActiveFilters ? 'header-pill-btn--active' : ''}`}
            onClick={() => setShowFiltersPanel((prev) => !prev)}
            aria-expanded={showFiltersPanel}
          >
            🔍 Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>

          {canAddQuery && (
            <button type="button" className="header-add-btn" onClick={handleOpenCreateModal}>
              + New Query
            </button>
          )}

          <button
            type="button"
            className="header-company-logo-badge"
            onClick={() => redirectToMainApp()}
            title="Back to WMD Hub"
            aria-label="Back to WMD Hub"
          >
            <img src={wmdLogo} alt="WMD Logo" className="header-company-logo-img" />
          </button>
        </div>

        {/* Collapsible Filter Drawer (prevents header overflow on mobile & laptop) */}
        {showFiltersPanel && (
          <div className="query-filter-drawer">
            {(currentUser.role === 'manager' || currentUser.role === 'account_manager') && (
              <div className="filter-drawer-item">
                <label htmlFor="filter-view-scope">Scope</label>
                <select
                  id="filter-view-scope"
                  value={managerViewType}
                  onChange={(e) => setManagerViewType(e.target.value as ManagerViewScope)}
                >
                  <option value="ALL">All Queries</option>
                  {currentUser.role === 'manager' && <option value="RECEIVED">Assigned to Me</option>}
                  <option value="SENT">Sent by Me</option>
                  <option value="CC">CC&apos;d ({ccCountForUser})</option>
                </select>
              </div>
            )}

            {(currentUser.role === 'manager' || currentUser.role === 'admin') && (
              <div className="filter-drawer-item">
                <label htmlFor="filter-sender">Sender</label>
                <select
                  id="filter-sender"
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

            <div className="filter-drawer-item">
              <label htmlFor="filter-mgr">Manager</label>
              <select
                id="filter-mgr"
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

            <div className="filter-drawer-item">
              <label htmlFor="filter-status">Status</label>
              <select
                id="filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as StatusFilterValue)}
              >
                <option value="ALL">All Statuses</option>
                <option value="Urgent">🚨 Urgent</option>
                <option value="Pending">Pending</option>
                <option value="ExtensionPending">⏳ Extension Req</option>
                <option value="Unchecked">Unchecked</option>
                <option value="ManagerDone">Mgr Checked</option>
                <option value="Delayed">Delayed</option>
                <option value="Completed">Completed</option>
              </select>
            </div>

            <div className="filter-drawer-actions">
              <button
                type="button"
                className="filter-sort-btn"
                onClick={() => setTimestampOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              >
                Sort: {timestampOrder === 'desc' ? 'Newest ↓' : 'Oldest ↑'}
              </button>
              {hasActiveFilters && (
                <button type="button" className="header-reset-btn" onClick={handleResetFilters}>
                  Reset
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content Card (Desktop Table + Mobile Responsive Cards) */}
      <section className="queries-table-card">
        <div className="queries-table-wrapper">
          <table className="queries-table">
            <thead>
              <tr>
                <th
                  className="th-sortable"
                  onClick={() => setTimestampOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                >
                  <span>Date</span>
                  <span className="sort-indicator">{timestampOrder === 'desc' ? '↓' : '↑'}</span>
                </th>
                <th>ID</th>
                <th>From</th>
                <th>Manager</th>
                <th>Query</th>
                <th>Mgr Remark</th>
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
                const managerOnlyChecked = item.managerDone && !item.accountManagerDone;
                const isRowSaving = savingQueryId === item.queryId;

                const isSender = belongsToAccountManager(item, currentUser);
                const isAssignedManager = belongsToManager(item, currentUser);
                const isAdmin = currentUser.role === 'admin';

                const senderCannotCheckYet = !item.managerDone && !item.accountManagerDone;
                const isSenderCheckboxDisabled = !isSender || isRowSaving || senderCannotCheckYet;
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
                  (item.linkedAppointmentId && appointments.some((a) => a.id === item.linkedAppointmentId)
                    ? item.linkedAppointmentId
                    : null);

                const latestMgrRemarkObj = (item.remarks || [])
                  .filter((r) => r.type === 'manager')
                  .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
                  .slice(-1)[0];
                const displayMgrRemarkText =
                  latestMgrRemarkObj?.text || item.managerRemark || item.managerRemarkTitle || '';

                const latestSenderRemarkObj = (item.remarks || [])
                  .filter((r) => r.type === 'sender')
                  .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
                  .slice(-1)[0];
                const displaySenderRemarkText =
                  latestSenderRemarkObj?.text || item.accountManagerRemark || item.accountManagerRemarkTitle || '';

                return (
                  <tr
                    key={item.queryId}
                    className={`${rowStateClass} query-row-clickable`}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('button, input, textarea, select, label, .inline-edit-box')) return;
                      setViewingQuery(item);
                    }}
                  >
                    {/* Date & Due */}
                    <td className="td-timestamp" data-label="Timeline">
                      <div className="timestamp-created">
                        <span className="timestamp-label">Sent:</span> {formatDateTime(item.createdAt)}
                      </div>
                      <div className={`timestamp-due ${item.extensionStatus === 'APPROVED' ? 'timestamp-due--extended' : ''}`}>
                        <span className="timestamp-label">Due:</span>{' '}
                        {item.extensionStatus === 'APPROVED' && item.targetDueAt ? (
                          <span className="due-date-val due-date-val--extended">
                            <strong>{formatDateTime(item.targetDueAt)}</strong>{' '}
                            <span className="ext-badge-mini ext-badge-mini--approved">Ext</span>
                          </span>
                        ) : item.extensionStatus === 'PENDING' && item.extensionProposedDueAt ? (
                          <span className="due-date-val due-date-val--pending">
                            {formatDateTime(item.extensionProposedDueAt)}{' '}
                            <span className="ext-badge-mini ext-badge-mini--pending">Ext Req</span>
                          </span>
                        ) : item.isUrgent ? (
                          <span className="due-date-val due-date-val--urgent">🚨 Immediate</span>
                        ) : (
                          <span className="due-date-val">{formatDateTime(getQueryDeadlineMs(item))}</span>
                        )}
                      </div>
                    </td>

                    {/* Query ID & Badges */}
                    <td className="td-query-id" data-label="Query ID">
                      <div className="query-id-stack">
                        <span
                          className="query-id-badge query-id-badge--clickable"
                          onClick={() => setViewingQuery(item)}
                        >
                          {item.queryId}
                        </span>
                        <div className="query-mini-tags">
                          {isUserCcOnQuery(item, currentUser) ? (
                            <span className="query-cc-tag">CC</span>
                          ) : item.ccUsers && item.ccUsers.length > 0 ? (
                            <span className="query-cc-tag query-cc-tag--other">CC ({item.ccUsers.length})</span>
                          ) : null}
                          {item.isUrgent && (
                            <span className={`query-urgent-tag ${completed ? 'query-urgent-tag--completed' : ''}`}>
                              🚨 URGENT
                            </span>
                          )}
                          {rowLinkedAptId && <span className="query-linked-apt-chip">📅 {rowLinkedAptId}</span>}
                          {item.attachments && item.attachments.length > 0 && (
                            <span
                              className="query-attachment-badge"
                              onClick={(e) => {
                                e.stopPropagation();
                                setViewingQuery(item);
                              }}
                            >
                              📎 {item.attachments.length}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Sender */}
                    <td className="td-person" data-label="From">
                      <div className="person-cell-wrapper">
                        <span>{item.accountManagerName}</span>
                        {senderRoleBadge && (
                          <span className={`person-role-tag person-role-tag--${senderRoleBadge.toLowerCase()}`}>
                            {senderRoleBadge}
                          </span>
                        )}
                        {isSender && <span className="person-self-tag">(You)</span>}
                      </div>
                    </td>

                    {/* Manager */}
                    <td className="td-person" data-label="Manager">
                      <div className="person-cell-wrapper">
                        <span>{item.managerName}</span>
                        {isAssignedManager && <span className="person-self-tag">(You)</span>}
                      </div>
                    </td>

                    {/* Query Title */}
                    <td className="td-query-text" data-label="Query">
                      {isSender && editingQueryTextId === item.queryId ? (
                        <div className="inline-edit-box">
                          <input
                            type="text"
                            className="inline-edit-title-input"
                            value={queryTitleDraft}
                            onChange={(e) => setQueryTitleDraft(e.target.value)}
                            placeholder="Title..."
                          />
                          <textarea
                            rows={2}
                            value={queryTextDraft}
                            onChange={(e) => setQueryTextDraft(e.target.value)}
                            placeholder="Details..."
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
                          {isSender && (
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
                    <td className="td-remark" data-label="Mgr Remark">
                      {isAssignedManager ? (
                        editingMgrRemarkId === item.queryId ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              className="inline-edit-title-input"
                              value={mgrRemarkTitleDraft}
                              onChange={(e) => setMgrRemarkTitleDraft(e.target.value)}
                              placeholder="Title..."
                            />
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
                              className={displayMgrRemarkText ? 'remark-value query-body-text--clickable' : 'remark-placeholder'}
                              onClick={() => setViewingQuery(item)}
                            >
                              {displayMgrRemarkText || '—'}
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
                          className={displayMgrRemarkText ? 'remark-value query-body-text--clickable' : 'remark-placeholder'}
                          onClick={() => setViewingQuery(item)}
                        >
                          {displayMgrRemarkText || '—'}
                        </span>
                      )}
                    </td>

                    {/* Manager Done */}
                    <td className="td-check-cell" data-label="Mgr Done">
                      <label
                        className={`check-button-label ${item.managerDone ? 'check-button-label--checked' : ''} ${
                          !(isAssignedManager && !isRowSaving) ? 'check-button-label--readonly' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.managerDone}
                          disabled={!(isAssignedManager && !isRowSaving)}
                          onChange={() => handleToggleManagerDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    {/* Sender Remark */}
                    <td className="td-remark" data-label="Sender Remark">
                      {isSender ? (
                        editingSenderRemarkId === item.queryId ? (
                          <div className="inline-edit-box">
                            <input
                              type="text"
                              className="inline-edit-title-input"
                              value={senderRemarkTitleDraft}
                              onChange={(e) => setSenderRemarkTitleDraft(e.target.value)}
                              placeholder="Title..."
                            />
                            <textarea
                              rows={2}
                              value={senderRemarkDraft}
                              onChange={(e) => setSenderRemarkDraft(e.target.value)}
                              placeholder="Remark..."
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
                              className={displaySenderRemarkText ? 'remark-value query-body-text--clickable' : 'remark-placeholder'}
                              onClick={() => setViewingQuery(item)}
                            >
                              {displaySenderRemarkText || '—'}
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
                          className={displaySenderRemarkText ? 'remark-value query-body-text--clickable' : 'remark-placeholder'}
                          onClick={() => setViewingQuery(item)}
                        >
                          {displaySenderRemarkText || '—'}
                        </span>
                      )}
                    </td>

                    {/* Sender Done */}
                    <td className="td-check-cell" data-label="Sender Done">
                      <label
                        className={`check-button-label ${item.accountManagerDone ? 'check-button-label--checked' : ''} ${
                          isSenderCheckboxDisabled ? 'check-button-label--readonly' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.accountManagerDone}
                          disabled={isSenderCheckboxDisabled}
                          onChange={() => handleToggleSenderDone(item)}
                        />
                        <span>Done</span>
                      </label>
                    </td>

                    {/* Rating */}
                    <td className="td-rating th-center" data-label="Rating">
                      {isAdmin ? (
                        (() => {
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
                              >
                                <span className="rating-role-prefix rating-role-prefix--rec">Mgr:</span>
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
                              >
                                <span className="rating-role-prefix rating-role-prefix--snd">Snd:</span>
                                <span>⭐ {sndBreakdown.overallRating}/10</span>
                              </button>
                            </div>
                          );
                        })()
                      ) : isSender ? (
                        item.senderReceiverRating || item.rating ? (
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
                          >
                            <span className="rating-stars-gold">⭐</span>
                            <span className="rating-score-num">
                              {item.senderReceiverRating ||
                                (item.rating ? (item.rating <= 5 ? item.rating * 2 : item.rating) : 10)}
                              /10
                            </span>
                          </button>
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
                          >
                            ★ Rate
                          </button>
                        )
                      ) : isAssignedManager ? (
                        (() => {
                          const isPostCutoff = Boolean(
                            (item.createdAtMs && item.createdAtMs > RECEIVER_RATING_FEATURE_START_MS) ||
                              (item.receiverSenderRating !== undefined && item.receiverSenderRating !== null)
                          );
                          if (!isPostCutoff) return <span className="rating-placeholder">—</span>;
                          return item.receiverSenderRating ? (
                            <button
                              type="button"
                              className="rating-badge rating-badge--receiver"
                              onClick={() => {
                                setReceiverRatingModalQuery(item);
                                setReceiverRatingInput(item.receiverSenderRating || 10);
                                setReceiverRatingHover(0);
                                setReceiverRatingRemarkInput(item.receiverSenderRemark || '');
                                setReceiverRatingRemarkError('');
                              }}
                            >
                              ⭐ {item.receiverSenderRating}/10
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-rate-prompt"
                              onClick={() => {
                                setReceiverRatingModalQuery(item);
                                setReceiverRatingInput(10);
                                setReceiverRatingHover(0);
                                setReceiverRatingRemarkInput('');
                                setReceiverRatingRemarkError('');
                              }}
                            >
                              ★ Rate
                            </button>
                          );
                        })()
                      ) : (
                        <span className="rating-placeholder">—</span>
                      )}
                    </td>

                    {/* Status & Extension Action */}
                    <td className="td-status-cell" data-label="Status">
                      {renderStatusPills(item, true)}

                      {item.extensionStatus === 'PENDING' ? (
                        isSender || isAdmin || currentUser.role === 'account_manager' ? (
                          <button
                            type="button"
                            className="table-action-pill-btn table-action-pill-btn--review"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExtensionReviewModalQuery(item);
                            }}
                          >
                            Review Ext
                          </button>
                        ) : isAssignedManager ? (
                          <button
                            type="button"
                            className="table-action-pill-btn table-action-pill-btn--edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              openExtensionModal(item);
                            }}
                          >
                            Edit Ext
                          </button>
                        ) : null
                      ) : !completed && (isAssignedManager || isAdmin) ? (
                        <button
                          type="button"
                          className="table-action-link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openExtensionModal(item);
                          }}
                        >
                          {item.extensionStatus === 'APPROVED'
                            ? '+ Extend'
                            : item.extensionStatus === 'DECLINED'
                            ? '+ Re-request'
                            : '+ Extend'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}

              {sortedAndFilteredQueries.length === 0 && (
                <tr>
                  <td colSpan={11} className="empty-queries-cell">
                    No queries match your current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {hasMoreQueries && !isAllQueriesLoaded && (
            <div className="archive-load-bar">
              <span>Showing {queries.length} recent queries.</span>
              <button type="button" className="archive-load-btn" onClick={onLoadAllQueries}>
                📥 Load All Queries
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ========================================================================
          CREATE NEW QUERY MODAL
         ======================================================================== */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div
            className="modal-dialog query-modal-unified"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-query-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="create-query-modal-title">New Query</h3>
                <span className="modal-sender-badge">
                  From <strong>{currentUser.name}</strong> &bull; 24h standard SLA
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
                  <label htmlFor="select-manager">Assign To (Manager) *</label>
                  <select
                    id="select-manager"
                    value={selectedManagerId}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                    required
                  >
                    {targetManagersForCreation.map((mgr) => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="cp-form-group">
                  <label htmlFor="select-appointment-link">Linked Appointment</label>
                  <select
                    id="select-appointment-link"
                    value={selectedAppointmentId}
                    onChange={(e) => setSelectedAppointmentId(e.target.value)}
                  >
                    <option value="">None</option>
                    {linkableAppointmentsForCreation.map((apt) => (
                      <option key={apt.id} value={apt.id}>
                        [{apt.id}] {apt.title} ({apt.scheduledAt})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* CC Selection */}
              <div className="cp-form-group">
                <label htmlFor="create-cc-select">CC Team Members (View-Only)</label>
                {selectedCcUserIds.length > 0 && (
                  <div className="cc-chips-container">
                    {selectedCcUserIds.map((userId) => {
                      const u = AUTHORIZED_USERS.find((usr) => usr.id === userId);
                      if (!u) return null;
                      return (
                        <span key={userId} className="cc-chip">
                          <span>{u.name}</span>
                          <button
                            type="button"
                            className="cc-chip-remove"
                            onClick={() => setSelectedCcUserIds((prev) => prev.filter((id) => id !== userId))}
                            aria-label={`Remove ${u.name}`}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <select
                  id="create-cc-select"
                  className="cc-user-select"
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !selectedCcUserIds.includes(id)) {
                      setSelectedCcUserIds((prev) => [...prev, id]);
                    }
                  }}
                >
                  <option value="">+ Add CC member...</option>
                  {eligibleCcUsersForCreation
                    .filter((u) => !selectedCcUserIds.includes(u.id))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role === 'manager' ? 'Mgr' : u.role === 'account_manager' ? 'AM' : 'Admin'})
                      </option>
                    ))}
                </select>
              </div>

              <div className="cp-form-group">
                <label htmlFor="query-title-input">Title *</label>
                <input
                  id="query-title-input"
                  type="text"
                  placeholder="Brief summary of the query..."
                  value={queryTitleInput}
                  onChange={(e) => setQueryTitleInput(e.target.value)}
                  required
                />
              </div>

              <div className="cp-form-group">
                <label htmlFor="write-query">Details *</label>
                <textarea
                  id="write-query"
                  rows={4}
                  placeholder="Provide clear context or questions..."
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  required
                />
              </div>

              {/* Attachments */}
              <div className="cp-form-group">
                <div className="attachment-header-row">
                  <label htmlFor="query-attachments-input" className="attachment-label">
                    📎 Attachments
                  </label>
                  <span className="attachment-subtext">
                    {attachedFiles.length}/{MAX_FILES_PER_UPLOAD} &bull; Max {MAX_FILE_SIZE_LABEL}/file
                  </span>
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
                    <span className="attachment-dropzone-cta">
                      {isReadingFiles
                        ? 'Reading files...'
                        : attachedFiles.length >= MAX_FILES_PER_UPLOAD
                        ? `Max ${MAX_FILES_PER_UPLOAD} files reached`
                        : 'Tap or drop files to attach'}
                    </span>
                  </div>
                </div>

                {attachedFiles.length > 0 && (
                  <div className="attached-files-list">
                    {attachedFiles.map((att) => (
                      <div key={att.id} className="attached-file-pill">
                        <span className="attached-file-icon">{getFileIcon(att.name, att.type)}</span>
                        <div className="attached-file-info">
                          <span className="attached-file-name">{att.name}</span>
                          <span className="attached-file-size">{formatFileSize(att.size)}</span>
                        </div>
                        <button
                          type="button"
                          className="attached-file-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveAttachedFile(att.id);
                          }}
                          aria-label={`Remove ${att.name}`}
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
                  <span>🚨</span>
                  <span>
                    <strong>Urgent Mode:</strong> 1-hour manager remark SLA &bull; 10-minute reminder alerts until resolved.
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
                  disabled={isSubmittingNew}
                >
                  🚨 Urgent
                </button>
                <button
                  type="submit"
                  className={`btn-primary ${isUrgentDraft ? 'btn-primary--urgent' : ''}`}
                  disabled={isSubmittingNew || isReadingFiles}
                >
                  {isSubmittingNew ? 'Sending...' : isUrgentDraft ? 'Send Urgent' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================
          MANDATORY SOLUTION REMARK MODAL
         ======================================================================== */}
      {remarkModalQuery && (
        <div className="modal-backdrop" onClick={() => setRemarkModalQuery(null)}>
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
                  Query <strong>{remarkModalQuery.queryId}</strong>
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
              <div className="cp-form-group">
                <label htmlFor="mandatory-remark-title-input">Title *</label>
                <input
                  id="mandatory-remark-title-input"
                  type="text"
                  placeholder="Short resolution summary..."
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
                <label htmlFor="mandatory-remark-input">Resolution Details *</label>
                <textarea
                  id="mandatory-remark-input"
                  rows={4}
                  placeholder="Explain the actions taken to resolve this query..."
                  value={mandatoryRemarkDraft}
                  onChange={(e) => {
                    setMandatoryRemarkDraft(e.target.value);
                    if (remarkError) setRemarkError('');
                  }}
                  required
                />
                {remarkError && <span className="form-error-text">{remarkError}</span>}
              </div>

              <div className="cp-form-group">
                <div className="attachment-header-row">
                  <label htmlFor="mandatory-remark-file-btn">Attachments (Optional)</label>
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
                          { uploadedBy: currentUser.name, uploaderRole: 'manager' }
                        );
                        if (errors.length > 0) alert(errors.join('\n\n'));
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
                    {isReadingMandatoryFiles ? 'Reading...' : '📎 Attach'}
                  </button>
                </div>

                {mandatoryRemarkAttachmentsDraft.length > 0 && (
                  <div className="attached-files-list">
                    {mandatoryRemarkAttachmentsDraft.map((att) => (
                      <div key={att.id} className="attached-file-pill">
                        <span className="attached-file-icon">{getFileIcon(att.name, att.type)}</span>
                        <div className="attached-file-info">
                          <span className="attached-file-name">{att.name}</span>
                          <span className="attached-file-size">{formatFileSize(att.size)}</span>
                        </div>
                        <button
                          type="button"
                          className="attached-file-remove-btn"
                          onClick={() =>
                            setMandatoryRemarkAttachmentsDraft((prev) => prev.filter((a) => a.id !== att.id))
                          }
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setRemarkModalQuery(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save &amp; Mark Done
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================
          VIEW QUERY DETAILS MODAL
         ======================================================================== */}
      {activeViewingQuery && (
        <div className="modal-backdrop" onClick={() => setViewingQuery(null)}>
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
                  <h3 id="view-query-modal-title">Query {activeViewingQuery.queryId}</h3>
                  {renderStatusPills(activeViewingQuery, false)}
                </div>
                <span className="modal-sender-badge">
                  Sent: <strong>{formatDateTime(activeViewingQuery.createdAt)}</strong>
                  {activeViewingQuery.completedAt && (
                    <>
                      {' '}
                      &bull; Done: <strong>{formatDateTime(activeViewingQuery.completedAt)}</strong>
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
              {/* CC View-Only Notice */}
              {(() => {
                const isSender = belongsToAccountManager(activeViewingQuery, currentUser);
                const isAssignedMgr = belongsToManager(activeViewingQuery, currentUser);
                const isCc = isUserCcOnQuery(activeViewingQuery, currentUser);
                if (!(isCc && !isSender && !isAssignedMgr && currentUser.role !== 'admin')) return null;

                return (
                  <div className="query-view-cc-banner">
                    <span>ℹ️</span>
                    <div>
                      <strong>CC&apos;d (View-Only)</strong> &mdash; You can track updates and open attachments.
                    </div>
                  </div>
                );
              })()}

              {/* Awaiting Verification Banner */}
              {activeViewingQuery.managerDone &&
                !activeViewingQuery.accountManagerDone &&
                activeViewingQuery.managerDoneAtMs && (
                  <div className="query-view-grace-banner">
                    <div className="grace-banner-left">
                      <span className="grace-banner-icon">🛡️</span>
                      <div>
                        <div className="grace-banner-title">Awaiting Sender Verification</div>
                        <div className="grace-banner-desc">
                          Resolved by manager on <strong>{formatDateTime(activeViewingQuery.managerDoneAt, false)}</strong>.
                          {isSenderDelayed(activeViewingQuery, nowMs) && (
                            <span className="overdue-inline-alert"> (Due deadline passed)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              {activeViewingQuery.completionNote && (
                <div className="query-view-completion-note-card">
                  <span>ℹ️</span>
                  <span>{activeViewingQuery.completionNote}</span>
                </div>
              )}

              {/* People & CC Metadata */}
              <div className="query-view-meta-grid">
                <div className="query-view-meta-box">
                  <span className="query-view-meta-label">From</span>
                  <div className="person-cell-wrapper">
                    <span className="query-view-meta-value">{activeViewingQuery.accountManagerName}</span>
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
                  <span className="query-view-meta-value">{activeViewingQuery.managerName}</span>
                </div>

                <div className="query-view-meta-box query-view-meta-box--full">
                  <div className="meta-box-header-row">
                    <span className="query-view-meta-label">CC Members</span>
                    {(belongsToAccountManager(activeViewingQuery, currentUser) || currentUser.role === 'admin') &&
                      !isEditingModalCc && (
                        <button
                          type="button"
                          className="btn-meta-edit-cc"
                          onClick={() => {
                            setModalCcDraftIds((activeViewingQuery.ccUsers || []).map((u) => u.id));
                            setIsEditingModalCc(true);
                          }}
                        >
                          {activeViewingQuery.ccUsers && activeViewingQuery.ccUsers.length > 0 ? 'Edit' : '+ Add'}
                        </button>
                      )}
                  </div>

                  {isEditingModalCc ? (
                    <div className="modal-cc-editor">
                      {modalCcDraftIds.length > 0 && (
                        <div className="cc-chips-container">
                          {modalCcDraftIds.map((userId) => {
                            const u = AUTHORIZED_USERS.find((usr) => usr.id === userId);
                            if (!u) return null;
                            return (
                              <span key={userId} className="cc-chip">
                                <span>{u.name}</span>
                                <button
                                  type="button"
                                  className="cc-chip-remove"
                                  onClick={() => setModalCcDraftIds((prev) => prev.filter((id) => id !== userId))}
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
                      >
                        <option value="">+ Select member...</option>
                        {AUTHORIZED_USERS.filter(
                          (u) =>
                            u.id !== activeViewingQuery.accountManagerId &&
                            u.id !== activeViewingQuery.managerId &&
                            !modalCcDraftIds.includes(u.id)
                        ).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <div className="inline-edit-actions" style={{ marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn-inline-save"
                          onClick={handleSaveModalCc}
                          disabled={isSavingModalCc}
                        >
                          {isSavingModalCc ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="btn-inline-cancel"
                          onClick={() => setIsEditingModalCc(false)}
                          disabled={isSavingModalCc}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : activeViewingQuery.ccUsers && activeViewingQuery.ccUsers.length > 0 ? (
                    <div className="cc-view-pills">
                      {activeViewingQuery.ccUsers.map((u) => (
                        <span key={u.id} className="cc-view-pill">
                          {u.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="query-view-meta-empty">None</span>
                  )}

                  {modalCcSaveSuccess && <div className="query-view-save-toast">✅ CC updated</div>}
                </div>
              </div>

              {/* Query Details & Sender Attachments */}
              {(() => {
                const isSenderOrAdmin =
                  belongsToAccountManager(activeViewingQuery, currentUser) || currentUser.role === 'admin';

                return (
                  <>
                    <div className="query-view-section">
                      <div className="query-view-section-header">
                        <span className="query-view-section-label">Query Details</span>
                        {isSenderOrAdmin && (
                          <button
                            type="button"
                            className={`btn-query-edit-action ${isEditingDescription ? 'btn-query-edit-action--active' : ''}`}
                            onClick={() => {
                              setIsEditingDescription((prev) => !prev);
                              if (!isEditingDescription) setHasUnsavedDetailChanges(true);
                            }}
                          >
                            {isEditingDescription ? 'Done' : '✏️ Edit'}
                          </button>
                        )}
                      </div>
                      <div className="query-view-content-box">
                        {isEditingDescription ? (
                          <div className="query-view-edit-block">
                            <input
                              id="detail-title-input"
                              type="text"
                              className="inline-edit-title-input"
                              value={detailTitleDraft}
                              onChange={(e) => {
                                setDetailTitleDraft(e.target.value);
                                setHasUnsavedDetailChanges(true);
                              }}
                              placeholder="Title..."
                            />
                            <textarea
                              id="detail-desc-input"
                              rows={5}
                              className="inline-edit-desc-textarea"
                              style={{ marginTop: '0.5rem' }}
                              value={detailDescDraft}
                              onChange={(e) => {
                                setDetailDescDraft(e.target.value);
                                setHasUnsavedDetailChanges(true);
                              }}
                              placeholder="Description..."
                            />
                          </div>
                        ) : (
                          <>
                            <div className="query-view-item-title">
                              {activeViewingQuery.queryTitle || activeViewingQuery.queryText}
                            </div>
                            <div className="query-view-field-block--desc query-view-item-desc">
                              {activeViewingQuery.queryText || '—'}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Attachments */}
                    <div className="query-view-section">
                      <div className="query-view-section-header">
                        <span className="query-view-section-label">
                          Attachments ({detailAttachmentsDraft.length}/{MAX_FILES_PER_UPLOAD})
                        </span>
                        {isSenderOrAdmin && (
                          <>
                            <input
                              ref={detailFileInputRef}
                              type="file"
                              multiple
                              style={{ display: 'none' }}
                              onChange={handleDetailFilesSelected}
                            />
                            <button
                              type="button"
                              className="btn-query-edit-action"
                              onClick={() => detailFileInputRef.current?.click()}
                              disabled={isReadingDetailFiles || detailAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD}
                            >
                              {isReadingDetailFiles ? 'Reading...' : '📎 Add'}
                            </button>
                          </>
                        )}
                      </div>

                      {detailAttachmentsDraft.length > 0 ? (
                        <div className="query-view-attachments-grid">
                          {detailAttachmentsDraft.map((att) =>
                            renderAttachmentCard(att, isSenderOrAdmin, handleRemoveDetailAttachment, true)
                          )}
                        </div>
                      ) : (
                        <div className="query-view-empty-box">No attachments.</div>
                      )}
                    </div>

                    {isSenderOrAdmin && (hasUnsavedDetailChanges || isEditingDescription) && (
                      <div className="query-view-save-bar">
                        <span className="query-view-save-info">Original creation time &amp; deadline remain unchanged.</span>
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
                            className="btn-save-changes-highlight"
                            onClick={handleSaveDetailChanges}
                            disabled={isSavingDetailChanges || isReadingDetailFiles}
                          >
                            {isSavingDetailChanges ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    )}

                    {detailSaveSuccess && <div className="query-view-save-toast">✅ Changes saved</div>}
                  </>
                );
              })()}

              {/* Linked Appointment Card */}
              {(activeViewingLinkedAppointment || activeViewingQuery.linkedAppointmentId) && (
                <div className="query-view-section">
                  <span className="query-view-section-label">Linked Appointment</span>
                  <div className="linked-apt-card">
                    {activeViewingLinkedAppointment ? (
                      <>
                        <div className="linked-apt-header">
                          <div>
                            <span className="apt-id-pill">📅 {activeViewingLinkedAppointment.id}</span>{' '}
                            <strong>{activeViewingLinkedAppointment.title}</strong>
                          </div>
                          <button
                            type="button"
                            className="btn-inline-cancel"
                            onClick={async () => {
                              if (
                                window.confirm(
                                  `Unlink appointment ${activeViewingLinkedAppointment.id} from query ${activeViewingQuery.queryId}?`
                                )
                              ) {
                                await onUpdateQuery(activeViewingQuery.queryId, { linkedAppointmentId: null });
                              }
                            }}
                          >
                            Unlink
                          </button>
                        </div>
                        <div className="linked-apt-meta">
                          <span>
                            <strong>When:</strong> {activeViewingLinkedAppointment.scheduledAt}
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
                      </>
                    ) : (
                      <span>📅 Appointment {activeViewingQuery.linkedAppointmentId}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Target Completion & Extension Section */}
              <div className="query-view-section query-view-section--extension">
                <div className="query-view-section-header">
                  <span className="query-view-section-label">Deadline</span>
                  <span className="query-view-due-text">
                    {activeViewingQuery.extensionStatus === 'APPROVED' && activeViewingQuery.targetDueAt ? (
                      <>
                        <strong>{formatDateTime(activeViewingQuery.targetDueAt)}</strong>{' '}
                        <span className="pill-extended-badge">Extended</span>
                      </>
                    ) : activeViewingQuery.extensionStatus === 'PENDING' && activeViewingQuery.extensionProposedDueAt ? (
                      <>
                        <span>{formatDateTime(getQueryDeadlineMs(activeViewingQuery))}</span> &rarr;{' '}
                        <strong>{formatDateTime(activeViewingQuery.extensionProposedDueAt)}</strong>
                      </>
                    ) : activeViewingQuery.isUrgent ? (
                      <span className="pill-urgent-badge-strong">🚨 Immediate (1h Remark SLA)</span>
                    ) : activeViewingQuery.targetDueAt ? (
                      <strong>{formatDateTime(activeViewingQuery.targetDueAt)}</strong>
                    ) : (
                      <>{formatDateTime(getQueryDeadlineMs(activeViewingQuery))}</>
                    )}
                  </span>
                </div>

                {activeViewingQuery.extensionStatus === 'PENDING' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--pending">
                    <div className="ext-banner-top">
                      <strong>⏳ Extension Requested</strong>
                      <span className="ext-proposed-pill">
                        New: {formatDateTime(activeViewingQuery.extensionProposedDueAt) || '—'}
                      </span>
                    </div>
                    <p className="ext-banner-reason">{activeViewingQuery.extensionReason || '—'}</p>
                    <div className="ext-banner-actions">
                      {(belongsToAccountManager(activeViewingQuery, currentUser) ||
                        currentUser.role === 'admin' ||
                        currentUser.role === 'account_manager') && (
                        <>
                          <button
                            type="button"
                            className="btn-approve-ext"
                            onClick={() => handleApproveExtension(activeViewingQuery)}
                            disabled={isReviewingExtension}
                          >
                            ✓ Approve
                          </button>
                          <button
                            type="button"
                            className="btn-decline-ext"
                            onClick={() => setExtensionReviewModalQuery(activeViewingQuery)}
                            disabled={isReviewingExtension}
                          >
                            ✕ Decline
                          </button>
                        </>
                      )}
                      {(belongsToManager(activeViewingQuery, currentUser) || currentUser.role === 'admin') && (
                        <button
                          type="button"
                          className="btn-request-ext"
                          onClick={() => openExtensionModal(activeViewingQuery)}
                        >
                          Edit Request
                        </button>
                      )}
                    </div>
                  </div>
                ) : activeViewingQuery.extensionStatus === 'APPROVED' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--approved">
                    <span>
                      ✅ <strong>Approved:</strong> Extended to{' '}
                      <strong>{formatDateTime(activeViewingQuery.targetDueAt)}</strong>
                    </span>
                    {!isQueryDone(activeViewingQuery) &&
                      (belongsToManager(activeViewingQuery, currentUser) || currentUser.role === 'admin') && (
                        <button
                          type="button"
                          className="btn-request-ext"
                          onClick={() => openExtensionModal(activeViewingQuery)}
                        >
                          Extend Further
                        </button>
                      )}
                  </div>
                ) : activeViewingQuery.extensionStatus === 'DECLINED' ? (
                  <div className="query-view-ext-banner query-view-ext-banner--declined">
                    <span>
                      ❌ <strong>Declined:</strong> {activeViewingQuery.extensionReviewNote || 'No note provided'}
                    </span>
                    {!isQueryDone(activeViewingQuery) &&
                      (belongsToManager(activeViewingQuery, currentUser) || currentUser.role === 'admin') && (
                        <button
                          type="button"
                          className="btn-request-ext"
                          onClick={() => openExtensionModal(activeViewingQuery)}
                        >
                          Re-request
                        </button>
                      )}
                  </div>
                ) : (
                  !isQueryDone(activeViewingQuery) &&
                  (belongsToManager(activeViewingQuery, currentUser) || currentUser.role === 'admin') && (
                    <div className="ext-request-btn-row">
                      <button
                        type="button"
                        className="btn-request-ext"
                        onClick={() => openExtensionModal(activeViewingQuery)}
                      >
                        ⏳ Request Extension
                      </button>
                    </div>
                  )
                )}
              </div>

              {/* Remarks Grid (Manager & Sender) */}
              <div className="query-view-remarks-grid">
                {/* Manager Remarks */}
                {(() => {
                  const isAssignedManagerOrAdmin =
                    belongsToManager(activeViewingQuery, currentUser) || currentUser.role === 'admin';
                  const mgrRemarks = [...(activeViewingQuery.remarks || [])]
                    .filter((r) => r.type === 'manager')
                    .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

                  return (
                    <div className="query-view-section query-view-section--card">
                      <div className="query-view-section-header">
                        <div className="person-cell-wrapper">
                          <span className="query-view-section-label">Manager Remarks</span>
                          {isAssignedManagerOrAdmin && (
                            <>
                              <input
                                ref={mgrFileInputRef}
                                type="file"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleMgrFilesSelected}
                              />
                              <button
                                type="button"
                                className="btn-query-edit-action"
                                onClick={() => mgrFileInputRef.current?.click()}
                                disabled={isReadingMgrFiles || modalMgrAttachmentsDraft.length >= MAX_FILES_PER_UPLOAD}
                              >
                                {isReadingMgrFiles ? 'Reading...' : '📎 Attach'}
                              </button>
                            </>
                          )}
                        </div>
                        <span
                          className={`query-view-check-tag ${
                            activeViewingQuery.managerDone ? 'query-view-check-tag--done' : ''
                          }`}
                        >
                          {activeViewingQuery.managerDone ? '✓ Done' : 'Pending'}
                        </span>
                      </div>

                      <div className="remark-timeline">
                        {mgrRemarks.length > 0 ? (
                          mgrRemarks.map((rmk, idx) => {
                            const isLatest = idx === mgrRemarks.length - 1;
                            const displayText = (rmk.text || rmk.title || '—').trim();
                            const displayTitle =
                              rmk.title && rmk.title.trim() !== displayText ? rmk.title.trim() : null;
                            return (
                              <div
                                key={rmk.id || idx}
                                className={`remark-timeline-item ${isLatest ? 'remark-timeline-item--latest' : ''}`}
                              >
                                <div className="remark-timeline-header">
                                  <span className="remark-author-name">{rmk.authorName}</span>
                                  <span className="remark-timestamp">{rmk.createdAt}</span>
                                </div>
                                {displayTitle && <div className="remark-title">{displayTitle}</div>}
                                <div className="remark-text">{displayText}</div>
                              </div>
                            );
                          })
                        ) : activeViewingQuery.managerRemarkTitle || activeViewingQuery.managerRemark ? (
                          <div className="remark-timeline-item remark-timeline-item--latest">
                            <div className="remark-timeline-header">
                              <span className="remark-author-name">{activeViewingQuery.managerName}</span>
                              <span className="remark-timestamp">
                                {activeViewingQuery.managerDoneAt || activeViewingQuery.createdAt}
                              </span>
                            </div>
                            <div className="remark-text">
                              {activeViewingQuery.managerRemark || activeViewingQuery.managerRemarkTitle}
                            </div>
                          </div>
                        ) : (
                          <div className="remark-timeline-empty">No remarks yet.</div>
                        )}
                      </div>

                      {modalMgrAttachmentsDraft.length > 0 && (
                        <div className="query-view-attachments-grid" style={{ marginTop: '0.5rem' }}>
                          {modalMgrAttachmentsDraft.map((att) =>
                            renderAttachmentCard(att, isAssignedManagerOrAdmin, handleRemoveMgrAttachment, false)
                          )}
                        </div>
                      )}

                      {isAssignedManagerOrAdmin && (
                        <div className="remark-add-box">
                          <input
                            type="text"
                            className="remark-add-title-input"
                            value={newMgrRemarkTitle}
                            onChange={(e) => setNewMgrRemarkTitle(e.target.value)}
                            placeholder="Title (optional)..."
                          />
                          <textarea
                            className="remark-add-textarea"
                            rows={2}
                            value={newMgrRemarkText}
                            onChange={(e) => setNewMgrRemarkText(e.target.value)}
                            placeholder="Write a manager remark..."
                          />
                          <div className="remark-add-footer">
                            <button
                              type="button"
                              className="btn-post-remark"
                              onClick={handlePostManagerRemark}
                              disabled={isPostingMgrRemark || !newMgrRemarkText.trim()}
                            >
                              {isPostingMgrRemark ? 'Posting...' : 'Post Remark'}
                            </button>
                          </div>
                        </div>
                      )}

                      {modalMgrRemarkSaveSuccess && <div className="query-view-save-toast">✅ Remark posted</div>}
                    </div>
                  );
                })()}

                {/* Sender Remarks */}
                {(() => {
                  const isSenderOrAdmin =
                    belongsToAccountManager(activeViewingQuery, currentUser) || currentUser.role === 'admin';
                  const senderRemarks = [...(activeViewingQuery.remarks || [])]
                    .filter((r) => r.type === 'sender')
                    .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

                  return (
                    <div className="query-view-section query-view-section--card">
                      <div className="query-view-section-header">
                        <span className="query-view-section-label">Sender Remarks</span>
                        <span
                          className={`query-view-check-tag ${
                            activeViewingQuery.accountManagerDone ? 'query-view-check-tag--done' : ''
                          }`}
                        >
                          {activeViewingQuery.accountManagerDone ? '✓ Verified' : 'Pending'}
                        </span>
                      </div>

                      <div className="remark-timeline">
                        {senderRemarks.length > 0 ? (
                          senderRemarks.map((rmk, idx) => {
                            const isLatest = idx === senderRemarks.length - 1;
                            const displayText = (rmk.text || rmk.title || '—').trim();
                            const displayTitle =
                              rmk.title && rmk.title.trim() !== displayText ? rmk.title.trim() : null;
                            return (
                              <div
                                key={rmk.id || idx}
                                className={`remark-timeline-item ${isLatest ? 'remark-timeline-item--latest' : ''}`}
                              >
                                <div className="remark-timeline-header">
                                  <span className="remark-author-name">{rmk.authorName}</span>
                                  <span className="remark-timestamp">{rmk.createdAt}</span>
                                </div>
                                {displayTitle && <div className="remark-title">{displayTitle}</div>}
                                <div className="remark-text">{displayText}</div>
                              </div>
                            );
                          })
                        ) : activeViewingQuery.accountManagerRemarkTitle || activeViewingQuery.accountManagerRemark ? (
                          <div className="remark-timeline-item remark-timeline-item--latest">
                            <div className="remark-timeline-header">
                              <span className="remark-author-name">{activeViewingQuery.accountManagerName}</span>
                              <span className="remark-timestamp">
                                {activeViewingQuery.completedAt || activeViewingQuery.createdAt}
                              </span>
                            </div>
                            <div className="remark-text">
                              {activeViewingQuery.accountManagerRemark || activeViewingQuery.accountManagerRemarkTitle}
                            </div>
                          </div>
                        ) : (
                          <div className="remark-timeline-empty">No remarks yet.</div>
                        )}
                      </div>

                      {isSenderOrAdmin && (
                        <div className="remark-add-box">
                          <input
                            type="text"
                            className="remark-add-title-input"
                            value={newSenderRemarkTitle}
                            onChange={(e) => setNewSenderRemarkTitle(e.target.value)}
                            placeholder="Title (optional)..."
                          />
                          <textarea
                            className="remark-add-textarea"
                            rows={2}
                            value={newSenderRemarkText}
                            onChange={(e) => setNewSenderRemarkText(e.target.value)}
                            placeholder="Write feedback or follow-up..."
                          />
                          <div className="remark-add-footer">
                            <button
                              type="button"
                              className="btn-post-remark"
                              onClick={handlePostSenderRemark}
                              disabled={isPostingSenderRemark || !newSenderRemarkText.trim()}
                            >
                              {isPostingSenderRemark ? 'Posting...' : 'Post Remark'}
                            </button>
                          </div>
                        </div>
                      )}

                      {modalSenderRemarkSaveSuccess && <div className="query-view-save-toast">✅ Remark posted</div>}
                    </div>
                  );
                })()}
              </div>

              {/* Ratings Section */}
              {(currentUser.role === 'admin' || currentUser.id === activeViewingQuery.accountManagerId) && (
                <div className="query-view-rating-card">
                  <div className="query-view-rating-prompt">
                    <div>
                      <span className="query-view-meta-label">
                        Manager Rating ({activeViewingQuery.managerName})
                      </span>
                      {activeViewingQuery.senderReceiverRating || activeViewingQuery.rating ? (
                        <div className="query-view-rating-value">
                          ⭐{' '}
                          {activeViewingQuery.senderReceiverRating ||
                            (activeViewingQuery.rating
                              ? activeViewingQuery.rating <= 5
                                ? activeViewingQuery.rating * 2
                                : activeViewingQuery.rating
                              : 10)}
                          /10
                          {activeViewingQuery.senderReceiverRemark && (
                            <span className="rating-quote"> &mdash; &ldquo;{activeViewingQuery.senderReceiverRemark}&rdquo;</span>
                          )}
                        </div>
                      ) : (
                        <div className="rating-pending-text">Not rated yet</div>
                      )}
                    </div>
                    {(currentUser.id === activeViewingQuery.accountManagerId || currentUser.role === 'admin') && (
                      <button
                        type="button"
                        className="btn-rate-prompt"
                        onClick={() => {
                          const currentRating =
                            activeViewingQuery.senderReceiverRating ||
                            (activeViewingQuery.rating
                              ? activeViewingQuery.rating <= 5
                                ? activeViewingQuery.rating * 2
                                : activeViewingQuery.rating
                              : 10);
                          setRatingModalQuery(activeViewingQuery);
                          setRatingInput(currentRating);
                          setRatingHover(0);
                          setRatingRemarkInput(activeViewingQuery.senderReceiverRemark || '');
                          setRatingRemarkError('');
                          setRatingModalCompleteOnSubmit(false);
                        }}
                      >
                        {activeViewingQuery.senderReceiverRating || activeViewingQuery.rating ? 'Update' : '★ Rate'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {(currentUser.role === 'admin' || currentUser.id === activeViewingQuery.managerId) &&
                (() => {
                  const isPostCutoff = Boolean(
                    (activeViewingQuery.createdAtMs && activeViewingQuery.createdAtMs > RECEIVER_RATING_FEATURE_START_MS) ||
                      (activeViewingQuery.receiverSenderRating !== undefined &&
                        activeViewingQuery.receiverSenderRating !== null)
                  );
                  if (!isPostCutoff && currentUser.role !== 'admin') return null;

                  return (
                    <div className="query-view-rating-card">
                      <div className="query-view-rating-prompt">
                        <div>
                          <span className="query-view-meta-label">
                            Sender Rating ({activeViewingQuery.accountManagerName})
                          </span>
                          {activeViewingQuery.receiverSenderRating ? (
                            <div className="query-view-rating-value">
                              ⭐ {activeViewingQuery.receiverSenderRating}/10
                              {activeViewingQuery.receiverSenderRemark && (
                                <span className="rating-quote">
                                  {' '}
                                  &mdash; &ldquo;{activeViewingQuery.receiverSenderRemark}&rdquo;
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="rating-pending-text">Not rated yet</div>
                          )}
                        </div>
                        {(currentUser.id === activeViewingQuery.managerId || currentUser.role === 'admin') && (
                          <button
                            type="button"
                            className="btn-rate-prompt"
                            onClick={() => {
                              setReceiverRatingModalQuery(activeViewingQuery);
                              setReceiverRatingInput(activeViewingQuery.receiverSenderRating || 10);
                              setReceiverRatingHover(0);
                              setReceiverRatingRemarkInput(activeViewingQuery.receiverSenderRemark || '');
                              setReceiverRatingRemarkError('');
                            }}
                          >
                            {activeViewingQuery.receiverSenderRating ? 'Update' : '★ Rate'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* Link Existing Appointment Inline Panel */}
              {!activeViewingLinkedAppointment &&
                !activeViewingQuery.linkedAppointmentId &&
                isLinkingExistingApt && (
                  <div className="link-apt-inline-box">
                    <div className="meta-box-header-row">
                      <span className="query-view-section-label">
                        Link Appointment with {activeViewingQuery.managerName}
                      </span>
                      <button
                        type="button"
                        className="btn-inline-cancel"
                        onClick={() => {
                          setIsLinkingExistingApt(false);
                          setLinkExistingError(null);
                        }}
                      >
                        ✕
                      </button>
                    </div>

                    {linkableAppointmentsForActiveQuery.length === 0 ? (
                      <div className="form-error-text">No eligible appointments found.</div>
                    ) : (
                      <div className="link-apt-controls">
                        <select
                          className="cc-user-select"
                          value={chosenExistingAptId}
                          onChange={(e) => {
                            setChosenExistingAptId(e.target.value);
                            setLinkExistingError(null);
                          }}
                        >
                          <option value="">-- Select appointment --</option>
                          {linkableAppointmentsForActiveQuery.map((apt) => (
                            <option key={apt.id} value={apt.id}>
                              [{apt.id}] {apt.title} ({apt.scheduledAt})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn-primary"
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
                              setLinkExistingError('Selected appointment must include the assigned manager.');
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
                          {isSubmittingLinkApt ? 'Linking...' : 'Link'}
                        </button>
                      </div>
                    )}
                    {linkExistingError && <div className="form-error-text">{linkExistingError}</div>}
                  </div>
                )}

              {/* Modal Footer Actions */}
              <div className="modal-actions">
                {(() => {
                  const isParticipant =
                    currentUser.id === activeViewingQuery.accountManagerId ||
                    currentUser.id === activeViewingQuery.managerId ||
                    currentUser.role === 'admin';

                  if (!isParticipant) return null;

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
                            🔗 Link Appointment
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
                                currentUser.id === q.accountManagerId ? q.managerId : q.accountManagerId;
                              onOpenBookAppointment(q.queryId, targetUserId);
                            }}
                          >
                            📅 Book Meeting
                          </button>
                        )}
                    </>
                  );
                })()}
                <button type="button" className="btn-primary" onClick={() => setViewingQuery(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          SENDER RATING MODAL
         ======================================================================== */}
      {ratingModalQuery && (
        <div className="modal-backdrop" onClick={() => setRatingModalQuery(null)}>
          <div
            className="modal-dialog rating-prompt-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rating-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="rating-modal-title">Rate {ratingModalQuery.managerName}</h3>
                <span className="modal-sender-badge">Query {ratingModalQuery.queryId}</span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRatingModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="rating-modal-body">
              <p className="rating-modal-desc">
                {ratingModalCompleteOnSubmit
                  ? 'Rate the manager’s resolution to complete this query (anonymous to manager).'
                  : 'Rate the manager’s response quality (anonymous to manager).'}
              </p>

              <div className="star-rating-picker-10" role="radiogroup" aria-label="Rating from 1 to 10 stars">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-pick-btn-10 ${(ratingHover || ratingInput) >= star ? 'star-pick-btn-10--active' : ''}`}
                    onMouseEnter={() => setRatingHover(star)}
                    onMouseLeave={() => setRatingHover(0)}
                    onClick={() => setRatingInput(star)}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="rating-score-label">
                {ratingInput > 0 ? (
                  <span className="rating-score-active">⭐ {ratingInput} / 10</span>
                ) : (
                  <span className="rating-score-hint">Tap a star (1–10)</span>
                )}
              </div>

              <div className="cp-form-group">
                <label>Feedback Remark *</label>
                <textarea
                  rows={3}
                  placeholder="Share brief feedback on resolution..."
                  value={ratingRemarkInput}
                  onChange={(e) => {
                    setRatingRemarkInput(e.target.value);
                    if (ratingRemarkError) setRatingRemarkError('');
                  }}
                />
                {ratingRemarkError && <span className="form-error-text">{ratingRemarkError}</span>}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setRatingModalQuery(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={ratingInput < 1 || savingQueryId === ratingModalQuery.queryId}
                  onClick={async () => {
                    if (ratingInput < 1) return;
                    if (!ratingRemarkInput.trim()) {
                      setRatingRemarkError('Please enter a feedback remark.');
                      return;
                    }

                    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
                    const nowMsVal = Date.now();

                    const updatesToSave: Record<string, unknown> = {
                      senderReceiverRating: ratingInput,
                      senderReceiverRemark: ratingRemarkInput.trim(),
                      senderReceiverRatedAt: nowIso,
                      senderReceiverRatedAtMs: nowMsVal,
                      rating: ratingInput,
                    };

                    if (ratingModalCompleteOnSubmit) {
                      updatesToSave.accountManagerDone = true;
                    }

                    await onUpdateQuery(ratingModalQuery.queryId, updatesToSave);
                    setRatingModalQuery(null);
                  }}
                >
                  {ratingModalCompleteOnSubmit ? 'Submit & Complete' : 'Save Rating'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          RECEIVER RATING MODAL
         ======================================================================== */}
      {receiverRatingModalQuery && (
        <div className="modal-backdrop" onClick={() => setReceiverRatingModalQuery(null)}>
          <div
            className="modal-dialog rating-prompt-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="receiver-rating-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="receiver-rating-modal-title">Rate {receiverRatingModalQuery.accountManagerName}</h3>
                <span className="modal-sender-badge">Query {receiverRatingModalQuery.queryId}</span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setReceiverRatingModalQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="rating-modal-body">
              <p className="rating-modal-desc">Rate the clarity and responsiveness of the sender.</p>

              <div className="star-rating-picker-10" role="radiogroup" aria-label="Rating from 1 to 10 stars">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`star-pick-btn-10 ${
                      (receiverRatingHover || receiverRatingInput) >= star ? 'star-pick-btn-10--active' : ''
                    }`}
                    onMouseEnter={() => setReceiverRatingHover(star)}
                    onMouseLeave={() => setReceiverRatingHover(0)}
                    onClick={() => setReceiverRatingInput(star)}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="rating-score-label">
                {receiverRatingInput > 0 ? (
                  <span className="rating-score-active">⭐ {receiverRatingInput} / 10</span>
                ) : (
                  <span className="rating-score-hint">Tap a star (1–10)</span>
                )}
              </div>

              <div className="cp-form-group">
                <label>Feedback Remark *</label>
                <textarea
                  rows={3}
                  placeholder="Share brief feedback on communication..."
                  value={receiverRatingRemarkInput}
                  onChange={(e) => {
                    setReceiverRatingRemarkInput(e.target.value);
                    if (receiverRatingRemarkError) setReceiverRatingRemarkError('');
                  }}
                />
                {receiverRatingRemarkError && <span className="form-error-text">{receiverRatingRemarkError}</span>}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setReceiverRatingModalQuery(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={receiverRatingInput < 1 || savingQueryId === receiverRatingModalQuery.queryId}
                  onClick={async () => {
                    if (receiverRatingInput < 1) return;
                    if (!receiverRatingRemarkInput.trim()) {
                      setReceiverRatingRemarkError('Please enter a feedback remark.');
                      return;
                    }

                    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
                    const nowMsVal = Date.now();

                    await onUpdateQuery(receiverRatingModalQuery.queryId, {
                      receiverSenderRating: receiverRatingInput,
                      receiverSenderRemark: receiverRatingRemarkInput.trim(),
                      receiverSenderRatedAt: nowIso,
                      receiverSenderRatedAtMs: nowMsVal,
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

      {/* ========================================================================
          ADMIN RATING MODAL
         ======================================================================== */}
      {adminRatingQuery && (
        <div className="modal-backdrop" onClick={() => setAdminRatingQuery(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div className="modal-header-text">
                <h3>Admin Rating &bull; {adminRatingQuery.queryId}</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setAdminRatingQuery(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-form">
              <div className="admin-role-tabs">
                <button
                  type="button"
                  className={`admin-role-tab ${adminRatingTargetRole === 'receiver' ? 'admin-role-tab--active' : ''}`}
                  onClick={() => {
                    setAdminRatingTargetRole('receiver');
                    setAdminRatingInput(adminRatingQuery.adminReceiverRating ?? 10);
                    setAdminRemarkInput(adminRatingQuery.adminReceiverRemark || 'Proper turnaround and response');
                    setAdminRemarkError('');
                  }}
                >
                  Manager ({adminRatingQuery.managerName})
                </button>
                <button
                  type="button"
                  className={`admin-role-tab ${adminRatingTargetRole === 'sender' ? 'admin-role-tab--active' : ''}`}
                  onClick={() => {
                    setAdminRatingTargetRole('sender');
                    setAdminRatingInput(adminRatingQuery.adminSenderRating ?? 10);
                    setAdminRemarkInput(adminRatingQuery.adminSenderRemark || 'Prompt responses to queries and requests');
                    setAdminRemarkError('');
                  }}
                >
                  Sender ({adminRatingQuery.accountManagerName})
                </button>
              </div>

              <div className="admin-sys-score-box">
                {adminRatingTargetRole === 'receiver' ? (
                  <>
                    <strong>System Score:</strong> ⭐ {calculateReceiverOverallRating(adminRatingQuery).systemRating}/10 (
                    {calculateReceiverOverallRating(adminRatingQuery).systemReason})
                  </>
                ) : (
                  <>
                    <strong>System Score:</strong> ⭐ {calculateSenderOverallRating(adminRatingQuery).systemRating}/10 (
                    {calculateSenderOverallRating(adminRatingQuery).systemReason})
                  </>
                )}
              </div>

              <div>
                <div className="star-rating-picker-10">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={`star-pick-btn-10 ${adminRatingInput >= star ? 'star-pick-btn-10--active' : ''}`}
                      onClick={() => setAdminRatingInput(star)}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <div className="rating-score-label">
                  <span className="rating-score-active">⭐ {adminRatingInput} / 10</span>
                </div>
              </div>

              <div className="cp-form-group">
                <label>Admin Remark *</label>
                <textarea
                  rows={3}
                  placeholder="Enter admin evaluation note..."
                  value={adminRemarkInput}
                  onChange={(e) => {
                    setAdminRemarkInput(e.target.value);
                    if (adminRemarkError) setAdminRemarkError('');
                  }}
                />
                {adminRemarkError && <span className="form-error-text">{adminRemarkError}</span>}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setAdminRatingQuery(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingQueryId === adminRatingQuery.queryId}
                  onClick={async () => {
                    if (!adminRemarkInput.trim()) {
                      setAdminRemarkError('Please enter an admin remark.');
                      return;
                    }

                    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19);
                    const nowMsVal = Date.now();

                    if (adminRatingTargetRole === 'receiver') {
                      await onUpdateQuery(adminRatingQuery.queryId, {
                        adminReceiverRating: adminRatingInput,
                        adminReceiverRemark: adminRemarkInput.trim(),
                        adminReceiverRatedAt: nowIso,
                        adminReceiverRatedAtMs: nowMsVal,
                      });
                    } else {
                      await onUpdateQuery(adminRatingQuery.queryId, {
                        adminSenderRating: adminRatingInput,
                        adminSenderRemark: adminRemarkInput.trim(),
                        adminSenderRatedAt: nowIso,
                        adminSenderRatedAtMs: nowMsVal,
                      });
                    }

                    setAdminRatingQuery(null);
                  }}
                >
                  {savingQueryId === adminRatingQuery.queryId ? 'Saving...' : 'Save Rating'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================
          EXTENSION REQUEST MODAL
         ======================================================================== */}
      {extensionModalQuery && (
        <div className="modal-backdrop" onClick={() => setExtensionModalQuery(null)}>
          <div
            className="modal-dialog extension-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extension-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="extension-modal-title">Request Extension</h3>
                <span className="modal-sender-badge">
                  Query <strong>{extensionModalQuery.queryId}</strong> &bull; To{' '}
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
              <div className="cp-form-group">
                <label htmlFor="ext-proposed-date">New Target Date &amp; Time *</label>
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
                <label htmlFor="ext-reason">Reason *</label>
                <textarea
                  id="ext-reason"
                  rows={3}
                  placeholder="Briefly explain why extra time is needed..."
                  value={extensionReasonInput}
                  onChange={(e) => {
                    setExtensionReasonInput(e.target.value);
                    if (extensionError) setExtensionError('');
                  }}
                  required
                />
                {extensionError && <span className="form-error-text">{extensionError}</span>}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setExtensionModalQuery(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSubmittingExtension}>
                  {isSubmittingExtension ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================
          EXTENSION REVIEW MODAL
         ======================================================================== */}
      {extensionReviewModalQuery && (
        <div className="modal-backdrop" onClick={() => setExtensionReviewModalQuery(null)}>
          <div
            className="modal-dialog extension-review-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-ext-modal-title"
          >
            <div className="modal-header">
              <div className="modal-header-text">
                <h3 id="review-ext-modal-title">Review Extension</h3>
                <span className="modal-sender-badge">
                  Query <strong>{extensionReviewModalQuery.queryId}</strong> &bull; By{' '}
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
                <span className="review-meta-label">Proposed Deadline</span>
                <span className="review-meta-val highlight">
                  {extensionReviewModalQuery.extensionProposedDueAt || '—'}
                </span>
              </div>

              <div className="review-meta-item">
                <span className="review-meta-label">Reason</span>
                <p className="review-reason-box">
                  &ldquo;{extensionReviewModalQuery.extensionReason || 'No reason provided'}&rdquo;
                </p>
              </div>

              <div className="cp-form-group">
                <label htmlFor="ext-decline-note">Note (Optional if declining)</label>
                <input
                  id="ext-decline-note"
                  type="text"
                  placeholder="Add a note for the manager..."
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
                  ✕ Decline
                </button>
                <button
                  type="button"
                  className="btn-primary btn-approve-action"
                  disabled={isReviewingExtension}
                  onClick={() => handleApproveExtension(extensionReviewModalQuery)}
                >
                  {isReviewingExtension ? 'Saving...' : '✓ Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};