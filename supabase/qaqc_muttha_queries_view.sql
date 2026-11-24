-- ============================================================================
-- Read-Only View for QAQCWeb: Queries Involving Muttha (From / To / CC)
-- ============================================================================
-- Safe & Non-Destructive:
--   * Does NOT modify public.queries, public.users, triggers, or RLS policies.
--   * Exposes ONLY Muttha's queries (From, To, or CC'd) and ONLY display fields
--     (excludes ratings, attachment blobs, and other managers' queries).
--
-- How to apply:
--   Run this script once in the ManagerDashboard Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE VIEW public.qaqc_muttha_queries AS
SELECT
  query_id,
  account_manager_id,
  account_manager_name,
  account_manager_email,
  manager_id,
  manager_name,
  manager_email,
  query_title,
  query_text,
  manager_remark_title,
  manager_remark,
  manager_done,
  manager_done_at,
  account_manager_remark_title,
  account_manager_remark,
  account_manager_done,
  status,
  created_at,
  created_at_ms,
  completed_at,
  completed_at_ms,
  is_delayed,
  is_urgent,
  target_due_at,
  cc_users,
  remarks_log,
  CASE
    WHEN manager_id = 'mgr-7' OR LOWER(COALESCE(manager_email, '')) = 'wmgmuttha@gmail.com' THEN 'to'
    WHEN account_manager_id = 'mgr-7' OR LOWER(COALESCE(account_manager_email, '')) = 'wmgmuttha@gmail.com' THEN 'from'
    ELSE 'cc'
  END AS muttha_relation
FROM public.queries
WHERE
  manager_id = 'mgr-7'
  OR LOWER(COALESCE(manager_email, '')) = 'wmgmuttha@gmail.com'
  OR account_manager_id = 'mgr-7'
  OR LOWER(COALESCE(account_manager_email, '')) = 'wmgmuttha@gmail.com'
  OR COALESCE(cc_users, '') ILIKE '%mgr-7%'
  OR COALESCE(cc_users, '') ILIKE '%wmgmuttha@gmail.com%';

GRANT SELECT ON public.qaqc_muttha_queries TO anon, authenticated;
