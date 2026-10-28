import { createClient } from '@supabase/supabase-js';
import {
  Query,
  QueryStatus,
  ExtensionStatus,
  DELAY_THRESHOLD_MS,
  getQueryDeadlineMs,
  UserAccount,
  Appointment,
  AppointmentAttendee,
  AppointmentStatus,
  MeetingType,
  UserRole,
} from '../types';
import { AUTHORIZED_USERS } from '../data/users';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://mjrqamakqqsqqmuvaqpw.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnFhbWFrcXFzcXFtdXZhcXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjQyOTgsImV4cCI6MjEwODA0MDI5OH0.5VWlGTl87khT4JHlLLoT8IAwmceToyNZcN2EjfDohKg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const OLD_COMPLETION_META_KEY = 'wm_portal_completion_meta_v1';
const COMPLETION_META_STORAGE_KEY = 'wm_portal_completion_meta_v2';

interface LocalCompletionMeta {
  completedAt?: string | null;
  completedAtMs?: number | null;
  managerDoneAt?: string | null;
  managerDoneAtMs?: number | null;
  isDelayed?: boolean;
  targetDueAt?: string | null;
  targetDueAtMs?: number | null;
  extensionStatus?: ExtensionStatus | null;
  extensionRequestedAt?: string | null;
  extensionProposedDueAt?: string | null;
  extensionProposedDueAtMs?: number | null;
  extensionReason?: string | null;
  extensionReviewNote?: string | null;
  extensionReviewedAt?: string | null;
  linkedAppointmentId?: string | null;
  isUrgent?: boolean;
  lastUrgentReminderAtMs?: number | null;
}

function readLocalCompletionMetaMap(): Record<string, LocalCompletionMeta> {
  try {
    localStorage.removeItem(OLD_COMPLETION_META_KEY);
    const raw = localStorage.getItem(COMPLETION_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLocalCompletionMeta(
  queryId: string,
  meta: Partial<LocalCompletionMeta>
): void {
  try {
    const current = readLocalCompletionMetaMap();
    current[queryId] = {
      ...(current[queryId] || {}),
      ...meta,
    };
    localStorage.setItem(COMPLETION_META_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export interface QueryRow {
  query_id: string;
  account_manager_id: string;
  account_manager_name: string;
  account_manager_email: string;
  manager_id: string;
  manager_name: string;
  manager_email: string;
  query_title?: string | null;
  query_text: string;
  manager_remark_title?: string | null;
  manager_remark: string;
  manager_done: boolean;
  manager_done_at?: string | null;
  manager_done_at_ms?: number | null;
  account_manager_remark_title?: string | null;
  account_manager_remark: string;
  account_manager_done: boolean;
  status: QueryStatus;
  created_at: string;
  created_at_ms: number;
  completed_at?: string | null;
  completed_at_ms?: number | null;
  is_delayed?: boolean | null;
  delay_notified?: boolean | null;
  rating?: number | null;
  target_due_at?: string | null;
  target_due_at_ms?: number | null;
  extension_status?: string | null;
  extension_requested_at?: string | null;
  extension_proposed_due_at?: string | null;
  extension_proposed_due_at_ms?: number | null;
  extension_reason?: string | null;
  extension_review_note?: string | null;
  extension_reviewed_at?: string | null;
  linked_appointment_id?: string | null;
  is_urgent?: boolean | null;
  last_urgent_reminder_at_ms?: number | null;
}

const TITLE_DESC_SEPARATOR = '\n<<<WMD_DESC>>>\n';

// Tracks whether the Supabase table has the dedicated *_title columns
let titleColumnsSupported: boolean | null = null;

export function packTitleAndDescription(
  title?: string | null,
  description?: string | null
): string {
  const cleanTitle = (title ?? '').trim();
  const cleanDesc = (description ?? '').trim();
  if (!cleanTitle && !cleanDesc) return '';
  return `${cleanTitle}${TITLE_DESC_SEPARATOR}${cleanDesc}`;
}

export function unpackTitleAndDescription(
  rawText?: string | null,
  explicitTitle?: string | null
): { title: string; description: string } {
  const raw = rawText ?? '';
  const hasExplicitTitle =
    explicitTitle !== undefined &&
    explicitTitle !== null &&
    explicitTitle.trim() !== '';

  if (raw.includes(TITLE_DESC_SEPARATOR)) {
    const [packedTitle, ...rest] = raw.split(TITLE_DESC_SEPARATOR);
    const unpackedDesc = rest.join(TITLE_DESC_SEPARATOR);
    return {
      title: hasExplicitTitle ? explicitTitle!.trim() : packedTitle.trim(),
      description: unpackedDesc.trim(),
    };
  }

  const trimmedRaw = raw.trim();
  if (hasExplicitTitle) {
    return {
      title: explicitTitle!.trim(),
      description: trimmedRaw,
    };
  }

  return {
    title: trimmedRaw,
    description: trimmedRaw,
  };
}

export function mapRowToQuery(row: QueryRow): Query {
  const managerDone = Boolean(row.manager_done);
  const accountManagerDone = Boolean(row.account_manager_done);
  const isDone = managerDone && accountManagerDone;
  const status: QueryStatus = isDone ? 'Completed' : 'Pending';

  const rawCreatedMs = Number(row.created_at_ms);
  const parsedCreatedMs = row.created_at
    ? Date.parse(row.created_at.replace(' ', 'T'))
    : 0;
  const createdAtMs =
    !Number.isNaN(rawCreatedMs) && rawCreatedMs > 0
      ? rawCreatedMs
      : !Number.isNaN(parsedCreatedMs) && parsedCreatedMs > 0
      ? parsedCreatedMs
      : 0;

  const localMeta = readLocalCompletionMetaMap()[row.query_id];

  const dbManagerDoneAtMs =
    row.manager_done_at_ms !== null && row.manager_done_at_ms !== undefined
      ? Number(row.manager_done_at_ms)
      : null;

  const managerDoneAtMs = managerDone
    ? dbManagerDoneAtMs && !Number.isNaN(dbManagerDoneAtMs) && dbManagerDoneAtMs > 0
      ? dbManagerDoneAtMs
      : localMeta?.managerDoneAtMs ?? null
    : null;

  const managerDoneAt = managerDone
    ? row.manager_done_at || localMeta?.managerDoneAt || null
    : null;

  const dbCompletedAtMs =
    row.completed_at_ms !== null && row.completed_at_ms !== undefined
      ? Number(row.completed_at_ms)
      : null;

  const completedAtMs = isDone
    ? dbCompletedAtMs && !Number.isNaN(dbCompletedAtMs) && dbCompletedAtMs > 0
      ? dbCompletedAtMs
      : localMeta?.completedAtMs ?? null
    : null;

  const completedAt = isDone
    ? row.completed_at || localMeta?.completedAt || null
    : null;

  const rawTargetDueAtMs =
    row.target_due_at_ms !== null && row.target_due_at_ms !== undefined
      ? Number(row.target_due_at_ms)
      : null;
  const targetDueAtMs =
    rawTargetDueAtMs && !Number.isNaN(rawTargetDueAtMs) && rawTargetDueAtMs > 0
      ? rawTargetDueAtMs
      : localMeta?.targetDueAtMs ?? null;

  const targetDueAt =
    row.target_due_at || localMeta?.targetDueAt || null;

  const extensionStatus =
    (row.extension_status as ExtensionStatus) || localMeta?.extensionStatus || 'NONE';

  const extensionRequestedAt =
    row.extension_requested_at || localMeta?.extensionRequestedAt || null;

  const rawProposedDueAtMs =
    row.extension_proposed_due_at_ms !== null && row.extension_proposed_due_at_ms !== undefined
      ? Number(row.extension_proposed_due_at_ms)
      : null;
  const extensionProposedDueAtMs =
    rawProposedDueAtMs && !Number.isNaN(rawProposedDueAtMs) && rawProposedDueAtMs > 0
      ? rawProposedDueAtMs
      : localMeta?.extensionProposedDueAtMs ?? null;

  const extensionProposedDueAt =
    row.extension_proposed_due_at || localMeta?.extensionProposedDueAt || null;

  const extensionReason =
    row.extension_reason || localMeta?.extensionReason || null;

  const extensionReviewNote =
    row.extension_review_note || localMeta?.extensionReviewNote || null;

  const extensionReviewedAt =
    row.extension_reviewed_at || localMeta?.extensionReviewedAt || null;

  const effectiveDeadlineMs =
    targetDueAtMs && targetDueAtMs > 0
      ? targetDueAtMs
      : createdAtMs > 0
      ? createdAtMs + DELAY_THRESHOLD_MS
      : 0;

  const computedDelayed = isDone
    ? completedAtMs && effectiveDeadlineMs > 0
      ? completedAtMs > effectiveDeadlineMs
      : Boolean(row.is_delayed === true || localMeta?.isDelayed === true)
    : Boolean(effectiveDeadlineMs > 0 && Date.now() > effectiveDeadlineMs);

  const unpackedQuery = unpackTitleAndDescription(
    row.query_text,
    row.query_title
  );
  const unpackedMgrRemark = unpackTitleAndDescription(
    row.manager_remark,
    row.manager_remark_title
  );
  const unpackedAmRemark = unpackTitleAndDescription(
    row.account_manager_remark,
    row.account_manager_remark_title
  );

  return {
    id: row.query_id,
    queryId: row.query_id,
    createdAt: row.created_at,
    createdAtMs,
    completedAt,
    completedAtMs,
    isDelayed: computedDelayed,
    accountManagerId: row.account_manager_id,
    accountManagerName: row.account_manager_name,
    accountManagerEmail: row.account_manager_email,
    managerId: row.manager_id,
    managerName: row.manager_name,
    managerEmail: row.manager_email,
    queryTitle: unpackedQuery.title,
    queryText: unpackedQuery.description,
    managerRemarkTitle: unpackedMgrRemark.title,
    managerRemark: unpackedMgrRemark.description,
    managerDone,
    managerDoneAt,
    managerDoneAtMs,
    accountManagerRemarkTitle: unpackedAmRemark.title,
    accountManagerRemark: unpackedAmRemark.description,
    accountManagerDone,
    status,
    delayNotified: Boolean(row.delay_notified),
    rating: typeof row.rating === 'number' ? row.rating : null,
    targetDueAt,
    targetDueAtMs,
    extensionStatus,
    extensionRequestedAt,
    extensionProposedDueAt,
    extensionProposedDueAtMs,
    extensionReason,
    extensionReviewNote,
    extensionReviewedAt,
    linkedAppointmentId:
      row.linked_appointment_id || localMeta?.linkedAppointmentId || null,
    isUrgent: Boolean(row.is_urgent === true || localMeta?.isUrgent === true),
    lastUrgentReminderAtMs:
      row.last_urgent_reminder_at_ms !== null && row.last_urgent_reminder_at_ms !== undefined
        ? Number(row.last_urgent_reminder_at_ms)
        : localMeta?.lastUrgentReminderAtMs ?? null,
  };
}

export function mapQueryToBaseRow(query: Query): QueryRow {
  const managerDone = Boolean(query.managerDone);
  const accountManagerDone = Boolean(query.accountManagerDone);
  const status: QueryStatus =
    managerDone && accountManagerDone ? 'Completed' : 'Pending';

  return {
    query_id: query.queryId,
    account_manager_id: query.accountManagerId,
    account_manager_name: query.accountManagerName,
    account_manager_email: query.accountManagerEmail,
    manager_id: query.managerId,
    manager_name: query.managerName,
    manager_email: query.managerEmail,
    query_text: packTitleAndDescription(
      query.queryTitle,
      query.queryText
    ),
    manager_remark: packTitleAndDescription(
      query.managerRemarkTitle,
      query.managerRemark
    ),
    manager_done: managerDone,
    account_manager_remark: packTitleAndDescription(
      query.accountManagerRemarkTitle,
      query.accountManagerRemark
    ),
    account_manager_done: accountManagerDone,
    status,
    created_at: query.createdAt,
    created_at_ms: query.createdAtMs,
    rating: query.rating ?? null,
    is_urgent: Boolean(query.isUrgent),
  };
}

export async function ensureUsersSeededInDb(): Promise<void> {
  try {
    const userRows = AUTHORIZED_USERS.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      role_label: u.roleLabel,
      avatar_initials: u.avatarInitials,
      phone: u.phone || null,
    }));
    const { error } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
    if (error && error.message.includes('phone')) {
      const fallbackRows = AUTHORIZED_USERS.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        role_label: u.roleLabel,
        avatar_initials: u.avatarInitials,
      }));
      await supabase.from('users').upsert(fallbackRows, { onConflict: 'id' });
    }
  } catch {
    // Non-blocking if table does not exist yet
  }
}

export async function fetchUsersFromDb(): Promise<UserAccount[]> {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error || !data) return AUTHORIZED_USERS;

    return AUTHORIZED_USERS.map((localUser) => {
      const dbMatch = (data as { id: string; phone?: string }[]).find(
        (d) => d.id === localUser.id
      );
      if (dbMatch) {
        return {
          ...localUser,
          phone: dbMatch.phone || localUser.phone || '',
        };
      }
      return localUser;
    });
  } catch {
    return AUTHORIZED_USERS;
  }
}

export async function updateUserSettingsInDb(
  userId: string,
  settings: { phone?: string }
): Promise<void> {
  try {
    const updates: Record<string, string | null> = {};
    if (settings.phone !== undefined) {
      updates.phone = settings.phone.trim() || null;
    }
    await supabase.from('users').update(updates).eq('id', userId);
  } catch {
    // Non-blocking
  }
}

export async function fetchQueriesFromDb(): Promise<{
  data: Query[];
  tableMissing: boolean;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('queries')
    .select('*')
    .order('created_at_ms', { ascending: false });

  if (error) {
    const isMissingTable =
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      error.message?.includes("Could not find the table 'public.queries'");

    return {
      data: [],
      tableMissing: isMissingTable,
      error: error.message,
    };
  }

  const rows = (data || []) as QueryRow[];
  if (rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
    titleColumnsSupported = 'query_title' in rows[0];
  }

  const mapped = rows.map(mapRowToQuery);
  return {
    data: mapped,
    tableMissing: false,
    error: null,
  };
}

function isMissingTitleColumnError(message?: string): boolean {
  if (!message) return false;
  return (
    message.includes('query_title') ||
    message.includes('manager_remark_title') ||
    message.includes('account_manager_remark_title')
  );
}

function isMissingExtendedColumnError(message?: string): boolean {
  if (!message) return false;
  return (
    message.includes('completed_at') ||
    message.includes('completed_at_ms') ||
    message.includes('is_delayed') ||
    message.includes('manager_done_at') ||
    message.includes('manager_done_at_ms') ||
    message.includes('rating') ||
    message.includes('target_due_at') ||
    message.includes('target_due_at_ms') ||
    message.includes('extension_status') ||
    message.includes('extension_requested_at') ||
    message.includes('extension_proposed_due_at') ||
    message.includes('extension_proposed_due_at_ms') ||
    message.includes('extension_reason') ||
    message.includes('extension_review_note') ||
    message.includes('extension_reviewed_at') ||
    message.includes('linked_appointment_id') ||
    message.includes('is_urgent') ||
    message.includes('last_urgent_reminder_at_ms')
  );
}

async function computeNextQueryIdFromDb(): Promise<string> {
  const { data } = await supabase
    .from('queries')
    .select('query_id');
  let maxNum = 0;
  for (const row of (data || []) as { query_id?: string }[]) {
    const match = row.query_id?.match(/QRY-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `QRY-${String(maxNum + 1).padStart(3, '0')}`;
}

export async function insertQueryInDb(query: Query): Promise<{
  data: Query | null;
  error: string | null;
}> {
  const baseRow = mapQueryToBaseRow(query);
  const extendedRow: QueryRow = {
    ...baseRow,
    completed_at: query.completedAt ?? null,
    completed_at_ms: query.completedAtMs ?? null,
    manager_done_at: query.managerDoneAt ?? null,
    manager_done_at_ms: query.managerDoneAtMs ?? null,
    is_delayed: Boolean(query.isDelayed),
    linked_appointment_id: query.linkedAppointmentId ?? null,
    is_urgent: Boolean(query.isUrgent),
    last_urgent_reminder_at_ms: query.lastUrgentReminderAtMs ?? null,
  };
  if (query.linkedAppointmentId || query.isUrgent) {
    saveLocalCompletionMeta(query.queryId, {
      completedAt: query.completedAt ?? null,
      completedAtMs: query.completedAtMs ?? null,
      isDelayed: Boolean(query.isDelayed),
      linkedAppointmentId: query.linkedAppointmentId,
      isUrgent: Boolean(query.isUrgent),
    });
  }

  const rowToInsert: QueryRow =
    titleColumnsSupported !== false
      ? {
          ...extendedRow,
          query_title: (query.queryTitle || '').trim(),
          manager_remark_title: (query.managerRemarkTitle || '').trim(),
          account_manager_remark_title: (
            query.accountManagerRemarkTitle || ''
          ).trim(),
        }
      : extendedRow;

  let { data, error } = await supabase
    .from('queries')
    .insert([rowToInsert])
    .select('*')
    .single();

  if (error && isMissingTitleColumnError(error.message)) {
    titleColumnsSupported = false;
    const retryWithoutTitles = await supabase
      .from('queries')
      .insert([extendedRow])
      .select('*')
      .single();
    data = retryWithoutTitles.data;
    error = retryWithoutTitles.error;
  }

  // Fallback if user hasn't run ALTER TABLE for completed_at / is_delayed yet
  if (error && isMissingExtendedColumnError(error.message)) {
    const retryBase = await supabase
      .from('queries')
      .insert([baseRow])
      .select('*')
      .single();
    data = retryBase.data;
    error = retryBase.error;
  }

  // Handle duplicate query_id collision automatically by fetching max ID from DB
  if (error && (error.code === '23505' || error.message?.includes('duplicate key'))) {
    const nextId = await computeNextQueryIdFromDb();
    const retryRow = { ...extendedRow, query_id: nextId };
    const retryDuplicate = await supabase
      .from('queries')
      .insert([retryRow])
      .select('*')
      .single();
    data = retryDuplicate.data;
    error = retryDuplicate.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: mapRowToQuery(data as QueryRow),
    error: null,
  };
}

export async function updateQueryInDb(
  queryId: string,
  updates: {
    queryTitle?: string;
    queryText?: string;
    managerRemarkTitle?: string;
    managerRemark?: string;
    managerDone?: boolean;
    managerDoneAt?: string | null;
    managerDoneAtMs?: number | null;
    accountManagerRemarkTitle?: string;
    accountManagerRemark?: string;
    accountManagerDone?: boolean;
    status?: QueryStatus;
    completedAt?: string | null;
    completedAtMs?: number | null;
    isDelayed?: boolean;
    rating?: number | null;
    targetDueAt?: string | null;
    targetDueAtMs?: number | null;
    extensionStatus?: ExtensionStatus | null;
    extensionRequestedAt?: string | null;
    extensionProposedDueAt?: string | null;
    extensionProposedDueAtMs?: number | null;
    extensionReason?: string | null;
    extensionReviewNote?: string | null;
    extensionReviewedAt?: string | null;
    linkedAppointmentId?: string | null;
    isUrgent?: boolean;
    lastUrgentReminderAtMs?: number | null;
  }
): Promise<{
  data: Query | null;
  error: string | null;
}> {
  const baseUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) {
    baseUpdates.status = updates.status;
  }

  if (updates.queryTitle !== undefined || updates.queryText !== undefined) {
    baseUpdates.query_text = packTitleAndDescription(
      updates.queryTitle,
      updates.queryText
    );
  }
  if (updates.managerRemarkTitle !== undefined || updates.managerRemark !== undefined) {
    baseUpdates.manager_remark = packTitleAndDescription(
      updates.managerRemarkTitle,
      updates.managerRemark
    );
  }
  if (updates.managerDone !== undefined) {
    baseUpdates.manager_done = updates.managerDone;
  }
  if (
    updates.accountManagerRemarkTitle !== undefined ||
    updates.accountManagerRemark !== undefined
  ) {
    baseUpdates.account_manager_remark = packTitleAndDescription(
      updates.accountManagerRemarkTitle,
      updates.accountManagerRemark
    );
  }
  if (updates.accountManagerDone !== undefined) {
    baseUpdates.account_manager_done = updates.accountManagerDone;
  }

  const extendedUpdates: Record<string, unknown> = {
    ...baseUpdates,
  };
  if (updates.managerDoneAt !== undefined) {
    extendedUpdates.manager_done_at = updates.managerDoneAt;
  }
  if (updates.managerDoneAtMs !== undefined) {
    extendedUpdates.manager_done_at_ms = updates.managerDoneAtMs;
  }
  if (updates.completedAt !== undefined) {
    extendedUpdates.completed_at = updates.completedAt;
  }
  if (updates.completedAtMs !== undefined) {
    extendedUpdates.completed_at_ms = updates.completedAtMs;
  }
  if (updates.isDelayed !== undefined) {
    extendedUpdates.is_delayed = updates.isDelayed;
  }
  if (updates.rating !== undefined) {
    extendedUpdates.rating = updates.rating;
  }
  if (updates.targetDueAt !== undefined) {
    extendedUpdates.target_due_at = updates.targetDueAt;
  }
  if (updates.targetDueAtMs !== undefined) {
    extendedUpdates.target_due_at_ms = updates.targetDueAtMs;
  }
  if (updates.extensionStatus !== undefined) {
    extendedUpdates.extension_status = updates.extensionStatus;
  }
  if (updates.extensionRequestedAt !== undefined) {
    extendedUpdates.extension_requested_at = updates.extensionRequestedAt;
  }
  if (updates.extensionProposedDueAt !== undefined) {
    extendedUpdates.extension_proposed_due_at = updates.extensionProposedDueAt;
  }
  if (updates.extensionProposedDueAtMs !== undefined) {
    extendedUpdates.extension_proposed_due_at_ms = updates.extensionProposedDueAtMs;
  }
  if (updates.extensionReason !== undefined) {
    extendedUpdates.extension_reason = updates.extensionReason;
  }
  if (updates.extensionReviewNote !== undefined) {
    extendedUpdates.extension_review_note = updates.extensionReviewNote;
  }
  if (updates.extensionReviewedAt !== undefined) {
    extendedUpdates.extension_reviewed_at = updates.extensionReviewedAt;
  }
  if (updates.linkedAppointmentId !== undefined) {
    extendedUpdates.linked_appointment_id = updates.linkedAppointmentId;
  }
  if (updates.isUrgent !== undefined) {
    extendedUpdates.is_urgent = updates.isUrgent;
  }
  if (updates.lastUrgentReminderAtMs !== undefined) {
    extendedUpdates.last_urgent_reminder_at_ms = updates.lastUrgentReminderAtMs;
  }

  const updatesWithTitles: Record<string, unknown> =
    titleColumnsSupported !== false
      ? {
          ...extendedUpdates,
          ...(updates.queryTitle !== undefined
            ? { query_title: updates.queryTitle.trim() }
            : {}),
          ...(updates.managerRemarkTitle !== undefined
            ? { manager_remark_title: updates.managerRemarkTitle.trim() }
            : {}),
          ...(updates.accountManagerRemarkTitle !== undefined
            ? {
                account_manager_remark_title:
                  updates.accountManagerRemarkTitle.trim(),
              }
            : {}),
        }
      : extendedUpdates;

  // Persist locally as well so delayed-on-completion, manager-done, and extension tracking work even before SQL migration is run
  if (
    updates.completedAt !== undefined ||
    updates.completedAtMs !== undefined ||
    updates.managerDoneAt !== undefined ||
    updates.managerDoneAtMs !== undefined ||
    updates.isDelayed !== undefined ||
    updates.targetDueAt !== undefined ||
    updates.targetDueAtMs !== undefined ||
    updates.extensionStatus !== undefined ||
    updates.extensionProposedDueAt !== undefined ||
    updates.extensionReason !== undefined ||
    updates.linkedAppointmentId !== undefined ||
    updates.isUrgent !== undefined ||
    updates.lastUrgentReminderAtMs !== undefined
  ) {
    saveLocalCompletionMeta(queryId, {
      ...(updates.completedAt !== undefined ? { completedAt: updates.completedAt } : {}),
      ...(updates.completedAtMs !== undefined ? { completedAtMs: updates.completedAtMs } : {}),
      ...(updates.managerDoneAt !== undefined ? { managerDoneAt: updates.managerDoneAt } : {}),
      ...(updates.managerDoneAtMs !== undefined ? { managerDoneAtMs: updates.managerDoneAtMs } : {}),
      ...(updates.isDelayed !== undefined ? { isDelayed: Boolean(updates.isDelayed) } : {}),
      ...(updates.targetDueAt !== undefined ? { targetDueAt: updates.targetDueAt } : {}),
      ...(updates.targetDueAtMs !== undefined ? { targetDueAtMs: updates.targetDueAtMs } : {}),
      ...(updates.extensionStatus !== undefined ? { extensionStatus: updates.extensionStatus } : {}),
      ...(updates.extensionRequestedAt !== undefined ? { extensionRequestedAt: updates.extensionRequestedAt } : {}),
      ...(updates.extensionProposedDueAt !== undefined ? { extensionProposedDueAt: updates.extensionProposedDueAt } : {}),
      ...(updates.extensionProposedDueAtMs !== undefined ? { extensionProposedDueAtMs: updates.extensionProposedDueAtMs } : {}),
      ...(updates.extensionReason !== undefined ? { extensionReason: updates.extensionReason } : {}),
      ...(updates.extensionReviewNote !== undefined ? { extensionReviewNote: updates.extensionReviewNote } : {}),
      ...(updates.extensionReviewedAt !== undefined ? { extensionReviewedAt: updates.extensionReviewedAt } : {}),
      ...(updates.linkedAppointmentId !== undefined
        ? { linkedAppointmentId: updates.linkedAppointmentId }
        : {}),
      ...(updates.isUrgent !== undefined ? { isUrgent: Boolean(updates.isUrgent) } : {}),
      ...(updates.lastUrgentReminderAtMs !== undefined
        ? { lastUrgentReminderAtMs: updates.lastUrgentReminderAtMs }
        : {}),
    });
  }

  // Note: created_at and created_at_ms are intentionally NEVER included in updates
  // so the original creation timestamp is strictly preserved.
  let { data, error } = await supabase
    .from('queries')
    .update(updatesWithTitles)
    .eq('query_id', queryId)
    .select('*')
    .single();

  if (error && isMissingTitleColumnError(error.message)) {
    titleColumnsSupported = false;
    const retryWithoutTitles = await supabase
      .from('queries')
      .update(extendedUpdates)
      .eq('query_id', queryId)
      .select('*')
      .single();
    data = retryWithoutTitles.data;
    error = retryWithoutTitles.error;
  }

  if (error && isMissingExtendedColumnError(error.message)) {
    const retryBase =
      Object.keys(baseUpdates).length > 0
        ? await supabase
            .from('queries')
            .update(baseUpdates)
            .eq('query_id', queryId)
            .select('*')
            .single()
        : await supabase
            .from('queries')
            .select('*')
            .eq('query_id', queryId)
            .single();
    data = retryBase.data;
    error = retryBase.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: mapRowToQuery(data as QueryRow),
    error: null,
  };
}

// ============================================================================
// Appointments Database Interface & Realtime Helpers
// ============================================================================

export const STORAGE_KEY_APPOINTMENTS = 'wm_portal_appointments_v2';

export interface AppointmentRow {
  id: string;
  title: string;
  agenda?: string | null;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  requester_role: string;
  receiver_id?: string | null;
  receiver_name?: string | null;
  receiver_email?: string | null;
  receiver_role?: string | null;
  attendees_json?: string | null;
  scheduled_at: string;
  scheduled_at_ms: number;
  duration_minutes?: number | null;
  meeting_type?: string | null;
  meeting_location?: string | null;
  status: string;
  reschedule_proposed_by?: string | null;
  proposed_scheduled_at?: string | null;
  proposed_scheduled_at_ms?: number | null;
  reschedule_reason?: string | null;
  cancellation_remark?: string | null;
  cancelled_at?: string | null;
  query_id?: string | null;
  created_at: string;
  created_at_ms: number;
  updated_at?: string | null;
}

const APT_META_SEPARATOR = '\n<<<WMD_APT_META>>>\n';

interface PackedAppointmentMeta {
  attendees?: AppointmentAttendee[];
  cancellationRemark?: string | null;
  cancelledAt?: string | null;
  queryId?: string | null;
}

export function packAppointmentAgenda(
  agenda?: string | null,
  meta?: PackedAppointmentMeta
): string {
  const cleanAgenda = (agenda ?? '').split(APT_META_SEPARATOR)[0].trim();
  if (
    !meta ||
    ((!meta.attendees || meta.attendees.length === 0) &&
      !meta.cancellationRemark &&
      !meta.cancelledAt &&
      !meta.queryId)
  ) {
    return cleanAgenda;
  }
  return `${cleanAgenda}${APT_META_SEPARATOR}${JSON.stringify(meta)}`;
}

export function unpackAppointmentAgenda(rawAgenda?: string | null): {
  agenda: string;
  meta: PackedAppointmentMeta;
} {
  const raw = rawAgenda ?? '';
  if (raw.includes(APT_META_SEPARATOR)) {
    const [cleanAgenda, ...rest] = raw.split(APT_META_SEPARATOR);
    const metaJson = rest.join(APT_META_SEPARATOR);
    try {
      const parsed = JSON.parse(metaJson) as PackedAppointmentMeta;
      return {
        agenda: cleanAgenda.trim(),
        meta: parsed && typeof parsed === 'object' ? parsed : {},
      };
    } catch {
      return { agenda: cleanAgenda.trim(), meta: {} };
    }
  }
  return { agenda: raw.trim(), meta: {} };
}

export function mapRowToAppointment(row: AppointmentRow): Appointment {
  const scheduledAtMs =
    Number(row.scheduled_at_ms) && !Number.isNaN(Number(row.scheduled_at_ms))
      ? Number(row.scheduled_at_ms)
      : row.scheduled_at
      ? Date.parse(row.scheduled_at.replace(' ', 'T')) || 0
      : 0;

  const createdAtMs =
    Number(row.created_at_ms) && !Number.isNaN(Number(row.created_at_ms))
      ? Number(row.created_at_ms)
      : row.created_at
      ? Date.parse(row.created_at.replace(' ', 'T')) || Date.now()
      : Date.now();

  const { agenda: unpackedAgenda, meta: packedMeta } = unpackAppointmentAgenda(
    row.agenda
  );

  let parsedAttendees: AppointmentAttendee[] = [];
  if (row.attendees_json) {
    try {
      const parsed = JSON.parse(row.attendees_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsedAttendees = parsed;
      }
    } catch {
      // Fallback
    }
  }

  if (
    parsedAttendees.length === 0 &&
    Array.isArray(packedMeta.attendees) &&
    packedMeta.attendees.length > 0
  ) {
    parsedAttendees = packedMeta.attendees;
  }

  // Fallback if attendees_json / packed meta wasn't set: reconstruct from receiver_name & receiver_id
  if (parsedAttendees.length === 0) {
    if (row.receiver_name && row.receiver_name.includes(',')) {
      const names = row.receiver_name
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      const matchedUsers: AppointmentAttendee[] = [];
      for (const name of names) {
        const found = AUTHORIZED_USERS.find(
          (u) => u.name.toLowerCase() === name.toLowerCase()
        );
        if (found) {
          matchedUsers.push({
            id: found.id,
            name: found.name,
            email: found.email,
            role: found.role,
          });
        }
      }
      if (matchedUsers.length > 0) {
        parsedAttendees = matchedUsers;
      }
    }

    if (parsedAttendees.length === 0 && row.receiver_id) {
      const foundById = AUTHORIZED_USERS.find((u) => u.id === row.receiver_id);
      parsedAttendees = [
        {
          id: row.receiver_id,
          name: row.receiver_name || foundById?.name || 'Attendee',
          email: row.receiver_email || foundById?.email || '',
          role:
            (row.receiver_role as UserRole) || foundById?.role || 'manager',
        },
      ];
    }
  }

  const primaryReceiverName =
    parsedAttendees.map((a) => a.name).join(', ') || row.receiver_name || '';

  return {
    id: row.id,
    title: row.title,
    agenda: unpackedAgenda,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    requesterRole: (row.requester_role as UserRole) || 'account_manager',
    attendees: parsedAttendees,
    receiverId: parsedAttendees[0]?.id || row.receiver_id || '',
    receiverName: primaryReceiverName,
    receiverEmail: parsedAttendees[0]?.email || row.receiver_email || '',
    receiverRole:
      parsedAttendees[0]?.role ||
      (row.receiver_role as UserRole) ||
      'manager',
    scheduledAt: row.scheduled_at,
    scheduledAtMs,
    durationMinutes: Number(row.duration_minutes) || 30,
    meetingType: (row.meeting_type as MeetingType) || 'Online Call',
    meetingLocation: row.meeting_location || '',
    status: (row.status as AppointmentStatus) || 'PENDING',
    rescheduleProposedBy: row.reschedule_proposed_by || null,
    proposedScheduledAt: row.proposed_scheduled_at || null,
    proposedScheduledAtMs: row.proposed_scheduled_at_ms
      ? Number(row.proposed_scheduled_at_ms)
      : null,
    rescheduleReason: row.reschedule_reason || null,
    cancellationRemark:
      row.cancellation_remark || packedMeta.cancellationRemark || null,
    cancelledAt: row.cancelled_at || packedMeta.cancelledAt || null,
    queryId: row.query_id || packedMeta.queryId || null,
    createdAt: row.created_at,
    createdAtMs,
    updatedAt: row.updated_at || null,
  };
}

export function mapAppointmentToRow(apt: Appointment): AppointmentRow {
  const primaryAttendee = apt.attendees?.[0];
  const combinedNames =
    apt.attendees && apt.attendees.length > 0
      ? apt.attendees.map((a) => a.name).join(', ')
      : apt.receiverName || '';

  const packedAgenda = packAppointmentAgenda(apt.agenda, {
    attendees: apt.attendees || [],
    cancellationRemark: apt.cancellationRemark || null,
    cancelledAt: apt.cancelledAt || null,
    queryId: apt.queryId || null,
  });

  return {
    id: apt.id,
    title: apt.title,
    agenda: packedAgenda,
    requester_id: apt.requesterId,
    requester_name: apt.requesterName,
    requester_email: apt.requesterEmail,
    requester_role: apt.requesterRole,
    receiver_id: primaryAttendee?.id || apt.receiverId || '',
    receiver_name: combinedNames,
    receiver_email: primaryAttendee?.email || apt.receiverEmail || '',
    receiver_role: primaryAttendee?.role || apt.receiverRole || 'manager',
    scheduled_at: apt.scheduledAt,
    scheduled_at_ms: apt.scheduledAtMs,
    duration_minutes: apt.durationMinutes || 30,
    meeting_type: apt.meetingType || 'Online Call',
    meeting_location: apt.meetingLocation || '',
    status: apt.status || 'PENDING',
    reschedule_proposed_by: apt.rescheduleProposedBy || null,
    proposed_scheduled_at: apt.proposedScheduledAt || null,
    proposed_scheduled_at_ms: apt.proposedScheduledAtMs || null,
    reschedule_reason: apt.rescheduleReason || null,
    query_id: apt.queryId || null,
    created_at: apt.createdAt,
    created_at_ms: apt.createdAtMs,
    updated_at: apt.updatedAt || null,
  };
}

export function readCachedAppointments(): Appointment[] {
  try {
    localStorage.removeItem('wm_portal_appointments_v1');
    const raw = localStorage.getItem(STORAGE_KEY_APPOINTMENTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCachedAppointments(list: Appointment[]): void {
  try {
    localStorage.removeItem('wm_portal_appointments_v1');
    localStorage.setItem(STORAGE_KEY_APPOINTMENTS, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors
  }
}

export async function fetchAppointmentsFromDb(): Promise<{
  data: Appointment[];
  tableMissing: boolean;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .order('scheduled_at_ms', { ascending: true });

  if (error) {
    const isTableMissing =
      error.code === '42P01' ||
      error.message?.toLowerCase().includes('relation') ||
      error.message?.toLowerCase().includes('appointments');

    const cached = readCachedAppointments();
    return {
      data: cached,
      tableMissing: isTableMissing,
      error: error.message,
    };
  }

  const rows = (data || []) as AppointmentRow[];
  const mapped = rows.map(mapRowToAppointment);
  writeCachedAppointments(mapped);

  return {
    data: mapped,
    tableMissing: false,
    error: null,
  };
}

async function computeNextAppointmentIdFromDb(): Promise<string> {
  const { data } = await supabase.from('appointments').select('id');
  let maxNum = 0;
  for (const row of (data || []) as { id?: string }[]) {
    const match = row.id?.match(/APT-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `APT-${String(maxNum + 1).padStart(3, '0')}`;
}

export async function insertAppointmentInDb(
  appointment: Appointment
): Promise<{ data: Appointment; error: string | null }> {
  const row = mapAppointmentToRow(appointment);

  let { data, error } = await supabase
    .from('appointments')
    .insert([row])
    .select('*')
    .single();

  // Retry if foreign key on query_id fails (e.g. linked query only exists locally)
  if (error && (error.code === '23503' || error.message?.includes('query_id'))) {
    const retryWithoutQueryFk = await supabase
      .from('appointments')
      .insert([{ ...row, query_id: null }])
      .select('*')
      .single();
    data = retryWithoutQueryFk.data;
    error = retryWithoutQueryFk.error;
  }

  // Retry if foreign key on users fails
  if (error && error.code === '23503') {
    await ensureUsersSeededInDb();
    const retryAfterSeed = await supabase
      .from('appointments')
      .insert([{ ...row, query_id: null }])
      .select('*')
      .single();
    data = retryAfterSeed.data;
    error = retryAfterSeed.error;
  }

  // Handle duplicate ID collision automatically
  if (error && (error.code === '23505' || error.message?.includes('duplicate key'))) {
    const nextId = await computeNextAppointmentIdFromDb();
    const retryDuplicate = await supabase
      .from('appointments')
      .insert([{ ...row, id: nextId }])
      .select('*')
      .single();
    data = retryDuplicate.data;
    error = retryDuplicate.error;
  }

  if (error) {
    console.warn('[Supabase] Failed to insert appointment to DB, persisting locally:', error.message);
    const cached = readCachedAppointments();
    const updated = [appointment, ...cached.filter((a) => a.id !== appointment.id)];
    writeCachedAppointments(updated);
    return { data: appointment, error: error.message };
  }

  const saved = mapRowToAppointment(data as AppointmentRow);
  const cached = readCachedAppointments();
  const updated = [saved, ...cached.filter((a) => a.id !== saved.id)];
  writeCachedAppointments(updated);

  return { data: saved, error: null };
}

export async function updateAppointmentInDb(
  appointmentId: string,
  updates: Partial<AppointmentRow> & Partial<Appointment>
): Promise<{ data: Appointment | null; error: string | null }> {
  const cached = readCachedAppointments();
  const existing = cached.find((a) => a.id === appointmentId);

  const mergedApt: Appointment | null = existing
    ? {
        ...existing,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.agenda !== undefined ? { agenda: updates.agenda || '' } : {}),
        ...(updates.attendees !== undefined ? { attendees: updates.attendees } : {}),
        ...(updates.receiverId !== undefined ? { receiverId: updates.receiverId } : {}),
        ...(updates.receiver_id !== undefined ? { receiverId: updates.receiver_id || '' } : {}),
        ...(updates.receiverName !== undefined ? { receiverName: updates.receiverName } : {}),
        ...(updates.receiver_name !== undefined ? { receiverName: updates.receiver_name || '' } : {}),
        ...(updates.receiverEmail !== undefined ? { receiverEmail: updates.receiverEmail } : {}),
        ...(updates.receiver_email !== undefined ? { receiverEmail: updates.receiver_email || '' } : {}),
        ...(updates.receiverRole !== undefined ? { receiverRole: updates.receiverRole } : {}),
        ...(updates.receiver_role !== undefined
          ? { receiverRole: updates.receiver_role as UserRole }
          : {}),
        ...(updates.scheduledAt !== undefined ? { scheduledAt: updates.scheduledAt } : {}),
        ...(updates.scheduled_at !== undefined ? { scheduledAt: updates.scheduled_at } : {}),
        ...(updates.scheduledAtMs !== undefined ? { scheduledAtMs: updates.scheduledAtMs } : {}),
        ...(updates.scheduled_at_ms !== undefined ? { scheduledAtMs: updates.scheduled_at_ms } : {}),
        ...(updates.meetingType !== undefined ? { meetingType: updates.meetingType } : {}),
        ...(updates.meeting_type !== undefined
          ? { meetingType: updates.meeting_type as MeetingType }
          : {}),
        ...(updates.meetingLocation !== undefined
          ? { meetingLocation: updates.meetingLocation }
          : {}),
        ...(updates.meeting_location !== undefined
          ? { meetingLocation: updates.meeting_location || '' }
          : {}),
        ...(updates.status !== undefined
          ? { status: updates.status as AppointmentStatus }
          : {}),
        ...(updates.rescheduleProposedBy !== undefined
          ? { rescheduleProposedBy: updates.rescheduleProposedBy }
          : {}),
        ...(updates.reschedule_proposed_by !== undefined
          ? { rescheduleProposedBy: updates.reschedule_proposed_by }
          : {}),
        ...(updates.proposedScheduledAt !== undefined
          ? { proposedScheduledAt: updates.proposedScheduledAt }
          : {}),
        ...(updates.proposed_scheduled_at !== undefined
          ? { proposedScheduledAt: updates.proposed_scheduled_at }
          : {}),
        ...(updates.proposedScheduledAtMs !== undefined
          ? { proposedScheduledAtMs: updates.proposedScheduledAtMs }
          : {}),
        ...(updates.proposed_scheduled_at_ms !== undefined
          ? { proposedScheduledAtMs: updates.proposed_scheduled_at_ms }
          : {}),
        ...(updates.rescheduleReason !== undefined
          ? { rescheduleReason: updates.rescheduleReason }
          : {}),
        ...(updates.reschedule_reason !== undefined
          ? { rescheduleReason: updates.reschedule_reason }
          : {}),
        ...(updates.cancellationRemark !== undefined
          ? { cancellationRemark: updates.cancellationRemark }
          : {}),
        ...(updates.cancellation_remark !== undefined
          ? { cancellationRemark: updates.cancellation_remark }
          : {}),
        ...(updates.cancelledAt !== undefined
          ? { cancelledAt: updates.cancelledAt }
          : {}),
        ...(updates.cancelled_at !== undefined
          ? { cancelledAt: updates.cancelled_at }
          : {}),
        ...(updates.queryId !== undefined ? { queryId: updates.queryId } : {}),
        ...(updates.query_id !== undefined ? { queryId: updates.query_id } : {}),
        updatedAt: new Date().toISOString(),
      }
    : null;

  const dbPayload: Record<string, unknown> = mergedApt
    ? {
        ...mapAppointmentToRow(mergedApt),
        updated_at: mergedApt.updatedAt,
      }
    : {
        ...(updates.status !== undefined ? { status: updates.status } : {}),
        ...(updates.scheduled_at !== undefined ? { scheduled_at: updates.scheduled_at } : {}),
        ...(updates.scheduled_at_ms !== undefined
          ? { scheduled_at_ms: updates.scheduled_at_ms }
          : {}),
        ...(updates.reschedule_proposed_by !== undefined
          ? { reschedule_proposed_by: updates.reschedule_proposed_by }
          : {}),
        ...(updates.proposed_scheduled_at !== undefined
          ? { proposed_scheduled_at: updates.proposed_scheduled_at }
          : {}),
        ...(updates.proposed_scheduled_at_ms !== undefined
          ? { proposed_scheduled_at_ms: updates.proposed_scheduled_at_ms }
          : {}),
        ...(updates.reschedule_reason !== undefined
          ? { reschedule_reason: updates.reschedule_reason }
          : {}),
        updated_at: new Date().toISOString(),
      };

  let { data, error } = await supabase
    .from('appointments')
    .update(dbPayload)
    .eq('id', appointmentId)
    .select('*')
    .single();

  if (error && (error.code === '23503' || error.message?.includes('query_id'))) {
    const retryWithoutQueryFk = await supabase
      .from('appointments')
      .update({ ...dbPayload, query_id: null })
      .eq('id', appointmentId)
      .select('*')
      .single();
    data = retryWithoutQueryFk.data;
    error = retryWithoutQueryFk.error;
  }

  if (error) {
    console.warn('[Supabase] Failed to update appointment in DB, updating locally:', error.message);
    if (!mergedApt) {
      return { data: null, error: error.message };
    }
    const nextCached = cached.map((a) => (a.id === appointmentId ? mergedApt : a));
    writeCachedAppointments(nextCached);
    return { data: mergedApt, error: null };
  }

  const saved = mapRowToAppointment(data as AppointmentRow);
  const nextCached = cached.map((a) => (a.id === appointmentId ? saved : a));
  writeCachedAppointments(nextCached);

  return { data: saved, error: null };
}

export function generateNextAppointmentId(existingList: Appointment[]): string {
  let highest = 0;
  for (const item of existingList) {
    const numPart = item.id.replace('APT-', '');
    const num = parseInt(numPart, 10);
    if (!Number.isNaN(num) && num > highest) {
      highest = num;
    }
  }
  return `APT-${String(highest + 1).padStart(3, '0')}`;
}

