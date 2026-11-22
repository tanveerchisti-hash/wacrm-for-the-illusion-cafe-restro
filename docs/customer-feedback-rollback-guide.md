# WACRM Customer Feedback Automation — Rollback & Emergency Guide

**Document ID:** `ROL-WACRM-FEEDBACK-20261122`  
**Target:** Emergency Suspension, Rollback & Disaster Recovery  
**Author:** WACRM Reliability & Incident Management Engineering

---

## 1. Emergency Killswitch Procedures (Zero-Downtime Halts)

If an anomaly, duplicate message, or policy issue is detected in production, execute one of the following emergency pause options immediately. None of these options require destructive database changes or server downtime.

### Option A: Global Environment Emergency Pause (Fastest System-Wide)
In Vercel Project Settings → Environment Variables:
1. Add or set:
   ```env
   BACKEND_FLOWS_EMERGENCY_PAUSE=true
   ```
2. Redeploy or restart runtime.
3. **Effect:** Every outbound send attempt across all backend flows immediately aborts with `EMERGENCY_PAUSED` and `shouldRetry: false`. Zero messages reach Meta.

### Option B: Workflow Unpublish (Immediate via Dashboard)
In WACRM Dashboard:
1. Navigate to `/backend-flows`.
2. Open `customer-feedback-automation`.
3. Click **Unpublish** (or change status to Draft).
4. **Effect:** New order completion events will not trigger the workflow. Pending executions already waiting on delay nodes will be blocked at pre-send revalidation.

### Option C: Account-Level Database Pause (No Code Deploy Needed)
Run this SQL command in Supabase SQL editor:
```sql
UPDATE public.whatsapp_config
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{emergency_paused}', 'true'::jsonb)
WHERE account_id = '<your-account-id>';
```
**Effect:** Sender checks abort outbound sending with `[EMERGENCY_PAUSED] Outbound messaging is currently suspended by persistent account configuration.`

---

## 2. In-Flight Execution Handling Policy

When an emergency pause is engaged:
- **Waiting Executions:** Runs currently waiting on the 20-minute delay node remain in status `'waiting'` in table `backend_flow_runs`.
- **Pre-Send Revalidation Guard:** When the cron resumes them, Node 4 (`restaurant_feedback_revalidation`) and Node 5 (`whatsapp_message`) inspect the pause state. If paused, the run safely terminates as `'skipped'` or `'blocked'`. No delayed customer messages will burst out after the pause is engaged.
- **Cancel Pending Waiting Runs (Optional Cleanup):**
  ```sql
  UPDATE public.backend_flow_runs
  SET status = 'cancelled',
      error = 'Cancelled by emergency administrator rollback'
  WHERE flow_id = 'dd8a35e6-551f-49c7-a8f7-307b051edc86'
    AND status = 'waiting';
  ```

---

## 3. Code Rollback Procedure

If a code defect requires rolling back to the previous deployment:

1. In Vercel Dashboard:
   - Go to Deployments.
   - Locate the previous stable production deployment (commit `614e9ea`).
   - Click **Promote to Production** (Instant Rollback).
2. The previous version will serve traffic immediately.
3. Note: The database schema changes in `202611220003` are fully backward compatible with earlier code versions, so rolling back application code will not break existing features.

---

## 4. Database Schema Rollback Procedure

If database tables must be removed:

> [!CAUTION]
> Do NOT drop `restaurant_trial_orders`. Real restaurant orders must be preserved.

```sql
-- Step 1: Remove atomic transition function
DROP FUNCTION IF EXISTS public.transition_restaurant_order_status(UUID, UUID, TEXT, TEXT, UUID);

-- Step 2: Drop feedback dispatch ledger (deletes feedback audit history)
DROP TABLE IF EXISTS public.restaurant_feedback_dispatch_ledger CASCADE;

-- Step 3: Drop outbox table (deletes outbox events)
DROP TABLE IF EXISTS public.restaurant_order_outbox_events CASCADE;

-- Step 4: Drop added feedback tracking columns
ALTER TABLE public.restaurant_trial_orders
  DROP COLUMN IF EXISTS feedback_requested_at,
  DROP COLUMN IF EXISTS feedback_status;
```

---

## 5. Post-Rollback Verification

1. Verify restaurant trial orders can be accepted and completed normally.
2. Verify customer welcome flows and AI auto-replies operate normally.
3. Confirm table `restaurant_feedback_dispatch_ledger` and `restaurant_order_outbox_events` are clean.
