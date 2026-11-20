-- ============================================================
-- WACRM: RESTAURANT ORDER APPROVAL, FULFILMENT & TIMER TRIAL
-- Trial order lifecycle: pending_kitchen -> kitchen_accepted
--   -> fulfilment_pending -> payment_pending -> preparing -> ready
-- ============================================================

-- PART 1: Restaurant Trial Settings (Configurable per account)

CREATE TABLE IF NOT EXISTS public.restaurant_trial_settings (
  account_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  restaurant_name TEXT NOT NULL DEFAULT 'The Illusion Cafe & Restaurant',
  restaurant_address TEXT NOT NULL DEFAULT 'The Illusion Cafe & Restaurant, Main Market / Station Road',
  pickup_instructions TEXT NOT NULL DEFAULT 'Please collect your order at the counter when notified.',
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 40.00,
  test_upi_id TEXT NOT NULL DEFAULT 'test-illusioncafe@upi',
  test_qr_code_url TEXT,
  default_prep_minutes INTEGER NOT NULL DEFAULT 15,
  item_prep_durations JSONB NOT NULL DEFAULT '{"pizza": 20, "burger": 12, "pasta": 15, "coffee": 5, "tea": 5, "beverage": 5, "sandwich": 10, "fries": 8}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.restaurant_trial_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_trial_settings_account_access"
ON public.restaurant_trial_settings
FOR ALL
USING (
  account_id IN (
    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

-- PART 2: Restaurant Trial Orders Table

CREATE TABLE IF NOT EXISTS public.restaurant_trial_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  ordering_session_id UUID REFERENCES public.ordering_sessions(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_kitchen'
    CHECK (
      status IN (
        'pending_kitchen',
        'kitchen_accepted',
        'kitchen_rejected',
        'fulfilment_pending',
        'payment_pending',
        'preparing',
        'ready',
        'completed',
        'cancelled'
      )
    ),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  fulfilment_type TEXT CHECK (fulfilment_type IN ('delivery', 'takeaway')),
  delivery_address TEXT,
  delivery_location JSONB,
  payment_method TEXT CHECK (payment_method IN ('cash', 'upi')),
  payment_status TEXT CHECK (payment_status IN ('pending_collection', 'awaiting_verification', 'verified')),
  is_test_order BOOLEAN NOT NULL DEFAULT true,
  kitchen_decision_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kitchen_decision_at TIMESTAMPTZ,
  kitchen_rejection_reason TEXT,
  payment_confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_confirmed_at TIMESTAMPTZ,
  preparation_started_at TIMESTAMPTZ,
  estimated_prep_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance and isolation
CREATE INDEX IF NOT EXISTS idx_trial_orders_account_status
ON public.restaurant_trial_orders (account_id, status);

CREATE INDEX IF NOT EXISTS idx_trial_orders_contact
ON public.restaurant_trial_orders (account_id, contact_id, status);

ALTER TABLE public.restaurant_trial_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_trial_orders_account_access"
ON public.restaurant_trial_orders
FOR ALL
USING (
  account_id IN (
    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

-- PART 3: Item-wise Preparation Timers Table (Resilient Database Timestamps)

CREATE TABLE IF NOT EXISTS public.restaurant_trial_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.restaurant_trial_orders(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'preparing', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_order_items_order
ON public.restaurant_trial_order_items (order_id, account_id);

ALTER TABLE public.restaurant_trial_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_trial_order_items_account_access"
ON public.restaurant_trial_order_items
FOR ALL
USING (
  account_id IN (
    SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
  )
);

-- Service role access for webhooks and background automation
GRANT ALL ON public.restaurant_trial_settings TO service_role;
GRANT ALL ON public.restaurant_trial_orders TO service_role;
GRANT ALL ON public.restaurant_trial_order_items TO service_role;

-- PART 4: Account Membership Integrity Guard (redeem_invitation)
-- Ensures trial tables are guarded against accidental account deletion when accepting invitations

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ordering_sessions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM restaurant_trial_settings WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM restaurant_trial_orders WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM restaurant_trial_order_items WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

