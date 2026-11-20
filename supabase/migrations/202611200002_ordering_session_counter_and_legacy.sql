
-- Create an ordering session and reset the AI reply
-- counter only when a NEW session is inserted.
-- Must be executed using the trusted service role.

CREATE OR REPLACE FUNCTION public.begin_ordering_session(
  p_account_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_activity_at timestamptz DEFAULT now()
)
RETURNS public.ordering_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_session public.ordering_sessions;
BEGIN
  -- Serialize session creation for this contact.
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE id = p_contact_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'Contact not in account';
  END IF;

  -- Verify the conversation belongs to the same
  -- account and customer.
  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id
      AND account_id = p_account_id
      AND contact_id = p_contact_id
  ) THEN
    RAISE EXCEPTION 'Conversation not in account';
  END IF;

  SELECT * INTO v_session
  FROM public.ordering_sessions
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
    AND status = 'active'
  FOR UPDATE;

  -- Existing session: refresh activity only.
  -- Never reset the reply count here.
  IF FOUND THEN
    IF v_session.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION
        'Expired session must be closed first';
    END IF;

    UPDATE public.ordering_sessions
    SET
      last_customer_activity_at =
        GREATEST(last_customer_activity_at, p_activity_at),
      expires_at =
        GREATEST(last_customer_activity_at, p_activity_at)
          + INTERVAL '6 hours'
    WHERE id = v_session.id
    RETURNING * INTO v_session;

    RETURN v_session;
  END IF;

  -- New ordering session.
  INSERT INTO public.ordering_sessions (
    account_id,
    contact_id,
    conversation_id,
    status,
    started_at,
    last_customer_activity_at,
    expires_at
  )
  VALUES (
    p_account_id,
    p_contact_id,
    p_conversation_id,
    'active',
    p_activity_at,
    p_activity_at,
    p_activity_at + INTERVAL '6 hours'
  )
  RETURNING * INTO v_session;

  -- Reset counter ONLY on new session creation.
  -- Preserve human ownership and manual AI pauses.
  UPDATE public.conversations
  SET ai_reply_count = 0
  WHERE id = p_conversation_id
    AND account_id = p_account_id
    AND contact_id = p_contact_id
    AND assigned_agent_id IS NULL
    AND ai_autoreply_disabled = false;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_ordering_session(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_ordering_session(
  uuid, uuid, uuid, timestamptz
) TO service_role;

-- Handle customers tagged before ordering_sessions
-- tracking was introduced.

CREATE OR REPLACE FUNCTION public.bootstrap_legacy_ordering_session(
  p_account_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_message_id text,
  p_received_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_tag_id uuid;
  v_previous_activity timestamptz;
BEGIN
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE id = p_contact_id
    AND account_id = p_account_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id
      AND account_id = p_account_id
      AND contact_id = p_contact_id
  ) THEN
    RETURN 'invalid_conversation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ordering_sessions
    WHERE account_id = p_account_id
      AND contact_id = p_contact_id
      AND status = 'active'
  ) THEN
    RETURN 'already_active';
  END IF;

  SELECT t.id INTO v_tag_id
  FROM public.tags t
  JOIN public.contact_tags ct
    ON ct.tag_id = t.id
  WHERE t.account_id = p_account_id
    AND t.name = 'ordering_active'
    AND ct.contact_id = p_contact_id
  LIMIT 1;

  IF v_tag_id IS NULL THEN
    RETURN 'not_tagged';
  END IF;

  -- The current inbound has already been inserted
  -- by the webhook. Exclude it to measure inactivity.
  SELECT MAX(m.created_at)
  INTO v_previous_activity
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.sender_type = 'customer'
    AND m.message_id IS DISTINCT FROM p_message_id
    AND m.created_at <= p_received_at;

  IF v_previous_activity IS NULL
     OR v_previous_activity <=
        p_received_at - INTERVAL '6 hours'
  THEN
    -- Legacy session is stale.
    DELETE FROM public.contact_tags
    WHERE contact_id = p_contact_id
      AND tag_id = v_tag_id;

    RETURN 'legacy_expired';
  END IF;

  -- Existing tagged customer is still active.
  -- Preserve the reply count: this is NOT a new order.
  INSERT INTO public.ordering_sessions (
    account_id,
    contact_id,
    conversation_id,
    status,
    started_at,
    last_customer_activity_at,
    expires_at
  )
  VALUES (
    p_account_id,
    p_contact_id,
    p_conversation_id,
    'active',
    p_received_at - INTERVAL '6 hours',
    v_previous_activity,
    v_previous_activity + INTERVAL '6 hours'
  );

  RETURN 'legacy_bootstrapped';
END;
$$;

REVOKE ALL ON FUNCTION
public.bootstrap_legacy_ordering_session(
  uuid, uuid, uuid, text, timestamptz
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.bootstrap_legacy_ordering_session(
  uuid, uuid, uuid, text, timestamptz
)
TO service_role;
