-- ============================================================
-- WACRM: RESTAURANT ORDER OUTBOX & FEEDBACK DISPATCH LEDGER SCHEMA
-- Migration: 202611220003_restaurant_feedback_and_outbox_schema.sql
--
-- Adds:
-- 1. `restaurant_order_outbox_events` - Durable transactional outbox for reliable order lifecycle event dispatching
-- 2. `restaurant_feedback_dispatch_ledger` - Tenant-scoped ledger preventing duplicate customer feedback requests
-- 3. Columns on `restaurant_trial_orders` for direct feedback tracking
-- ============================================================

-- PART 1: Alter restaurant_trial_orders with feedback tracking columns
ALTER TABLE public.restaurant_trial_orders
  ADD COLUMN IF NOT EXISTS feedback_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_status TEXT DEFAULT 'none'
    CHECK (feedback_status IN ('none', 'initiated', 'pending', 'submitted', 'delivered', 'failed', 'skipped', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_trial_orders_feedback_status
  ON public.restaurant_trial_orders (account_id, status, feedback_status);

-- PART 2: Transactional Outbox for Durable Order Lifecycle Events
CREATE TABLE IF NOT EXISTS public.restaurant_order_outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.restaurant_trial_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'dispatched', 'failed')),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  -- Strict idempotency: same order and event_type cannot be queued more than once
  CONSTRAINT uq_restaurant_order_outbox_event UNIQUE (account_id, order_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_order_outbox_pending
  ON public.restaurant_order_outbox_events (account_id, status, created_at)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.restaurant_order_outbox_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_order_outbox_events_access"
  ON public.restaurant_order_outbox_events
  FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

-- PART 3: Tenant-Scoped Feedback Dispatch Ledger
CREATE TABLE IF NOT EXISTS public.restaurant_feedback_dispatch_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.restaurant_trial_orders(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  feedback_purpose TEXT NOT NULL DEFAULT 'customer_order_feedback',
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'pending_send', 'submitted_to_meta', 'sent', 'delivered', 'read', 'failed', 'skipped', 'blocked')),
  block_reason TEXT,
  whatsapp_message_id TEXT,
  template_name TEXT,
  template_category TEXT,
  is_test_order BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  -- Strict unique constraint on account, order, and feedback purpose
  CONSTRAINT uq_feedback_dispatch_ledger UNIQUE (account_id, order_id, feedback_purpose)
);

CREATE INDEX IF NOT EXISTS idx_feedback_dispatch_wamid
  ON public.restaurant_feedback_dispatch_ledger (account_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_dispatch_status
  ON public.restaurant_feedback_dispatch_ledger (account_id, order_id, status);

ALTER TABLE public.restaurant_feedback_dispatch_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "restaurant_feedback_dispatch_ledger_access"
  ON public.restaurant_feedback_dispatch_ledger
  FOR ALL
  USING (
    account_id IN (
      SELECT account_id FROM public.profiles WHERE user_id = auth.uid()
    )
  );

-- PART 4: Guard Account Deletion in redeem_invitation RPC
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
    UNION ALL SELECT 1 FROM restaurant_trial_draft_carts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM backend_flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM backend_flow_versions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM backend_flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM restaurant_order_outbox_events WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM restaurant_feedback_dispatch_ledger WHERE account_id = v_old_account_id
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

-- PART 5: Atomic Order Transition & Outbox Enqueue RPC
-- Atomically updates order status and enqueues lifecycle event into outbox in a single DB transaction.
CREATE OR REPLACE FUNCTION public.transition_restaurant_order_status(
  p_account_id UUID,
  p_order_id UUID,
  p_new_status TEXT,
  p_cancellation_reason TEXT DEFAULT NULL,
  p_updated_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order restaurant_trial_orders%ROWTYPE;
  v_outbox_id UUID := NULL;
  v_event_type TEXT := NULL;
  v_payload JSONB := '{}'::jsonb;
BEGIN
  -- 1. Lock the order row FOR UPDATE to prevent concurrent race conditions
  SELECT * INTO v_order
  FROM restaurant_trial_orders
  WHERE id = p_order_id AND account_id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Order not found',
      'code', 'ORDER_NOT_FOUND'
    );
  END IF;

  -- 2. Guard: Cannot update cancelled or rejected orders
  IF v_order.status IN ('cancelled', 'kitchen_rejected') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot update order with status ' || v_order.status,
      'code', 'INVALID_TRANSITION'
    );
  END IF;

  -- 3. Guard: Prevent duplicate transition events if already in target status
  IF v_order.status = p_new_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'order', to_jsonb(v_order),
      'unchanged', true
    );
  END IF;

  -- 4. Update the order row
  UPDATE restaurant_trial_orders
  SET status = p_new_status,
      kitchen_rejection_reason = CASE
        WHEN p_new_status = 'cancelled' AND p_cancellation_reason IS NOT NULL THEN p_cancellation_reason
        ELSE kitchen_rejection_reason
      END,
      updated_at = NOW()
  WHERE id = p_order_id AND account_id = p_account_id
  RETURNING * INTO v_order;

  -- 5. Determine event type and build payload
  IF p_new_status = 'completed' THEN
    v_event_type := 'order.completed';
  ELSIF p_new_status = 'cancelled' THEN
    v_event_type := 'order.cancelled';
  ELSIF p_new_status = 'ready' THEN
    v_event_type := 'order.ready';
  END IF;

  -- 6. Atomically insert outbox event within the exact same transaction
  IF v_event_type IS NOT NULL THEN
    v_payload := jsonb_build_object(
      'orderId', v_order.id,
      'orderNumber', v_order.order_number,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'deliveryFee', v_order.delivery_fee,
      'totalAmount', v_order.total_amount,
      'fulfilmentType', v_order.fulfilment_type,
      'deliveryAddress', v_order.delivery_address,
      'paymentMethod', v_order.payment_method,
      'paymentStatus', v_order.payment_status,
      'isTestOrder', COALESCE(v_order.is_test_order, false),
      'contactId', v_order.contact_id,
      'conversationId', v_order.conversation_id,
      'updatedBy', p_updated_by,
      'cancellationReason', p_cancellation_reason
    );

    INSERT INTO restaurant_order_outbox_events (
      account_id,
      order_id,
      event_type,
      payload,
      status
    )
    VALUES (
      p_account_id,
      p_order_id,
      v_event_type,
      v_payload,
      'pending'
    )
    ON CONFLICT (account_id, order_id, event_type) DO NOTHING
    RETURNING id INTO v_outbox_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order', to_jsonb(v_order),
    'outbox_id', v_outbox_id,
    'event_type', v_event_type,
    'unchanged', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_restaurant_order_status(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_restaurant_order_status(UUID, UUID, TEXT, TEXT, UUID) TO authenticated, service_role;


