-- ============================================================
-- WACRM: BACKEND FLOWS MODULE (PHASE 1)
-- Multi-tenant orchestration for server-side business logic,
-- order lifecycle pipelines, and event workflows with versioning.
-- ============================================================

-- PART 1: Master Backend Flows Table
CREATE TABLE IF NOT EXISTS public.backend_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'order_processing', 'kitchen_sync', 'payment_reconciliation', 'custom_integration')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual', 'webhook', 'schedule', 'order_event', 'system_event')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Schema compatible with @xyflow/react canvas
  definition JSONB NOT NULL DEFAULT '{"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{"timeout_seconds": 300, "max_retries": 3, "concurrency_limit": 5}'::jsonb,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_backend_flow_account_slug UNIQUE (account_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_backend_flows_account_status
  ON public.backend_flows (account_id, status);

CREATE INDEX IF NOT EXISTS idx_backend_flows_account_category
  ON public.backend_flows (account_id, category);

ALTER TABLE public.backend_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_flows_select_policy"
  ON public.backend_flows
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

CREATE POLICY "backend_flows_insert_policy"
  ON public.backend_flows
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "backend_flows_update_policy"
  ON public.backend_flows
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "backend_flows_delete_policy"
  ON public.backend_flows
  FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- PART 2: Immutable Version History Snapshots
CREATE TABLE IF NOT EXISTS public.backend_flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.backend_flows(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  definition JSONB NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_backend_flow_version UNIQUE (flow_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_backend_flow_versions_flow
  ON public.backend_flow_versions (flow_id, version_number DESC);

ALTER TABLE public.backend_flow_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_flow_versions_select_policy"
  ON public.backend_flow_versions
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

CREATE POLICY "backend_flow_versions_insert_policy"
  ON public.backend_flow_versions
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "backend_flow_versions_delete_policy"
  ON public.backend_flow_versions
  FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- PART 3: Execution Run History & Audit
CREATE TABLE IF NOT EXISTS public.backend_flow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES public.backend_flows(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  triggered_by TEXT NOT NULL,
  trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timed_out')),
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backend_flow_runs_flow_status
  ON public.backend_flow_runs (flow_id, status, created_at DESC);

ALTER TABLE public.backend_flow_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_flow_runs_select_policy"
  ON public.backend_flow_runs
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

CREATE POLICY "backend_flow_runs_insert_policy"
  ON public.backend_flow_runs
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "backend_flow_runs_update_policy"
  ON public.backend_flow_runs
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "backend_flow_runs_delete_policy"
  ON public.backend_flow_runs
  FOR DELETE
  USING (is_account_member(account_id, 'admin'));


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
