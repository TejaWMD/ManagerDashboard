-- Atomic sequence-backed ID generators for queries (QRY-XXX) and appointments (APT-XXX)
-- Run this once in the Supabase SQL Editor to eliminate concurrent ID collisions.

CREATE SEQUENCE IF NOT EXISTS public.query_id_seq START WITH 1;
CREATE SEQUENCE IF NOT EXISTS public.appointment_id_seq START WITH 1;

-- Sync sequences with current max numeric IDs so new IDs never collide with existing rows
SELECT setval(
  'public.query_id_seq',
  GREATEST(
    COALESCE((SELECT MAX((regexp_match(query_id, 'QRY-(\d+)', 'i'))[1]::BIGINT) FROM public.queries), 0),
    1
  ),
  true
);

SELECT setval(
  'public.appointment_id_seq',
  GREATEST(
    COALESCE((SELECT MAX((regexp_match(id, 'APT-(\d+)', 'i'))[1]::BIGINT) FROM public.appointments), 0),
    1
  ),
  true
);

CREATE OR REPLACE FUNCTION public.next_query_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num BIGINT;
BEGIN
  next_num := nextval('public.query_id_seq');
  RETURN 'QRY-' || LPAD(next_num::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.next_appointment_id()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num BIGINT;
BEGIN
  next_num := nextval('public.appointment_id_seq');
  RETURN 'APT-' || LPAD(next_num::TEXT, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_query_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_appointment_id() TO anon, authenticated;