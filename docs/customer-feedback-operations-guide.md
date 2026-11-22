# WACRM Customer Feedback Automation — Operations & Monitoring Guide

**Document ID:** `OPS-WACRM-FEEDBACK-20261122`  
**Target:** Operational Maintenance, Metrics, Troubleshooting & Day-2 Management  
**Author:** WACRM Operations & Site Reliability Engineering

---

## 1. System Architecture Overview

The Customer Feedback Automation coordinates across six distinct layers:

```
[Restaurant Order Transition: Completed]
             │
             ▼
[Atomic Transactional Outbox (PostgreSQL)] ───► [1-Min Cron Sweeper: Fallback Recovery]
             │
             ▼
[Backend Flows Trigger: order.completed]
             │
             ▼
[Step 1: Feedback Eligibility Adapter]
     - Tenant Isolation & Contact Existence
     - Staff Tag Exclusion
     - Opt-out / DND Consent Check
     - Suppression of Test Orders
     - Ledger Insertion: 'initiated'
             │
             ▼
[Step 2: 20-Minute Persistent Delay]
     - Status: 'waiting'
     - Resumed by Cron Scheduler (/api/backend-flows/cron)
             │
             ▼
[Step 3: Pre-Send Revalidation Adapter]
     - Re-verifies Order & Customer State
     - Meta 24-Hour Customer Service Window Check
     - Marketing Template Policy Check
     - Ledger Update: 'pending_send'
             │
             ▼
[Step 4: WhatsApp Message Dispatcher]
     - Verified Business Sender Verification
     - Meta Test Number Guard
     - Emergency Pause Check
     - Meta Cloud API Submission: 'submitted_to_meta'
             │
             ▼
[Inbound Meta Webhooks]
     - Delivery Sync: 'sent' → 'delivered' → 'read' / 'failed'
```

---

## 2. Operational Health Monitoring Queries

Run these queries in Supabase SQL editor to monitor system health:

### 1. Feedback Delivery Funnel (Last 24 Hours)
```sql
SELECT 
  status,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
FROM public.restaurant_feedback_dispatch_ledger
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY count DESC;
```
*Healthy Statuses: `initiated`, `pending_send`, `submitted_to_meta`, `delivered`, `read`, `skipped`.*

### 2. Check Order Outbox Backlog & Stale Processing
```sql
SELECT 
  status,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE updated_at < NOW() - INTERVAL '5 minutes') AS stale_count
FROM public.restaurant_order_outbox_events
WHERE status IN ('pending', 'processing', 'failed')
GROUP BY status;
```
*Expected: `pending` and `processing` counts should remain near 0 under normal cron operation.*

### 3. Review Top Feedback Block / Skip Reasons
```sql
SELECT 
  block_reason,
  COUNT(*) AS occurrences
FROM public.restaurant_feedback_dispatch_ledger
WHERE status IN ('skipped', 'blocked', 'failed')
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY block_reason
ORDER BY occurrences DESC;
```

### 4. Review Currently Waiting Delay Executions
```sql
SELECT 
  r.id AS run_id,
  r.flow_id,
  r.current_node_id,
  r.created_at,
  r.variables->>'orderId' AS order_id
FROM public.backend_flow_runs r
WHERE r.status = 'waiting'
ORDER BY r.created_at ASC
LIMIT 20;
```

---

## 3. Customer Consent & Tag Management

### Opt-Out / DND Management:
If a customer requests not to receive feedback solicitations:
1. Navigate to Contacts → Contact Detail in the WACRM Dashboard.
2. Add one of the recognized opt-out tags:
   - `opt_out`
   - `dnd`
   - `unsubscribed`
   - `stop`
3. The eligibility adapter automatically detects this tag and marks future feedback runs as `skipped` (`CUSTOMER_OPTED_OUT`).

### Staff Exclusion:
To prevent staff or managers who place test/staff orders from receiving feedback solicitations:
1. Add one of the recognized staff tags to the contact record:
   - `staff`
   - `admin`
   - `manager`
   - `employee`
   - `chef`
2. The eligibility adapter automatically skips feedback with `STAFF_RECIPIENT_EXCLUDED`.

---

## 4. Troubleshooting Guide

### Issue A: Outbox Backlog Growing (`pending` count increasing)
- **Root Cause:** External cron job on `cron-job.org` may be disabled or failing authentication.
- **Diagnostic:**
  1. Inspect `cron-job.org` execution history.
  2. Verify HTTP response is 200:
     ```bash
     curl -i -H "x-cron-secret: <secret>" https://<domain>/api/backend-flows/cron
     ```
  3. Ensure `AUTOMATION_CRON_SECRET` matches between Vercel and `cron-job.org`.

### Issue B: Status is `skipped` with `TEMPLATE_WINDOW_RESTRICTION`
- **Root Cause:** Outside the Meta 24-hour customer service window, feedback solicitations cannot use free-form text or Utility templates.
- **Remediation:** Configure Node 5 in the canvas to use an approved Meta `MARKETING` category template (e.g. `customer_feedback_request`).

### Issue C: Send Fails with `PRODUCTION_SENDER_DISABLED`
- **Root Cause:** The system detected that the connected WhatsApp sender is a Meta Developer Test Number (`106540352331505`) or lacks a registered 2FA PIN.
- **Remediation:** Connect the verified restaurant WhatsApp Business Account phone number in Settings → WhatsApp Config.

### Issue D: Ambiguous Timeout (`META_AMBIGUOUS_TIMEOUT`)
- **Root Cause:** Meta Graph API took longer than 15 seconds to respond.
- **Safety Guarantee:** The ledger records `pending_send` and does NOT blind-retry, protecting the customer from receiving duplicate messages. Check Meta Developer Status dashboard for Cloud API latency.
