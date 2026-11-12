import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  belongsToAccountManager,
  belongsToManager,
  Query,
  DELAY_THRESHOLD_MS,
  getQueryTimestampMs,
  isQueryDelayed,
  isQueryDone,
  getFirstManagerRemarkTimestampMs,
  URGENT_MANAGER_REMARK_WINDOW_MS,
  PageView,
  UserAccount,
  Appointment,
  AppointmentAttendee,
  AppointmentStatus,
  belongsToAppointment,
  QueryAttachment,
  QueryCCUser,
  UserActivity,
  UserPresence,
} from './types';
import { AUTHORIZED_USERS, getStoredCustomUsers } from './data/users';
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
  ACTIVITIES_STORAGE_KEY,
  PRESENCE_STORAGE_KEY,
  ActivityRow,
  PresenceRow,
  fetchRecentActivitiesFromDb,
  fetchUserPresencesFromDb,
  getCrossTabBus,
  getOrCreateTrackingChannel,
  logUserActivity,
  mapRowToActivity,
  mapRowToPresence,
  readCachedActivities,
  readCachedPresences,
  setUserOffline,
  updateUserPresence,
  writeCachedActivities,
  writeCachedPresences,
} from './lib/activityTracker';
import {
  registerServiceWorker,
  showWebNotification,
} from './lib/notifications';
import {
  formatTimestamp as formatTimestampUtil,
  formatDateTime,
  formatDate,
  parseDateToMs,
} from './lib/dateUtils';
import {
  checkForAppUpdate,
  applyAppUpdate,
} from './lib/versionManager';
import {
  dispatchQueryPushNotification,
  dispatchAppointmentPushNotification,
} from './lib/pushDispatcher';
import {
  checkAndNotifyDelayedQueries,
  checkAndNotifyUrgentReminders,
  resetDelayNotifiedLocally,
  clearUrgentReminderLocally,
  markUrgentQueryFinished,
  unmarkUrgentQueryFinished,
} from './lib/slaDelayChecker';
import { Login } from './components/Login/Login';
import { Navbar } from './components/Navbar/Navbar';
import { HomePage } from './components/HomePage/HomePage';
import { QueryPage } from './components/QueryPage/QueryPage';
import { KPIPage } from './components/KPIPage/KPIPage';
import { TrackingPage } from './components/TrackingPage/TrackingPage';
import { BookAppointmentModal } from './components/Appointments/BookAppointmentModal';
import { RescheduleAppointmentModal } from './components/Appointments/RescheduleAppointmentModal';
import { NotificationModal } from './components/NotificationModal/NotificationModal';
import { MyTrello } from './components/MyTrello/MyTrello';
import { AdminTrello } from './components/AdminTrello/AdminTrello';
import { RatingsPage } from './components/RatingsPage/RatingsPage';
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
      if (parsed && parsed.email) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [activePage, setActivePage] = useState<PageView>('home');
  const [tvMode, setTvMode] = useState<boolean>(false);
  const [allUsers, setAllUsers] = useState<UserAccount[]>(() => {
    const custom = getStoredCustomUsers();
    const map = new Map<string, UserAccount>();
    AUTHORIZED_USERS.forEach((u) => map.set(u.email.toLowerCase(), u));
    custom.forEach((u) => {
      if (!map.has(u.email.toLowerCase())) {
        map.set(u.email.toLowerCase(), u);
      }
    });
    return Array.from(map.values());
  });
  const [isNotifModalOpen, setIsNotifModalOpen] = useState<boolean>(false);

  const [queries, setQueries] = useState<Query[]>(INITIAL_QUERIES);
  const [appointments, setAppointments] = useState<Appointment[]>(() => readCachedAppointments());
  const [activities, setActivities] = useState<UserActivity[]>(() => readCachedActivities());
  const [presences, setPresences] = useState<Record<string, UserPresence>>(() => readCachedPresences());
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
  const presencesRef = useRef<Record<string, UserPresence>>(presences);
  presencesRef.current = presences;

  // Initialize Service Worker for Web Push and fetch updated user phone & keys
  useEffect(() => {
    registerServiceWorker();
    fetchUsersFromDb().then((users) => {
      if (users && users.length > 0) {
        setAllUsers(users);
      }
    });
  }, []);

  // Protect role-restricted pages: My Trello (AM + Admin) and Ratings/Tracking/Admin Trello (Admin only)
  useEffect(() => {
    if (!currentUser) return;
    if (
      activePage === 'my-trello' &&
      currentUser.role !== 'admin' &&
      currentUser.role !== 'account_manager'
    ) {
      setActivePage('home');
    } else if (
      (activePage === 'ratings' || activePage === 'tracking' || activePage === 'admin-trello') &&
      currentUser.role !== 'admin'
    ) {
      setActivePage('home');
    }
  }, [activePage, currentUser]);

  // Monitor for SLA delay breaches and urgent 24h reminders
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

  const [syncToast, setSyncToast] = useState<{
    message: string;
    type: 'info' | 'updating' | 'success';
  } | null>(null);

  const [hasMoreQueries, setHasMoreQueries] = useState(false);
  const [isAllQueriesLoaded, setIsAllQueriesLoaded] = useState(false);
  const hasSeededUsersRef = useRef(false);

  // Run ensureUsersSeededInDb only once per session on mount to prevent write/egress spam
  useEffect(() => {
    if (!hasSeededUsersRef.current) {
      hasSeededUsersRef.current = true;
      ensureUsersSeededInDb().catch(() => {});
    }
  }, []);

  const loadQueries = useCallback(async (loadAll = false): Promise<Query[]> => {
    // Skip background queries when tab is hidden unless explicitly requested
    if (typeof document !== 'undefined' && document.hidden && !loadAll) {
      return queriesRef.current;
    }

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

    const result = await fetchQueriesFromDb({ loadAll: loadAll || isAllQueriesLoaded });
    if (result.error) {
      setDbTableMissing(result.tableMissing);
      setDbError(result.error);
      try {
        const cached = localStorage.getItem(STORAGE_KEY_QUERIES);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            setQueries(parsed as Query[]);
            setIsLoadingDb(false);
            return parsed as Query[];
          }
        }
      } catch {
        // Ignore
      }
      setIsLoadingDb(false);
      return [];
    } else {
      setDbTableMissing(false);
      setDbError(null);
      setQueries(result.data);
      if (loadAll) {
        setIsAllQueriesLoaded(true);
      }
      setHasMoreQueries(Boolean(result.hasMore));
      persistQueriesCache(result.data);
      setIsLoadingDb(false);
      return result.data;
    }
  }, [isAllQueriesLoaded]);

  const loadAppointments = useCallback(async (): Promise<Appointment[]> => {
    if (typeof document !== 'undefined' && document.hidden) {
      return appointmentsRef.current;
    }
    try {
      const res = await fetchAppointmentsFromDb();
      if (res.data) {
        setAppointments(res.data);
        return res.data;
      }
    } catch {
      // Graceful fallback to cached
    }
    return appointmentsRef.current;
  }, []);

  const loadActivities = useCallback(
    async (
      overrideQueries?: Query[],
      overrideAppointments?: Appointment[]
    ): Promise<UserActivity[]> => {
      try {
        const targetQueries = overrideQueries || queriesRef.current;
        const targetAppointments =
          overrideAppointments || appointmentsRef.current;
        const acts = await fetchRecentActivitiesFromDb(
          targetQueries,
          targetAppointments
        );
        setActivities(acts);
        return acts;
      } catch {
        return [];
      }
    },
    []
  );

  const loadPresences = useCallback(async (): Promise<Record<string, UserPresence>> => {
    if (typeof document !== 'undefined' && document.hidden) {
      return presencesRef.current;
    }
    try {
      const p = await fetchUserPresencesFromDb();
      setPresences(p);
      return p;
    } catch {
      return {};
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setSyncToast({
      message: 'Checking for deployment updates & syncing...',
      type: 'info',
    });

    try {
      // 1. Check if a newer version has been deployed to the server
      const updateCheck = await checkForAppUpdate();
      if (updateCheck.hasUpdate) {
        setSyncToast({
          message: 'Reloading',
          type: 'updating',
        });
        // Brief pause so the user sees the confirmation message before reload
        await new Promise((resolve) => setTimeout(resolve, 650));
        await applyAppUpdate();
        return;
      }

      // 2. Fetch fresh data from Supabase in parallel
      const [freshQueries, freshAppointments, freshPresences, freshUsers] =
        await Promise.all([
          loadQueries(),
          loadAppointments(),
          loadPresences(),
          fetchUsersFromDb().catch(() => null),
        ]);

      if (freshUsers && freshUsers.length > 0) {
        setAllUsers(freshUsers);
      }

      // 3. Sync activities with fresh queries and appointments
      await loadActivities(freshQueries, freshAppointments);

      // 4. Run SLA delay checks & urgent notifications on fresh data
      if (freshQueries && freshQueries.length > 0) {
        await checkAndNotifyDelayedQueries(freshQueries);
        await checkAndNotifyUrgentReminders(freshQueries);
      }

      // 5. Update timestamp with DD-MM-YYYY format
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const dateStr = formatDate(now);
      setLastRefreshedAt(`${dateStr} ${hh}:${mm}:${ss}`);

      setSyncToast({
        message: '✓ All portal data is up to date and in sync',
        type: 'success',
      });
      setTimeout(() => {
        setSyncToast(null);
      }, 2500);
    } catch (err: unknown) {
      console.warn('[Refresh] Sync warning:', err);
      setSyncToast({
        message: '✓ Synced with local cache',
        type: 'success',
      });
      setTimeout(() => {
        setSyncToast(null);
      }, 2500);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 450);
    }
  }, [loadQueries, loadAppointments, loadActivities, loadPresences]);

  useEffect(() => {
    loadQueries();
    loadAppointments();
    loadActivities();
    loadPresences();

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
              const exists = prev.some(
                (c) => c.queryId.toUpperCase() === incoming.queryId.toUpperCase()
              );
              const next = exists
                ? prev.map((c) =>
                    c.queryId.toUpperCase() === incoming.queryId.toUpperCase() ? incoming : c
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

            if (updated.isUrgent) {
              if (isQueryDone(updated)) {
                markUrgentQueryFinished(updated.queryId);
              } else {
                unmarkUrgentQueryFinished(updated.queryId);
              }
            }

            setQueries((prev) => {
              const next = prev.map((c) =>
                c.queryId.toUpperCase() === updated.queryId.toUpperCase() ? updated : c
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
                  if (belongsToAccountManager(updated, user) || user.role === 'admin') {
                    showWebNotification(
                      '⏳ Extension Requested',
                      `Manager ${updated.managerName} requested completion extension for ${updated.queryId}`
                    );
                  }
                } else if (updated.extensionStatus === 'APPROVED') {
                  if (belongsToManager(updated, user) || user.role === 'admin') {
                    showWebNotification(
                      '✅ Extension Approved',
                      `Completion extension approved for ${updated.queryId}`
                    );
                  }
                } else if (updated.extensionStatus === 'DECLINED') {
                  if (belongsToManager(updated, user) || user.role === 'admin') {
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
                `${incoming.requesterName} requested "${incoming.title}" on ${formatDateTime(incoming.scheduledAt)}`
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
                  `"${updated.title}" is confirmed for ${formatDateTime(updated.scheduledAt)}`
                );
              } else if (
                updated.status === 'RESCHEDULE_PROPOSED' &&
                updated.rescheduleProposedBy !== user.id
              ) {
                showWebNotification(
                  '⏳ Reschedule Proposed',
                  `New time proposed for "${updated.title}": ${formatDateTime(updated.proposedScheduledAt) || 'new date'}`
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
                  `"${updated.title}" details were updated for ${formatDateTime(updated.scheduledAt)}.`
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

    // Realtime channel for live user activities (DB changes)
    const activityChannel = supabase
      .channel('public:user_activities')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_activities' },
        (payload) => {
          if (payload.new) {
            const incoming = mapRowToActivity(payload.new as ActivityRow);
            setActivities((prev) => {
              if (prev.some((a) => a.id === incoming.id)) return prev;
              const next = [incoming, ...prev];
              writeCachedActivities(next);
              return next;
            });
          }
        }
      )
      .subscribe();

    // Realtime channel for live user presence (DB changes)
    const presenceChannel = supabase
      .channel('public:user_presence')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_presence' },
        (payload) => {
          if (payload.new) {
            const incoming = mapRowToPresence(payload.new as PresenceRow);
            setPresences((prev) => {
              const next = { ...prev, [incoming.userId]: incoming };
              writeCachedPresences(next);
              return next;
            });
          }
        }
      )
      .subscribe();

    // Realtime WebSocket broadcast channel (Works WITHOUT ANY Supabase tables or migrations!)
    const broadcastTrackingChannel = getOrCreateTrackingChannel();
    broadcastTrackingChannel
      .on('broadcast', { event: 'user_activity' }, ({ payload }) => {
        if (payload) {
          const incoming = payload as UserActivity;
          setActivities((prev) => {
            if (prev.some((a) => a.id === incoming.id)) return prev;
            const next = [incoming, ...prev];
            writeCachedActivities(next);
            return next;
          });
        }
      })
      .on('broadcast', { event: 'user_presence' }, ({ payload }) => {
        if (payload) {
          const incoming = payload as UserPresence;
          setPresences((prev) => {
            const next = { ...prev, [incoming.userId]: incoming };
            writeCachedPresences(next);
            return next;
          });
        }
      })
      .on('broadcast', { event: 'user_presence_offline' }, ({ payload }) => {
        if (payload && payload.userId) {
          setPresences((prev) => {
            const current = prev[payload.userId];
            if (!current) return prev;
            const next = {
              ...prev,
              [payload.userId]: {
                ...current,
                isOnline: false,
                lastSeenAtMs: payload.lastSeenAtMs || Date.now(),
              },
            };
            writeCachedPresences(next);
            return next;
          });
        }
      })
      .subscribe();

    // Listen to local events for instantaneous 0ms local response
    const handleLocalActivity = (e: Event) => {
      const customEvent = e as CustomEvent<UserActivity>;
      if (customEvent.detail) {
        setActivities((prev) => {
          if (prev.some((a) => a.id === customEvent.detail.id)) return prev;
          const next = [customEvent.detail, ...prev];
          writeCachedActivities(next);
          return next;
        });
      }
    };

    const handleLocalPresence = (e: Event) => {
      const customEvent = e as CustomEvent<UserPresence>;
      if (customEvent.detail) {
        setPresences((prev) => {
          const next = { ...prev, [customEvent.detail.userId]: customEvent.detail };
          writeCachedPresences(next);
          return next;
        });
      }
    };

    window.addEventListener('wm_activity_logged', handleLocalActivity);
    window.addEventListener('wm_presence_updated', handleLocalPresence);

    // Cross-tab broadcast bus listener (instant 0ms sync between multiple tabs/windows)
    const crossTabBus = getCrossTabBus();
    const handleCrossTabMessage = (event: MessageEvent) => {
      const { type, data } = event.data || {};
      if (type === 'activity' && data) {
        setActivities((prev) => {
          if (prev.some((a) => a.id === data.id)) return prev;
          return [data, ...prev];
        });
      } else if (type === 'presence' && data) {
        setPresences((prev) => ({
          ...prev,
          [data.userId]: data,
        }));
      } else if (type === 'offline' && data) {
        setPresences((prev) => {
          const curr = prev[data.userId];
          if (!curr) return prev;
          return {
            ...prev,
            [data.userId]: {
              ...curr,
              isOnline: false,
              lastSeenAtMs: data.lastSeenAtMs || Date.now(),
            },
          };
        });
      } else if (data?.type === 'QUERY_UPDATED' && data.query) {
        if (data.query.isUrgent && isQueryDone(data.query)) {
          markUrgentQueryFinished(data.query.queryId);
        }
        setQueries((prev) => {
          const exists = prev.some(
            (c) => c.queryId.toUpperCase() === data.query.queryId.toUpperCase()
          );
          const next = exists
            ? prev.map((c) =>
                c.queryId.toUpperCase() === data.query.queryId.toUpperCase()
                  ? data.query
                  : c
              )
            : [data.query, ...prev];
          persistQueriesCache(next);
          return next;
        });
      } else if (data?.type === 'URGENT_QUERY_COMPLETED' && data.queryId) {
        markUrgentQueryFinished(data.queryId);
      }
    };

    if (crossTabBus) {
      crossTabBus.addEventListener('message', handleCrossTabMessage);
    }

    // Storage event listener fallback (detects when other tabs log in or out)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ACTIVITIES_STORAGE_KEY) {
        setActivities(readCachedActivities());
      } else if (e.key === PRESENCE_STORAGE_KEY) {
        setPresences(readCachedPresences());
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Relaxed background polling interval (10 minutes) to drastically reduce egress.
    // Supabase Realtime channels already receive live inserts, updates, and deletes instantaneously!
    const backgroundSyncTimer = setInterval(() => {
      if (document.hidden) return; // Completely pause polling when tab is hidden/minimized
      loadQueries();
      loadAppointments();
      loadPresences();
    }, 10 * 60 * 1000);

    // Window focus & tab visibility sync: throttled with a 2-minute cooldown to prevent refetch loops
    let lastFocusSyncMs = 0;
    const handleFocusSync = () => {
      const now = Date.now();
      if (now - lastFocusSyncMs < 120000) return;
      lastFocusSyncMs = now;
      loadQueries();
      loadAppointments();
      loadPresences();
    };
    window.addEventListener('focus', handleFocusSync);
    const handleVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        if (currentUserRef.current) {
          updateUserPresence(currentUserRef.current, activePage, undefined, true);
        }
        handleFocusSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilitySync);

    return () => {
      clearInterval(backgroundSyncTimer);
      window.removeEventListener('focus', handleFocusSync);
      document.removeEventListener('visibilitychange', handleVisibilitySync);
      supabase.removeChannel(queryChannel);
      supabase.removeChannel(aptChannel);
      supabase.removeChannel(activityChannel);
      supabase.removeChannel(presenceChannel);
      window.removeEventListener('wm_activity_logged', handleLocalActivity);
      window.removeEventListener('wm_presence_updated', handleLocalPresence);
      if (crossTabBus) {
        crossTabBus.removeEventListener('message', handleCrossTabMessage);
      }
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [loadQueries, loadAppointments, loadActivities, loadPresences]);

  // Real-time live presence heartbeat (paused when tab is hidden, relaxed from 25s to 45s)
  useEffect(() => {
    if (!currentUser) return;
    updateUserPresence(currentUser, activePage);
    const presenceTimer = setInterval(() => {
      if (currentUserRef.current && !document.hidden) {
        updateUserPresence(currentUserRef.current, activePage);
      }
    }, 45000);
    return () => clearInterval(presenceTimer);
  }, [currentUser, activePage]);

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    if (user.role === 'admin') {
      ensureUsersSeededInDb().catch(() => {});
    }
    setAllUsers((prev) => {
      if (prev.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
        return prev;
      }
      return [...prev, user];
    });
    setActivePage('home');
    try {
      sessionStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(user));
    } catch {
      // Ignore storage errors
    }
    logUserActivity({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      actionType: 'USER_LOGIN',
      actionTitle: `${user.name} logged in`,
      targetType: 'auth',
    });
    updateUserPresence(user, 'home', 'Logged into portal', true);
    loadActivities();
    loadPresences();
  };

  const handleLogout = () => {
    if (currentUser) {
      logUserActivity({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        actionType: 'USER_LOGOUT',
        actionTitle: `${currentUser.name} logged out`,
        targetType: 'auth',
      });
      setUserOffline(currentUser.id);
    }
    setCurrentUser(null);
    setActivePage('home');
    try {
      sessionStorage.removeItem(STORAGE_KEY_SESSION);
    } catch {
      // Ignore
    }
  };

  const formatTimestamp = (date: Date) => {
    return formatTimestampUtil(date);
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
    ccUsers?: QueryCCUser[];
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
      ccUsers: payload.ccUsers || [],
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

      // Log real-time activity
      logUserActivity({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        userRole: currentUser.role,
        actionType: 'QUERY_CREATED',
        actionTitle: `${currentUser.name} submitted Query ${data.queryId}`,
        actionDetails: `Assigned to ${data.managerName}: "${data.queryTitle || data.queryText.slice(0, 60)}"`,
        targetId: data.queryId,
        targetType: 'query',
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
        | 'managerAttachments'
        | 'remarks'
        | 'completedAt'
        | 'completedAtMs'
        | 'isDelayed'
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
  ) => {
    if (!currentUser) return;
    const existing = queries.find(
      (c) => c.queryId.trim().toUpperCase() === queryId.trim().toUpperCase()
    );
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

    // If an extension was approved (or is currently approved and within deadline), query is NOT delayed!
    const isApprovedExtActive =
      (updates.extensionStatus === 'APPROVED' ||
        (existing.extensionStatus === 'APPROVED' && updates.extensionStatus !== 'DECLINED')) &&
      effectiveDeadlineMs > 0 &&
      nowMs <= effectiveDeadlineMs;

    const wasAlreadyDelayed = isApprovedExtActive
      ? false
      : isQueryDelayed(existing, nowMs);

    const isUrgentQuery =
      updates.isUrgent !== undefined ? Boolean(updates.isUrgent) : Boolean(existing.isUrgent);

    // Track first manager remark timestamp for urgent queries SLA evaluation
    let nextFirstManagerRemarkAtMs = existing.firstManagerRemarkAtMs ?? null;
    const isAddingManagerRemarkNow =
      (updates.managerRemarkTitle !== undefined || updates.managerRemark !== undefined) &&
      Boolean((updates.managerRemarkTitle || '').trim() || (updates.managerRemark || '').trim());
    if (nextFirstManagerRemarkAtMs === null) {
      if (isAddingManagerRemarkNow) {
        nextFirstManagerRemarkAtMs = nowMs;
      } else {
        nextFirstManagerRemarkAtMs = getFirstManagerRemarkTimestampMs(existing);
      }
    }

    let nextIsDelayed = false;
    if (
      existing.queryId &&
      (existing.queryId.trim().toUpperCase() === 'QRY-009' ||
        existing.queryId.trim().toUpperCase() === 'QRY-005')
    ) {
      nextIsDelayed = false;
    } else if (isApprovedExtActive) {
      nextIsDelayed = false;
    } else if (isUrgentQuery) {
      const createdMs = getQueryTimestampMs(existing);
      if (nextFirstManagerRemarkAtMs !== null) {
        nextIsDelayed = nextFirstManagerRemarkAtMs > createdMs + URGENT_MANAGER_REMARK_WINDOW_MS;
      } else {
        nextIsDelayed = nowMs > createdMs + URGENT_MANAGER_REMARK_WINDOW_MS;
      }
    } else if (nextIsCompleted) {
      nextIsDelayed = Boolean(
        wasAlreadyDelayed ||
          (effectiveDeadlineMs > 0 &&
            nextCompletedAtMs !== null &&
            nextCompletedAtMs > effectiveDeadlineMs)
      );
    } else {
      nextIsDelayed = Boolean(effectiveDeadlineMs > 0 && nowMs > effectiveDeadlineMs);
    }

    if (nextIsCompleted && isUrgentQuery) {
      clearUrgentReminderLocally(queryId);
      markUrgentQueryFinished(queryId);
    } else if (!nextIsCompleted && isUrgentQuery) {
      unmarkUrgentQueryFinished(queryId);
    }

    const nextManagerRemarkTitle =
      updates.managerRemarkTitle !== undefined
        ? updates.managerRemarkTitle
        : existing.managerRemarkTitle;
    const nextManagerRemark =
      updates.managerRemark !== undefined
        ? updates.managerRemark
        : existing.managerRemark;

    const nextAccountManagerRemarkTitle =
      updates.accountManagerRemarkTitle !== undefined
        ? updates.accountManagerRemarkTitle
        : existing.accountManagerRemarkTitle;
    const nextAccountManagerRemark =
      updates.accountManagerRemark !== undefined
        ? updates.accountManagerRemark
        : existing.accountManagerRemark;

    // Synchronize remarks array so the details modal timeline and Supabase remarks_log are always in sync
    let nextRemarks = updates.remarks !== undefined ? updates.remarks : existing.remarks ? [...existing.remarks] : [];
    if (updates.remarks === undefined) {
      if (updates.accountManagerRemarkTitle !== undefined || updates.accountManagerRemark !== undefined) {
        const text = (nextAccountManagerRemark || nextAccountManagerRemarkTitle || '').trim();
        const title = (nextAccountManagerRemarkTitle || '').trim();
        if (text) {
          const finalTitle = title && title !== text ? title : undefined;
          const lastSenderIdx = [...nextRemarks].reverse().findIndex((r) => r.type === 'sender');
          const nowFormatted = formatDateTime(now, false);
          if (lastSenderIdx !== -1) {
            const actualIdx = nextRemarks.length - 1 - lastSenderIdx;
            nextRemarks[actualIdx] = {
              ...nextRemarks[actualIdx],
              title: finalTitle,
              text,
              createdAt: nowFormatted,
              createdAtMs: nowMs,
            };
          } else {
            nextRemarks.push({
              id: `rmk-sender-${nowMs}-${Math.random().toString(36).substring(2, 6)}`,
              authorId: currentUser.id,
              authorName: currentUser.name,
              authorRole: currentUser.role,
              type: 'sender',
              title: finalTitle,
              text,
              createdAt: nowFormatted,
              createdAtMs: nowMs,
            });
          }
        }
      }

      if (updates.managerRemarkTitle !== undefined || updates.managerRemark !== undefined) {
        const text = (nextManagerRemark || nextManagerRemarkTitle || '').trim();
        const title = (nextManagerRemarkTitle || '').trim();
        if (text) {
          const finalTitle = title && title !== text ? title : undefined;
          const lastMgrIdx = [...nextRemarks].reverse().findIndex((r) => r.type === 'manager');
          const nowFormatted = formatDateTime(now, false);
          if (lastMgrIdx !== -1) {
            const actualIdx = nextRemarks.length - 1 - lastMgrIdx;
            nextRemarks[actualIdx] = {
              ...nextRemarks[actualIdx],
              title: finalTitle,
              text,
              createdAt: nowFormatted,
              createdAtMs: nowMs,
            };
          } else {
            nextRemarks.push({
              id: `rmk-mgr-${nowMs}-${Math.random().toString(36).substring(2, 6)}`,
              authorId: currentUser.id,
              authorName: currentUser.name,
              authorRole: currentUser.role,
              type: 'manager',
              title: finalTitle,
              text,
              createdAt: nowFormatted,
              createdAtMs: nowMs,
            });
          }
        }
      }
    }

    const optimisticItem: Query = {
      ...existing,
      ...updates,
      remarks: nextRemarks,
      managerRemarkTitle: nextManagerRemarkTitle,
      managerRemark: nextManagerRemark,
      accountManagerRemarkTitle: nextAccountManagerRemarkTitle,
      accountManagerRemark: nextAccountManagerRemark,
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
      firstManagerRemarkAtMs: nextFirstManagerRemarkAtMs,
      adminCompletedBy:
        updates.adminCompletedBy !== undefined
          ? updates.adminCompletedBy
          : existing.adminCompletedBy,
      adminCompletedAt:
        updates.adminCompletedAt !== undefined
          ? updates.adminCompletedAt
          : existing.adminCompletedAt,
      adminCompletedAtMs:
        updates.adminCompletedAtMs !== undefined
          ? updates.adminCompletedAtMs
          : existing.adminCompletedAtMs,
      autoCompletedAt:
        updates.autoCompletedAt !== undefined
          ? updates.autoCompletedAt
          : existing.autoCompletedAt,
      autoCompletedAtMs:
        updates.autoCompletedAtMs !== undefined
          ? updates.autoCompletedAtMs
          : existing.autoCompletedAtMs,
      completionNote:
        updates.completionNote !== undefined
          ? updates.completionNote
          : existing.completionNote,
      ...(updates.ccUsers !== undefined ? { ccUsers: updates.ccUsers } : {}),
    };

    setSavingQueryId(queryId);

    setQueries((prev) => {
      const next = prev.map((item) =>
        item.queryId.toUpperCase() === queryId.toUpperCase() ? optimisticItem : item
      );
      persistQueriesCache(next);
      return next;
    });

    // Broadcast optimistic query update across browser tabs in 0ms
    const bus = getCrossTabBus();
    if (bus) {
      try {
        bus.postMessage({
          type: 'QUERY_UPDATED',
          query: optimisticItem,
        });
        if (nextIsCompleted && isUrgentQuery) {
          bus.postMessage({
            type: 'URGENT_QUERY_COMPLETED',
            queryId: optimisticItem.queryId,
          });
        }
      } catch {}
    }

    const dbPayload: Parameters<typeof updateQueryInDb>[1] = {
      ...updates,
      managerDone: nextManagerDone,
      managerDoneAt: nextManagerDoneAt,
      managerDoneAtMs: nextManagerDoneAtMs,
      accountManagerDone: nextAccountManagerDone,
      status: nextStatus,
      completedAt: nextCompletedAt,
      completedAtMs: nextCompletedAtMs,
      isDelayed: nextIsDelayed,
      firstManagerRemarkAtMs: nextFirstManagerRemarkAtMs,
    };

    if (
      updates.remarks !== undefined ||
      updates.managerRemark !== undefined ||
      updates.managerRemarkTitle !== undefined ||
      updates.accountManagerRemark !== undefined ||
      updates.accountManagerRemarkTitle !== undefined
    ) {
      dbPayload.remarks = nextRemarks;
      dbPayload.managerRemark = nextManagerRemark;
      dbPayload.managerRemarkTitle = nextManagerRemarkTitle;
      dbPayload.accountManagerRemark = nextAccountManagerRemark;
      dbPayload.accountManagerRemarkTitle = nextAccountManagerRemarkTitle;
    }

    const { data, error } = await updateQueryInDb(queryId, dbPayload);

    setSavingQueryId(null);

    if (error) {
      setDbError(error);
      // Roll back optimistic update on error
      setQueries((prev) => {
        const rolledBack = prev.map((item) =>
          item.queryId.toUpperCase() === queryId.toUpperCase() ? existing : item
        );
        persistQueriesCache(rolledBack);
        return rolledBack;
      });
    } else if (data) {
      setDbError(null);
      setQueries((prev) => {
        const next = prev.map((item) =>
          item.queryId.toUpperCase() === queryId.toUpperCase() ? data : item
        );
        persistQueriesCache(next);
        return next;
      });

      if (bus) {
        try {
          bus.postMessage({
            type: 'QUERY_UPDATED',
            query: data,
          });
          if (isQueryDone(data) && data.isUrgent) {
            bus.postMessage({
              type: 'URGENT_QUERY_COMPLETED',
              queryId: data.queryId,
            });
          }
        } catch {}
      }

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
      if (updates.extensionStatus === 'PENDING') {
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

      // Log granular real-time activities for tracking
      if (!existing.managerDone && updates.managerDone) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_MANAGER_DONE',
          actionTitle: `${currentUser.name} marked Query ${queryId} as Done`,
          actionDetails: updates.managerRemark || existing.managerRemark || 'Manager completed resolution.',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (!existing.accountManagerDone && updates.accountManagerDone) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_COMPLETED',
          actionTitle: `${currentUser.name} closed Query ${queryId}`,
          actionDetails: updates.rating ? `Mandatory Rating: ${updates.rating} stars` : 'Finalized by account manager.',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.extensionStatus === 'PENDING') {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_EXTENSION_REQUESTED',
          actionTitle: `${currentUser.name} requested extension for ${queryId}`,
          actionDetails: updates.extensionReason || 'Requested target date extension',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.extensionStatus === 'APPROVED' || updates.extensionStatus === 'DECLINED') {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_EXTENSION_RESOLVED',
          actionTitle: `${currentUser.name} ${updates.extensionStatus.toLowerCase()} extension for ${queryId}`,
          actionDetails: updates.extensionReviewNote || `Extension ${updates.extensionStatus.toLowerCase()}`,
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.adminReceiverRating && updates.adminReceiverRating !== existing.adminReceiverRating) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_RATED',
          actionTitle: `${currentUser.name} (Admin) rated Receiver on ${queryId} (${updates.adminReceiverRating}/10 stars)`,
          actionDetails: updates.adminReceiverRemark || 'Admin performance rating',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.adminSenderRating && updates.adminSenderRating !== existing.adminSenderRating) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_RATED',
          actionTitle: `${currentUser.name} (Admin) rated Sender on ${queryId} (${updates.adminSenderRating}/10 stars)`,
          actionDetails: updates.adminSenderRemark || 'Admin performance rating',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.receiverSenderRating && updates.receiverSenderRating !== existing.receiverSenderRating) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_RATED',
          actionTitle: `${currentUser.name} (Receiver) rated Sender on ${queryId} (${updates.receiverSenderRating}/10 stars)`,
          actionDetails: updates.receiverSenderRemark || 'Receiver performance review',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.senderReceiverRating && updates.senderReceiverRating !== existing.senderReceiverRating) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_RATED',
          actionTitle: `${currentUser.name} rated Manager on ${queryId} (${updates.senderReceiverRating}/10 stars)`,
          actionDetails: updates.senderReceiverRemark || 'Sender peer review',
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.rating && updates.rating !== existing.rating) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_RATED',
          actionTitle: `${currentUser.name} rated Query ${queryId} (${updates.rating} stars)`,
          targetId: queryId,
          targetType: 'query',
        });
      } else if (updates.rating === null && existing.rating) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_UPDATED',
          actionTitle: `${currentUser.name} cleared rating for Query ${queryId}`,
          targetId: queryId,
          targetType: 'query',
        });
      } else if (
        updates.managerRemark &&
        updates.managerRemark !== existing.managerRemark
      ) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_REMARK_ADDED',
          actionTitle: `${currentUser.name} added Manager remark on ${queryId}`,
          actionDetails: updates.managerRemark,
          targetId: queryId,
          targetType: 'query',
        });
      } else if (
        updates.accountManagerRemark &&
        updates.accountManagerRemark !== existing.accountManagerRemark
      ) {
        logUserActivity({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          userRole: currentUser.role,
          actionType: 'QUERY_REMARK_ADDED',
          actionTitle: `${currentUser.name} added AM remark on ${queryId}`,
          actionDetails: updates.accountManagerRemark,
          targetId: queryId,
          targetType: 'query',
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

    const createdAtStr = formatTimestamp(now);

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

    // Log real-time activity for tracking
    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      actionType: 'APPOINTMENT_BOOKED',
      actionTitle: `${currentUser.name} booked Appointment ${finalApt.id}: ${finalApt.title}`,
      actionDetails: `Scheduled for ${formatDateTime(finalApt.scheduledAt)} (${finalApt.meetingType})`,
      targetId: finalApt.id,
      targetType: 'appointment',
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

    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      actionType: 'APPOINTMENT_ACCEPTED',
      actionTitle: `${currentUser.name} accepted Appointment ${appointmentId}`,
      actionDetails: target.title,
      targetId: appointmentId,
      targetType: 'appointment',
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

    const proposedMs = parseDateToMs(proposedDateTime);
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
        parseDateToMs(target.proposedScheduledAt),
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

    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      actionType: 'APPOINTMENT_RESCHEDULED',
      actionTitle: `${currentUser.name} accepted reschedule for Appointment ${appointmentId}`,
      actionDetails: `Rescheduled to ${formatDateTime(updated.scheduledAt)}`,
      targetId: appointmentId,
      targetType: 'appointment',
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

    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      actionType: 'APPOINTMENT_DECLINED',
      actionTitle: `${currentUser.name} declined Appointment ${appointmentId}`,
      actionDetails: target.title,
      targetId: appointmentId,
      targetType: 'appointment',
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

    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      actionType: 'APPOINTMENT_CANCELLED',
      actionTitle: `${currentUser.name} cancelled Appointment ${appointmentId}`,
      actionDetails: 'Cancelled meeting',
      targetId: appointmentId,
      targetType: 'appointment',
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

    logUserActivity({
      userId: currentUser.id,
      userName: currentUser.name,
      userEmail: currentUser.email,
      userRole: currentUser.role,
      actionType: 'APPOINTMENT_CANCELLED',
      actionTitle: `${currentUser.name} cancelled Appointment ${appointmentId}`,
      actionDetails: remark ? `Reason: "${remark}"` : 'Cancelled meeting',
      targetId: appointmentId,
      targetType: 'appointment',
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
                onClick={() => loadQueries()}
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
              onClick={() => loadQueries()}
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
              onRefreshQueries={() => loadQueries(true)}
            />
          ) : activePage === 'tracking' ? (
            <TrackingPage
              currentUser={currentUser}
              users={allUsers}
              queries={queries}
              appointments={appointments}
              activities={activities}
              presences={presences}
              onNavigate={setActivePage}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />
          ) : activePage === 'my-trello' && (currentUser.role === 'admin' || currentUser.role === 'account_manager') ? (
            <MyTrello
              currentUser={currentUser}
              onLogActivity={(title, details) => {
                logUserActivity({
                  userId: currentUser.id,
                  userName: currentUser.name,
                  userEmail: currentUser.email,
                  userRole: currentUser.role,
                  actionType: 'PAGE_VIEW',
                  actionTitle: title,
                  actionDetails: details,
                });
              }}
            />
          ) : activePage === 'admin-trello' ? (
            <AdminTrello
              currentUser={currentUser}
              allUsers={allUsers}
              onLogActivity={(title, details) => {
                logUserActivity({
                  userId: currentUser.id,
                  userName: currentUser.name,
                  userEmail: currentUser.email,
                  userRole: currentUser.role,
                  actionType: 'PAGE_VIEW',
                  actionTitle: title,
                  actionDetails: details,
                });
              }}
            />
          ) : activePage === 'ratings' && currentUser.role === 'admin' ? (
            <RatingsPage
              currentUser={currentUser}
              allUsers={allUsers}
              queries={queries}
              onUpdateQuery={handleUpdateQuery}
              savingQueryId={savingQueryId}
            />
          ) : (
            <QueryPage
              currentUser={currentUser}
              queries={queries}
              savingQueryId={savingQueryId}
              appointments={appointments}
              initialFollowupAppointment={pendingFollowupAppointment}
              hasMoreQueries={hasMoreQueries}
              isAllQueriesLoaded={isAllQueriesLoaded}
              onLoadAllQueries={() => loadQueries(true)}
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

      {syncToast && (
        <aside
          className={`portal-sync-toast portal-sync-toast--${syncToast.type}`}
          role="status"
          aria-live="polite"
        >
          <span className="sync-toast-icon">
            {syncToast.type === 'updating'
              ? '🚀'
              : syncToast.type === 'success'
              ? '✓'
              : '🔄'}
          </span>
          <span className="sync-toast-message">{syncToast.message}</span>
        </aside>
      )}
    </div>
  );
};

export default App;
