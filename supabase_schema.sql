-- ============================================================================
-- WM Manager Dashboard - Supabase Relational Schema (Updated with SLA / Delay Tracking)
-- Connected by: complaint_id, account_manager_id, manager_id, created_at, and completed_at
-- Run this script in your Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 1. Users Table (Account Managers, Managers, Admin)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('account_manager', 'manager', 'admin')),
  role_label TEXT NOT NULL,
  avatar_initials TEXT NOT NULL,
  phone TEXT DEFAULT NULL,
  callmebot_api_key TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade public.users table if it already exists
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS callmebot_api_key TEXT DEFAULT NULL;

-- Drop legacy department column if it exists from an earlier schema version
ALTER TABLE public.users DROP COLUMN IF EXISTS department;

-- Remove old manager account if present and not referenced, or update mgr-1
DELETE FROM public.users WHERE email = 'wmgteja@gmail.com' AND id != 'mgr-1';

-- Seed authorized users with phone numbers so notifications work immediately
INSERT INTO public.users (id, name, email, role, role_label, avatar_initials, phone)
VALUES
  ('am-1', 'Shakti', 'wmdklshakti@gmail.com', 'account_manager', 'Account Manager', 'SK', '+60194167570'),
  ('am-2', 'Kavita', 'wmdklkavita@gmail.com', 'account_manager', 'Account Manager', 'KV', NULL),
  ('am-3', 'Linda', 'wmdkllinda@gmail.com', 'account_manager', 'Account Manager', 'LD', NULL),
  ('mgr-1', 'Muugaa', 'wmdklmuugaa@gmail.com', 'manager', 'Manager', 'MG', '+601940017570'),
  ('mgr-2', 'Awi', 'wmdklawi@gmail.com', 'manager', 'Manager', 'AW', NULL),
  ('mgr-3', 'Jay', 'wmdkljay@gmail.com', 'manager', 'Manager', 'JY', NULL),
  ('adm-1', 'Admin', 'admin1@gmail.com', 'admin', 'Admin', 'AD', '+601157350949')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_label = EXCLUDED.role_label,
  avatar_initials = EXCLUDED.avatar_initials,
  phone = COALESCE(EXCLUDED.phone, public.users.phone);

-- 2. Complaints Table
-- Keyed by complaint_id and linked to account_manager_id, manager_id, immutable created_at, and completion SLA tracking
CREATE TABLE IF NOT EXISTS public.complaints (
  complaint_id TEXT PRIMARY KEY,
  account_manager_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE,
  account_manager_name TEXT NOT NULL,
  account_manager_email TEXT NOT NULL,
  manager_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE,
  manager_name TEXT NOT NULL,
  manager_email TEXT NOT NULL,
  complaint_text TEXT NOT NULL,
  manager_remark TEXT NOT NULL DEFAULT '',
  manager_done BOOLEAN NOT NULL DEFAULT FALSE,
  account_manager_remark TEXT NOT NULL DEFAULT '',
  account_manager_done BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  created_at TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  completed_at TEXT DEFAULT NULL,
  completed_at_ms BIGINT DEFAULT NULL,
  is_delayed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Safely add new columns if upgrading an existing complaints table
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS completed_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_delayed BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing completed rows that do not have completed_at_ms yet
UPDATE public.complaints
SET
  completed_at = COALESCE(completed_at, created_at),
  completed_at_ms = COALESCE(completed_at_ms, created_at_ms)
WHERE manager_done = TRUE
  AND account_manager_done = TRUE
  AND completed_at_ms IS NULL;

-- Backfill is_delayed for existing rows (> 48 hours = 172,800,000 ms)
UPDATE public.complaints
SET is_delayed = CASE
  WHEN manager_done = TRUE AND account_manager_done = TRUE THEN
    ((COALESCE(completed_at_ms, created_at_ms) - created_at_ms) > 172800000)
  ELSE
    (((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - created_at_ms) > 172800000)
END;

-- Indexes for fast filtering & metric calculations
CREATE INDEX IF NOT EXISTS idx_complaints_manager_id ON public.complaints(manager_id);
CREATE INDEX IF NOT EXISTS idx_complaints_account_manager_id ON public.complaints(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at_ms ON public.complaints(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_is_delayed ON public.complaints(is_delayed);

-- Trigger to enforce:
-- 1) created_at and created_at_ms NEVER change on UPDATE
-- 2) account_manager_done is automatically reset to FALSE if manager_done is FALSE
-- 3) status is 'Completed' ONLY when BOTH manager_done AND account_manager_done are TRUE
-- 4) completed_at / completed_at_ms and is_delayed (>48h SLA breach) are persisted even after completion
CREATE OR REPLACE FUNCTION public.enforce_complaint_rules()
RETURNS TRIGGER AS $$
DECLARE
  now_ms BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  delay_threshold_ms BIGINT := 172800000; -- 48 hours (172,800,000 ms)
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_at_ms := OLD.created_at_ms;
  END IF;

  IF NEW.manager_done = FALSE THEN
    NEW.account_manager_done := FALSE;
  END IF;

  IF NEW.manager_done = TRUE AND NEW.account_manager_done = TRUE THEN
    NEW.status := 'Completed';

    IF TG_OP = 'UPDATE' AND OLD.completed_at_ms IS NOT NULL THEN
      NEW.completed_at := OLD.completed_at;
      NEW.completed_at_ms := OLD.completed_at_ms;
    ELSIF NEW.completed_at_ms IS NULL THEN
      NEW.completed_at := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI:SS');
      NEW.completed_at_ms := now_ms;
    END IF;

    -- Keep is_delayed = TRUE if it took >48h to complete or was already delayed (>48h) before completion
    IF ((NEW.completed_at_ms - NEW.created_at_ms) > delay_threshold_ms)
       OR (TG_OP = 'UPDATE' AND OLD.is_delayed = TRUE)
       OR (NEW.is_delayed = TRUE) THEN
      NEW.is_delayed := TRUE;
    ELSE
      NEW.is_delayed := FALSE;
    END IF;
  ELSE
    NEW.status := 'Pending';
    NEW.completed_at := NULL;
    NEW.completed_at_ms := NULL;

    IF ((now_ms - NEW.created_at_ms) > delay_threshold_ms) THEN
      NEW.is_delayed := TRUE;
    ELSE
      NEW.is_delayed := FALSE;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_complaint_rules ON public.complaints;
CREATE TRIGGER trg_enforce_complaint_rules
BEFORE INSERT OR UPDATE ON public.complaints
FOR EACH ROW
EXECUTE FUNCTION public.enforce_complaint_rules();

-- 3. Enable Row Level Security & Policies for Anon/Public Client Access
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to users" ON public.users;
DROP POLICY IF EXISTS "Allow full access to users" ON public.users;
CREATE POLICY "Allow full access to users"
  ON public.users FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access to complaints" ON public.complaints;
CREATE POLICY "Allow full access to complaints"
  ON public.complaints FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Enable Realtime for complaints table (with full replica identity for updates/deletes)
ALTER TABLE public.complaints REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'complaints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
  END IF;
END $$;

-- 5. Push Subscriptions Table (for Web Push notifications across desktop & mobile)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT,
  auth TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access to push_subscriptions" ON public.push_subscriptions;
CREATE POLICY "Allow full access to push_subscriptions"
  ON public.push_subscriptions FOR ALL
  USING (true)
  WITH CHECK (true);
