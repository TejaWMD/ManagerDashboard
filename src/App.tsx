import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Query,
  DELAY_THRESHOLD_MS,
  getQueryTimestampMs,
  isQueryDelayed,
  isQueryDone,
  PageView,
  UserAccount,
  Appointment,
  AppointmentAttendee,
  AppointmentStatus,
  belongsToAppointment,
  QueryAttachment,
} from './types';
import { AUTHORIZED_USERS } from './data/users';
import { INITIAL_QUERIES } from './data/initialQueries';
import {
  QueryRow,
  AppointmentRow,
  ensureUsersSeededInDb,
  fetchQueriesFromDb,
  fetchAppointmentsFromDb,
  fetchUsersFromDb,
  insertQueryInDb,
  insertAppointmentInDb,
  mapRowToQuery,
  mapRowToAppointment,
  supabase,
  updateQueryInDb,
  updateAppointmentInDb,
  generateNextAppointmentId,
  readCachedAppointments,
  writeCachedAppointments,
} from './lib/supabase';
import {
  registerServiceWorker,
  showWebNotification,
} from './lib/notifications';
import {
  dispatchQueryPushNotification,
  dispatchAppointmentPushNotification,
} from './lib/pushDispatcher';
import {
  checkAndNotifyDelayedQueries,
  checkAndNotifyUrgentReminders,
  resetDelayNotifiedLocally,
  clearUrgentReminderLocally,
} from './lib/slaDelayChecker';
import { Login } from './components/Login/Login';
import { Navbar } from './components/Navbar/Navbar';
import { HomePage } from './components/HomePage/HomePage';
import { QueryPage } from './components/QueryPage/QueryPage';
import { KPIPage } from './components/KPIPage/KPIPage';
import { BookAppointmentModal } from './components/Appointments/BookAppointmentModal';
import { RescheduleAppointmentModal } from './components/Appointments/RescheduleAppointmentModal';
import { NotificationModal } from './components/NotificationModal/NotificationModal';
import sqlSchemaText from '../supabase_schema.sql?raw';
import './App.css';

const OLD_DUMMY_STORAGE_KEY = 'wm_portal_queries_v1';
const STORAGE_KEY_QUERIES = 'wm_portal_queries_v4';
const STORAGE_KEY_SESSION = 'wm_portal_active_user_v1';

// One-time cleanup of legacy and corrupted mock/test keys
try {
  localStorage.removeItem(OLD_DUMMY_STORAGE_KEY);
  localStorage.removeItem('wm_portal_queries_v2');
  localStorage.removeItem('wm_portal_queries_v3');
  localStorage.removeItem('wm_portal_completion_meta_v1');
  localStorage.removeItem('wm_portal_completion_meta_v2');
  localStorage.removeItem('wm_portal_appointments_v1');
  localStorage.removeItem('wm_portal_appointments_v2');
} catch {
  // Ignore storage errors
}

function persistQueriesCache(list: Query[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_QUERIES, JSON.stringify(list));
  } catch {
    // Ignore storage errors
  }
}

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_SESSION);
      if (!saved) return null;
      const parsed = JSON.parse(saved) as UserAccount;
      const verified = AUTHORIZED_USERS.find(
        (u) =>
          u.email.toLowerCase() === parsed.email.toLowerCase() &&
          u.password === parsed.password &&
          u.role === parsed.role
      );
      return verified || null;
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState<PageView>('home');
  const [tvMode, setTvMode] = useState<boolean>(false);
  const [allUsers, setAllUsers] = useState<UserAccount[]>(AUTHORIZED_USERS);
  const [isNotifModalOpen, setIsNotifModalOpen] = useState<boolean>(false);

  const [queries, setQueries] = useState<Query[]>(INITIAL_QUERIES);
  const [appointments, setAppointments] = useState<Appointment[]>(() => readCachedAppointments());
  const [isBookAptModalOpen, setIsBookAptModalOpen] = useState<boolean>(false);
  const [appointmentToEdit, setAppointmentToEdit] = useState<Appointment | null>(null);
  const [bookAptPreselectedQueryId, setBookAptPreselectedQueryId] = useState<string | null>(null);
  const [bookAptPreselectedUserId, setBookAptPreselectedUserId] = useState<string | null>(null);
  const [rescheduleTargetApt, setRescheduleTargetApt] = useState<Appointment | null>(null);
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState<boolean>(false);
  const [pendingFollowupAppointment, setPendingFollowupAppointment] = useState<Appointment | null>(null);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);
  const [dbTableMissing, setDbTableMissing] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [savingQueryId, setSavingQueryId] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');

  // Keep fresh references for realtime subscription closures
  const currentUserRef = useRef<UserAccount | null>(currentUser);
  currentUserRef.current = currentUser;
  const queriesRef = useRef<Query[]>(queries);
  queriesRef.current = queries;
  const appointmentsRef = useRef<Appointment[]>(appointments);
  appointmentsRef.current = appointments;

  // Initialize Service Worker for Web Push and fetch updated user phone & keys
  useEffect(() => {
    registerServiceWorker();
    fetchUsersFromDb().then((users) => {
      if (users && users.length > 0) {
        setAllUsers(users);
      }
    });
  }, []);

  // Monitor for SLA delay breaches and urgent 24h reminders and dispatch push notifications
  useEffect(() => {
    if (queries.length === 0) return;
    checkAndNotifyDelayedQueries(queries);
    checkAndNotifyUrgentReminders(queries);

    const delayTimer = window.setInterval(() => {
      if (queriesRef.current.length > 0) {
        checkAndNotifyDelayedQueries(queriesRef.current);
        checkAndNotifyUrgentReminders(queriesRef.current);
      }
    }, 60 * 1000); // Check every minute

    return () => window.clearInterval(delayTimer);
  }, [queries.length]);

  const loadQueries = useCallback(async () => {
    setIsLoadingDb(true);
    try {
      localStorage.removeItem(OLD_DUMMY_STORAGE_KEY);
      localStorage.removeItem('wm_portal_queries_v2');
      localStorage.removeItem('wm_portal_queries_v3');
      localStorage.removeItem('wm_portal_completion_meta_v1');
      localStorage.removeItem('wm_portal_completion_meta_v2');
      localStorage.removeItem('wm_portal_appointments_v1');
      localStorage.removeItem('wm_portal_appointments_v2');
    } catch {
      // Ignore storage errors
    }

    await ensureUsersSeededInDb();
    const result = await fetchQueriesFromDb();
    if (result.error) {
      setDbTableMissing(result.tableMissing);
      setDbError(result.error);
      try {
        const cached = localStorage.getItem(STORAGE_KEY_QUERIES);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setQueries(parsed as Query[]);
          }
        }
      } catch {
        // Ignore
      }
    } else {
      setDbTableMissing(false);
      setDbError(null);
      setQueries(result.data);
      persistQueriesCache(result.data);
    }
    setIsLoadingDb(false);
  }, []);

  const loadAppointments = useCallback(async () => {
    try {
      const res = await fetchAppointmentsFromDb();
      if (res.data) {
        setAppointments(res.data);
      }
    } catch {
      // Graceful fallback to cached
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        loadQueries(),
        loadAppointments(),
        fetchUsersFromDb().then((users) => {
          if (users && users.length > 0) {
            setAllUsers(users);
          }
        }),
      ]);
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      setLastRefreshedAt(`${hh}:${mm}:${ss}`);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 450);
    }
  }, [loadQueries, loadAppointments]);

  useEffect(() => {
    loadQueries();
    loadAppointments();

    const queryChannel = supabase
      .channel('public:queries')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queries' },
        (payload) => {
          const user = currentUserRef.current;

          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = mapRowToQuery(payload.new as QueryRow);
            setQueries((prev) => {
              const exists = prev.some((c) => c.queryId === incoming.queryId);
              const next = exists
                ? prev.map((c) =>
                    c.queryId === incoming.queryId ? incoming : c
                  )
                : [incoming, ...prev];
              persistQueriesCache(next);
              return next;
            });

            // Trigger real-time browser/system notification on receiver's device
            if (user && incoming.accountManagerId !== user.id) {
              const senderObj = AUTHORIZED_USERS.find(
                (u) => u.id === incoming.accountManagerId
              );
              const senderRolePrefix =
                senderObj?.role === 'manager'
                  ? 'Manager'
                  : senderObj?.role === 'account_manager'
                  ? 'Account Manager'
                  : '';
              const senderLabel = senderRolePrefix
                ? `${senderRolePrefix} ${incoming.accountManagerName}`
                : incoming.accountManagerName;

              if (user.role === 'admin') {
                showWebNotification(
                  incoming.isUrgent ? '🚨 URGENT Query Created (Immediate)' : '🚨 New Query Created',
                  incoming.isUrgent
                    ? `[URGENT] ${senderLabel} submitted ${incoming.queryId} to Manager ${incoming.managerName} - Immediate Action Required!`
                    : `${senderLabel} submitted ${incoming.queryId} to Manager ${incoming.managerName}`
                );
              } else if (user.id === incoming.managerId) {
                showWebNotification(
                  incoming.isUrgent ? '🚨 URGENT Query Assigned (Immediate)' : '🚨 New Query Assigned',
                  incoming.isUrgent
                    ? `[URGENT] ${senderLabel} assigned ${incoming.queryId} to you! Requires immediate response.`
                    : `${senderLabel} assigned ${incoming.queryId} to you`
                );
              }
            }
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = mapRowToQuery(payload.new as QueryRow);
            const prevItem = queriesRef.current.find((c) => c.queryId === updated.queryId);

            setQueries((prev) => {
              const next = prev.map((c) =>
                c.queryId === updated.queryId ? updated : c
              );
              persistQueriesCache(next);
              return next;
            });

            // Trigger real-time browser/system notifications for relevant receivers
            if (prevItem && user) {
              const senderObj = AUTHORIZED_USERS.find(
                (u) => u.id === updated.accountManagerId
              );
              const senderRolePrefix =
                senderObj?.role === 'manager'
                  ? 'Manager'
                  : senderObj?.role === 'account_manager'
                  ? 'Account Manager'
                  : '';
              const senderLabel = senderRolePrefix
                ? `${senderRolePrefix} ${updated.accountManagerName}`
                : updated.accountManagerName;

              if (updated.status === 'Completed' && prevItem.status !== 'Completed') {
                if (user.id === updated.managerId || user.role === 'admin') {
                  showWebNotification(
                    '🎉 Query Completed',
                    `${updated.queryId} marked Completed by ${senderLabel}!`
                  );
                }
              } else if (updated.managerDone !== prevItem.managerDone) {
                if (user.id === updated.accountManagerId || user.role === 'admin') {
                  showWebNotification(
                    updated.managerDone ? '✅ Manager Marked Done' : '↩️ Manager Unmarked Done',
                    `Manager ${updated.managerName} ${updated.managerDone ? 'marked Done on' : 'unmarked'} ${updated.queryId}`
                  );
                }
              } else if (
                updated.managerRemarkTitle !== prevItem.managerRemarkTitle ||
                updated.managerRemark !== prevItem.managerRemark
              ) {
                if (user.id === updated.accountManagerId || user.role === 'admin') {
                  const mgrRemarkSummary =
                    updated.managerRemarkTitle || updated.managerRemark;
                  showWebNotification(
                    '💬 Manager Added Remark',
                    `Manager ${updated.managerName} on ${updated.queryId}: "${mgrRemarkSummary}"`
                  );
                }
              } else if (
                updated.extensionStatus !== prevItem.extensionStatus &&
                updated.extensionStatus
              ) {
                if (updated.extensionStatus === 'PENDING') {
                  if (user.id === updated.accountManagerId || user.role === 'admin') {
                    showWebNotification(
                      '⏳ Extension Requested',
                      `Manager ${updated.managerName} requested completion extension for ${updated.queryId}`
                    );
                  }
                } else if (updated.extensionStatus === 'APPROVED') {
                  if (user.id === updated.managerId || user.role === 'admin') {
                    showWebNotification(
                      '✅ Extension Approved',
                      `Completion extension approved for ${updated.queryId}`
                    );
                  }
                } else if (updated.extensionStatus === 'DECLINED') {
                  if (user.id === updated.managerId || user.role === 'admin') {
                    showWebNotification(
                      '❌ Extension Declined',
                      `Extension request for ${updated.queryId} was declined`
                    );
                  }
                }
              } else if (
                updated.accountManagerRemarkTitle !==
                  prevItem.accountManagerRemarkTitle ||
                updated.accountManagerRemark !== prevItem.accountManagerRemark
              ) {
                if (user.id === updated.managerId || user.role === 'admin') {
                  const amRemarkSummary =
                    updated.accountManagerRemarkTitle ||
                    updated.accountManagerRemark;
                  showWebNotification(
                    `💬 ${senderRolePrefix || 'Sender'} Added Remark`,
                    `${senderLabel} on ${updated.queryId}: "${amRemarkSummary}"`
                  );
                }
              }
            }
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedId = (payload.old as { query_id?: string }).query_id;
            if (deletedId) {
              setQueries((prev) => {
                const next = prev.filter((c) => c.queryId !== deletedId);
                persistQueriesCache(next);
                return next;
              });
            }
          }
        }
      )
      .subscribe();

    const aptChannel = supabase
      .channel('public:appointments')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments' },
        (payload) => {
          const user = currentUserRef.current;

          if (payload.eventType === 'INSERT' && payload.new) {
            const incoming = mapRowToAppointment(payload.new as AppointmentRow);
            setAppointments((prev) => {
              if (prev.some((a) => a.id === incoming.id)) return prev;
              const next = [incoming, ...prev];
              writeCachedAppointments(next);
              return next;
            });

            if (user && belongsToAppointment(incoming, user) && incoming.requesterId !== user.id) {
              showWebNotification(
                '📅 New Appointment Request',
                `${incoming.requesterName} requested "${incoming.title}" on ${incoming.scheduledAt}`
              );
            }
          } else if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = mapRowToAppointment(payload.new as AppointmentRow);
            const prevApt = appointmentsRef.current.find((a) => a.id === updated.id);
            setAppointments((prev) => {
              const next = prev.map((a) => (a.id === updated.id ? updated : a));
              writeCachedAppointments(next);
              return next;
            });

            if (user && belongsToAppointment(updated, user)) {
              if (updated.status === 'CONFIRMED' && prevApt?.status !== 'CONFIRMED') {
                showWebNotification(
                  '✅ Appointment Confirmed',
                  `"${updated.title}" is confirmed for ${updated.scheduledAt}`
                );
              } else if (
                updated.status === 'RESCHEDULE_PROPOSED' &&
                updated.rescheduleProposedBy !== user.id
              ) {
                showWebNotification(
                  '⏳ Reschedule Proposed',
                  `New time proposed for "${updated.title}": ${updated.proposedScheduledAt || 'new date'}`
                );
              } else if (updated.status === 'DECLINED' && prevApt?.status !== 'DECLINED') {
                showWebNotification(
                  '❌ Appointment Declined',
                  `"${updated.title}" was declined.`
                );
              } else if (updated.status === 'CANCELLED' && prevApt?.status !== 'CANCELLED') {
                showWebNotification(
                  '❌ Appointment Cancelled',
                  `"${updated.title}" was cancelled.${updated.cancellationRemark ? ` Remark: "${updated.cancellationRemark}"` : ''}`
                );
              } else if (
                prevApt &&
                prevApt.status === updated.status &&
                (prevApt.title !== updated.title ||
                  prevApt.scheduledAt !== updated.scheduledAt ||
                  prevApt.agenda !== updated.agenda ||
                  prevApt.meetingLocation !== updated.meetingLocation ||
                  prevApt.queryId !== updated.queryId)
              ) {
                showWebNotification(
                  '📝 Appointment Updated',
                  `"${updated.title}" details were updated for ${updated.scheduledAt}.`
                );
              }
            }
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deletedId = (payload.old as { id?: string }).id;
            if (deletedId) {
              setAppointments((prev) => {
                const next = prev.filter((a) => a.id !== deletedId);
                writeCachedAppointments(next);
                return next;
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(queryChannel);
      supabase.removeChannel(aptChannel);
    };
  }, [loadQueries, loadAppointments]);

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    setActivePage('home');
    try {
      sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(user));
    } catch {
      // Ignore storage errors
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActivePage('home');
    try {
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // Ignore
    }
  };

  const formatTimestamp = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const sec = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
  };

  const generateNextQueryId = (list: Query[]): string => {
    let maxNum = 0;
    for (const item of list) {
      const match = item.queryId.match(/QRY-(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!Number.isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
    const nextNumber = maxNum + 1;
    return `QRY-${String(nextNumber).padStart(3, '0')}`;
  };

  const handleCreateQuery = async (payload: {
    managerId: string;
    managerEmail: string;
    managerName: string;
    queryTitle: string;
    queryText: string;
    linkedAppointmentId?: string | null;
    isUrgent?: boolean;
    attachments?: QueryAttachment[];
  }) => {
    if (!currentUser) return;
    const now = new Date();
    const tempQueryId = generateNextQueryId(queries);

    const created: Query = {
      id: tempQueryId,
      queryId: tempQueryId,
      createdAt: formatTimestamp(now),
      createdAtMs: now.getTime(),
      completedAt: null,
      completedAtMs: null,
      isDelayed: false,
      accountManagerId: currentUser.id,
      accountManagerEmail: currentUser.email,
      accountManagerName: currentUser.name,
      managerId: payload.managerId,
      managerEmail: payload.managerEmail,
      managerName: payload.managerName,
      queryTitle: payload.queryTitle,
      queryText: payload.queryText,
      managerRemarkTitle: '',
      managerRemark: '',
      managerDone: false,
      accountManagerRemarkTitle: '',
      accountManagerRemark: '',
      accountManagerDone: false,
      status: 'Pending',
      linkedAppointmentId: payload.linkedAppointmentId || null,
      isUrgent: Boolean(payload.isUrgent),
      attachments: payload.attachments || [],
    };

    setQueries((prev) => {
      const next = [created, ...prev];
      persistQueriesCache(next);
      return next;
    });

    const { data, error } = await insertQueryInDb(created);
    if (error) {
      setDbError(error);
      // Roll back optimistic insert on error
      setQueries((prev) => {
        const rolledBack = prev.filter((c) => c.queryId !== tempQueryId);
        persistQueriesCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setQueries((prev) => {
        const withoutTemp = prev.filter(
          (c) => c.queryId !== tempQueryId && c.queryId !== data.queryId
        );
        const next = [data, ...withoutTemp];
        persistQueriesCache(next);
        return next;
      });

      // Bidirectionally link the appointment to this created query if linkedAppointmentId was specified
      if (payload.linkedAppointmentId) {
        const linkedAptId = payload.linkedAppointmentId;
        setAppointments((prev) => {
          const next = prev.map((a) =>
            a.id === linkedAptId ? { ...a, queryId: data.queryId } : a
          );
          writeCachedAppointments(next);
          return next;
        });
        updateAppointmentInDb(linkedAptId, { queryId: data.queryId });
      }

      // Dispatch desktop background push notification to assigned Manager & Admin
      dispatchQueryPushNotification({
        event: 'NEW_QUERY',
        query: data,
        actor: currentUser,
      });
    }
  };

  const handleUpdateQuery = async (
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
        | 'isUrgent'
        | 'lastUrgentReminderAtMs'
        | 'linkedAppointmentId'
        | 'attachments'
      >
    >
  ) => {
    if (!currentUser) return;
    const existing = queries.find((c) => c.queryId === queryId);
    if (!existing) return;

    const now = new Date();
    const nowMs = now.getTime();
    const createdMs = getQueryTimestampMs(existing);

    const nextManagerDone =
      updates.managerDone !== undefined
        ? updates.managerDone
        : existing.managerDone;

    // Anti-cheat dedicated manager resolution timestamp
    const nextManagerDoneAt = nextManagerDone
      ? existing.managerDoneAt || formatTimestamp(now)
      : null;
    const nextManagerDoneAtMs = nextManagerDone
      ? existing.managerDoneAtMs || nowMs
      : null;

    // Account Manager cannot stay done if Manager Done is unchecked
    const nextAccountManagerDone = !nextManagerDone
      ? false
      : updates.accountManagerDone !== undefined
      ? updates.accountManagerDone
      : existing.accountManagerDone;

    const nextIsCompleted = Boolean(nextManagerDone && nextAccountManagerDone);
    const nextStatus = nextIsCompleted ? 'Completed' : 'Pending';

    const nextCompletedAt = nextIsCompleted
      ? existing.completedAt || formatTimestamp(now)
      : null;
    const nextCompletedAtMs = nextIsCompleted
      ? existing.completedAtMs || nowMs
      : null;

    // Effective target completion deadline
    const effectiveDeadlineMs =
      updates.targetDueAtMs !== undefined && updates.targetDueAtMs !== null
        ? updates.targetDueAtMs
        : existing.targetDueAtMs && existing.targetDueAtMs > 0
        ? existing.targetDueAtMs
        : createdMs > 0
        ? createdMs + DELAY_THRESHOLD_MS
        : 0;

    // If an extension was approved, recalculate whether it is delayed against the extended target!
    const wasAlreadyDelayed =
      updates.extensionStatus === 'APPROVED'
        ? false
        : isQueryDelayed(existing, nowMs);

    const isUrgentQuery =
      updates.isUrgent !== undefined ? Boolean(updates.isUrgent) : Boolean(existing.isUrgent);

    // Urgent queries have no delay threshold and are never classified as delayed
    const nextIsDelayed = isUrgentQuery
      ? false
      : nextIsCompleted
      ? Boolean(
          wasAlreadyDelayed ||
            (effectiveDeadlineMs > 0 &&
              nextCompletedAtMs !== null &&
              nextCompletedAtMs > effectiveDeadlineMs)
        )
      : Boolean(effectiveDeadlineMs > 0 && nowMs > effectiveDeadlineMs);

    if (nextIsCompleted && isUrgentQuery) {
      clearUrgentReminderLocally(queryId);
    }

    const optimisticItem: Query = {
      ...existing,
      ...updates,
      managerDone: nextManagerDone,
      managerDoneAt: nextManagerDoneAt,
      managerDoneAtMs: nextManagerDoneAtMs,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      createdAt: existing.createdAt,
      createdAtMs: existing.createdAtMs,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
    };

    setSavingQueryId(queryId);

    setQueries((prev) => {
      const next = prev.map((item) =>
        item.queryId === queryId ? optimisticItem : item
      );
      persistQueriesCache(next);
      return next;
    });

    const { data, error } = await updateQueryInDb(queryId, {
      ...updates,
      managerDone: nextManagerDone,
      managerDoneAt: nextManagerDoneAt,
      managerDoneAtMs: nextManagerDoneAtMs,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
    });

    setSavingQueryId(null);

    if (error) {
      setDbError(error);
      // Roll back optimistic update on error
      setQueries((prev) => {
        const rolledBack = prev.map((item) =>
          item.queryId === queryId ? existing : item
        );
        persistQueriesCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setQueries((prev) => {
        const next = prev.map((item) =>
          item.queryId === queryId ? data : item
        );
        persistQueriesCache(next);
        return next;
      });

      // Synchronize appointment's queryId if linkedAppointmentId changed
      if (updates.linkedAppointmentId !== undefined) {
        const newLinkedAptId = updates.linkedAppointmentId;
        const oldLinkedAptId = existing.linkedAppointmentId;

        if (oldLinkedAptId && oldLinkedAptId !== newLinkedAptId) {
          setAppointments((prev) => {
            const next = prev.map((a) =>
              a.id === oldLinkedAptId ? { ...a, queryId: null } : a
            );
            writeCachedAppointments(next);
            return next;
          });
          updateAppointmentInDb(oldLinkedAptId, { queryId: null });
        }

        if (newLinkedAptId) {
          setAppointments((prev) => {
            const next = prev.map((a) =>
              a.id === newLinkedAptId ? { ...a, queryId } : a
            );
            writeCachedAppointments(next);
            return next;
          });
          updateAppointmentInDb(newLinkedAptId, { queryId });
        }
      }

      // Dispatch desktop background push notifications to involved users & admin
      if (
        updates.extensionStatus === 'PENDING' &&
        existing.extensionStatus !== 'PENDING'
      ) {
        dispatchQueryPushNotification({
          event: 'EXTENSION_REQUESTED',
          query: data,
          actor: currentUser,
        });
      } else if (
        updates.extensionStatus === 'APPROVED' &&
        existing.extensionStatus !== 'APPROVED'
      ) {
        resetDelayNotifiedLocally(queryId);
        dispatchQueryPushNotification({
          event: 'EXTENSION_APPROVED',
          query: data,
          actor: currentUser,
        });
      } else if (
        updates.extensionStatus === 'DECLINED' &&
        existing.extensionStatus !== 'DECLINED'
      ) {
        dispatchQueryPushNotification({
          event: 'EXTENSION_DECLINED',
          query: data,
          actor: currentUser,
        });
      } else if (
        updates.managerDone !== undefined &&
        updates.managerDone !== existing.managerDone &&
        updates.managerDone
      ) {
        dispatchQueryPushNotification({
          event: 'MANAGER_DONE',
          query: data,
          actor: currentUser,
          isDone: true,
        });
      } else if (
        updates.accountManagerDone !== undefined &&
        updates.accountManagerDone !== existing.accountManagerDone &&
        updates.accountManagerDone
      ) {
        dispatchQueryPushNotification({
          event: 'AM_DONE',
          query: data,
          actor: currentUser,
          isDone: true,
        });
      }

      if (
        (updates.managerRemarkTitle !== undefined ||
          updates.managerRemark !== undefined) &&
        ((updates.managerRemarkTitle ?? existing.managerRemarkTitle).trim() !==
          (existing.managerRemarkTitle || '').trim() ||
          (updates.managerRemark ?? existing.managerRemark).trim() !==
            (existing.managerRemark || '').trim()) &&
        ((updates.managerRemarkTitle ?? '').trim() ||
          (updates.managerRemark ?? '').trim())
      ) {
        dispatchQueryPushNotification({
          event: 'MANAGER_REMARK',
          query: data,
          actor: currentUser,
          remarkText:
            (updates.managerRemarkTitle ?? '').trim() ||
            (updates.managerRemark ?? '').trim(),
        });
      } else if (
        (updates.accountManagerRemarkTitle !== undefined ||
          updates.accountManagerRemark !== undefined) &&
        ((
          updates.accountManagerRemarkTitle ??
          existing.accountManagerRemarkTitle
        ).trim() !== (existing.accountManagerRemarkTitle || '').trim() ||
          (updates.accountManagerRemark ?? existing.accountManagerRemark).trim() !==
            (existing.accountManagerRemark || '').trim()) &&
        ((updates.accountManagerRemarkTitle ?? '').trim() ||
          (updates.accountManagerRemark ?? '').trim())
      ) {
        dispatchQueryPushNotification({
          event: 'AM_REMARK',
          query: data,
          actor: currentUser,
          remarkText:
            (updates.accountManagerRemarkTitle ?? '').trim() ||
            (updates.accountManagerRemark ?? '').trim(),
        });
      }
    }
  };

  const handleOpenBookAppointment = (
    preselectedQueryId?: string | null,
    preselectedUserId?: string | null
  ) => {
    setBookAptPreselectedQueryId(preselectedQueryId || null);
    setBookAptPreselectedUserId(preselectedUserId || null);
    setIsBookAptModalOpen(true);
  };

  const handleBookAppointment = async (
    data: Omit<Appointment, 'id' | 'createdAt' | 'createdAtMs'>
  ) => {
    if (!currentUser) return;
    const now = new Date();
    const nextId = generateNextAppointmentId(appointments);

    const pad = (n: number) => String(n).padStart(2, '0');
    const createdAtStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;

    const newAppointment: Appointment = {
      ...data,
      id: nextId,
      createdAt: createdAtStr,
      createdAtMs: now.getTime(),
    };

    setAppointments((prev) => {
      const next = [newAppointment, ...prev];
      writeCachedAppointments(next);
      return next;
    });

    // Save to Supabase (and cache)
    const { data: savedApt } = await insertAppointmentInDb(newAppointment);
    const finalApt = savedApt || newAppointment;
    if (savedApt && savedApt.id !== newAppointment.id) {
      setAppointments((prev) => {
        const next = prev.map((a) => (a.id === newAppointment.id ? savedApt : a));
        writeCachedAppointments(next);
        return next;
      });
    }

    // Bidirectionally link the query to this appointment if queryId is specified
    if (finalApt.queryId) {
      const targetQueryId = finalApt.queryId;
      setQueries((prev) => {
        const next = prev.map((q) =>
          q.queryId === targetQueryId ? { ...q, linkedAppointmentId: finalApt.id } : q
        );
        persistQueriesCache(next);
        return next;
      });
      updateQueryInDb(targetQueryId, { linkedAppointmentId: finalApt.id });
    }

    // Dual Push notification to recipient + admin
    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_REQUESTED',
      appointment: finalApt,
      actor: currentUser,
    });
  };

  const handleAcceptAppointment = async (appointmentId: string) => {
    if (!currentUser) return;
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return;

    // Normalize attendees list
    const currentAttendees: AppointmentAttendee[] =
      Array.isArray(target.attendees) && target.attendees.length > 0
        ? target.attendees
        : target.receiverId
        ? [
            {
              id: target.receiverId,
              name: target.receiverName || '',
              email: target.receiverEmail || '',
              role: target.receiverRole || 'manager',
              status: target.status === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING',
            },
          ]
        : [];

    const isAdmin = currentUser.role === 'admin';
    const isMatchingAttendee = currentAttendees.some(
      (att) =>
        (att.id && att.id === currentUser.id) ||
        (Boolean(att.email) &&
          Boolean(currentUser.email) &&
          att.email.toLowerCase() === currentUser.email.toLowerCase()) ||
        (Boolean(att.name) &&
          Boolean(currentUser.name) &&
          att.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase())
    );

    // Mark current user (or all if admin not in attendees) as CONFIRMED
    const nextAttendees: AppointmentAttendee[] = currentAttendees.map((att) => {
      const isMatch =
        (att.id && att.id === currentUser.id) ||
        (Boolean(att.email) &&
          Boolean(currentUser.email) &&
          att.email.toLowerCase() === currentUser.email.toLowerCase()) ||
        (Boolean(att.name) &&
          Boolean(currentUser.name) &&
          att.name.trim().toLowerCase() === currentUser.name.trim().toLowerCase());

      if (isMatch || (isAdmin && !isMatchingAttendee)) {
        return { ...att, status: 'CONFIRMED' as AppointmentStatus };
      }
      return {
        ...att,
        status: att.status || ('PENDING' as AppointmentStatus),
      };
    });

    // Classification as CONFIRMED: EVERY attendee must accept
    const allAttendeesConfirmed =
      nextAttendees.length > 0 &&
      nextAttendees.every((att) => att.status === 'CONFIRMED');

    const nextStatus: AppointmentStatus = allAttendeesConfirmed
      ? 'CONFIRMED'
      : 'PENDING';

    const updated: Appointment = {
      ...target,
      status: nextStatus,
      attendees: nextAttendees,
    };

    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, {
      status: nextStatus,
      attendees: nextAttendees,
    });

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_ACCEPTED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleRescheduleClick = (appointment: Appointment) => {
    setRescheduleTargetApt(appointment);
    setIsRescheduleModalOpen(true);
  };

  const handleConfirmReschedule = async (
    appointmentId: string,
    proposedDateTime: string,
    reason: string
  ) => {
    if (!currentUser) return;
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return;

    const proposedMs = Date.parse(proposedDateTime.replace(' ', 'T'));
    const updated: Appointment = {
      ...target,
      status: 'RESCHEDULE_PROPOSED',
      rescheduleProposedBy: currentUser.id,
      proposedScheduledAt: proposedDateTime,
      proposedScheduledAtMs: proposedMs,
      rescheduleReason: reason,
    };

    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, {
      status: 'RESCHEDULE_PROPOSED',
      reschedule_proposed_by: currentUser.id,
      proposed_scheduled_at: proposedDateTime,
      proposed_scheduled_at_ms: proposedMs,
      reschedule_reason: reason,
    });

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_RESCHEDULE_REQUESTED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleAcceptReschedule = async (appointmentId: string) => {
    if (!currentUser) return;
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target || !target.proposedScheduledAt) return;

    const updated: Appointment = {
      ...target,
      status: 'CONFIRMED',
      scheduledAt: target.proposedScheduledAt,
      scheduledAtMs:
        target.proposedScheduledAtMs ||
        Date.parse(target.proposedScheduledAt.replace(' ', 'T')),
      rescheduleProposedBy: null,
      proposedScheduledAt: null,
      proposedScheduledAtMs: null,
      rescheduleReason: null,
    };

    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, {
      status: 'CONFIRMED',
      scheduled_at: updated.scheduledAt,
      scheduled_at_ms: updated.scheduledAtMs,
      reschedule_proposed_by: null,
      proposed_scheduled_at: null,
      proposed_scheduled_at_ms: null,
      reschedule_reason: null,
    });

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_RESCHEDULE_ACCEPTED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleDeclineAppointment = async (appointmentId: string) => {
    if (!currentUser) return;
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return;

    const updated: Appointment = { ...target, status: 'DECLINED' };
    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, { status: 'DECLINED' });

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_DECLINED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    if (!currentUser) return;
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return;

    const updated: Appointment = { ...target, status: 'CANCELLED' };
    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, { status: 'CANCELLED' });

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_CANCELLED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleEditAppointment = (appointment: Appointment) => {
    setAppointmentToEdit(appointment);
    setIsBookAptModalOpen(true);
  };

  const handleUpdateAppointment = async (
    appointmentId: string,
    updates: Partial<Appointment>
  ) => {
    if (!currentUser) return;
    const existing = appointments.find((a) => a.id === appointmentId);
    if (!existing) return;

    const updated: Appointment = {
      ...existing,
      ...updates,
    };

    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, updates);

    // Bidirectionally sync query's linkedAppointmentId if queryId changed
    if (updates.queryId !== undefined && updates.queryId !== existing.queryId) {
      const oldQueryId = existing.queryId;
      const newQueryId = updates.queryId;
      setQueries((prev) => {
        const next = prev.map((q) => {
          if (oldQueryId && q.queryId === oldQueryId && q.linkedAppointmentId === appointmentId) {
            return { ...q, linkedAppointmentId: null };
          }
          if (newQueryId && q.queryId === newQueryId) {
            return { ...q, linkedAppointmentId: appointmentId };
          }
          return q;
        });
        persistQueriesCache(next);
        return next;
      });
      if (oldQueryId) {
        updateQueryInDb(oldQueryId, { linkedAppointmentId: null });
      }
      if (newQueryId) {
        updateQueryInDb(newQueryId, { linkedAppointmentId: appointmentId });
      }
    }

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_UPDATED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleCancelAppointmentWithRemark = async (
    appointmentId: string,
    remark: string
  ) => {
    if (!currentUser) return;
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return;

    const nowIso = new Date().toISOString();
    const updated: Appointment = {
      ...target,
      status: 'CANCELLED',
      cancellationRemark: remark,
      cancelledAt: nowIso,
    };

    setAppointments((prev) => {
      const next = prev.map((a) => (a.id === appointmentId ? updated : a));
      writeCachedAppointments(next);
      return next;
    });

    await updateAppointmentInDb(appointmentId, {
      status: 'CANCELLED',
      cancellation_remark: remark,
      cancelled_at: nowIso,
    });

    dispatchAppointmentPushNotification({
      event: 'APPOINTMENT_CANCELLED',
      appointment: updated,
      actor: currentUser,
    });
  };

  const handleOpenCreateQueryForAppointment = (appointment: Appointment) => {
    setPendingFollowupAppointment(appointment);
    setActivePage('queries');
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(sqlSchemaText);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      // Fallback
    }
  };

  if (!currentUser) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const openQueriesCount = queries.filter((c) => {
    if (isQueryDone(c)) return false;
    if (currentUser.role === 'account_manager') {
      return belongsToAccountManager(c, currentUser);
    }
    if (currentUser.role === 'manager') {
      return (
        belongsToManager(c, currentUser) ||
        belongsToAccountManager(c, currentUser)
      );
    }
    return true;
  }).length;

  return (
    <div className={`app-shell ${tvMode ? 'app-shell--tv-mode' : ''}`}>
      <Navbar
        currentUser={currentUser}
        activePage={activePage}
        onNavigate={setActivePage}
        onLogout={handleLogout}
        tvMode={tvMode}
        onToggleTvMode={() => setTvMode((prev) => !prev)}
        openQueriesCount={openQueriesCount}
        onOpenNotifications={() => setIsNotifModalOpen(true)}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing || isLoadingDb}
        lastRefreshedAt={lastRefreshedAt}
      />

      <div className={`app-body-column app-body-column--${activePage}`}>
        {dbTableMissing && (
          <div className="db-setup-banner" role="alert">
            <span>Database tables not initialized.</span>
            <div className="db-setup-banner-actions">
              <button
                type="button"
                className="db-banner-btn db-banner-btn--primary"
                onClick={handleCopySql}
              >
                {copiedSql ? 'Copied SQL' : 'Copy SQL'}
              </button>
              <button
                type="button"
                className="db-banner-btn"
                onClick={loadQueries}
                disabled={isLoadingDb}
              >
                {isLoadingDb ? '...' : 'Retry'}
              </button>
            </div>
          </div>
        )}

        {!dbTableMissing && dbError && (
          <div className="db-error-banner" role="alert">
            <span>{dbError}</span>
            <button
              type="button"
              className="db-banner-btn"
              onClick={loadQueries}
            >
              Retry
            </button>
          </div>
        )}

        <main className={`app-main-content app-main-content--${activePage}`}>
          {activePage === 'home' ? (
            <HomePage
              currentUser={currentUser}
              queries={queries}
              users={allUsers}
              appointments={appointments}
              onNavigate={setActivePage}
              onOpenBookAppointment={handleOpenBookAppointment}
              onAcceptAppointment={handleAcceptAppointment}
              onRescheduleClick={handleRescheduleClick}
              onAcceptReschedule={handleAcceptReschedule}
              onDeclineAppointment={handleDeclineAppointment}
              onCancelAppointment={handleCancelAppointment}
              onEditAppointment={handleEditAppointment}
              onCancelAppointmentWithRemark={handleCancelAppointmentWithRemark}
              onOpenCreateQueryForAppointment={handleOpenCreateQueryForAppointment}
            />
          ) : activePage === 'kpi' ? (
            <KPIPage
              currentUser={currentUser}
              queries={queries}
              users={allUsers}
              onNavigate={setActivePage}
            />
          ) : (
            <QueryPage
              currentUser={currentUser}
              queries={queries}
              savingQueryId={savingQueryId}
              appointments={appointments}
              initialFollowupAppointment={pendingFollowupAppointment}
              onOpenBookAppointment={handleOpenBookAppointment}
              onCreateQuery={handleCreateQuery}
              onUpdateQuery={handleUpdateQuery}
            />
          )}
        </main>
      </div>

      <BookAppointmentModal
        isOpen={isBookAptModalOpen}
        onClose={() => {
          setIsBookAptModalOpen(false);
          setAppointmentToEdit(null);
          setBookAptPreselectedQueryId(null);
          setBookAptPreselectedUserId(null);
        }}
        currentUser={currentUser}
        users={allUsers}
        queries={queries}
        preselectedQueryId={bookAptPreselectedQueryId}
        preselectedUserId={bookAptPreselectedUserId}
        appointmentToEdit={appointmentToEdit}
        onBookAppointment={handleBookAppointment}
        onUpdateAppointment={handleUpdateAppointment}
      />

      <RescheduleAppointmentModal
        isOpen={isRescheduleModalOpen}
        onClose={() => {
          setIsRescheduleModalOpen(false);
          setRescheduleTargetApt(null);
        }}
        appointment={rescheduleTargetApt}
        currentUser={currentUser}
        onConfirmReschedule={handleConfirmReschedule}
      />

      <NotificationModal
        isOpen={isNotifModalOpen}
        onClose={() => setIsNotifModalOpen(false)}
        currentUser={currentUser}
      />
    </div>
  );
};

export default App;
