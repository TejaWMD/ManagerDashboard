import { createClient } from '@supabase/supabase-js';
import { Complaint, ComplaintStatus } from '../types';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://mjrqamakqqsqqmuvaqpw.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnFhbWFrcXFzcXFtdXZhcXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjQyOTgsImV4cCI6MjEwODA0MDI5OH0.5VWlGTl87khT4JHlLLoT8IAwmceToyNZcN2EjfDohKg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
}

export function mapRowToComplaint(row: ComplaintRow): Complaint {
  const managerDone = Boolean(row.manager_done);
  const accountManagerDone = Boolean(row.account_manager_done);
  const status: ComplaintStatus =
    managerDone && accountManagerDone ? 'Completed' : 'Pending';

  return {
    id: row.complaint_id,
    complaintId: row.complaint_id,
    createdAt: row.created_at,
    createdAtMs: Number(row.created_at_ms),
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

export function mapComplaintToRow(complaint: Complaint): ComplaintRow {
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
    manager_remark: complaint.managerRemark,
    manager_done: managerDone,
    account_manager_remark: complaint.accountManagerRemark,
    account_manager_done: accountManagerDone,
    status,
    created_at: complaint.createdAt,
    created_at_ms: complaint.createdAtMs,
  };
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

export async function insertComplaintInDb(complaint: Complaint): Promise<{
  data: Complaint | null;
  error: string | null;
}> {
  const row = mapComplaintToRow(complaint);
  const { data, error } = await supabase
    .from('complaints')
    .insert([row])
    .select('*')
    .single();

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
  }
): Promise<{
  data: Complaint | null;
  error: string | null;
}> {
  const dbUpdates: Record<string, unknown> = {
    status: updates.status,
  };

  if (updates.complaintText !== undefined) {
    dbUpdates.complaint_text = updates.complaintText;
  }
  if (updates.managerRemark !== undefined) {
    dbUpdates.manager_remark = updates.managerRemark;
  }
  if (updates.managerDone !== undefined) {
    dbUpdates.manager_done = updates.managerDone;
  }
  if (updates.accountManagerRemark !== undefined) {
    dbUpdates.account_manager_remark = updates.accountManagerRemark;
  }
  if (updates.accountManagerDone !== undefined) {
    dbUpdates.account_manager_done = updates.accountManagerDone;
  }

  // Note: created_at and created_at_ms are intentionally NEVER included in dbUpdates
  // so the original creation timestamp is strictly preserved.
  const { data, error } = await supabase
    .from('complaints')
    .update(dbUpdates)
    .eq('complaint_id', complaintId)
    .select('*')
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return {
    data: mapRowToComplaint(data as ComplaintRow),
    error: null,
  };
}
