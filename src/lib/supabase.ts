import { createClient } from '@supabase/supabase-js';
import { Complaint, ComplaintStatus, DELAY_THRESHOLD_MS } from '../types';
import { AUTHORIZED_USERS } from '../data/users';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://mjrqamakqqsqqmuvaqpw.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnFhbWFrcXFzcXFtdXZhcXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjQyOTgsImV4cCI6MjEwODA0MDI5OH0.5VWlGTl87khT4JHlLLoT8IAwmceToyNZcN2EjfDohKg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const COMPLETION_META_STORAGE_KEY = 'wm_portal_completion_meta_v1';

interface LocalCompletionMeta {
  completedAt: string | null;
  completedAtMs: number | null;
  isDelayed: boolean;
}

function readLocalCompletionMetaMap(): Record<string, LocalCompletionMeta> {
  try {
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
  complaint_text: string;
  manager_remark: string;
  manager_done: boolean;
  account_manager_remark: string;
  account_manager_done: boolean;
  status: ComplaintStatus;
  created_at: string;
  created_at_ms: number;
  completed_at?: string | null;
  completed_at_ms?: number | null;
  is_delayed?: boolean | null;
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
    ? Boolean(
        row.is_delayed === true ||
          localMeta?.isDelayed === true ||
          (completedAtMs && createdAtMs > 0 && completedAtMs - createdAtMs > DELAY_THRESHOLD_MS)
      )
    : Boolean(
        row.is_delayed === true ||
          (createdAtMs > 0 && Date.now() - createdAtMs > DELAY_THRESHOLD_MS)
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
    complaintText: row.complaint_text,
    managerRemark: row.manager_remark || '',
    managerDone,
    accountManagerRemark: row.account_manager_remark || '',
    accountManagerDone,
    status,
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
    complaint_text: complaint.complaintText,
    manager_remark: complaint.managerRemark || '',
    manager_done: managerDone,
    account_manager_remark: complaint.accountManagerRemark || '',
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
    }));
    await supabase.from('users').upsert(userRows, { onConflict: 'id' });
  } catch {
    // Non-blocking if table does not exist yet
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

  const mapped = ((data || []) as ComplaintRow[]).map(mapRowToComplaint);
  return {
    data: mapped,
    tableMissing: false,
    error: null,
  };
}

function isMissingExtendedColumnError(message?: string): boolean {
  if (!message) return false;
  return (
    message.includes('completed_at') ||
    message.includes('completed_at_ms') ||
    message.includes('is_delayed')
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
    is_delayed: Boolean(complaint.isDelayed),
  };

  let { data, error } = await supabase
    .from('complaints')
    .insert([extendedRow])
    .select('*')
    .single();

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
    const retryRow = { ...baseRow, complaint_id: nextId };
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
    complaintText?: string;
    managerRemark?: string;
    managerDone?: boolean;
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

  if (updates.complaintText !== undefined) {
    baseUpdates.complaint_text = updates.complaintText;
  }
  if (updates.managerRemark !== undefined) {
    baseUpdates.manager_remark = updates.managerRemark;
  }
  if (updates.managerDone !== undefined) {
    baseUpdates.manager_done = updates.managerDone;
  }
  if (updates.accountManagerRemark !== undefined) {
    baseUpdates.account_manager_remark = updates.accountManagerRemark;
  }
  if (updates.accountManagerDone !== undefined) {
    baseUpdates.account_manager_done = updates.accountManagerDone;
  }

  const extendedUpdates: Record<string, unknown> = {
    ...baseUpdates,
  };
  if (updates.completedAt !== undefined) {
    extendedUpdates.completed_at = updates.completedAt;
  }
  if (updates.completedAtMs !== undefined) {
    extendedUpdates.completed_at_ms = updates.completedAtMs;
  }
  if (updates.isDelayed !== undefined) {
    extendedUpdates.is_delayed = updates.isDelayed;
  }

  // Persist locally as well so delayed-on-completion works even before SQL migration is run
  if (
    updates.completedAt !== undefined ||
    updates.completedAtMs !== undefined ||
    updates.isDelayed !== undefined
  ) {
    saveLocalCompletionMeta(complaintId, {
      completedAt: updates.completedAt ?? null,
      completedAtMs: updates.completedAtMs ?? null,
      isDelayed: Boolean(updates.isDelayed),
    });
  }

  // Note: created_at and created_at_ms are intentionally NEVER included in updates
  // so the original creation timestamp is strictly preserved.
  let { data, error } = await supabase
    .from('complaints')
    .update(extendedUpdates)
    .eq('complaint_id', complaintId)
    .select('*')
    .single();

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
