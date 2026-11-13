-- Performance indexes to prevent full-table scans and reduce Supabase Disk IO
-- Run this once in the Supabase SQL Editor.

CREATE INDEX IF NOT EXISTS idx_queries_created_at_ms
  ON public.queries (created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_queries_status
  ON public.queries (status);

CREATE INDEX IF NOT EXISTS idx_queries_is_urgent
  ON public.queries (is_urgent)
  WHERE is_urgent = TRUE;

CREATE INDEX IF NOT EXISTS idx_queries_manager_id
  ON public.queries (manager_id);

CREATE INDEX IF NOT EXISTS idx_queries_account_manager_id
  ON public.queries (account_manager_id);

CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at_ms
  ON public.appointments (scheduled_at_ms ASC);

CREATE INDEX IF NOT EXISTS idx_appointments_query_id
  ON public.appointments (query_id)
  WHERE query_id IS NOT NULL;