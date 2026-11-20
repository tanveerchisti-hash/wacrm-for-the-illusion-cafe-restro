
-- ============================================================
-- WACRM: ORDERING SESSION TIMEOUT
-- Default inactivity timeout: 6 hours
-- ============================================================

-- PART 1: Create ordering sessions table

CREATE TABLE IF NOT EXISTS public.ordering_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  contact_id UUID NOT NULL
    REFERENCES public.contacts(id) ON DELETE CASCADE,

  conversation_id UUID
    REFERENCES public.conversations(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'expired',
        'completed',
        'cancelled'
      )
    ),

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  last_customer_activity_at TIMESTAMPTZ
    NOT NULL DEFAULT now(),

  expires_at TIMESTAMPTZ NOT NULL
    DEFAULT (now() + INTERVAL '6 hours'),

  ended_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ordering_session_time_valid
    CHECK (expires_at >= started_at)
);

-- PART 2: Prevent multiple active sessions
-- for the same customer in the same account

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_ordering_sessions_one_active
ON public.ordering_sessions (
  account_id,
  contact_id
)
WHERE status = 'active';

-- PART 3: Speed up expiry lookups

CREATE INDEX IF NOT EXISTS
  idx_ordering_sessions_expiry
ON public.ordering_sessions (
  account_id,
  status,
  expires_at
);

-- PART 4: Protect the table with RLS

ALTER TABLE public.ordering_sessions
ENABLE ROW LEVEL SECURITY;

-- PART 5: Atomic expiry function

CREATE OR REPLACE FUNCTION
public.expire_inactive_ordering_session(
  p_account_id UUID,
  p_contact_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id UUID;
  v_tag_id UUID;
BEGIN

  -- Find an expired active session.
  -- Verify that the customer belongs to this account.

  SELECT s.id
  INTO v_session_id
  FROM public.ordering_sessions AS s
  INNER JOIN public.contacts AS c
    ON c.id = s.contact_id
   AND c.account_id = s.account_id
  WHERE s.account_id = p_account_id
    AND s.contact_id = p_contact_id
    AND s.status = 'active'
    AND s.expires_at <= clock_timestamp()
  FOR UPDATE OF s;

  -- No expired session found.

  IF v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Mark the session expired.

  UPDATE public.ordering_sessions
  SET
    status = 'expired',
    ended_at = clock_timestamp()
  WHERE id = v_session_id
    AND account_id = p_account_id
    AND contact_id = p_contact_id
    AND status = 'active';

  -- Find ordering_active tag belonging
  -- to the same WACRM account.

  SELECT id
  INTO v_tag_id
  FROM public.tags
  WHERE account_id = p_account_id
    AND name = 'ordering_active'
  LIMIT 1;

  -- Remove the tag association.
  -- Do not delete the tag definition.

  IF v_tag_id IS NOT NULL THEN
    DELETE FROM public.contact_tags
    WHERE contact_id = p_contact_id
      AND tag_id = v_tag_id;
  END IF;

  RETURN TRUE;

END;
$$;

-- PART 6: Restrict function execution
-- to the trusted Supabase service role

REVOKE ALL ON FUNCTION
public.expire_inactive_ordering_session(
  UUID, UUID
)
FROM PUBLIC;

REVOKE ALL ON FUNCTION
public.expire_inactive_ordering_session(
  UUID, UUID
)
FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.expire_inactive_ordering_session(
  UUID, UUID
)
TO service_role;

-- ============================================================
-- END OF MIGRATION
-- ============================================================
