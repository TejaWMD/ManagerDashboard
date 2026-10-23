import { createClient } from '@supabase/supabase-js';
import { Complaint, ComplaintStatus, DELAY_THRESHOLD_MS, UserAccount } from '../types';
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
  completedAt: string | null;
  completedAtMs: number | null;
  managerDoneAt?: string | null;
  managerDoneAtMs?: number | null;
  isDelayed: boolean;
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
  complaintId: string,
  meta: LocalCompletionMeta
): void {
  try {
    const current = readLocalCompletionMetaMap();
    current[complaintId] = meta;
    localStorage.setItem(COMPLETION_META_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export interface ComplaintRow {
  complaint_id: string;
  account_manager_id: string;
  account_manager_name: string;
  account_manager_email: string;
  manager_id: string;
  manager_name: string;
  manager_email: string;
  complaint_title?: string | null;
  complaint_text: string;
  manager_remark_title?: string | null;
  manager_remark: string;
  manager_done: boolean;
  manager_done_at?: string | null;
  manager_done_at_ms?: number | null;
  account_manager_remark_title?: string | null;
  account_manager_remark: string;
  account_manager_done: boolean;
  status: ComplaintStatus;
  created_at: string;
  created_at_ms: number;
  completed_at?: string | null;
  completed_at_ms?: number | null;
  is_delayed?: boolean | null;
  delay_notified?: boolean | null;
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

export function mapRowToComplaint(row: ComplaintRow): Complaint {
  const managerDone = Boolean(row.manager_done);
  const accountManagerDone = Boolean(row.account_manager_done);
  const isDone = managerDone && accountManagerDone;
  const status: ComplaintStatus = isDone ? 'Completed' : 'Pending';

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

  const localMeta = readLocalCompletionMetaMap()[row.complaint_id];

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

  const computedDelayed = isDone
    ? completedAtMs && createdAtMs > 0
      ? completedAtMs - createdAtMs > DELAY_THRESHOLD_MS
      : Boolean(row.is_delayed === true || localMeta?.isDelayed === true)
    : Boolean(createdAtMs > 0 && Date.now() - createdAtMs > DELAY_THRESHOLD_MS);

  const unpackedComplaint = unpackTitleAndDescription(
    row.complaint_text,
    row.complaint_title
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
    id: row.complaint_id,
    complaintId: row.complaint_id,
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
    complaintTitle: unpackedComplaint.title,
    complaintText: unpackedComplaint.description,
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
  };
}

export function mapComplaintToBaseRow(complaint: Complaint): ComplaintRow {
  const managerDone = Boolean(complaint.managerDone);
  const accountManagerDone = Boolean(complaint.accountManagerDone);
  const status: ComplaintStatus =
    managerDone && accountManagerDone ? 'Completed' : 'Pending';

  return {
    complaint_id: complaint.complaintId,
    account_manager_id: complaint.accountManagerId,
    account_manager_name: complaint.accountManagerName,
    account_manager_email: complaint.accountManagerEmail,
    manager_id: complaint.managerId,
    manager_name: complaint.managerName,
    manager_email: complaint.managerEmail,
    complaint_text: packTitleAndDescription(
      complaint.complaintTitle,
      complaint.complaintText
    ),
    manager_remark: packTitleAndDescription(
      complaint.managerRemarkTitle,
      complaint.managerRemark
    ),
    manager_done: managerDone,
    account_manager_remark: packTitleAndDescription(
      complaint.accountManagerRemarkTitle,
      complaint.accountManagerRemark
    ),
    account_manager_done: accountManagerDone,
    status,
    created_at: complaint.createdAt,
    created_at_ms: complaint.createdAtMs,
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

export async function fetchComplaintsFromDb(): Promise<{
  data: Complaint[];
  tableMissing: boolean;
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('complaints')
    .select('*')
    .order('created_at_ms', { ascending: false });

  if (error) {
    const isMissingTable =
      error.code === 'PGRST205' ||
      error.code === '42P01' ||
      error.message?.includes("Could not find the table 'public.complaints'");

    return {
      data: [],
      tableMissing: isMissingTable,
      error: error.message,
    };
  }

  const rows = (data || []) as ComplaintRow[];
  if (rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
    titleColumnsSupported = 'complaint_title' in rows[0];
  }

  const mapped = rows.map(mapRowToComplaint);
  return {
    data: mapped,
    tableMissing: false,
    error: null,
  };
}

function isMissingTitleColumnError(message?: string): boolean {
  if (!message) return false;
  return (
    message.includes('complaint_title') ||
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
    message.includes('manager_done_at_ms')
  );
}

async function computeNextComplaintIdFromDb(): Promise<string> {
  const { data } = await supabase
    .from('complaints')
    .select('complaint_id');
  let maxNum = 0;
  for (const row of (data || []) as { complaint_id?: string }[]) {
    const match = row.complaint_id?.match(/CMP-(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    }
  }
  return `CMP-${String(maxNum + 1).padStart(3, '0')}`;
}

export async function insertComplaintInDb(complaint: Complaint): Promise<{
  data: Complaint | null;
  error: string | null;
}> {
  const baseRow = mapComplaintToBaseRow(complaint);
  const extendedRow: ComplaintRow = {
    ...baseRow,
    completed_at: complaint.completedAt ?? null,
    completed_at_ms: complaint.completedAtMs ?? null,
    manager_done_at: complaint.managerDoneAt ?? null,
    manager_done_at_ms: complaint.managerDoneAtMs ?? null,
    is_delayed: Boolean(complaint.isDelayed),
  };

  const rowToInsert: ComplaintRow =
    titleColumnsSupported !== false
      ? {
          ...extendedRow,
          complaint_title: (complaint.complaintTitle || '').trim(),
          manager_remark_title: (complaint.managerRemarkTitle || '').trim(),
          account_manager_remark_title: (
            complaint.accountManagerRemarkTitle || ''
          ).trim(),
        }
      : extendedRow;

  let { data, error } = await supabase
    .from('complaints')
    .insert([rowToInsert])
    .select('*')
    .single();

  if (error && isMissingTitleColumnError(error.message)) {
    titleColumnsSupported = false;
    const retryWithoutTitles = await supabase
      .from('complaints')
      .insert([extendedRow])
      .select('*')
      .single();
    data = retryWithoutTitles.data;
    error = retryWithoutTitles.error;
  }

  // Fallback if user hasn't run ALTER TABLE for completed_at / is_delayed yet
  if (error && isMissingExtendedColumnError(error.message)) {
    const retryBase = await supabase
      .from('complaints')
      .insert([baseRow])
      .select('*')
      .single();
    data = retryBase.data;
    error = retryBase.error;
  }

  // Handle duplicate complaint_id collision automatically by fetching max ID from DB
  if (error && (error.code === '23505' || error.message?.includes('duplicate key'))) {
    const nextId = await computeNextComplaintIdFromDb();
    const retryRow = { ...extendedRow, complaint_id: nextId };
    const retryDuplicate = await supabase
      .from('complaints')
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
    data: mapRowToComplaint(data as ComplaintRow),
    error: null,
  };
}

export async function updateComplaintInDb(
  complaintId: string,
  updates: {
    complaintTitle?: string;
    complaintText?: string;
    managerRemarkTitle?: string;
    managerRemark?: string;
    managerDone?: boolean;
    managerDoneAt?: string | null;
    managerDoneAtMs?: number | null;
    accountManagerRemarkTitle?: string;
    accountManagerRemark?: string;
    accountManagerDone?: boolean;
    status: ComplaintStatus;
    completedAt?: string | null;
    completedAtMs?: number | null;
    isDelayed?: boolean;
  }
): Promise<{
  data: Complaint | null;
  error: string | null;
}> {
  const baseUpdates: Record<string, unknown> = {
    status: updates.status,
  };

  if (updates.complaintTitle !== undefined || updates.complaintText !== undefined) {
    baseUpdates.complaint_text = packTitleAndDescription(
      updates.complaintTitle,
      updates.complaintText
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

  const updatesWithTitles: Record<string, unknown> =
    titleColumnsSupported !== false
      ? {
          ...extendedUpdates,
          ...(updates.complaintTitle !== undefined
            ? { complaint_title: updates.complaintTitle.trim() }
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

  // Persist locally as well so delayed-on-completion and manager-done tracking work even before SQL migration is run
  if (
    updates.completedAt !== undefined ||
    updates.completedAtMs !== undefined ||
    updates.managerDoneAt !== undefined ||
    updates.managerDoneAtMs !== undefined ||
    updates.isDelayed !== undefined
  ) {
    saveLocalCompletionMeta(complaintId, {
      completedAt: updates.completedAt ?? null,
      completedAtMs: updates.completedAtMs ?? null,
      managerDoneAt: updates.managerDoneAt ?? null,
      managerDoneAtMs: updates.managerDoneAtMs ?? null,
      isDelayed: Boolean(updates.isDelayed),
    });
  }

  // Note: created_at and created_at_ms are intentionally NEVER included in updates
  // so the original creation timestamp is strictly preserved.
  let { data, error } = await supabase
    .from('complaints')
    .update(updatesWithTitles)
    .eq('complaint_id', complaintId)
    .select('*')
    .single();

  if (error && isMissingTitleColumnError(error.message)) {
    titleColumnsSupported = false;
    const retryWithoutTitles = await supabase
      .from('complaints')
      .update(extendedUpdates)
      .eq('complaint_id', complaintId)
      .select('*')
      .single();
    data = retryWithoutTitles.data;
    error = retryWithoutTitles.error;
  }

  if (error && isMissingExtendedColumnError(error.message)) {
    const retryBase = await supabase
      .from('complaints')
      .update(baseUpdates)
      .eq('complaint_id', complaintId)
      .select('*')
      .single();
    data = retryBase.data;
    error = retryBase.error;
  }

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: mapRowToComplaint(data as ComplaintRow),
    error: null,
  };
}
