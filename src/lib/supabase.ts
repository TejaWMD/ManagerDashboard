import { createClient } from '@supabase/supabase-js';
import { parseDateToMs, formatDateTime } from './dateUtils';
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
  QueryAttachment,
  QueryRemark,
  QueryCCUser,
} from '../types';
import { AUTHORIZED_USERS } from '../data/users';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://mjrqamakqqsqqmuvaqpw.supabase.co';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnFhbWFrcXFzcXFtdXZhcXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjQyOTgsImV4cCI6MjEwODA0MDI5OH0.5VWlGTl87khT4JHlLLoT8IAwmceToyNZcN2EjfDohKg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Immediate cleanup of legacy dummy/test cache keys that may exist in client browsers
try {
  localStorage.removeItem('wm_portal_completion_meta_v1');
  localStorage.removeItem('wm_portal_completion_meta_v2');
  localStorage.removeItem('wm_portal_completion_meta_v3');
  localStorage.removeItem('wm_portal_completion_meta_v4');
  localStorage.removeItem('wm_portal_appointments_v1');
  localStorage.removeItem('wm_portal_appointments_v2');
  localStorage.removeItem('wm_portal_queries_v1');
  localStorage.removeItem('wm_portal_queries_v2');
  localStorage.removeItem('wm_portal_queries_v3');
  localStorage.removeItem('wm_portal_queries_v4');
  localStorage.removeItem('wm_portal_queries_v5');
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem('wmd_unsupported_query_cols_v2');
  }
} catch {
  // Ignore storage errors in non-browser/restricted environments
}

const OLD_COMPLETION_META_KEY = 'wm_portal_completion_meta_v4';
const COMPLETION_META_STORAGE_KEY = 'wm_portal_completion_meta_v5';

interface LocalCompletionMeta {
  createdAtMs?: number | null;
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
  attachments?: QueryAttachment[];
  managerAttachments?: QueryAttachment[];
  remarks?: QueryRemark[];
  ccUsers?: QueryCCUser[];
  adminCompletedBy?: string | null;
  adminCompletedAt?: string | null;
  adminCompletedAtMs?: number | null;
  autoCompletedAt?: string | null;
  autoCompletedAtMs?: number | null;
  completionNote?: string | null;
  firstManagerRemarkAtMs?: number | null;
  adminReceiverRating?: number | null;
  adminReceiverRemark?: string | null;
  adminReceiverRatedAt?: string | null;
  adminReceiverRatedAtMs?: number | null;
  senderReceiverRating?: number | null;
  senderReceiverRemark?: string | null;
  senderReceiverRatedAt?: string | null;
  senderReceiverRatedAtMs?: number | null;
  adminSenderRating?: number | null;
  adminSenderRemark?: string | null;
  adminSenderRatedAt?: string | null;
  adminSenderRatedAtMs?: number | null;
  receiverSenderRating?: number | null;
  receiverSenderRemark?: string | null;
  receiverSenderRatedAt?: string | null;
  receiverSenderRatedAtMs?: number | null;
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
    const norm = (queryId || '').trim().toUpperCase();
    if (!norm) return;
    const current = readLocalCompletionMetaMap();
    const prev = current[norm] || current[queryId] || {};
    // If saving for a newly created query with a different createdAtMs, discard stale meta from any deleted query
    const isDifferentQueryInstance =
      typeof meta.createdAtMs === 'number' &&
      meta.createdAtMs > 0 &&
      typeof prev.createdAtMs === 'number' &&
      prev.createdAtMs > 0 &&
      Math.abs(meta.createdAtMs - prev.createdAtMs) > 60000;
    current[norm] = {
      ...(isDifferentQueryInstance ? {} : prev),
      ...meta,
    };
    if (queryId !== norm) {
      delete current[queryId];
    }
    localStorage.setItem(COMPLETION_META_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
}

export function clearLocalCompletionMeta(queryId: string): void {
  try {
    const norm = (queryId || '').trim().toUpperCase();
    const current = readLocalCompletionMetaMap();
    let changed = false;
    if (queryId in current) {
      delete current[queryId];
      changed = true;
    }
    if (norm && norm in current) {
      delete current[norm];
      changed = true;
    }
    if (changed) {
      localStorage.setItem(COMPLETION_META_STORAGE_KEY, JSON.stringify(current));
    }
  } catch {
    // Ignore storage errors
  }
}

export function pruneStaleLocalQueryCache(activeQueryIds: string[]): void {
  try {
    const activeSet = new Set(activeQueryIds.map((id) => (id || '').trim().toUpperCase()));
    const current = readLocalCompletionMetaMap();
    let changed = false;
    for (const key of Object.keys(current)) {
      if (!activeSet.has(key.trim().toUpperCase())) {
        delete current[key];
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(COMPLETION_META_STORAGE_KEY, JSON.stringify(current));
    }
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
  attachments?: string | null;
  manager_attachments?: string | null;
  remarks_log?: string | null;
  admin_completed_by?: string | null;
  admin_completed_at?: string | null;
  admin_completed_at_ms?: number | null;
  auto_completed_at?: string | null;
  auto_completed_at_ms?: number | null;
  completion_note?: string | null;
  cc_users?: string | null;
  first_manager_remark_at_ms?: number | null;
  admin_receiver_rating?: number | null;
  admin_receiver_remark?: string | null;
  admin_receiver_rated_at?: string | null;
  admin_receiver_rated_at_ms?: number | null;
  sender_receiver_rating?: number | null;
  sender_receiver_remark?: string | null;
  sender_receiver_rated_at?: string | null;
  sender_receiver_rated_at_ms?: number | null;
  admin_sender_rating?: number | null;
  admin_sender_remark?: string | null;
  admin_sender_rated_at?: string | null;
  admin_sender_rated_at_ms?: number | null;
  receiver_sender_rating?: number | null;
  receiver_sender_remark?: string | null;
  receiver_sender_rated_at?: string | null;
  receiver_sender_rated_at_ms?: number | null;
}

const TITLE_DESC_SEPARATOR = '\n<<<WMD_DESC>>>\n';
const QUERY_ATTACHMENTS_SEPARATOR = '\n<<<WMD_ATTACHMENTS>>>\n';
const QUERY_META_SEPARATOR = '\n<<<WMD_QRY_META>>>\n';

export function packQueryMeta(
  cleanText: string,
  meta?: LocalCompletionMeta | null
): string {
  const baseText = (cleanText ?? '').split(QUERY_META_SEPARATOR)[0];
  if (!meta) return baseText;
  const { attachments, managerAttachments, ...lightMeta } = meta;
  const hasKeys = Object.values(lightMeta).some(
    (v) => v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0)
  );
  if (!hasKeys) return baseText;
  return `${baseText}${QUERY_META_SEPARATOR}${JSON.stringify(lightMeta)}`;
}

export function unpackQueryMeta(rawText?: string | null): {
  cleanText: string;
  meta: LocalCompletionMeta;
} {
  const raw = rawText ?? '';
  if (raw.includes(QUERY_META_SEPARATOR)) {
    const [cleanText, ...rest] = raw.split(QUERY_META_SEPARATOR);
    const metaJson = rest.join(QUERY_META_SEPARATOR);
    try {
      const parsed = JSON.parse(metaJson) as LocalCompletionMeta;
      return {
        cleanText,
        meta: parsed && typeof parsed === 'object' ? parsed : {},
      };
    } catch {
      return { cleanText, meta: {} };
    }
  }
  return { cleanText: raw, meta: {} };
}

export function packAttachments(attachments?: QueryAttachment[] | null): string {
  if (!attachments || attachments.length === 0) return '';
  return `${QUERY_ATTACHMENTS_SEPARATOR}${JSON.stringify(attachments)}`;
}

export function unpackAttachments(rawText?: string | null): {
  cleanText: string;
  attachments: QueryAttachment[];
} {
  const raw = rawText ?? '';
  if (raw.includes(QUERY_ATTACHMENTS_SEPARATOR)) {
    const [cleanText, ...rest] = raw.split(QUERY_ATTACHMENTS_SEPARATOR);
    const metaJson = rest.join(QUERY_ATTACHMENTS_SEPARATOR);
    try {
      const parsed = JSON.parse(metaJson);
      if (Array.isArray(parsed)) {
        return { cleanText: cleanText.trim(), attachments: parsed };
      }
    } catch {}
    return { cleanText: cleanText.trim(), attachments: [] };
  }
  return { cleanText: raw, attachments: [] };
}

// Tracks whether the Supabase table has the dedicated *_title columns (true on live schema)
let titleColumnsSupported: boolean | null = true;

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
  const { cleanText: rawWithoutMeta } = unpackQueryMeta(rawText);
  const raw = rawWithoutMeta ?? '';
  const hasExplicitTitle =
    explicitTitle !== undefined &&
    explicitTitle !== null &&
    explicitTitle.trim() !== '';

  if (raw.includes(TITLE_DESC_SEPARATOR)) {
    const [packedTitle, ...rest] = raw.split(TITLE_DESC_SEPARATOR);
    const unpackedDesc = rest.join(TITLE_DESC_SEPARATOR);
    const resolvedTitle = hasExplicitTitle ? explicitTitle!.trim() : packedTitle.trim();
    let resolvedDesc = unpackedDesc.trim();
    // If description is empty but title exists, fallback description to title so remark content is never blank
    if (!resolvedDesc && resolvedTitle) {
      resolvedDesc = resolvedTitle;
    }
    return {
      title: resolvedTitle,
      description: resolvedDesc,
    };
  }

  const trimmedRaw = raw.trim();
  if (hasExplicitTitle) {
    const title = explicitTitle!.trim();
    // If raw text is empty, the remark description is the title itself so content is not lost
    const description = trimmedRaw || title;
    return {
      title,
      description,
    };
  }

  return {
    title: trimmedRaw,
    description: trimmedRaw,
  };
}

export function mapRowToQuery(row: QueryRow): Query {
  const rawManagerDone = Boolean(row.manager_done);
  const rawAccountManagerDone = Boolean(row.account_manager_done);
  const isExplicitCompleted =
    row.status === 'Completed' ||
    Boolean(row.completed_at_ms) ||
    Boolean(row.completed_at) ||
    Boolean(row.admin_completed_at) ||
    Boolean(row.auto_completed_at);
  const isDone = (rawManagerDone && rawAccountManagerDone) || isExplicitCompleted;
  const managerDone = isDone ? true : rawManagerDone;
  const accountManagerDone = isDone ? true : rawAccountManagerDone;
  const status: QueryStatus = isDone ? 'Completed' : 'Pending';

  const rawCreatedMs = Number(row.created_at_ms);
  const parsedCreatedMs = row.created_at
    ? parseDateToMs(row.created_at)
    : 0;
  const createdAtMs =
    !Number.isNaN(rawCreatedMs) && rawCreatedMs > 0
      ? rawCreatedMs
      : !Number.isNaN(parsedCreatedMs) && parsedCreatedMs > 0
      ? parsedCreatedMs
      : 0;

  const normalizedQueryId = (row.query_id || '').trim().toUpperCase();
  const metaMap = readLocalCompletionMetaMap();
  const { meta: rawPackedQueryMeta } = unpackQueryMeta(row.account_manager_remark);
  const rawStoredLocalMeta = metaMap[normalizedQueryId] || metaMap[row.query_id];

  // Validate that storedLocalMeta belongs to THIS query instance (matching createdAtMs)
  // so a deleted test query's localStorage cache never pollutes a newly created query with the same ID.
  let storedLocalMeta: LocalCompletionMeta | undefined = undefined;
  if (rawStoredLocalMeta) {
    if (
      typeof rawStoredLocalMeta.createdAtMs === 'number' &&
      rawStoredLocalMeta.createdAtMs > 0 &&
      createdAtMs > 0 &&
      Math.abs(rawStoredLocalMeta.createdAtMs - createdAtMs) <= 60000
    ) {
      storedLocalMeta = rawStoredLocalMeta;
    } else if (createdAtMs > 0) {
      clearLocalCompletionMeta(normalizedQueryId);
    }
  }

  const packedQueryMeta: LocalCompletionMeta =
    rawPackedQueryMeta &&
    typeof rawPackedQueryMeta.createdAtMs === 'number' &&
    rawPackedQueryMeta.createdAtMs > 0 &&
    createdAtMs > 0 &&
    Math.abs(rawPackedQueryMeta.createdAtMs - createdAtMs) > 60000
      ? {}
      : rawPackedQueryMeta;

  const localMeta: LocalCompletionMeta | undefined =
    storedLocalMeta || Object.keys(packedQueryMeta).length > 0
      ? {
          ...(storedLocalMeta || {}),
          ...packedQueryMeta,
        }
      : undefined;

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

  const hasDbExtStatusCol =
    'extension_status' in row &&
    row.extension_status !== undefined &&
    row.extension_status !== null;
  const rawExtStatus = (row.extension_status || '').trim().toUpperCase();
  let extensionStatus: ExtensionStatus =
    rawExtStatus === 'PENDING' || rawExtStatus === 'APPROVED' || rawExtStatus === 'DECLINED'
      ? (rawExtStatus as ExtensionStatus)
      : hasDbExtStatusCol && rawExtStatus === 'NONE'
      ? 'NONE'
      : localMeta?.extensionStatus && localMeta.extensionStatus !== 'NONE'
      ? localMeta.extensionStatus
      : 'NONE';

  const rawTargetDueAtMs =
    row.target_due_at_ms !== null && row.target_due_at_ms !== undefined
      ? Number(row.target_due_at_ms)
      : null;
  const candidateTargetDueAt =
    row.target_due_at ||
    (!('target_due_at' in row) ? localMeta?.targetDueAt : null) ||
    null;
  const candidateTargetDueAtMs =
    rawTargetDueAtMs && !Number.isNaN(rawTargetDueAtMs) && rawTargetDueAtMs > 0
      ? rawTargetDueAtMs
      : !('target_due_at_ms' in row) && localMeta?.targetDueAtMs
      ? localMeta.targetDueAtMs
      : candidateTargetDueAt
      ? parseDateToMs(candidateTargetDueAt)
      : null;

  // Target due date is only valid if > createdAtMs and associated with an approved extension (or legacy QRY-005)
  const isTargetDueValid =
    (extensionStatus === 'APPROVED' || normalizedQueryId === 'QRY-005') &&
    typeof candidateTargetDueAtMs === 'number' &&
    !Number.isNaN(candidateTargetDueAtMs) &&
    candidateTargetDueAtMs > 0 &&
    (createdAtMs <= 0 || candidateTargetDueAtMs > createdAtMs);

  const targetDueAtMs = isTargetDueValid ? candidateTargetDueAtMs : null;
  const targetDueAt = isTargetDueValid ? candidateTargetDueAt : null;

  if (extensionStatus === 'APPROVED' && !isTargetDueValid) {
    extensionStatus = 'NONE';
  }

  const extensionRequestedAt =
    extensionStatus !== 'NONE'
      ? row.extension_requested_at || localMeta?.extensionRequestedAt || null
      : null;

  const rawProposedDueAtMs =
    row.extension_proposed_due_at_ms !== null && row.extension_proposed_due_at_ms !== undefined
      ? Number(row.extension_proposed_due_at_ms)
      : null;
  const candidateProposedDueAtMs =
    rawProposedDueAtMs && !Number.isNaN(rawProposedDueAtMs) && rawProposedDueAtMs > 0
      ? rawProposedDueAtMs
      : localMeta?.extensionProposedDueAtMs ?? null;
  const extensionProposedDueAtMs =
    extensionStatus !== 'NONE' &&
    candidateProposedDueAtMs &&
    (createdAtMs <= 0 || candidateProposedDueAtMs > createdAtMs)
      ? candidateProposedDueAtMs
      : null;

  const extensionProposedDueAt =
    extensionStatus !== 'NONE' && extensionProposedDueAtMs
      ? row.extension_proposed_due_at || localMeta?.extensionProposedDueAt || null
      : null;

  const extensionReason =
    extensionStatus !== 'NONE'
      ? row.extension_reason || localMeta?.extensionReason || null
      : null;

  const extensionReviewNote =
    extensionStatus !== 'NONE'
      ? row.extension_review_note || localMeta?.extensionReviewNote || null
      : null;

  const extensionReviewedAt =
    extensionStatus !== 'NONE'
      ? row.extension_reviewed_at || localMeta?.extensionReviewedAt || null
      : null;

  const effectiveDeadlineMs =
    targetDueAtMs && targetDueAtMs > 0
      ? targetDueAtMs
      : createdAtMs > 0
      ? createdAtMs + DELAY_THRESHOLD_MS
      : 0;

  const isApprovedExtensionActive =
    extensionStatus === 'APPROVED' &&
    effectiveDeadlineMs > 0 &&
    Date.now() <= effectiveDeadlineMs;

  const isUrgent = Boolean(row.is_urgent);
  const isExemptFromDelay = Boolean(
    row.query_id &&
      (row.query_id.trim().toUpperCase() === 'QRY-009' ||
        row.query_id.trim().toUpperCase() === 'QRY-005')
  );

  const firstMgrRemarkMs =
    row.first_manager_remark_at_ms !== null && row.first_manager_remark_at_ms !== undefined
      ? Number(row.first_manager_remark_at_ms)
      : localMeta?.firstManagerRemarkAtMs ?? null;

  const computedDelayed = isApprovedExtensionActive
    ? false
    : isExemptFromDelay
    ? false
    : isUrgent
    ? createdAtMs > 0
      ? firstMgrRemarkMs !== null && firstMgrRemarkMs > 0
        ? firstMgrRemarkMs > createdAtMs + 3600000
        : isDone
        ? Boolean(row.is_delayed === true)
        : Date.now() > createdAtMs + 3600000
      : false
    : isDone
    ? completedAtMs && effectiveDeadlineMs > 0
      ? completedAtMs > effectiveDeadlineMs
      : row.is_delayed !== null && row.is_delayed !== undefined
      ? Boolean(row.is_delayed)
      : Boolean(localMeta?.isDelayed === true)
    : Boolean(effectiveDeadlineMs > 0 && Date.now() > effectiveDeadlineMs);

  const { cleanText: strippedQueryText, attachments: unpackedAttachments } =
    unpackAttachments(row.query_text);

  const { cleanText: strippedMgrRemark, attachments: unpackedMgrAttachments } =
    unpackAttachments(row.manager_remark);

  const unpackedQuery = unpackTitleAndDescription(
    strippedQueryText,
    row.query_title
  );
  const unpackedMgrRemark = unpackTitleAndDescription(
    strippedMgrRemark,
    row.manager_remark_title
  );
  const unpackedAmRemark = unpackTitleAndDescription(
    row.account_manager_remark,
    row.account_manager_remark_title
  );

  let resolvedAttachments: QueryAttachment[] = [];
  if (row.attachments) {
    try {
      const parsed = JSON.parse(row.attachments);
      if (Array.isArray(parsed) && parsed.length > 0) {
        resolvedAttachments = parsed;
      }
    } catch {}
  }
  if (resolvedAttachments.length === 0 && unpackedAttachments.length > 0) {
    resolvedAttachments = unpackedAttachments;
  }
  if (
    resolvedAttachments.length === 0 &&
    localMeta?.attachments &&
    localMeta.attachments.length > 0
  ) {
    resolvedAttachments = localMeta.attachments;
  }

  let resolvedManagerAttachments: QueryAttachment[] = [];
  if (row.manager_attachments) {
    try {
      const parsed = JSON.parse(row.manager_attachments);
      if (Array.isArray(parsed) && parsed.length > 0) {
        resolvedManagerAttachments = parsed;
      }
    } catch {}
  }
  if (resolvedManagerAttachments.length === 0 && unpackedMgrAttachments.length > 0) {
    resolvedManagerAttachments = unpackedMgrAttachments;
  }
  if (
    resolvedManagerAttachments.length === 0 &&
    localMeta?.managerAttachments &&
    localMeta.managerAttachments.length > 0
  ) {
    resolvedManagerAttachments = localMeta.managerAttachments;
  }

  let resolvedRemarks: QueryRemark[] = [];
  if (row.remarks_log) {
    try {
      const parsed = JSON.parse(row.remarks_log);
      if (Array.isArray(parsed) && parsed.length > 0) {
        resolvedRemarks = parsed;
      }
    } catch {}
  }
  if (localMeta?.remarks && localMeta.remarks.length > 0) {
    if (resolvedRemarks.length === 0) {
      resolvedRemarks = [...localMeta.remarks];
    } else {
      const existingIds = new Set(resolvedRemarks.map((r) => r.id));
      for (const rmk of localMeta.remarks) {
        if (rmk && rmk.id && !existingIds.has(rmk.id)) {
          resolvedRemarks.push(rmk);
          existingIds.add(rmk.id);
        }
      }
    }
  }
  // Ensure Manager & Sender remarks are independently preserved and synthesized
  // (Prevents one party's remark from hiding or dropping the other party's remark)
  const hasManagerRemarkInLog = resolvedRemarks.some((r) => r.type === 'manager');
  const hasSenderRemarkInLog = resolvedRemarks.some((r) => r.type === 'sender');

  const mgrRemarkText = (unpackedMgrRemark.description || unpackedMgrRemark.title || '').trim();
  const mgrRemarkTitle =
    unpackedMgrRemark.title &&
    unpackedMgrRemark.title.trim() !== mgrRemarkText
      ? unpackedMgrRemark.title.trim()
      : undefined;

  if (!hasManagerRemarkInLog && mgrRemarkText) {
    resolvedRemarks.unshift({
      id: `rmk-init-mgr-${row.query_id}`,
      authorId: row.manager_id,
      authorName: row.manager_name,
      authorRole: 'manager',
      type: 'manager',
      title: mgrRemarkTitle,
      text: mgrRemarkText,
      createdAt: formatDateTime(managerDoneAt || row.created_at, false),
      createdAtMs: managerDoneAtMs || createdAtMs,
    });
  } else if (hasManagerRemarkInLog && mgrRemarkText) {
    // If remarks_log exists but column has newer or distinct content not in the log, merge it deterministically
    const matchesAny = resolvedRemarks.some(
      (r) =>
        r.type === 'manager' &&
        (r.text.trim() === mgrRemarkText || (r.title && r.title.trim() === mgrRemarkText))
    );
    if (!matchesAny) {
      const latestMgrMs = Math.max(
        ...resolvedRemarks.filter((r) => r.type === 'manager').map((r) => r.createdAtMs || 0),
        managerDoneAtMs || 0,
        createdAtMs
      );
      resolvedRemarks.push({
        id: `rmk-sync-mgr-${row.query_id}`,
        authorId: row.manager_id,
        authorName: row.manager_name,
        authorRole: 'manager',
        type: 'manager',
        title: mgrRemarkTitle,
        text: mgrRemarkText,
        createdAt: formatDateTime(managerDoneAt || row.created_at, false),
        createdAtMs: latestMgrMs + 1,
      });
    }
  }

  const amRemarkText = (unpackedAmRemark.description || unpackedAmRemark.title || '').trim();
  const amRemarkTitle =
    unpackedAmRemark.title &&
    unpackedAmRemark.title.trim() !== amRemarkText
      ? unpackedAmRemark.title.trim()
      : undefined;

  if (!hasSenderRemarkInLog && amRemarkText) {
    resolvedRemarks.push({
      id: `rmk-init-am-${row.query_id}`,
      authorId: row.account_manager_id,
      authorName: row.account_manager_name,
      authorRole: 'account_manager',
      type: 'sender',
      title: amRemarkTitle,
      text: amRemarkText,
      createdAt: formatDateTime(completedAt || row.created_at, false),
      createdAtMs: completedAtMs || createdAtMs,
    });
  } else if (hasSenderRemarkInLog && amRemarkText) {
    // If remarks_log exists but column has newer or distinct content not in the log, merge it deterministically
    const matchesAny = resolvedRemarks.some(
      (r) =>
        r.type === 'sender' &&
        (r.text.trim() === amRemarkText || (r.title && r.title.trim() === amRemarkText))
    );
    if (!matchesAny) {
      const latestSenderMs = Math.max(
        ...resolvedRemarks.filter((r) => r.type === 'sender').map((r) => r.createdAtMs || 0),
        completedAtMs || 0,
        createdAtMs
      );
      resolvedRemarks.push({
        id: `rmk-sync-am-${row.query_id}`,
        authorId: row.account_manager_id,
        authorName: row.account_manager_name,
        authorRole: 'account_manager',
        type: 'sender',
        title: amRemarkTitle,
        text: amRemarkText,
        createdAt: formatDateTime(completedAt || row.created_at, false),
        createdAtMs: latestSenderMs + 1,
      });
    }
  }

  // Ensure remarks are always sorted chronologically (oldest to newest)
  resolvedRemarks.sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));

  const adminCompletedBy = row.admin_completed_by || localMeta?.adminCompletedBy || null;
  const adminCompletedAt = row.admin_completed_at || localMeta?.adminCompletedAt || null;
  const adminCompletedAtMs =
    row.admin_completed_at_ms !== null && row.admin_completed_at_ms !== undefined
      ? Number(row.admin_completed_at_ms)
      : localMeta?.adminCompletedAtMs ?? null;
  const autoCompletedAt = row.auto_completed_at || localMeta?.autoCompletedAt || null;
  const autoCompletedAtMs =
    row.auto_completed_at_ms !== null && row.auto_completed_at_ms !== undefined
      ? Number(row.auto_completed_at_ms)
      : localMeta?.autoCompletedAtMs ?? null;
  const completionNote = row.completion_note || localMeta?.completionNote || null;

  let resolvedCcUsers: QueryCCUser[] = [];
  if (row.cc_users) {
    try {
      const parsed = JSON.parse(row.cc_users);
      if (Array.isArray(parsed) && parsed.length > 0) {
        resolvedCcUsers = parsed;
      }
    } catch {}
  }
  if (resolvedCcUsers.length === 0 && localMeta?.ccUsers && localMeta.ccUsers.length > 0) {
    resolvedCcUsers = localMeta.ccUsers;
  }

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
    adminReceiverRating:
      typeof row.admin_receiver_rating === 'number'
        ? row.admin_receiver_rating
        : localMeta?.adminReceiverRating ?? null,
    adminReceiverRemark:
      row.admin_receiver_remark !== undefined
        ? row.admin_receiver_remark || null
        : localMeta?.adminReceiverRemark || null,
    adminReceiverRatedAt:
      row.admin_receiver_rated_at || localMeta?.adminReceiverRatedAt || null,
    adminReceiverRatedAtMs:
      row.admin_receiver_rated_at_ms !== null && row.admin_receiver_rated_at_ms !== undefined
        ? Number(row.admin_receiver_rated_at_ms)
        : localMeta?.adminReceiverRatedAtMs ?? null,
    senderReceiverRating:
      typeof row.sender_receiver_rating === 'number'
        ? row.sender_receiver_rating
        : localMeta?.senderReceiverRating ??
          (typeof row.rating === 'number' ? (row.rating <= 5 ? row.rating * 2 : row.rating) : null),
    senderReceiverRemark:
      row.sender_receiver_remark !== undefined
        ? row.sender_receiver_remark || null
        : localMeta?.senderReceiverRemark || null,
    senderReceiverRatedAt:
      row.sender_receiver_rated_at || localMeta?.senderReceiverRatedAt || null,
    senderReceiverRatedAtMs:
      row.sender_receiver_rated_at_ms !== null && row.sender_receiver_rated_at_ms !== undefined
        ? Number(row.sender_receiver_rated_at_ms)
        : localMeta?.senderReceiverRatedAtMs ?? null,
    adminSenderRating:
      typeof row.admin_sender_rating === 'number'
        ? row.admin_sender_rating
        : localMeta?.adminSenderRating ?? null,
    adminSenderRemark:
      row.admin_sender_remark !== undefined
        ? row.admin_sender_remark || null
        : localMeta?.adminSenderRemark || null,
    adminSenderRatedAt:
      row.admin_sender_rated_at || localMeta?.adminSenderRatedAt || null,
    adminSenderRatedAtMs:
      row.admin_sender_rated_at_ms !== null && row.admin_sender_rated_at_ms !== undefined
        ? Number(row.admin_sender_rated_at_ms)
        : localMeta?.adminSenderRatedAtMs ?? null,
    receiverSenderRating:
      typeof row.receiver_sender_rating === 'number'
        ? row.receiver_sender_rating
        : localMeta?.receiverSenderRating ?? null,
    receiverSenderRemark:
      row.receiver_sender_remark !== undefined
        ? row.receiver_sender_remark || null
        : localMeta?.receiverSenderRemark || null,
    receiverSenderRatedAt:
      row.receiver_sender_rated_at || localMeta?.receiverSenderRatedAt || null,
    receiverSenderRatedAtMs:
      row.receiver_sender_rated_at_ms !== null && row.receiver_sender_rated_at_ms !== undefined
        ? Number(row.receiver_sender_rated_at_ms)
        : localMeta?.receiverSenderRatedAtMs ?? null,
    remarks: resolvedRemarks,
    adminCompletedBy,
    adminCompletedAt,
    adminCompletedAtMs,
    autoCompletedAt,
    autoCompletedAtMs,
    completionNote,
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
      row.linked_appointment_id !== undefined
        ? (row.linked_appointment_id || null)
        : (localMeta?.linkedAppointmentId || null),
    isUrgent:
      row.is_urgent !== undefined
        ? Boolean(row.is_urgent)
        : Boolean(localMeta?.isUrgent === true),
    lastUrgentReminderAtMs:
      row.last_urgent_reminder_at_ms !== null && row.last_urgent_reminder_at_ms !== undefined
        ? Number(row.last_urgent_reminder_at_ms)
        : localMeta?.lastUrgentReminderAtMs ?? null,
    firstManagerRemarkAtMs:
      row.first_manager_remark_at_ms !== null && row.first_manager_remark_at_ms !== undefined
        ? Number(row.first_manager_remark_at_ms)
        : localMeta?.firstManagerRemarkAtMs ?? null,
    attachments: resolvedAttachments,
    managerAttachments: resolvedManagerAttachments,
    ccUsers: resolvedCcUsers,
  };
}

export function mapQueryToBaseRow(query: Query): QueryRow {
  const managerDone = Boolean(query.managerDone);
  const accountManagerDone = Boolean(query.accountManagerDone);
  const status: QueryStatus =
    managerDone && accountManagerDone ? 'Completed' : 'Pending';

  const qTitle = (query.queryTitle || '').trim();
  const qDesc = (query.queryText || qTitle).trim();
  const mTitle = (query.managerRemarkTitle || '').trim();
  const mDesc = (query.managerRemark || mTitle).trim();
  const amTitle = (query.accountManagerRemarkTitle || '').trim();
  const amDesc = (query.accountManagerRemark || amTitle).trim();

  return {
    query_id: query.queryId,
    account_manager_id: query.accountManagerId,
    account_manager_name: query.accountManagerName,
    account_manager_email: query.accountManagerEmail,
    manager_id: query.managerId,
    manager_name: query.managerName,
    manager_email: query.managerEmail,
    query_text:
      titleColumnsSupported === false
        ? packTitleAndDescription(qTitle, qDesc)
        : qDesc,
    manager_remark:
      titleColumnsSupported === false
        ? packTitleAndDescription(mTitle, mDesc)
        : mDesc,
    manager_done: managerDone,
    account_manager_remark:
      titleColumnsSupported === false
        ? packTitleAndDescription(amTitle, amDesc)
        : amDesc,
    account_manager_done: accountManagerDone,
    status,
    created_at: query.createdAt,
    created_at_ms: query.createdAtMs,
    rating: query.rating ?? null,
    is_urgent: Boolean(query.isUrgent),
  };
}

let hasSeededUsersInSession = false;

export async function ensureUsersSeededInDb(extraUser?: UserAccount | null): Promise<void> {
  if (hasSeededUsersInSession && !extraUser) return;
  if (!extraUser) {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('wmd_users_seeded_v1') === 'true') {
        hasSeededUsersInSession = true;
        return;
      }
    } catch {}
  }

  try {
    const mergedUsers = [...AUTHORIZED_USERS];
    if (
      extraUser &&
      extraUser.id &&
      extraUser.email &&
      !mergedUsers.some(
        (u) => u.id === extraUser.id || u.email.toLowerCase() === extraUser.email.toLowerCase()
      )
    ) {
      mergedUsers.push(extraUser);
    }

    const userRows = mergedUsers.map((u) => ({
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
      const fallbackRows = mergedUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        role_label: u.roleLabel,
        avatar_initials: u.avatarInitials,
      }));
      await supabase.from('users').upsert(fallbackRows, { onConflict: 'id' });
    }
    hasSeededUsersInSession = true;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('wmd_users_seeded_v1', 'true');
      }
    } catch {}
  } catch {
    // Non-blocking if table does not exist yet
  }
}

export async function fetchUsersFromDb(): Promise<UserAccount[]> {
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error || !data) return AUTHORIZED_USERS;

    const dbRows = data as Array<{
      id: string;
      name?: string;
      email?: string;
      password?: string | null;
      role?: string;
      role_label?: string;
      avatar_initials?: string;
      phone?: string | null;
      status?: string | null;
    }>;

    const validRoles = new Set<UserRole>(['account_manager', 'manager', 'admin']);
    const merged: UserAccount[] = AUTHORIZED_USERS.map((localUser) => {
      const dbMatch = dbRows.find((d) => d.id === localUser.id);
      if (dbMatch) {
        return {
          ...localUser,
          name: dbMatch.name || localUser.name,
          email: dbMatch.email || localUser.email,
          phone: dbMatch.phone || localUser.phone || '',
        };
      }
      return localUser;
    });

    const knownIds = new Set(merged.map((u) => u.id.toLowerCase()));
    for (const row of dbRows) {
      if (!row.id || !row.email || !row.role) continue;
      if (row.status === 'Inactive') continue;
      if (!validRoles.has(row.role as UserRole)) continue;
      if (knownIds.has(row.id.toLowerCase())) continue;

      const role = row.role as UserRole;
      const name = (row.name || row.email.split('@')[0] || 'User').trim();
      merged.push({
        id: row.id,
        name,
        email: row.email.trim().toLowerCase(),
        password: row.password || '',
        role,
        roleLabel:
          row.role_label ||
          (role === 'admin' ? 'Admin' : role === 'manager' ? 'Manager' : 'Account Manager'),
        avatarInitials: row.avatar_initials || name.slice(0, 2).toUpperCase(),
        phone: row.phone || '',
      });
      knownIds.add(row.id.toLowerCase());
    }

    return merged;
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

export interface FetchQueriesOptions {
  limit?: number;
  loadAll?: boolean;
  includeAttachments?: boolean;
}

// Exclude heavy TOAST columns ('attachments', 'manager_attachments') for table list queries and updates.
// This prevents reading hundreds of megabytes of Base64 chunks from disk on every sync/refresh/click.
export const QUERY_LIST_COLUMNS_ARRAY = [
  'query_id',
  'account_manager_id',
  'account_manager_name',
  'account_manager_email',
  'manager_id',
  'manager_name',
  'manager_email',
  'query_title',
  'query_text',
  'manager_remark_title',
  'manager_remark',
  'manager_done',
  'manager_done_at',
  'manager_done_at_ms',
  'account_manager_remark_title',
  'account_manager_remark',
  'account_manager_done',
  'status',
  'created_at',
  'created_at_ms',
  'completed_at',
  'completed_at_ms',
  'is_delayed',
  'delay_notified',
  'rating',
  'target_due_at',
  'target_due_at_ms',
  'extension_status',
  'extension_requested_at',
  'extension_proposed_due_at',
  'extension_proposed_due_at_ms',
  'extension_reason',
  'extension_review_note',
  'extension_reviewed_at',
  'linked_appointment_id',
  'is_urgent',
  'last_urgent_reminder_at_ms',
  'first_manager_remark_at_ms',
  'remarks_log',
  'admin_completed_by',
  'admin_completed_at',
  'admin_completed_at_ms',
  'auto_completed_at',
  'auto_completed_at_ms',
  'completion_note',
  'cc_users',
  'admin_receiver_rating',
  'admin_receiver_remark',
  'admin_receiver_rated_at',
  'admin_receiver_rated_at_ms',
  'sender_receiver_rating',
  'sender_receiver_remark',
  'sender_receiver_rated_at',
  'sender_receiver_rated_at_ms',
  'admin_sender_rating',
  'admin_sender_remark',
  'admin_sender_rated_at',
  'admin_sender_rated_at_ms',
  'receiver_sender_rating',
  'receiver_sender_remark',
  'receiver_sender_rated_at',
  'receiver_sender_rated_at_ms',
];

export const QUERY_LIST_COLUMNS = QUERY_LIST_COLUMNS_ARRAY.join(',');

const BASE_SAFE_QUERY_COLUMNS = [
  'query_id',
  'account_manager_id',
  'account_manager_name',
  'account_manager_email',
  'manager_id',
  'manager_name',
  'manager_email',
  'query_text',
  'manager_remark',
  'manager_done',
  'account_manager_remark',
  'account_manager_done',
  'status',
  'created_at',
  'created_at_ms',
  'rating',
  'is_urgent',
].join(',');

const UNSUPPORTED_COLS_STORAGE_KEY = 'wmd_unsupported_query_cols_v3';

// Cache of columns discovered to be missing from the live public.queries table
const unsupportedQueryColumns: Set<string> = (() => {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(UNSUPPORTED_COLS_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set<string>(parsed);
    }
  } catch {}
  return new Set<string>();
})();

function markQueryColumnUnsupported(col: string): void {
  if (!col) return;
  unsupportedQueryColumns.add(col);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(
        UNSUPPORTED_COLS_STORAGE_KEY,
        JSON.stringify(Array.from(unsupportedQueryColumns))
      );
    }
  } catch {}
}

function getActiveQuerySelectColumns(): string {
  const cols = QUERY_LIST_COLUMNS_ARRAY.filter((col) => {
    if (unsupportedQueryColumns.has(col)) return false;
    if (
      titleColumnsSupported === false &&
      (col === 'query_title' || col === 'manager_remark_title' || col === 'account_manager_remark_title')
    ) {
      return false;
    }
    return true;
  });
  return cols.length > 0 ? cols.join(',') : BASE_SAFE_QUERY_COLUMNS;
}

const queryAttachmentsCache = new Map<
  string,
  { attachments: QueryAttachment[]; managerAttachments: QueryAttachment[] }
>();

export async function fetchQueryAttachmentsFromDb(queryId: string): Promise<{
  attachments: QueryAttachment[];
  managerAttachments: QueryAttachment[];
}> {
  if (queryAttachmentsCache.has(queryId)) {
    return queryAttachmentsCache.get(queryId)!;
  }

  try {
    const { data, error } = await supabase
      .from('queries')
      .select('attachments, manager_attachments, query_text, manager_remark')
      .eq('query_id', queryId)
      .maybeSingle();

    if (error || !data) {
      return { attachments: [], managerAttachments: [] };
    }

    let attachments: QueryAttachment[] = [];
    if (data.attachments) {
      try {
        const parsed = JSON.parse(data.attachments);
        if (Array.isArray(parsed) && parsed.length > 0) {
          attachments = parsed;
        }
      } catch {}
    }
    if (attachments.length === 0 && data.query_text) {
      const unpacked = unpackAttachments(data.query_text);
      if (unpacked.attachments.length > 0) {
        attachments = unpacked.attachments;
      }
    }

    let managerAttachments: QueryAttachment[] = [];
    if (data.manager_attachments) {
      try {
        const parsed = JSON.parse(data.manager_attachments);
        if (Array.isArray(parsed) && parsed.length > 0) {
          managerAttachments = parsed;
        }
      } catch {}
    }
    if (managerAttachments.length === 0 && data.manager_remark) {
      const unpacked = unpackAttachments(data.manager_remark);
      if (unpacked.attachments.length > 0) {
        managerAttachments = unpacked.attachments;
      }
    }

    const result = { attachments, managerAttachments };
    queryAttachmentsCache.set(queryId, result);
    return result;
  } catch {
    return { attachments: [], managerAttachments: [] };
  }
}

export function invalidateQueryAttachmentsCache(queryId?: string): void {
  if (queryId) {
    queryAttachmentsCache.delete(queryId);
  } else {
    queryAttachmentsCache.clear();
  }
}

export async function fetchQueriesFromDb(options?: FetchQueriesOptions): Promise<{
  data: Query[];
  tableMissing: boolean;
  error: string | null;
  hasMore?: boolean;
}> {
  const shouldLimit = !options?.loadAll;
  const queryLimit = options?.limit || 150;
  const selectCols = options?.includeAttachments ? '*' : getActiveQuerySelectColumns();

  let queryBuilder = supabase
    .from('queries')
    .select(selectCols)
    .order('created_at_ms', { ascending: false });

  if (shouldLimit) {
    queryBuilder = queryBuilder.limit(queryLimit);
  }

  let { data, error } = await queryBuilder;

  // Strip any missing columns without ever falling back to select('*') (which would read multi-MB Base64 attachments from TOAST disk!)
  let selectAttempts = 0;
  while (
    error &&
    !options?.includeAttachments &&
    selectAttempts < 15 &&
    (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('does not exist') || Boolean(extractMissingColumnFromError(error.message)))
  ) {
    selectAttempts++;
    const missingCol = extractMissingColumnFromError(error.message);
    if (missingCol) {
      markQueryColumnUnsupported(missingCol);
      const nextCols = getActiveQuerySelectColumns();
      let retryBuilder = supabase
        .from('queries')
        .select(nextCols)
        .order('created_at_ms', { ascending: false });
      if (shouldLimit) retryBuilder = retryBuilder.limit(queryLimit);
      const retryRes = await retryBuilder;
      data = retryRes.data;
      error = retryRes.error;
    } else {
      let safeBuilder = supabase
        .from('queries')
        .select(BASE_SAFE_QUERY_COLUMNS)
        .order('created_at_ms', { ascending: false });
      if (shouldLimit) safeBuilder = safeBuilder.limit(queryLimit);
      const safeRes = await safeBuilder;
      data = safeRes.data;
      error = safeRes.error;
      break;
    }
  }

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

  const rows = (data || []) as unknown as QueryRow[];
  if (rows.length > 0 && rows[0] && typeof rows[0] === 'object') {
    titleColumnsSupported = 'query_title' in rows[0];
  }

  const mapped = rows.map(mapRowToQuery);
  const hasMore = shouldLimit && rows.length >= queryLimit;
  if (!hasMore) {
    pruneStaleLocalQueryCache(mapped.map((q) => q.queryId));
  }
  return {
    data: mapped,
    tableMissing: false,
    error: null,
    hasMore,
  };
}

function extractMissingColumnFromError(message?: string): string | null {
  if (!message) return null;
  // PostgREST format: Could not find the 'first_manager_remark_at_ms' column of 'queries' in the schema cache
  const pgrstMatch = message.match(/Could not find the '([^']+)' column/i);
  if (pgrstMatch && pgrstMatch[1]) {
    return pgrstMatch[1];
  }
  // Postgres format: column "first_manager_remark_at_ms" of relation "queries" does not exist
  const pgMatch = message.match(/column "([^"]+)"(?: of relation "[^"]+")? does not exist/i);
  if (pgMatch && pgMatch[1]) {
    return pgMatch[1];
  }
  const pgMatchUnquoted = message.match(/column ([a-zA-Z0-9_.]+) does not exist/i);
  if (pgMatchUnquoted && pgMatchUnquoted[1]) {
    const parts = pgMatchUnquoted[1].split('.');
    return parts[parts.length - 1];
  }
  return null;
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
    Boolean(extractMissingColumnFromError(message)) ||
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
    message.includes('last_urgent_reminder_at_ms') ||
    message.includes('first_manager_remark_at_ms') ||
    message.includes('attachments') ||
    message.includes('manager_attachments') ||
    message.includes('remarks_log') ||
    message.includes('admin_completed_by') ||
    message.includes('admin_completed_at') ||
    message.includes('admin_completed_at_ms') ||
    message.includes('auto_completed_at') ||
    message.includes('auto_completed_at_ms') ||
    message.includes('completion_note') ||
    message.includes('cc_users') ||
    message.includes('admin_receiver_rating') ||
    message.includes('admin_receiver_remark') ||
    message.includes('admin_receiver_rated_at') ||
    message.includes('admin_receiver_rated_at_ms') ||
    message.includes('sender_receiver_rating') ||
    message.includes('sender_receiver_remark') ||
    message.includes('sender_receiver_rated_at') ||
    message.includes('sender_receiver_rated_at_ms') ||
    message.includes('admin_sender_rating') ||
    message.includes('admin_sender_remark') ||
    message.includes('admin_sender_rated_at') ||
    message.includes('admin_sender_rated_at_ms') ||
    message.includes('receiver_sender_rating') ||
    message.includes('receiver_sender_remark') ||
    message.includes('receiver_sender_rated_at') ||
    message.includes('receiver_sender_rated_at_ms')
  );
}

export async function fetchNextQueryIdFromRpcOrDb(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('next_query_id');
    if (!error && typeof data === 'string' && /^QRY-\d+$/i.test(data.trim())) {
      return data.trim().toUpperCase();
    }
  } catch {
    // RPC not deployed yet; fall back to DB scan + duplicate-key retry
  }
  return computeNextQueryIdFromDb();
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
    attachments:
      query.attachments && query.attachments.length > 0
        ? JSON.stringify(query.attachments)
        : null,
    manager_attachments:
      query.managerAttachments && query.managerAttachments.length > 0
        ? JSON.stringify(query.managerAttachments)
        : null,
    cc_users:
      query.ccUsers && query.ccUsers.length > 0
        ? JSON.stringify(query.ccUsers)
        : null,
  };
  // Always purge any stale local metadata from any previously deleted query with the same ID
  clearLocalCompletionMeta(query.queryId);

  if (
    query.linkedAppointmentId ||
    query.isUrgent ||
    (query.attachments && query.attachments.length > 0) ||
    (query.managerAttachments && query.managerAttachments.length > 0) ||
    (query.ccUsers && query.ccUsers.length > 0)
  ) {
    saveLocalCompletionMeta(query.queryId, {
      createdAtMs: query.createdAtMs,
      completedAt: query.completedAt ?? null,
      completedAtMs: query.completedAtMs ?? null,
      isDelayed: Boolean(query.isDelayed),
      linkedAppointmentId: query.linkedAppointmentId,
      isUrgent: Boolean(query.isUrgent),
      attachments: query.attachments || [],
      managerAttachments: query.managerAttachments || [],
      ccUsers: query.ccUsers || [],
    });
  }

  const payloadToInsert: Record<string, unknown> = {
    ...(titleColumnsSupported !== false
      ? {
          ...extendedRow,
          query_title: (query.queryTitle || '').trim(),
          manager_remark_title: (query.managerRemarkTitle || '').trim(),
          account_manager_remark_title: (
            query.accountManagerRemarkTitle || ''
          ).trim(),
        }
      : extendedRow),
  };

  for (const col of unsupportedQueryColumns) {
    delete payloadToInsert[col];
  }

  let { data, error } = await supabase
    .from('queries')
    .insert([payloadToInsert])
    .select(getActiveQuerySelectColumns())
    .single();

  let insertAttempts = 0;
  while (error && insertAttempts < 20) {
    insertAttempts++;
    const missingCol = extractMissingColumnFromError(error.message);
    if (missingCol && missingCol in payloadToInsert) {
      console.error(
        `[Supabase] Schema mismatch: column "${missingCol}" is missing in "queries" table and was omitted from insert.`
      );
      markQueryColumnUnsupported(missingCol);
      delete payloadToInsert[missingCol];
      const retryRes = await supabase
        .from('queries')
        .insert([payloadToInsert])
        .select(getActiveQuerySelectColumns())
        .single();
      data = retryRes.data;
      error = retryRes.error;
    } else if (isMissingTitleColumnError(error.message)) {
      console.error(
        '[Supabase] Schema mismatch: title columns (query_title, manager_remark_title, account_manager_remark_title) are missing in "queries" table.'
      );
      titleColumnsSupported = false;
      delete payloadToInsert.query_title;
      delete payloadToInsert.manager_remark_title;
      delete payloadToInsert.account_manager_remark_title;
      const retryRes = await supabase
        .from('queries')
        .insert([payloadToInsert])
        .select(getActiveQuerySelectColumns())
        .single();
      data = retryRes.data;
      error = retryRes.error;
    } else if (error.code === '23503') {
      // Foreign key constraint on account_manager_id or manager_id: seed users and retry
      await ensureUsersSeededInDb({
        id: query.accountManagerId,
        name: query.accountManagerName,
        email: query.accountManagerEmail,
        password: '',
        role: 'account_manager',
        roleLabel: 'Account Manager',
        avatarInitials: (query.accountManagerName || 'AM').slice(0, 2).toUpperCase(),
      });
      const retryFk = await supabase
        .from('queries')
        .insert([payloadToInsert])
        .select(getActiveQuerySelectColumns())
        .single();
      data = retryFk.data;
      error = retryFk.error;
    } else if (error.code === '23505' || error.message?.includes('duplicate key')) {
      const nextId = await fetchNextQueryIdFromRpcOrDb();
      payloadToInsert.query_id = nextId;
      const retryDuplicate = await supabase
        .from('queries')
        .insert([payloadToInsert])
        .select(getActiveQuerySelectColumns())
        .single();
      data = retryDuplicate.data;
      error = retryDuplicate.error;
    } else if (isMissingExtendedColumnError(error.message)) {
      console.error(
        '[Supabase] Schema mismatch: extended columns missing in "queries" table, falling back to baseRow:',
        error.message
      );
      const retryBase = await supabase
        .from('queries')
        .insert([baseRow])
        .select(BASE_SAFE_QUERY_COLUMNS)
        .single();
      data = retryBase.data;
      error = retryBase.error;
      break;
    } else {
      break;
    }
  }

  if (error) {
    return { data: null, error: error.message };
  }

  const mappedInserted = mapRowToQuery(data as unknown as QueryRow);
  if (query.attachments && query.attachments.length > 0) {
    mappedInserted.attachments = query.attachments;
  }
  if (query.managerAttachments && query.managerAttachments.length > 0) {
    mappedInserted.managerAttachments = query.managerAttachments;
  }
  if (
    (mappedInserted.attachments && mappedInserted.attachments.length > 0) ||
    (mappedInserted.managerAttachments && mappedInserted.managerAttachments.length > 0)
  ) {
    queryAttachmentsCache.set(mappedInserted.queryId.toUpperCase(), {
      attachments: mappedInserted.attachments || [],
      managerAttachments: mappedInserted.managerAttachments || [],
    });
  }

  return {
    data: mappedInserted,
    error: null,
  };
}

export async function fetchSingleQueryRowFromDb(queryId: string): Promise<QueryRow | null> {
  const normId = (queryId || '').trim().toUpperCase();
  if (!normId) return null;
  try {
    const { data, error } = await supabase
      .from('queries')
      .select(getActiveQuerySelectColumns())
      .eq('query_id', normId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as QueryRow;
  } catch {
    return null;
  }
}

export async function fetchSingleQueryFromDb(queryId: string): Promise<Query | null> {
  const row = await fetchSingleQueryRowFromDb(queryId);
  return row ? mapRowToQuery(row) : null;
}

export async function updateQueryInDb(
  queryId: string,
  updates: {
    createdAtMs?: number;
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
    firstManagerRemarkAtMs?: number | null;
    attachments?: QueryAttachment[] | null;
    managerAttachments?: QueryAttachment[] | null;
    remarks?: QueryRemark[] | null;
    adminCompletedBy?: string | null;
    adminCompletedAt?: string | null;
    adminCompletedAtMs?: number | null;
    autoCompletedAt?: string | null;
    autoCompletedAtMs?: number | null;
    completionNote?: string | null;
    ccUsers?: QueryCCUser[] | null;
    adminReceiverRating?: number | null;
    adminReceiverRemark?: string | null;
    adminReceiverRatedAt?: string | null;
    adminReceiverRatedAtMs?: number | null;
    senderReceiverRating?: number | null;
    senderReceiverRemark?: string | null;
    senderReceiverRatedAt?: string | null;
    senderReceiverRatedAtMs?: number | null;
    adminSenderRating?: number | null;
    adminSenderRemark?: string | null;
    adminSenderRatedAt?: string | null;
    adminSenderRatedAtMs?: number | null;
    receiverSenderRating?: number | null;
    receiverSenderRemark?: string | null;
    receiverSenderRatedAt?: string | null;
    receiverSenderRatedAtMs?: number | null;
  }
): Promise<{
  data: Query | null;
  error: string | null;
}> {
  const normalizedQueryId = (queryId || '').trim().toUpperCase();

  // Fetch the latest live database row first so a stale background tab can NEVER overwrite
  // a query that was already completed or updated on another device/tab.
  const liveRow = await fetchSingleQueryRowFromDb(normalizedQueryId);
  if (liveRow) {
    const liveIsAlreadyCompleted =
      (Boolean(liveRow.manager_done) && Boolean(liveRow.account_manager_done)) ||
      liveRow.status === 'Completed' ||
      Boolean(liveRow.completed_at_ms) ||
      Boolean(liveRow.completed_at) ||
      Boolean(liveRow.admin_completed_at) ||
      Boolean(liveRow.auto_completed_at);

    if (liveIsAlreadyCompleted) {
      // Lock completed queries: never allow any update to downgrade completion back to Pending/uncompleted
      updates = {
        ...updates,
        managerDone: true,
        managerDoneAt: liveRow.manager_done_at || updates.managerDoneAt || null,
        managerDoneAtMs:
          liveRow.manager_done_at_ms !== null && liveRow.manager_done_at_ms !== undefined
            ? Number(liveRow.manager_done_at_ms)
            : updates.managerDoneAtMs ?? null,
        accountManagerDone: true,
        status: 'Completed',
        completedAt: liveRow.completed_at || updates.completedAt || null,
        completedAtMs:
          liveRow.completed_at_ms !== null && liveRow.completed_at_ms !== undefined
            ? Number(liveRow.completed_at_ms)
            : updates.completedAtMs ?? null,
        isDelayed:
          liveRow.is_delayed !== null && liveRow.is_delayed !== undefined
            ? Boolean(liveRow.is_delayed)
            : updates.isDelayed,
      };
    } else if (Boolean(liveRow.manager_done) && updates.managerDone === true) {
      // Preserve original manager resolution timestamp if manager_done was already true in DB
      if (liveRow.manager_done_at) {
        updates = {
          ...updates,
          managerDoneAt: liveRow.manager_done_at,
          managerDoneAtMs:
            liveRow.manager_done_at_ms !== null && liveRow.manager_done_at_ms !== undefined
              ? Number(liveRow.manager_done_at_ms)
              : updates.managerDoneAtMs,
        };
      }
    }

    // Merge remarks with liveRow.remarks_log so remarks posted on another device are never lost
    if (updates.remarks !== undefined && Array.isArray(updates.remarks) && liveRow.remarks_log) {
      try {
        const liveRemarks = JSON.parse(liveRow.remarks_log);
        if (Array.isArray(liveRemarks) && liveRemarks.length > 0) {
          const mergedMap = new Map<string, QueryRemark>();
          for (const r of liveRemarks as QueryRemark[]) {
            if (r && r.id) mergedMap.set(r.id, r);
          }
          for (const r of updates.remarks) {
            if (r && r.id) mergedMap.set(r.id, r);
          }
          updates = {
            ...updates,
            remarks: Array.from(mergedMap.values()).sort(
              (a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)
            ),
          };
        }
      } catch {
        // Ignore parse error
      }
    }
  }

  const baseUpdates: Record<string, unknown> = {};
  if (updates.status !== undefined) {
    baseUpdates.status = updates.status;
  }

  if (
    (updates.queryTitle !== undefined || updates.queryText !== undefined) &&
    ((updates.queryTitle || '').trim() !== '' || (updates.queryText || '').trim() !== '')
  ) {
    const qTitle = (updates.queryTitle || '').trim();
    const qDesc = (updates.queryText || qTitle).trim();
    baseUpdates.query_text =
      titleColumnsSupported === false
        ? packTitleAndDescription(qTitle, qDesc)
        : qDesc;
  }
  if (
    updates.managerRemarkTitle !== undefined ||
    updates.managerRemark !== undefined
  ) {
    const mTitle = (
      updates.managerRemarkTitle !== undefined
        ? updates.managerRemarkTitle
        : updates.managerRemark || ''
    ).trim();
    const mDesc = (
      updates.managerRemark !== undefined
        ? updates.managerRemark
        : updates.managerRemarkTitle || ''
    ).trim();
    baseUpdates.manager_remark =
      titleColumnsSupported === false
        ? packTitleAndDescription(mTitle, mDesc)
        : mDesc;
  }
  if (updates.managerDone !== undefined) {
    baseUpdates.manager_done = updates.managerDone;
  }
  if (
    updates.accountManagerRemarkTitle !== undefined ||
    updates.accountManagerRemark !== undefined
  ) {
    const amTitle = (
      updates.accountManagerRemarkTitle !== undefined
        ? updates.accountManagerRemarkTitle
        : updates.accountManagerRemark || ''
    ).trim();
    const amDesc = (
      updates.accountManagerRemark !== undefined
        ? updates.accountManagerRemark
        : updates.accountManagerRemarkTitle || ''
    ).trim();
    baseUpdates.account_manager_remark =
      titleColumnsSupported === false
        ? packTitleAndDescription(amTitle, amDesc)
        : amDesc;
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
    // Clamp legacy rating column to 1..5 so databases with legacy CHECK (rating >= 1 AND rating <= 5) never fail with 23514,
    // while sender_receiver_rating stores the full 1..10 score.
    extendedUpdates.rating =
      typeof updates.rating === 'number' && updates.rating > 5
        ? Math.max(1, Math.min(5, Math.round(updates.rating / 2)))
        : updates.rating;
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
  if (updates.firstManagerRemarkAtMs !== undefined) {
    extendedUpdates.first_manager_remark_at_ms = updates.firstManagerRemarkAtMs;
  }
  if (updates.attachments !== undefined) {
    extendedUpdates.attachments =
      updates.attachments && updates.attachments.length > 0
        ? JSON.stringify(updates.attachments)
        : null;
  }
  if (updates.managerAttachments !== undefined) {
    extendedUpdates.manager_attachments =
      updates.managerAttachments && updates.managerAttachments.length > 0
        ? JSON.stringify(updates.managerAttachments)
        : null;
  }
  if (updates.remarks !== undefined) {
    extendedUpdates.remarks_log =
      updates.remarks && updates.remarks.length > 0
        ? JSON.stringify(updates.remarks)
        : null;
  }
  if (updates.adminCompletedBy !== undefined) {
    extendedUpdates.admin_completed_by = updates.adminCompletedBy;
  }
  if (updates.adminCompletedAt !== undefined) {
    extendedUpdates.admin_completed_at = updates.adminCompletedAt;
  }
  if (updates.adminCompletedAtMs !== undefined) {
    extendedUpdates.admin_completed_at_ms = updates.adminCompletedAtMs;
  }
  if (updates.autoCompletedAt !== undefined) {
    extendedUpdates.auto_completed_at = updates.autoCompletedAt;
  }
  if (updates.autoCompletedAtMs !== undefined) {
    extendedUpdates.auto_completed_at_ms = updates.autoCompletedAtMs;
  }
  if (updates.completionNote !== undefined) {
    extendedUpdates.completion_note = updates.completionNote;
  }
  if (updates.ccUsers !== undefined) {
    extendedUpdates.cc_users =
      updates.ccUsers && updates.ccUsers.length > 0
        ? JSON.stringify(updates.ccUsers)
        : null;
  }
  if (updates.adminReceiverRating !== undefined) {
    extendedUpdates.admin_receiver_rating = updates.adminReceiverRating;
  }
  if (updates.adminReceiverRemark !== undefined) {
    extendedUpdates.admin_receiver_remark = updates.adminReceiverRemark;
  }
  if (updates.adminReceiverRatedAt !== undefined) {
    extendedUpdates.admin_receiver_rated_at = updates.adminReceiverRatedAt;
  }
  if (updates.adminReceiverRatedAtMs !== undefined) {
    extendedUpdates.admin_receiver_rated_at_ms = updates.adminReceiverRatedAtMs;
  }
  if (updates.senderReceiverRating !== undefined) {
    extendedUpdates.sender_receiver_rating = updates.senderReceiverRating;
  }
  if (updates.senderReceiverRemark !== undefined) {
    extendedUpdates.sender_receiver_remark = updates.senderReceiverRemark;
  }
  if (updates.senderReceiverRatedAt !== undefined) {
    extendedUpdates.sender_receiver_rated_at = updates.senderReceiverRatedAt;
  }
  if (updates.senderReceiverRatedAtMs !== undefined) {
    extendedUpdates.sender_receiver_rated_at_ms = updates.senderReceiverRatedAtMs;
  }
  if (updates.adminSenderRating !== undefined) {
    extendedUpdates.admin_sender_rating = updates.adminSenderRating;
  }
  if (updates.adminSenderRemark !== undefined) {
    extendedUpdates.admin_sender_remark = updates.adminSenderRemark;
  }
  if (updates.adminSenderRatedAt !== undefined) {
    extendedUpdates.admin_sender_rated_at = updates.adminSenderRatedAt;
  }
  if (updates.adminSenderRatedAtMs !== undefined) {
    extendedUpdates.admin_sender_rated_at_ms = updates.adminSenderRatedAtMs;
  }
  if (updates.receiverSenderRating !== undefined) {
    extendedUpdates.receiver_sender_rating = updates.receiverSenderRating;
  }
  if (updates.receiverSenderRemark !== undefined) {
    extendedUpdates.receiver_sender_remark = updates.receiverSenderRemark;
  }
  if (updates.receiverSenderRatedAt !== undefined) {
    extendedUpdates.receiver_sender_rated_at = updates.receiverSenderRatedAt;
  }
  if (updates.receiverSenderRatedAtMs !== undefined) {
    extendedUpdates.receiver_sender_rated_at_ms = updates.receiverSenderRatedAtMs;
  }

  const resolvedMgrTitleForDb =
    updates.managerRemarkTitle !== undefined
      ? updates.managerRemarkTitle.trim()
      : updates.managerRemark !== undefined
      ? updates.managerRemark.trim()
      : undefined;

  const resolvedAmTitleForDb =
    updates.accountManagerRemarkTitle !== undefined
      ? updates.accountManagerRemarkTitle.trim()
      : updates.accountManagerRemark !== undefined
      ? updates.accountManagerRemark.trim()
      : undefined;

  const updatesWithTitles: Record<string, unknown> =
    titleColumnsSupported !== false
      ? {
          ...extendedUpdates,
          ...(updates.queryTitle !== undefined && updates.queryTitle.trim() !== ''
            ? { query_title: updates.queryTitle.trim() }
            : {}),
          ...(resolvedMgrTitleForDb !== undefined
            ? { manager_remark_title: resolvedMgrTitleForDb }
            : {}),
          ...(resolvedAmTitleForDb !== undefined
            ? { account_manager_remark_title: resolvedAmTitleForDb }
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
    updates.lastUrgentReminderAtMs !== undefined ||
    updates.attachments !== undefined ||
    updates.managerAttachments !== undefined ||
    updates.remarks !== undefined ||
    updates.adminCompletedBy !== undefined ||
    updates.adminCompletedAt !== undefined ||
    updates.adminCompletedAtMs !== undefined ||
    updates.autoCompletedAt !== undefined ||
    updates.autoCompletedAtMs !== undefined ||
    updates.completionNote !== undefined ||
    updates.ccUsers !== undefined ||
    updates.adminReceiverRating !== undefined ||
    updates.adminReceiverRemark !== undefined ||
    updates.senderReceiverRating !== undefined ||
    updates.senderReceiverRemark !== undefined ||
    updates.adminSenderRating !== undefined ||
    updates.adminSenderRemark !== undefined ||
    updates.receiverSenderRating !== undefined ||
    updates.receiverSenderRemark !== undefined
  ) {
    saveLocalCompletionMeta(normalizedQueryId, {
      ...(updates.createdAtMs !== undefined ? { createdAtMs: updates.createdAtMs } : {}),
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
      ...(updates.attachments !== undefined
        ? { attachments: updates.attachments || [] }
        : {}),
      ...(updates.managerAttachments !== undefined
        ? { managerAttachments: updates.managerAttachments || [] }
        : {}),
      ...(updates.remarks !== undefined
        ? { remarks: updates.remarks || [] }
        : {}),
      ...(updates.adminCompletedBy !== undefined ? { adminCompletedBy: updates.adminCompletedBy } : {}),
      ...(updates.adminCompletedAt !== undefined ? { adminCompletedAt: updates.adminCompletedAt } : {}),
      ...(updates.adminCompletedAtMs !== undefined ? { adminCompletedAtMs: updates.adminCompletedAtMs } : {}),
      ...(updates.autoCompletedAt !== undefined ? { autoCompletedAt: updates.autoCompletedAt } : {}),
      ...(updates.autoCompletedAtMs !== undefined ? { autoCompletedAtMs: updates.autoCompletedAtMs } : {}),
      ...(updates.completionNote !== undefined ? { completionNote: updates.completionNote } : {}),
      ...(updates.ccUsers !== undefined ? { ccUsers: updates.ccUsers || [] } : {}),
      ...(updates.adminReceiverRating !== undefined ? { adminReceiverRating: updates.adminReceiverRating } : {}),
      ...(updates.adminReceiverRemark !== undefined ? { adminReceiverRemark: updates.adminReceiverRemark } : {}),
      ...(updates.adminReceiverRatedAt !== undefined ? { adminReceiverRatedAt: updates.adminReceiverRatedAt } : {}),
      ...(updates.adminReceiverRatedAtMs !== undefined ? { adminReceiverRatedAtMs: updates.adminReceiverRatedAtMs } : {}),
      ...(updates.senderReceiverRating !== undefined ? { senderReceiverRating: updates.senderReceiverRating } : {}),
      ...(updates.senderReceiverRemark !== undefined ? { senderReceiverRemark: updates.senderReceiverRemark } : {}),
      ...(updates.senderReceiverRatedAt !== undefined ? { senderReceiverRatedAt: updates.senderReceiverRatedAt } : {}),
      ...(updates.senderReceiverRatedAtMs !== undefined ? { senderReceiverRatedAtMs: updates.senderReceiverRatedAtMs } : {}),
      ...(updates.adminSenderRating !== undefined ? { adminSenderRating: updates.adminSenderRating } : {}),
      ...(updates.adminSenderRemark !== undefined ? { adminSenderRemark: updates.adminSenderRemark } : {}),
      ...(updates.adminSenderRatedAt !== undefined ? { adminSenderRatedAt: updates.adminSenderRatedAt } : {}),
      ...(updates.adminSenderRatedAtMs !== undefined ? { adminSenderRatedAtMs: updates.adminSenderRatedAtMs } : {}),
      ...(updates.receiverSenderRating !== undefined ? { receiverSenderRating: updates.receiverSenderRating } : {}),
      ...(updates.receiverSenderRemark !== undefined ? { receiverSenderRemark: updates.receiverSenderRemark } : {}),
      ...(updates.receiverSenderRatedAt !== undefined ? { receiverSenderRatedAt: updates.receiverSenderRatedAt } : {}),
      ...(updates.receiverSenderRatedAtMs !== undefined ? { receiverSenderRatedAtMs: updates.receiverSenderRatedAtMs } : {}),
    });
  }

  if (updates.attachments !== undefined || updates.managerAttachments !== undefined) {
    invalidateQueryAttachmentsCache(normalizedQueryId);
  }

  // Only embed metadata inside account_manager_remark if the database lacks dedicated columns
  if (titleColumnsSupported === false) {
    const latestMetaForQuery = readLocalCompletionMetaMap()[normalizedQueryId];
    if (latestMetaForQuery && typeof baseUpdates.account_manager_remark === 'string') {
      const packedAmWithMeta = packQueryMeta(
        baseUpdates.account_manager_remark,
        latestMetaForQuery
      );
      baseUpdates.account_manager_remark = packedAmWithMeta;
      extendedUpdates.account_manager_remark = packedAmWithMeta;
      updatesWithTitles.account_manager_remark = packedAmWithMeta;
    }
  }

  // Note: created_at and created_at_ms are intentionally NEVER included in updates
  // so the original creation timestamp is strictly preserved.
  const payloadToUpdate: Record<string, unknown> = {
    ...updatesWithTitles,
  };
  for (const col of unsupportedQueryColumns) {
    delete payloadToUpdate[col];
  }

  let { data, error } = await supabase
    .from('queries')
    .update(payloadToUpdate)
    .eq('query_id', normalizedQueryId)
    .select(getActiveQuerySelectColumns())
    .maybeSingle();

  let updateAttempts = 0;
  while (error && updateAttempts < 25) {
    updateAttempts++;
    const missingCol = extractMissingColumnFromError(error.message);
    if (missingCol && missingCol in payloadToUpdate) {
      console.warn(
        `[Supabase] Stripping unsupported column '${missingCol}' from update on ${normalizedQueryId}`
      );
      markQueryColumnUnsupported(missingCol);
      delete payloadToUpdate[missingCol];
      if (Object.keys(payloadToUpdate).length === 0) {
        error = null;
        break;
      }
      const retryRes = await supabase
        .from('queries')
        .update(payloadToUpdate)
        .eq('query_id', normalizedQueryId)
        .select(getActiveQuerySelectColumns())
        .maybeSingle();
      data = retryRes.data;
      error = retryRes.error;
    } else if (error.code === '23514' && 'rating' in payloadToUpdate) {
      // Check constraint violation on rating column
      delete payloadToUpdate.rating;
      const retryRes = await supabase
        .from('queries')
        .update(payloadToUpdate)
        .eq('query_id', normalizedQueryId)
        .select(getActiveQuerySelectColumns())
        .maybeSingle();
      data = retryRes.data;
      error = retryRes.error;
    } else if (isMissingTitleColumnError(error.message)) {
      titleColumnsSupported = false;
      delete payloadToUpdate.query_title;
      delete payloadToUpdate.manager_remark_title;
      delete payloadToUpdate.account_manager_remark_title;
      const retryRes = await supabase
        .from('queries')
        .update(payloadToUpdate)
        .eq('query_id', normalizedQueryId)
        .select(getActiveQuerySelectColumns())
        .maybeSingle();
      data = retryRes.data;
      error = retryRes.error;
    } else if (isMissingExtendedColumnError(error.message)) {
      const retryBase =
        Object.keys(baseUpdates).length > 0
          ? await supabase
              .from('queries')
              .update(baseUpdates)
              .eq('query_id', normalizedQueryId)
              .select(BASE_SAFE_QUERY_COLUMNS)
              .maybeSingle()
          : await supabase
              .from('queries')
              .select(BASE_SAFE_QUERY_COLUMNS)
              .eq('query_id', normalizedQueryId)
              .maybeSingle();
      data = retryBase.data;
      error = retryBase.error;
      break;
    } else {
      break;
    }
  }

  if (error) {
    return { data: null, error: error.message };
  }

  if (!data) {
    // If update returned no row (e.g. RLS or temporary mismatch), try fetching the row directly without heavy attachments
    const fetchRes = await supabase
      .from('queries')
      .select(getActiveQuerySelectColumns())
      .eq('query_id', normalizedQueryId)
      .maybeSingle();
    data = fetchRes.data;
  }

  const mappedUpdated = data ? mapRowToQuery(data as unknown as QueryRow) : null;
  if (mappedUpdated) {
    const cachedAtt = queryAttachmentsCache.get(normalizedQueryId);
    if (updates.attachments !== undefined) {
      mappedUpdated.attachments = updates.attachments || [];
    } else if (
      (!mappedUpdated.attachments || mappedUpdated.attachments.length === 0) &&
      cachedAtt?.attachments?.length
    ) {
      mappedUpdated.attachments = cachedAtt.attachments;
    }
    if (updates.managerAttachments !== undefined) {
      mappedUpdated.managerAttachments = updates.managerAttachments || [];
    } else if (
      (!mappedUpdated.managerAttachments || mappedUpdated.managerAttachments.length === 0) &&
      cachedAtt?.managerAttachments?.length
    ) {
      mappedUpdated.managerAttachments = cachedAtt.managerAttachments;
    }
    if (updates.attachments !== undefined || updates.managerAttachments !== undefined) {
      queryAttachmentsCache.set(normalizedQueryId, {
        attachments: mappedUpdated.attachments || [],
        managerAttachments: mappedUpdated.managerAttachments || [],
      });
    }
  }

  return {
    data: mappedUpdated,
    error: null,
  };
}

// ============================================================================
// Appointments Database Interface & Realtime Helpers
// ============================================================================

export const STORAGE_KEY_APPOINTMENTS = 'wm_portal_appointments_v3';

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
      ? parseDateToMs(row.scheduled_at) || 0
      : 0;

  const createdAtMs =
    Number(row.created_at_ms) && !Number.isNaN(Number(row.created_at_ms))
      ? Number(row.created_at_ms)
      : row.created_at
      ? parseDateToMs(row.created_at) || Date.now()
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

  const cleanAgenda = (apt.agenda ?? '').split(APT_META_SEPARATOR)[0].trim();

  return {
    id: apt.id,
    title: apt.title,
    agenda: cleanAgenda,
    requester_id: apt.requesterId,
    requester_name: apt.requesterName,
    requester_email: apt.requesterEmail,
    requester_role: apt.requesterRole,
    receiver_id: primaryAttendee?.id || apt.receiverId || '',
    receiver_name: combinedNames,
    receiver_email: primaryAttendee?.email || apt.receiverEmail || '',
    receiver_role: primaryAttendee?.role || apt.receiverRole || 'manager',
    attendees_json:
      apt.attendees && apt.attendees.length > 0
        ? JSON.stringify(apt.attendees)
        : null,
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
    cancellation_remark: apt.cancellationRemark || null,
    cancelled_at: apt.cancelledAt || null,
    query_id: apt.queryId || null,
    created_at: apt.createdAt,
    created_at_ms: apt.createdAtMs,
    updated_at: apt.updatedAt || null,
  };
}

export function readCachedAppointments(): Appointment[] {
  try {
    localStorage.removeItem('wm_portal_appointments_v1');
    localStorage.removeItem('wm_portal_appointments_v2');
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
    localStorage.removeItem('wm_portal_appointments_v2');
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

export async function fetchNextAppointmentIdFromRpcOrDb(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('next_appointment_id');
    if (!error && typeof data === 'string' && /^APT-\d+$/i.test(data.trim())) {
      return data.trim().toUpperCase();
    }
  } catch {
    // RPC not deployed yet; fall back to DB scan + duplicate-key retry
  }
  return computeNextAppointmentIdFromDb();
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

  // Handle duplicate ID collision automatically (up to 5 attempts)
  let aptDupAttempts = 0;
  while (
    error &&
    aptDupAttempts < 5 &&
    (error.code === '23505' || error.message?.includes('duplicate key'))
  ) {
    aptDupAttempts++;
    const nextId = await fetchNextAppointmentIdFromRpcOrDb();
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

