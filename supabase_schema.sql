-- ============================================================================
-- WM Manager Dashboard - Supabase Relational Schema
-- Connected by: complaint_id, account_manager_id, manager_id, and created_at
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drop legacy department column if it exists from an earlier schema version
ALTER TABLE public.users DROP COLUMN IF EXISTS department;

-- Remove old manager account if present and not referenced, or update mgr-1
DELETE FROM public.users WHERE email = 'wmgteja@gmail.com' AND id != 'mgr-1';

-- Seed authorized users so foreign keys for account_manager_id and manager_id work out of the box
INSERT INTO public.users (id, name, email, role, role_label, avatar_initials)
VALUES
  ('am-1', 'Shakti', 'wmdklshakti@gmail.com', 'account_manager', 'Account Manager', 'SK'),
  ('am-2', 'Kavita', 'wmdklkavita@gmail.com', 'account_manager', 'Account Manager', 'KV'),
  ('am-3', 'Linda', 'wmdkllinda@gmail.com', 'account_manager', 'Account Manager', 'LD'),
  ('mgr-1', 'Muugaa', 'wmdklmuugaa@gmail.com', 'manager', 'Manager', 'MG'),
  ('mgr-2', 'Awi', 'wmdklawi@gmail.com', 'manager', 'Manager', 'AW'),
  ('mgr-3', 'Jay', 'wmdkljay@gmail.com', 'manager', 'Manager', 'JY'),
  ('adm-1', 'Admin', 'admin1@gmail.com', 'admin', 'Admin', 'AD')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_label = EXCLUDED.role_label,
  avatar_initials = EXCLUDED.avatar_initials;

-- 2. Complaints Table
-- Keyed by complaint_id and linked to account_manager_id, manager_id, and immutable created_at
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
  created_at_ms BIGINT NOT NULL
);

-- Indexes for fast filtering & metric calculations
CREATE INDEX IF NOT EXISTS idx_complaints_manager_id ON public.complaints(manager_id);
CREATE INDEX IF NOT EXISTS idx_complaints_account_manager_id ON public.complaints(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_complaints_created_at_ms ON public.complaints(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.complaints(status);

-- Trigger to enforce:
-- 1) created_at and created_at_ms NEVER change on UPDATE
-- 2) status is 'Completed' ONLY when BOTH manager_done AND account_manager_done are TRUE
CREATE OR REPLACE FUNCTION public.enforce_complaint_rules()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_at_ms := OLD.created_at_ms;
  END IF;

  IF NEW.manager_done = TRUE AND NEW.account_manager_done = TRUE THEN
    NEW.status := 'Completed';
  ELSE
    NEW.status := 'Pending';
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

-- 4. Enable Realtime for complaints table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'complaints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;
  END IF;
END $$;
