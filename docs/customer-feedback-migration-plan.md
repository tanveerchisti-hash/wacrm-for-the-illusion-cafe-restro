# WACRM Customer Feedback Automation — Database Migration Plan

**Document ID:** `MIG-WACRM-FEEDBACK-20261122`  
**Target Database:** Supabase PostgreSQL (WACRM Production/Staging)  
**Author:** WACRM Database Architecture & Reliability Engineering  
**Status:** `READY FOR REVIEW & APPROVAL` (Not applied to remote database)

---

## 1. Migration Inventory

Two sequential migrations have been authored in `supabase/migrations/`:

| Migration File | Purpose | Scope | Tenant Isolation |
|---|---|---|---|
| `202611220003_restaurant_feedback_and_outbox_schema.sql` | Schema, RLS, Indexes, Outbox, Ledger, `redeem_invitation` guard, and `transition_restaurant_order_status` RPC | Structural Schema | Fully account-scoped via `account_id` and RLS |
| `202611220004_customer_feedback_workflow_template.sql` | Workflow definition template for slug `'customer-feedback-automation'` | Data / Configuration | Dynamic slug lookup (zero hardcoded tenant IDs) |

---

## 2. Preflight Verification Checklist

Before applying these migrations to a live or staging Supabase instance:

1. **Database Backup:**
   - Execute a full database snapshot via Supabase Dashboard or CLI:
     ```bash
     supabase db dump -f pre_feedback_migration_backup.sql
     ```
2. **Schema Prerequisite Verification:**
   - Confirm table `restaurant_trial_orders` exists.
   - Confirm table `backend_flows` exists.
   - Confirm function `redeem_invitation(TEXT)` exists.
3. **Draft Status Assurance:**
   - Migration `202611220004` explicitly writes `status = 'draft'`. It will NOT activate or publish the automation upon application.

---

## 3. Migration Step-by-Step Execution

### Step 1: Execute Schema Migration (`202611220003`)

```sql
-- 1. Add feedback tracking columns to restaurant_trial_orders
ALTER TABLE public.restaurant_trial_orders
  ADD COLUMN IF NOT EXISTS feedback_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_status TEXT DEFAULT 'none'
    CHECK (feedback_status IN ('none', 'initiated', 'pending', 'submitted', 'delivered', 'failed', 'skipped', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_trial_orders_feedback_status
  ON public.restaurant_trial_orders (account_id, status, feedback_status);

-- 2. Create restaurant_order_outbox_events table
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

-- 3. Create restaurant_feedback_dispatch_ledger table
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

-- 4. Update redeem_invitation RPC data-retention guard
-- (See full definition in migration file)

-- 5. Create atomic transition RPC transition_restaurant_order_status
-- (See full definition in migration file)
```

### Step 2: Execute Workflow Template Migration (`202611220004`)

Updates any existing workflow with slug `'customer-feedback-automation'` to the verified 5-node production graph:
`Order Completed → Eligibility Check → 20-Min Delay → Pre-Send Revalidation → WhatsApp Feedback`
- Leaves status strictly as `'draft'`.
- Preserves all historical execution run traces and logs in `backend_flow_runs`.

---

## 4. Post-Migration Verification Queries

Run these queries after applying the migrations to confirm correct installation:

```sql
-- 1. Verify table creation
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('restaurant_order_outbox_events', 'restaurant_feedback_dispatch_ledger');

-- 2. Verify unique constraints
SELECT conname, contype 
FROM pg_constraint 
WHERE conname IN ('uq_restaurant_order_outbox_event', 'uq_feedback_dispatch_ledger');

-- 3. Verify RPC existence
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name IN ('transition_restaurant_order_status', 'redeem_invitation');

-- 4. Verify workflow template definition
SELECT slug, status, jsonb_array_length(definition->'nodes') AS node_count 
FROM public.backend_flows 
WHERE slug = 'customer-feedback-automation';
```
*Expected: 2 tables returned, 2 constraints returned, 2 routines returned, node_count = 5, status = 'draft'.*

---

## 5. Rollback Procedures

If migration must be rolled back:

```sql
-- Rollback Step 2: Revert workflow definition to previous state if needed
-- (Preserved in Git or backup)

-- Rollback Step 1: Drop newly created tables and functions
DROP FUNCTION IF EXISTS public.transition_restaurant_order_status(UUID, UUID, TEXT, TEXT, UUID);
DROP TABLE IF EXISTS public.restaurant_feedback_dispatch_ledger CASCADE;
DROP TABLE IF EXISTS public.restaurant_order_outbox_events CASCADE;

ALTER TABLE public.restaurant_trial_orders 
  DROP COLUMN IF EXISTS feedback_requested_at,
  DROP COLUMN IF EXISTS feedback_status;
```
