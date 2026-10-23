-- ============================================================================
-- WM Manager Dashboard - Supabase Relational Schema (Complete with SLA & Web Push)
-- Connected by: query_id, account_manager_id, manager_id, created_at, and completed_at
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade public.users table if it already exists
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT NULL;

-- Seed authorized users
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

-- 2. Queries Table
-- Remove legacy table and trigger function if they exist
DROP TABLE IF EXISTS public.complaints CASCADE;
DROP FUNCTION IF EXISTS public.enforce_complaint_rules() CASCADE;

-- Note: Both Account Managers and Managers can submit queries.
-- All queries must be addressed to a Manager (manager_id).
-- The creator/sender is stored in account_manager_id (which references public.users(id)).
-- Because public.users contains both managers and account managers, NO schema migration is needed!
CREATE TABLE IF NOT EXISTS public.queries (
  query_id TEXT PRIMARY KEY,
  account_manager_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE, -- Sender/Creator (AM or Manager)
  account_manager_name TEXT NOT NULL,
  account_manager_email TEXT NOT NULL,
  manager_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE, -- Assigned Manager (must be manager)
  manager_name TEXT NOT NULL,
  manager_email TEXT NOT NULL,
  query_title TEXT NOT NULL DEFAULT '',
  query_text TEXT NOT NULL,
  manager_remark_title TEXT NOT NULL DEFAULT '',
  manager_remark TEXT NOT NULL DEFAULT '',
  manager_done BOOLEAN NOT NULL DEFAULT FALSE,
  manager_done_at TEXT DEFAULT NULL,
  manager_done_at_ms BIGINT DEFAULT NULL,
  account_manager_remark_title TEXT NOT NULL DEFAULT '',
  account_manager_remark TEXT NOT NULL DEFAULT '',
  account_manager_done BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed')),
  created_at TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  completed_at TEXT DEFAULT NULL,
  completed_at_ms BIGINT DEFAULT NULL,
  is_delayed BOOLEAN NOT NULL DEFAULT FALSE,
  delay_notified BOOLEAN NOT NULL DEFAULT FALSE
);

-- Safely add new columns if upgrading an existing queries table
ALTER TABLE public.queries
  ADD COLUMN IF NOT EXISTS query_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS manager_remark_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_manager_remark_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS completed_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_done_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_done_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_delayed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delay_notified BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing manager_done rows that do not have manager_done_at_ms yet
UPDATE public.queries
SET
  manager_done_at = COALESCE(completed_at, created_at),
  manager_done_at_ms = COALESCE(completed_at_ms, created_at_ms)
WHERE manager_done = TRUE
  AND manager_done_at_ms IS NULL;

-- Backfill existing completed rows that do not have completed_at_ms yet
UPDATE public.queries
SET
  completed_at = COALESCE(completed_at, created_at),
  completed_at_ms = COALESCE(completed_at_ms, created_at_ms)
WHERE manager_done = TRUE
  AND account_manager_done = TRUE
  AND completed_at_ms IS NULL;

-- Backfill is_delayed for existing rows (> 48 hours = 172,800,000 ms)
UPDATE public.queries
SET is_delayed = CASE
  WHEN manager_done = TRUE AND account_manager_done = TRUE THEN
    ((COALESCE(completed_at_ms, created_at_ms) - created_at_ms) > 172800000)
  ELSE
    (((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - created_at_ms) > 172800000)
END;

-- Indexes for fast filtering & metric calculations
CREATE INDEX IF NOT EXISTS idx_queries_manager_id ON public.queries(manager_id);
CREATE INDEX IF NOT EXISTS idx_queries_account_manager_id ON public.queries(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_queries_created_at_ms ON public.queries(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_queries_status ON public.queries(status);
CREATE INDEX IF NOT EXISTS idx_queries_is_delayed ON public.queries(is_delayed);

-- 3. Trigger to enforce query rules & delay calculations
CREATE OR REPLACE FUNCTION public.enforce_query_rules()
RETURNS TRIGGER AS $$
DECLARE
  now_ms BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  delay_threshold_ms BIGINT := 172800000; -- 48 hours
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_at_ms := OLD.created_at_ms;
  END IF;

  IF NEW.manager_done = FALSE THEN
    NEW.account_manager_done := FALSE;
    NEW.manager_done_at := NULL;
    NEW.manager_done_at_ms := NULL;
  ELSE
    IF TG_OP = 'UPDATE' AND OLD.manager_done_at_ms IS NOT NULL THEN
      NEW.manager_done_at := OLD.manager_done_at;
      NEW.manager_done_at_ms := OLD.manager_done_at_ms;
    ELSIF NEW.manager_done_at_ms IS NULL THEN
      NEW.manager_done_at := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI:SS');
      NEW.manager_done_at_ms := now_ms;
    END IF;
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

DROP TRIGGER IF EXISTS trg_enforce_query_rules ON public.queries;
CREATE TRIGGER trg_enforce_query_rules
BEFORE INSERT OR UPDATE ON public.queries
FOR EACH ROW
EXECUTE FUNCTION public.enforce_query_rules();

-- 4. Enable Row Level Security & Policies for Anon/Public Client Access
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access to users" ON public.users;
CREATE POLICY "Allow full access to users"
  ON public.users FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access to queries" ON public.queries;
CREATE POLICY "Allow full access to queries"
  ON public.queries FOR ALL
  USING (true)
  WITH CHECK (true);

-- 5. Enable Realtime for queries table
ALTER TABLE public.queries REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queries;
  END IF;
END $$;

-- 6. Push Subscriptions Table (for Web Push notifications across desktop & mobile)
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