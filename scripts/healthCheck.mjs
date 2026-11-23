/**
 * Comprehensive Health, Data Freshness & Auto-Repair Audit for WM Manager Dashboard
 *
 * Usage:
 *   node C:\Users\wmgte\Desktop\ManagerDashboard\scripts\healthCheck.mjs
 *
 * Checks & Auto-Repairs:
 *   1. Local Build & Version Metadata (dist/version.json & dist/index.html)
 *   2. Supabase Connectivity & Table Availability (users, queries, appointments, user_activities, user_presence)
 *   3. Data Integrity, Stale Record Detection & Auto-Sync:
 *      - Appointments referencing deleted/non-existent query_id -> auto-unlinked
 *      - Queries referencing deleted/non-existent linked_appointment_id -> auto-unlinked
 *      - Activity logs referencing deleted QRY-* or APT-* IDs -> auto-cleaned
 *      - Queries with mismatched completion flags vs status ('Pending' vs 'Completed')
 *      - Queries with out-of-sync is_delayed flag in DB vs live SLA deadline -> auto-synced
 *      - Stale online user_presence records (is_online=true with last_seen > 12h ago) -> auto-set to is_online=false
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || 'https://mjrqamakqqsqqmuvaqpw.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcnFhbWFrcXFzcXFtdXZhcXB3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjQyOTgsImV4cCI6MjEwODA0MDI5OH0.5VWlGTl87khT4JHlLLoT8IAwmceToyNZcN2EjfDohKg';

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};

const DELAY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const URGENT_REMARK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const STALE_PRESENCE_MS = 12 * 60 * 60 * 1000; // 12 hours

async function fetchTable(table, queryParams = 'select=*') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${queryParams}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status} fetching ${table}: ${errText}`);
  }
  return res.json();
}

async function patchTable(table, filterQuery, body) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filterQuery}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status} patching ${table}: ${errText}`);
  }
  return res.json();
}

async function deleteFromTable(table, filterQuery) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filterQuery}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status} deleting from ${table}: ${errText}`);
  }
  return res.json();
}

function checkBuildArtifacts() {
  const distDir = path.join(ROOT_DIR, 'dist');
  const versionPath = path.join(distDir, 'version.json');
  const indexPath = path.join(distDir, 'index.html');
  const issues = [];
  let buildInfo = null;

  if (!fs.existsSync(distDir)) {
    issues.push('dist/ directory is missing (project needs a build).');
    return { ok: false, issues, buildInfo };
  }

  if (!fs.existsSync(versionPath)) {
    issues.push('dist/version.json is missing.');
  } else {
    try {
      buildInfo = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    } catch (e) {
      issues.push(`dist/version.json is invalid JSON: ${e.message}`);
    }
  }

  if (!fs.existsSync(indexPath)) {
    issues.push('dist/index.html is missing.');
  } else {
    const html = fs.readFileSync(indexPath, 'utf8');
    const scriptMatch = html.match(/assets\/index-[a-zA-Z0-9_-]+\.js/);
    if (!scriptMatch) {
      issues.push('dist/index.html does not reference a valid bundled JS asset.');
    } else {
      const bundlePath = path.join(distDir, scriptMatch[0]);
      if (!fs.existsSync(bundlePath)) {
        issues.push(`Referenced bundle ${scriptMatch[0]} does not exist in dist/.`);
      }
    }
  }

  return { ok: issues.length === 0, issues, buildInfo };
}

async function main() {
  const nowMs = Date.now();
  console.log('================================================================');
  console.log('WM ManagerDashboard - Deep Health & Data Freshness Check');
  console.log(`Timestamp: ${new Date(nowMs).toISOString()}`);
  console.log('================================================================\n');

  let hasErrors = false;
  const warnings = [];
  const repairs = [];

  // 1. Check build artifacts
  const buildCheck = checkBuildArtifacts();
  console.log('[1/3] Build & Bundle Integrity:');
  if (buildCheck.ok) {
    console.log(
      `  OK - Latest dist build: ${buildCheck.buildInfo?.builtAt || 'unknown'} (version: ${buildCheck.buildInfo?.version})`
    );
  } else {
    hasErrors = true;
    for (const issue of buildCheck.issues) {
      console.log(`  ERROR - ${issue}`);
    }
  }

  // 2. Fetch live Supabase tables
  console.log('\n[2/3] Live Supabase Database Connectivity:');
  let users = [];
  let queries = [];
  let appointments = [];
  let activities = [];
  let presences = [];

  try {
    [users, queries, appointments, activities, presences] = await Promise.all([
      fetchTable('users', 'select=*'),
      fetchTable('queries', 'select=*&order=created_at_ms.desc'),
      fetchTable('appointments', 'select=*&order=created_at_ms.desc'),
      fetchTable('user_activities', 'select=*&order=created_at_ms.desc&limit=500'),
      fetchTable('user_presence', 'select=*'),
    ]);
    console.log(`  OK - users: ${users.length} rows`);
    console.log(`  OK - queries: ${queries.length} rows`);
    console.log(`  OK - appointments: ${appointments.length} rows`);
    console.log(`  OK - user_activities (latest 500): ${activities.length} rows`);
    console.log(`  OK - user_presence: ${presences.length} rows`);
  } catch (err) {
    console.error(`  ERROR - Database check failed: ${err.message}`);
    process.exit(1);
  }

  // 3. Deep Data Freshness & Stale Record Audit + Auto-Repair
  console.log('\n[3/3] Data Freshness, Sync & Stale Data Audit:');

  const userIds = new Set(users.map((u) => u.id));
  const queryIds = new Set(queries.map((q) => String(q.query_id || '').trim().toUpperCase()));
  const appointmentIds = new Set(appointments.map((a) => String(a.id || '').trim().toUpperCase()));

  // 3a. Orphaned links & status/delay sync on queries
  for (const q of queries) {
    const qId = String(q.query_id || '').trim().toUpperCase();
    if (!userIds.has(q.account_manager_id)) {
      warnings.push(`Query ${qId} has unknown account_manager_id "${q.account_manager_id}".`);
    }
    if (!userIds.has(q.manager_id)) {
      warnings.push(`Query ${qId} has unknown manager_id "${q.manager_id}".`);
    }
    if (q.linked_appointment_id) {
      const linkedApt = String(q.linked_appointment_id).trim().toUpperCase();
      if (!appointmentIds.has(linkedApt)) {
        await patchTable('queries', `query_id=eq.${encodeURIComponent(q.query_id)}`, {
          linked_appointment_id: null,
        });
        repairs.push(
          `Auto-unlinked stale linked_appointment_id "${linkedApt}" from Query ${qId}.`
        );
      }
    }

    const isCompletedByFlags = Boolean(q.manager_done) && Boolean(q.account_manager_done);
    const isCompletedByStatus = q.status === 'Completed';
    if (isCompletedByFlags !== isCompletedByStatus) {
      warnings.push(
        `Status mismatch on Query ${qId}: status="${q.status}", manager_done=${q.manager_done}, account_manager_done=${q.account_manager_done}.`
      );
    }

    // Check if DB is_delayed column is stale vs actual SLA deadline for pending queries
    const isExempt = qId === 'QRY-009' || qId === 'QRY-005';
    const createdAtMs = Number(q.created_at_ms) || 0;
    const targetDueAtMs =
      q.extension_status === 'APPROVED' && Number(q.target_due_at_ms) > createdAtMs
        ? Number(q.target_due_at_ms)
        : 0;
    const effectiveDeadlineMs = targetDueAtMs > 0 ? targetDueAtMs : createdAtMs + DELAY_THRESHOLD_MS;

    if (!isCompletedByStatus && !isExempt && createdAtMs > 0) {
      let expectedDelayed = false;
      if (q.is_urgent) {
        const firstMgrMs = Number(q.first_manager_remark_at_ms) || 0;
        expectedDelayed =
          firstMgrMs > 0
            ? firstMgrMs > createdAtMs + URGENT_REMARK_THRESHOLD_MS
            : nowMs > createdAtMs + URGENT_REMARK_THRESHOLD_MS;
      } else {
        expectedDelayed = nowMs > effectiveDeadlineMs;
      }
      if (Boolean(q.is_delayed) !== expectedDelayed) {
        await patchTable('queries', `query_id=eq.${encodeURIComponent(q.query_id)}`, {
          is_delayed: expectedDelayed,
        });
        repairs.push(
          `Auto-synced is_delayed=${expectedDelayed} on open Query ${qId}.`
        );
      }
    }
  }

  for (const a of appointments) {
    const aId = String(a.id || '').trim().toUpperCase();
    if (a.query_id) {
      const linkedQry = String(a.query_id).trim().toUpperCase();
      if (!queryIds.has(linkedQry)) {
        await patchTable('appointments', `id=eq.${encodeURIComponent(a.id)}`, {
          query_id: null,
        });
        repairs.push(
          `Auto-unlinked stale query_id "${linkedQry}" from Appointment ${aId}.`
        );
      }
    }
  }

  // 3b. Stale activity logs referencing deleted queries or appointments
  const orphanedActivityTargets = new Set();
  for (const act of activities) {
    const targetId = String(act.target_id || '').trim().toUpperCase();
    if (targetId.startsWith('QRY-') && !queryIds.has(targetId)) {
      orphanedActivityTargets.add(targetId);
    } else if (targetId.startsWith('APT-') && !appointmentIds.has(targetId)) {
      orphanedActivityTargets.add(targetId);
    }
  }
  for (const orphanTarget of orphanedActivityTargets) {
    await deleteFromTable('user_activities', `target_id=eq.${encodeURIComponent(orphanTarget)}`);
    repairs.push(`Auto-deleted stale user_activities referencing deleted item ${orphanTarget}.`);
  }

  // 3c. Stale online user presence (> 12 hours without heartbeat while still marked is_online = true)
  for (const p of presences) {
    const lastSeenMs = Number(p.last_seen_at_ms) || 0;
    if (p.is_online && lastSeenMs > 0 && nowMs - lastSeenMs > STALE_PRESENCE_MS) {
      const hoursAgo = ((nowMs - lastSeenMs) / 3600000).toFixed(1);
      await patchTable('user_presence', `user_id=eq.${encodeURIComponent(p.user_id)}`, {
        is_online: false,
      });
      repairs.push(
        `Auto-cleared stale is_online=true for ${p.user_name} (${p.user_id}, last seen ${hoursAgo}h ago).`
      );
    }
  }

  if (repairs.length > 0) {
    console.log(`  REPAIRED - Applied ${repairs.length} stale-data cleanup(s):`);
    for (const r of repairs) {
      console.log(`    + ${r}`);
    }
  }

  if (warnings.length === 0) {
    console.log('  OK - Zero unresolved data integrity or staleness warnings.');
  } else {
    console.log(`  WARNING - ${warnings.length} unresolved item(s) requiring attention:`);
    for (const w of warnings) {
      console.log(`    * ${w}`);
    }
  }

  const pendingQueries = queries.filter((q) => q.status !== 'Completed');
  const completedQueries = queries.filter((q) => q.status === 'Completed');
  console.log('\n----------------------------------------------------------------');
  console.log(
    `Summary: ${queries.length} queries (${pendingQueries.length} Pending, ${completedQueries.length} Completed), ${appointments.length} appointments, ${repairs.length} auto-repaired, ${warnings.length} warnings.`
  );
  console.log('----------------------------------------------------------------');

  if (hasErrors) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in healthCheck.mjs:', err);
  process.exit(1);
});
