-- ============================================================================
-- WM Manager Dashboard - Supabase Relational Schema (Complete with Delay Tracking & Web Push)
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
  ('mgr-4', 'Tamil', 'wmgtamil@gmail.com', 'manager', 'Manager', 'TM', NULL),
  ('mgr-5', 'Aizam', 'wmgaizam@gmail.com', 'manager', 'Manager', 'AZ', NULL),
  ('mgr-6', 'Usha', 'wmdusha@gmail.com', 'manager', 'Manager', 'US', NULL),
  ('mgr-7', 'Muttha', 'wmgmuttha@gmail.com', 'manager', 'Manager', 'MT', NULL),
  ('mgr-8', 'Jay (HR)', 'wmgjay@gmail.com', 'manager', 'Manager', 'JH', NULL),
  ('adm-1', 'Mr Mani', 'admin1@gmail.com', 'admin', 'Admin', 'MN', '+601157350949'),
  ('adm-2', 'Teja', 'wmgteja@gmail.com', 'admin', 'Admin', 'TJ', NULL)
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
  delay_notified BOOLEAN NOT NULL DEFAULT FALSE,
  rating INTEGER DEFAULT NULL CHECK (rating >= 1 AND rating <= 5),
  target_due_at TEXT DEFAULT NULL,
  target_due_at_ms BIGINT DEFAULT NULL,
  extension_status TEXT DEFAULT 'NONE',
  extension_requested_at TEXT DEFAULT NULL,
  extension_proposed_due_at TEXT DEFAULT NULL,
  extension_proposed_due_at_ms BIGINT DEFAULT NULL,
  extension_reason TEXT DEFAULT NULL,
  extension_review_note TEXT DEFAULT NULL,
  extension_reviewed_at TEXT DEFAULT NULL,
  is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  last_urgent_reminder_at_ms BIGINT DEFAULT NULL,
  attachments TEXT DEFAULT NULL,
  manager_attachments TEXT DEFAULT NULL,
  cc_users TEXT DEFAULT NULL
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
  ADD COLUMN IF NOT EXISTS delay_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rating INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_due_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_due_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extension_status TEXT DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS extension_requested_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extension_proposed_due_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extension_proposed_due_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extension_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extension_review_note TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extension_reviewed_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS linked_appointment_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_urgent_reminder_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attachments TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manager_attachments TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS remarks_log TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_completed_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_completed_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_completed_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_completed_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_completed_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completion_note TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cc_users TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_receiver_rating INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_receiver_remark TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_receiver_rated_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_receiver_rated_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sender_receiver_rating INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sender_receiver_remark TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sender_receiver_rated_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sender_receiver_rated_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_sender_rating INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_sender_remark TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_sender_rated_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS admin_sender_rated_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receiver_sender_rating INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receiver_sender_remark TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receiver_sender_rated_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS receiver_sender_rated_at_ms BIGINT DEFAULT NULL;

-- Backfill receiver rating for senders to 10 stars for queries up till now (cutoff 1794298058000)
UPDATE public.queries
SET
  receiver_sender_rating = 10,
  receiver_sender_remark = 'Default 10★ rating (Legacy query)'
WHERE receiver_sender_rating IS NULL
  AND (created_at_ms IS NULL OR created_at_ms <= 1794298058000);

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

-- Backfill is_delayed for existing rows (> 24 hours = 86,400,000 ms or target due date)
UPDATE public.queries
SET is_delayed = CASE
  WHEN is_urgent = TRUE OR UPPER(query_id) = 'QRY-009' THEN FALSE
  WHEN extension_status = 'APPROVED' AND target_due_at_ms IS NOT NULL AND target_due_at_ms > 0 THEN
    CASE
      WHEN manager_done = TRUE AND account_manager_done = TRUE THEN
        (COALESCE(completed_at_ms, created_at_ms) > target_due_at_ms)
      ELSE
        (((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT) > target_due_at_ms)
    END
  WHEN manager_done = TRUE AND account_manager_done = TRUE THEN
    ((COALESCE(completed_at_ms, created_at_ms) - created_at_ms) > 86400000)
  ELSE
    (((EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT - created_at_ms) > 86400000)
END;

-- Indexes for fast filtering & metric calculations
CREATE INDEX IF NOT EXISTS idx_queries_manager_id ON public.queries(manager_id);
CREATE INDEX IF NOT EXISTS idx_queries_account_manager_id ON public.queries(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_queries_created_at_ms ON public.queries(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_queries_status ON public.queries(status);
CREATE INDEX IF NOT EXISTS idx_queries_is_delayed ON public.queries(is_delayed);

-- 3. Trigger to enforce query rules & delay calculations (24h threshold)
CREATE OR REPLACE FUNCTION public.enforce_query_rules()
RETURNS TRIGGER AS $$
DECLARE
  now_ms BIGINT := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  delay_threshold_ms BIGINT := 86400000; -- 24 hours
  effective_deadline_ms BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_at_ms := OLD.created_at_ms;
  END IF;

  -- Determine effective deadline (approved extension target due date or created_at + 24 hours)
  IF NEW.target_due_at_ms IS NOT NULL AND NEW.target_due_at_ms > 0 THEN
    effective_deadline_ms := NEW.target_due_at_ms;
  ELSE
    effective_deadline_ms := NEW.created_at_ms + delay_threshold_ms;
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

    -- Urgent queries and exempted queries (QRY-009, QRY-005) are never marked delayed
    IF NEW.is_urgent = TRUE OR UPPER(NEW.query_id) IN ('QRY-009', 'QRY-005') THEN
      NEW.is_delayed := FALSE;
    ELSIF (NEW.completed_at_ms > effective_deadline_ms)
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

    -- Open queries: urgent, exempted (QRY-009, QRY-005), or active approved extensions within deadline are NOT delayed
    IF NEW.is_urgent = TRUE OR UPPER(NEW.query_id) IN ('QRY-009', 'QRY-005') THEN
      NEW.is_delayed := FALSE;
    ELSIF NEW.extension_status = 'APPROVED' AND effective_deadline_ms > 0 AND now_ms <= effective_deadline_ms THEN
      NEW.is_delayed := FALSE;
    ELSIF (now_ms > effective_deadline_ms) THEN
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

-- 7. Appointments Table (Scheduling & Cross-Team Discussions)
CREATE TABLE IF NOT EXISTS public.appointments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  agenda TEXT NOT NULL DEFAULT '',
  requester_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  requester_role TEXT NOT NULL CHECK (requester_role IN ('account_manager', 'manager', 'admin')),
  receiver_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE,
  receiver_name TEXT NOT NULL,
  receiver_email TEXT NOT NULL,
  receiver_role TEXT NOT NULL CHECK (receiver_role IN ('account_manager', 'manager', 'admin')),
  scheduled_at TEXT NOT NULL,
  scheduled_at_ms BIGINT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  meeting_type TEXT NOT NULL DEFAULT 'Online Call' CHECK (meeting_type IN ('Online Call', 'Office/Desk', 'Phone')),
  meeting_location TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'RESCHEDULE_PROPOSED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
  reschedule_proposed_by TEXT DEFAULT NULL REFERENCES public.users(id) ON UPDATE CASCADE,
  proposed_scheduled_at TEXT DEFAULT NULL,
  proposed_scheduled_at_ms BIGINT DEFAULT NULL,
  reschedule_reason TEXT DEFAULT NULL,
  query_id TEXT DEFAULT NULL REFERENCES public.queries(query_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at TEXT DEFAULT NULL
);

-- Upgrade appointments table if columns exist
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS agenda TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS meeting_location TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS query_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reschedule_proposed_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS proposed_scheduled_at TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS proposed_scheduled_at_ms BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reschedule_reason TEXT DEFAULT NULL;

-- Indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_appointments_requester_id ON public.appointments(requester_id);
CREATE INDEX IF NOT EXISTS idx_appointments_receiver_id ON public.appointments(receiver_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at_ms ON public.appointments(scheduled_at_ms ASC);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_query_id ON public.appointments(query_id);

-- Enable RLS & Realtime for appointments
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access to appointments" ON public.appointments;
CREATE POLICY "Allow full access to appointments"
  ON public.appointments FOR ALL
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.appointments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;

-- ============================================================================
-- 8. User Activity Tracking & Real-Time Presence (Admin Live Monitoring)
-- ============================================================================

-- Audit trail of all user actions (queries, appointments, logins, completions)
CREATE TABLE IF NOT EXISTS public.user_activities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('account_manager', 'manager', 'admin')),
  action_type TEXT NOT NULL,
  action_title TEXT NOT NULL,
  action_details TEXT DEFAULT '',
  target_id TEXT DEFAULT NULL,
  target_type TEXT DEFAULT NULL,
  device_type TEXT DEFAULT 'desktop',
  created_at TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL
);

-- User presence / heartbeat for real-time live status
CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON UPDATE CASCADE,
  user_name TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('account_manager', 'manager', 'admin')),
  current_page TEXT NOT NULL DEFAULT 'home',
  current_action TEXT DEFAULT '',
  device_type TEXT DEFAULT 'desktop',
  last_seen_at TEXT NOT NULL,
  last_seen_at_ms BIGINT NOT NULL,
  is_online BOOLEAN NOT NULL DEFAULT TRUE
);

-- Indexes for lightning fast queries and ordering
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at_ms ON public.user_activities(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON public.user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_action_type ON public.user_activities(action_type);

-- Enable Row Level Security & Policies
ALTER TABLE public.user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access to user_activities" ON public.user_activities;
CREATE POLICY "Allow full access to user_activities"
  ON public.user_activities FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow full access to user_presence" ON public.user_presence;
CREATE POLICY "Allow full access to user_presence"
  ON public.user_presence FOR ALL
  USING (true)
  WITH CHECK (true);

-- Enable Realtime for activities and presence
ALTER TABLE public.user_activities REPLICA IDENTITY FULL;
ALTER TABLE public.user_presence REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_activities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_activities;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_presence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_presence;
  END IF;
END $$;

-- ============================================================================
-- 5. Trello Integration Tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_trello_integrations (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  trello_member_id TEXT NOT NULL,
  trello_username TEXT NOT NULL,
  trello_full_name TEXT NOT NULL,
  trello_email TEXT DEFAULT NULL,
  trello_avatar_url TEXT DEFAULT NULL,
  trello_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_trello_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access to user_trello_integrations" ON public.user_trello_integrations;
CREATE POLICY "Allow full access to user_trello_integrations"
  ON public.user_trello_integrations FOR ALL
  USING (true)
  WITH CHECK (true);

-- System Settings table (for storing Trello API Key or global configuration)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow full access to system_settings" ON public.system_settings;
CREATE POLICY "Allow full access to system_settings"
  ON public.system_settings FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 10. Supabase Storage Bucket for Attachments (Egress & Bandwidth Optimization)
-- Stores attachments via Supabase Storage CDN rather than heavy Base64 in database.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('query-attachments', 'query-attachments', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage object access policies for 'query-attachments'
DROP POLICY IF EXISTS "Allow public read query-attachments" ON storage.objects;
CREATE POLICY "Allow public read query-attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'query-attachments');

DROP POLICY IF EXISTS "Allow public insert query-attachments" ON storage.objects;
CREATE POLICY "Allow public insert query-attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'query-attachments');

DROP POLICY IF EXISTS "Allow public update query-attachments" ON storage.objects;
CREATE POLICY "Allow public update query-attachments"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'query-attachments');

DROP POLICY IF EXISTS "Allow public delete query-attachments" ON storage.objects;
CREATE POLICY "Allow public delete query-attachments"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'query-attachments');
