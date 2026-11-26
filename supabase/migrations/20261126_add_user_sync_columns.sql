-- ============================================================================
-- ManagerDashboard (Query Portal) Migration: Add Optional Sync Columns
-- Safe, non-destructive migration for ManagerDashboard Supabase
-- (https://mjrqamakqqsqqmuvaqpw.supabase.co)
--
-- IMPORTANT:
-- - Does NOT modify existing user IDs, queries, appointments, or constraints.
-- - Keeps role CHECK (role IN ('account_manager', 'manager', 'admin')) intact
--   because staff users are NOT permitted on Query Portal.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS department TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS password TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
