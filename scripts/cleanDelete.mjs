/**
 * Clean Deletion Utility for WM Manager Dashboard (Queries & Appointments)
 *
 * Usage:
 *   node scripts/cleanDelete.mjs QRY-048
 *   node scripts/cleanDelete.mjs APT-005 QRY-049
 *
 * What it does for each ID:
 *   1. If QRY-XXX:
 *      - Unlinks any appointments referencing query_id = QRY-XXX
 *      - Deletes all activity logs in public.user_activities where target_id = QRY-XXX
 *      - Deletes the row in public.queries where query_id = QRY-XXX
 *   2. If APT-XXX:
 *      - Unlinks any queries referencing linked_appointment_id = APT-XXX
 *      - Deletes all activity logs in public.user_activities where target_id = APT-XXX
 *      - Deletes the row in public.appointments where id = APT-XXX
 */

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

async function cleanDeleteItem(rawId) {
  const id = String(rawId || '').trim().toUpperCase();
  if (!id) return;

  if (id.startsWith('QRY-')) {
    console.log(`\n[CleanDelete] Cleaning and deleting Query ${id}...`);

    // 1. Unlink appointments referencing this query
    const unlinkAptRes = await fetch(
      `${SUPABASE_URL}/rest/v1/appointments?query_id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ query_id: null }),
      }
    ).then((r) => r.json());
    console.log(
      `  - Unlinked appointments: ${Array.isArray(unlinkAptRes) ? unlinkAptRes.length : 0}`
    );

    // 2. Delete all user_activities referencing this query
    const delActsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_activities?target_id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers,
      }
    ).then((r) => r.json());
    console.log(
      `  - Deleted activity logs: ${Array.isArray(delActsRes) ? delActsRes.length : 0}`
    );

    // 3. Delete the query row itself
    const delQueryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/queries?query_id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers,
      }
    ).then((r) => r.json());
    console.log(
      `  - Deleted query row: ${Array.isArray(delQueryRes) ? delQueryRes.length : 0}`
    );
  } else if (id.startsWith('APT-')) {
    console.log(`\n[CleanDelete] Cleaning and deleting Appointment ${id}...`);

    // 1. Unlink queries referencing this appointment
    const unlinkQryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/queries?linked_appointment_id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ linked_appointment_id: null }),
      }
    ).then((r) => r.json());
    console.log(
      `  - Unlinked queries: ${Array.isArray(unlinkQryRes) ? unlinkQryRes.length : 0}`
    );

    // 2. Delete all user_activities referencing this appointment
    const delActsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_activities?target_id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers,
      }
    ).then((r) => r.json());
    console.log(
      `  - Deleted activity logs: ${Array.isArray(delActsRes) ? delActsRes.length : 0}`
    );

    // 3. Delete the appointment row itself
    const delAptRes = await fetch(
      `${SUPABASE_URL}/rest/v1/appointments?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers,
      }
    ).then((r) => r.json());
    console.log(
      `  - Deleted appointment row: ${Array.isArray(delAptRes) ? delAptRes.length : 0}`
    );
  } else {
    console.warn(`[CleanDelete] Unknown ID prefix for "${id}". Expected QRY-XXX or APT-XXX.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Usage: node scripts/cleanDelete.mjs <QRY-XXX | APT-XXX> [...]');
    process.exit(0);
  }
  for (const arg of args) {
    await cleanDeleteItem(arg);
  }
  console.log('\n[CleanDelete] Done!');
}

main().catch((err) => {
  console.error('[CleanDelete] Error:', err);
  process.exit(1);
});
