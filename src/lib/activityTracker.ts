import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  ActivityActionType,
  ActivityCategory,
  Appointment,
  PageView,
  Query,
  UserAccount,
  UserActivity,
  UserPresence,
} from '../types';

const ACTIVITIES_STORAGE_KEY = 'wm_portal_activities_v2';
const PRESENCE_STORAGE_KEY = 'wm_portal_presence_v2';

export function detectDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }
  if (
    /Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(
      ua
    )
  ) {
    return 'mobile';
  }
  return 'desktop';
}

function formatCurrentTimestamp(date = new Date()): { formatted: string; epochMs: number } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return { formatted, epochMs: date.getTime() };
}

// Local cache helpers
export function readCachedActivities(): UserActivity[] {
  try {
    const raw = localStorage.getItem(ACTIVITIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCachedActivities(activities: UserActivity[]): void {
  try {
    const trimmed = activities.slice(0, 150);
    localStorage.setItem(ACTIVITIES_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota
  }
}

export function readCachedPresences(): Record<string, UserPresence> {
  try {
    const raw = localStorage.getItem(PRESENCE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCachedPresences(presences: Record<string, UserPresence>): void {
  try {
    localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(presences));
  } catch {
    // Ignore storage quota
  }
}

/**
 * Shared Supabase Realtime Channel for Broadcast & Presence.
 * Works WITHOUT ANY DATABASE TABLES OR SQL MIGRATIONS!
 */
let sharedTrackingChannel: RealtimeChannel | null = null;

export function getOrCreateTrackingChannel(): RealtimeChannel {
  if (!sharedTrackingChannel) {
    sharedTrackingChannel = supabase.channel('wmd_realtime_tracking', {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: '' },
      },
    });
  }
  return sharedTrackingChannel;
}

/**
 * Log a user action.
 * 1. Broadcasts to all connected devices in real time via Supabase WebSocket (No table needed!).
 * 2. Persists to local storage.
 * 3. Also tries database table if user created it (safe silent fallback).
 */
export async function logUserActivity(payload: {
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserAccount['role'];
  actionType: ActivityActionType;
  actionTitle: string;
  actionDetails?: string;
  targetId?: string | null;
  targetType?: 'query' | 'appointment' | 'auth' | 'navigation' | null;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
}): Promise<UserActivity> {
  const { formatted, epochMs } = formatCurrentTimestamp();
  const id = `act-${epochMs}-${Math.random().toString(36).substring(2, 7)}`;
  const device = payload.deviceType || detectDeviceType();

  let category: ActivityCategory = 'query';
  if (payload.actionType.startsWith('APPOINTMENT_')) category = 'appointment';
  else if (payload.actionType.startsWith('USER_')) category = 'auth';
  else if (payload.actionType === 'PAGE_VIEW') category = 'navigation';

  const activity: UserActivity = {
    id,
    userId: payload.userId,
    userName: payload.userName,
    userEmail: payload.userEmail,
    userRole: payload.userRole,
    actionType: payload.actionType,
    category,
    actionTitle: payload.actionTitle,
    actionDetails: payload.actionDetails || '',
    targetId: payload.targetId || null,
    targetType: payload.targetType || null,
    deviceType: device,
    createdAt: formatted,
    createdAtMs: epochMs,
  };

  // 1. Instant local persistence and event
  const cached = readCachedActivities();
  writeCachedActivities([activity, ...cached]);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('wm_activity_logged', { detail: activity }));
  }

  // 2. Broadcast to all other devices over Supabase Realtime WebSocket (Zero database tables needed!)
  try {
    const channel = getOrCreateTrackingChannel();
    channel.send({
      type: 'broadcast',
      event: 'user_activity',
      payload: activity,
    });
  } catch (err) {
    // Silent
  }

  // 3. Optional DB persistence if table was created in Supabase (never throws or blocks)
  try {
    supabase
      .from('user_activities')
      .insert({
        id: activity.id,
        user_id: activity.userId,
        user_name: activity.userName,
        user_email: activity.userEmail,
        user_role: activity.userRole,
        action_type: activity.actionType,
        action_title: activity.actionTitle,
        action_details: activity.actionDetails,
        target_id: activity.targetId,
        target_type: activity.targetType,
        device_type: activity.deviceType,
        created_at: activity.createdAt,
        created_at_ms: activity.createdAtMs,
      })
      .then(
        () => {},
        () => {}
      );
  } catch {
    // Silent
  }

  return activity;
}

// Throttle presence updates
let lastHeartbeatMs = 0;
let lastHeartbeatPage: PageView | null = null;

export async function updateUserPresence(
  user: UserAccount,
  currentPage: PageView,
  currentAction?: string,
  force = false
): Promise<void> {
  const nowMs = Date.now();
  if (!force && lastHeartbeatPage === currentPage && nowMs - lastHeartbeatMs < 20000) {
    return;
  }
  lastHeartbeatMs = nowMs;
  lastHeartbeatPage = currentPage;

  const { formatted, epochMs } = formatCurrentTimestamp();
  const device = detectDeviceType();

  const presence: UserPresence = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userRole: user.role,
    currentPage,
    currentAction: currentAction || `Viewing ${currentPage.toUpperCase()}`,
    deviceType: device,
    lastSeenAt: formatted,
    lastSeenAtMs: epochMs,
    isOnline: true,
  };

  // Cache locally
  const currentMap = readCachedPresences();
  currentMap[user.id] = presence;
  writeCachedPresences(currentMap);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('wm_presence_updated', { detail: presence }));
  }

  // Broadcast to other devices over Supabase Realtime channel
  try {
    const channel = getOrCreateTrackingChannel();
    channel.send({
      type: 'broadcast',
      event: 'user_presence',
      payload: presence,
    });
  } catch {
    // Silent
  }

  // Optional DB write
  try {
    supabase
      .from('user_presence')
      .upsert({
        user_id: presence.userId,
        user_name: presence.userName,
        user_email: presence.userEmail,
        user_role: presence.userRole,
        current_page: presence.currentPage,
        current_action: presence.currentAction,
        device_type: presence.deviceType,
        last_seen_at: presence.lastSeenAt,
        last_seen_at_ms: presence.lastSeenAtMs,
        is_online: true,
      })
      .then(
        () => {},
        () => {}
      );
  } catch {
    // Silent
  }
}

export async function setUserOffline(userId: string): Promise<void> {
  const currentMap = readCachedPresences();
  if (currentMap[userId]) {
    currentMap[userId].isOnline = false;
    currentMap[userId].lastSeenAtMs = Date.now();
    writeCachedPresences(currentMap);
  }

  try {
    const channel = getOrCreateTrackingChannel();
    channel.send({
      type: 'broadcast',
      event: 'user_presence_offline',
      payload: { userId, isOnline: false, lastSeenAtMs: Date.now() },
    });
  } catch {
    // Silent
  }
}

export interface ActivityRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  action_type: string;
  action_title: string;
  action_details?: string | null;
  target_id?: string | null;
  target_type?: string | null;
  device_type?: string | null;
  created_at: string;
  created_at_ms: number | string;
}

export function mapRowToActivity(row: ActivityRow): UserActivity {
  const actionType = row.action_type as ActivityActionType;
  let category: ActivityCategory = 'query';
  if (actionType.startsWith('APPOINTMENT_')) category = 'appointment';
  else if (actionType.startsWith('USER_')) category = 'auth';
  else if (actionType === 'PAGE_VIEW') category = 'navigation';

  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userRole: row.user_role as any,
    actionType,
    category,
    actionTitle: row.action_title,
    actionDetails: row.action_details || '',
    targetId: row.target_id || null,
    targetType: (row.target_type as any) || null,
    deviceType: (row.device_type as any) || 'desktop',
    createdAt: row.created_at,
    createdAtMs: Number(row.created_at_ms) || Date.now(),
  };
}

export interface PresenceRow {
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  current_page: string;
  current_action?: string | null;
  device_type?: string | null;
  last_seen_at: string;
  last_seen_at_ms: number | string;
  is_online?: boolean | null;
}

export function mapRowToPresence(row: PresenceRow): UserPresence {
  return {
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userRole: row.user_role as any,
    currentPage: (row.current_page as PageView) || 'home',
    currentAction: row.current_action || '',
    deviceType: (row.device_type as any) || 'desktop',
    lastSeenAt: row.last_seen_at,
    lastSeenAtMs: Number(row.last_seen_at_ms) || Date.now(),
    isOnline: row.is_online !== false,
  };
}

/**
 * Fetch activities: combines synthesized history from existing queries & appointments
 * with live logged/cached activities so the admin has 100% data visibility immediately
 * without requiring any Supabase SQL migrations.
 */
export async function fetchRecentActivitiesFromDb(
  existingQueries: Query[] = [],
  existingAppointments: Appointment[] = []
): Promise<UserActivity[]> {
  const localLogged = readCachedActivities();
  const synthesized = synthesizeHistoricalActivities(existingQueries, existingAppointments);

  // Attempt to check if DB table exists (optional)
  try {
    const { data, error } = await supabase
      .from('user_activities')
      .select('*')
      .order('created_at_ms', { ascending: false })
      .limit(80);

    if (!error && Array.isArray(data) && data.length > 0) {
      const dbActivities = data.map((row) => mapRowToActivity(row as ActivityRow));
      return mergeUniqueActivities(dbActivities, localLogged, synthesized);
    }
  } catch {
    // Silent
  }

  return mergeUniqueActivities(localLogged, synthesized);
}

function mergeUniqueActivities(...lists: UserActivity[][]): UserActivity[] {
  const map = new Map<string, UserActivity>();
  for (const list of lists) {
    for (const item of list) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
  }
  const merged = Array.from(map.values());
  merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return merged.slice(0, 150);
}

export async function fetchUserPresencesFromDb(): Promise<Record<string, UserPresence>> {
  const cached = readCachedPresences();
  try {
    const { data, error } = await supabase.from('user_presence').select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      const map: Record<string, UserPresence> = { ...cached };
      data.forEach((row) => {
        const pres = mapRowToPresence(row as PresenceRow);
        map[pres.userId] = pres;
      });
      writeCachedPresences(map);
      return map;
    }
  } catch {
    // Silent
  }
  return cached;
}

/**
 * Synthesizes historical activities directly from the existing queries and appointments.
 * Guarantees that all past user accomplishments are shown automatically!
 */
export function synthesizeHistoricalActivities(
  queries: Query[],
  appointments: Appointment[]
): UserActivity[] {
  const list: UserActivity[] = [];

  // 1. Queries
  for (const q of queries) {
    // Creation event
    list.push({
      id: `syn-q-create-${q.queryId}`,
      userId: q.accountManagerId,
      userName: q.accountManagerName,
      userEmail: q.accountManagerEmail,
      userRole: 'account_manager',
      actionType: 'QUERY_CREATED',
      category: 'query',
      actionTitle: `Submitted Query ${q.queryId}`,
      actionDetails: `Assigned to ${q.managerName}: "${q.queryTitle || q.queryText.slice(0, 55)}"`,
      targetId: q.queryId,
      targetType: 'query',
      deviceType: 'desktop',
      createdAt: q.createdAt,
      createdAtMs: q.createdAtMs,
    });

    // Manager done event
    if (q.managerDone && q.managerDoneAtMs) {
      list.push({
        id: `syn-q-mgrdone-${q.queryId}`,
        userId: q.managerId,
        userName: q.managerName,
        userEmail: q.managerEmail,
        userRole: 'manager',
        actionType: 'QUERY_MANAGER_DONE',
        category: 'query',
        actionTitle: `Marked Query ${q.queryId} Done`,
        actionDetails: q.managerRemark ? `Remark: "${q.managerRemark.slice(0, 70)}..."` : 'Tasks resolved',
        targetId: q.queryId,
        targetType: 'query',
        deviceType: 'desktop',
        createdAt: q.managerDoneAt || q.createdAt,
        createdAtMs: q.managerDoneAtMs,
      });
    }

    // Both done / Completed
    if (q.accountManagerDone && q.completedAtMs) {
      list.push({
        id: `syn-q-completed-${q.queryId}`,
        userId: q.accountManagerId,
        userName: q.accountManagerName,
        userEmail: q.accountManagerEmail,
        userRole: 'account_manager',
        actionType: 'QUERY_COMPLETED',
        category: 'query',
        actionTitle: `Closed Query ${q.queryId}`,
        actionDetails: q.rating ? `Closed with ${q.rating} star rating` : 'Query verified and finalized',
        targetId: q.queryId,
        targetType: 'query',
        deviceType: 'desktop',
        createdAt: q.completedAt || q.createdAt,
        createdAtMs: q.completedAtMs,
      });
    }

    // Extension requested
    if (q.extensionStatus && q.extensionStatus !== 'NONE' && q.extensionRequestedAt) {
      list.push({
        id: `syn-q-ext-${q.queryId}`,
        userId: q.managerId,
        userName: q.managerName,
        userEmail: q.managerEmail,
        userRole: 'manager',
        actionType: 'QUERY_EXTENSION_REQUESTED',
        category: 'query',
        actionTitle: `Requested Extension for ${q.queryId}`,
        actionDetails: q.extensionReason || 'Requested target due date extension',
        targetId: q.queryId,
        targetType: 'query',
        deviceType: 'desktop',
        createdAt: q.extensionRequestedAt,
        createdAtMs: q.extensionProposedDueAtMs || q.createdAtMs + 3600000,
      });
    }
  }

  // 2. Appointments
  for (const apt of appointments) {
    list.push({
      id: `syn-apt-book-${apt.id}`,
      userId: apt.requesterId,
      userName: apt.requesterName,
      userEmail: apt.requesterEmail,
      userRole: apt.requesterRole,
      actionType: 'APPOINTMENT_BOOKED',
      category: 'appointment',
      actionTitle: `Booked Appointment ${apt.id}: ${apt.title}`,
      actionDetails: `Scheduled for ${apt.scheduledAt} (${apt.meetingType})`,
      targetId: apt.id,
      targetType: 'appointment',
      deviceType: 'desktop',
      createdAt: apt.createdAt,
      createdAtMs: apt.createdAtMs,
    });

    if (apt.status === 'CONFIRMED' && apt.updatedAt) {
      list.push({
        id: `syn-apt-accept-${apt.id}`,
        userId: apt.receiverId || 'unknown',
        userName: apt.receiverName || 'Attendee',
        userEmail: apt.receiverEmail || '',
        userRole: apt.receiverRole || 'manager',
        actionType: 'APPOINTMENT_ACCEPTED',
        category: 'appointment',
        actionTitle: `Accepted Appointment ${apt.id}`,
        actionDetails: `Confirmed attendance for ${apt.title}`,
        targetId: apt.id,
        targetType: 'appointment',
        deviceType: 'desktop',
        createdAt: apt.updatedAt,
        createdAtMs: apt.createdAtMs + 60000,
      });
    }
  }

  list.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return list.slice(0, 100);
}

export function formatRelativeTime(epochMs: number): string {
  if (!epochMs) return 'Unknown';
  const diffSec = Math.floor((Date.now() - epochMs) / 1000);
  if (diffSec < 30) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  const date = new Date(epochMs);
  return `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}`;
}
