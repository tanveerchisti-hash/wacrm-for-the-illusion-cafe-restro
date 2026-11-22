# WACRM Customer Feedback Automation — Production Architectural Safety Audit

**Document ID:** `AUDIT-WACRM-FEEDBACK-20261122`  
**Target Workflow:** `dd8a35e6-551f-49c7-a8f7-307b051edc86`  
**Workflow Slug:** `customer-feedback-automation`  
**Current Status:** `draft`  
**Date:** 2026-11-22  
**Auditors:** WACRM Engineering Team (Architecture, Database, Meta API, Automation, QA)

---

## Executive Summary

A comprehensive architectural audit was performed on the Customer Feedback Automation pipeline. The pipeline's target flow is:
`Order Completed → Customer Eligibility Check → 20-Minute Durable Delay → Pre-Send Revalidation → WhatsApp Feedback Solicitation → Delivery Tracking`

All architectural risks identified during the initial design phase—including non-atomic order transitions, unhandled outbox processing, feedback duplication across retries/crashes, test sender leakage into production, and unverified delivery state—have been resolved with verified, database-enforced controls.

---

## Detailed Architectural Review Findings

### A. Atomic Order Completion & State Machine Integrity
- **Finding:** Previously, order status updates and event outbox insertions occurred in two distinct application-level HTTP calls. A worker crash between the update and outbox insertion could cause the event to be lost.
- **Remediation Implemented:**
  - Implemented PostgreSQL RPC `public.transition_restaurant_order_status` in migration `202611220003`.
  - The RPC executes in a single database transaction with row-level locking (`SELECT ... FOR UPDATE`).
  - Terminal orders (`cancelled`, `kitchen_rejected`) are rejected with `INVALID_TRANSITION` (HTTP 409).
  - Already-completed orders are detected with `unchanged: true` without re-emitting duplicate events.
  - The status update and the `restaurant_order_outbox_events` row insert commit atomically.
- **Classification:** `PASSED` (Unit tested in `src/lib/restaurant/order-outbox.test.ts` and `src/app/api/restaurant/orders/[id]/route.test.ts`).

### B. Durable Outbox Processing & Worker Reliability
- **Finding:** An outbox event that fails or gets interrupted before dispatch must be systematically swept and retried by a background process.
- **Remediation Implemented:**
  - Implemented `sweepPendingOrderOutboxEvents` in `src/lib/restaurant/order-outbox.ts`.
  - Wired into the external 1-minute cron endpoint `GET /api/backend-flows/cron` alongside waiting delay run resumption.
  - Concurrency safety: Atomically claims records using `UPDATE ... WHERE status IN ('pending', 'failed', 'processing') RETURNING *`.
  - Stale lease recovery: Recovers processing events whose timestamp is older than 5 minutes.
  - Bounded retries: Re-attempts failed dispatches up to 3 times before requiring operator review.
- **Classification:** `PASSED` (Unit tested in `src/lib/restaurant/order-outbox.test.ts` and `src/app/api/backend-flows/cron/route.test.ts`).

### C. Feedback Send Idempotency & Ledger Protection
- **Finding:** Worker crashes, duplicate webhook events, or ambiguous Meta API HTTP timeouts could trigger duplicate customer messages.
- **Remediation Implemented:**
  - Implemented table `restaurant_feedback_dispatch_ledger` with unique constraint `UNIQUE (account_id, order_id, feedback_purpose)`.
  - Atomic dispatch state lifecycle: `initiated` → `pending_send` → `submitted_to_meta` → `sent` → `delivered`.
  - Ambiguous timeout safety: If the Meta API HTTP call times out (`META_AMBIGUOUS_TIMEOUT`), the ledger records `pending_send` and does not blind-retry, preventing duplicate customer messages.
- **Classification:** `PASSED` (Unit tested in `src/lib/restaurant/feedback-eligibility.test.ts` and `src/lib/backend-flows/engine/whatsapp-sender.test.ts`).

### D. Workflow Execution Safety & Non-Retryable Skips
- **Finding:** A permanent customer eligibility failure (e.g. customer opted out or order was cancelled during the 20-minute delay) must not trigger automatic step retries or downstream messaging.
- **Remediation Implemented:**
  - Updated `src/lib/backend-flows/engine/graph-runner.ts` to inspect `result.shouldRetry` and `result.skipped`.
  - Permanent validation failures immediately mark the step as `skipped` and gracefully complete the flow without executing downstream delay or message actions.
- **Classification:** `PASSED` (Unit tested in `src/lib/backend-flows/engine/graph-runner.test.ts` and `src/lib/restaurant/customer-feedback-flow.test.ts`).

### E. WhatsApp Sender Security & Meta Policy Compliance
- **Finding:** The connected WhatsApp sender is currently a Meta Developer Test Number (`106540352331505`). Production customer sending must be strictly prohibited until a real business number is verified.
- **Remediation Implemented:**
  - Multi-gate sender protection in `src/lib/backend-flows/engine/whatsapp-sender.ts`:
    1. Environment Gate: `BACKEND_FLOWS_ENABLE_LIVE_SEND === 'true'` required.
    2. Test Number Blocker: Explicitly rejects phone number ID `106540352331505` and `META_TEST_PHONE_NUMBER_ID` in live mode with `PRODUCTION_SENDER_DISABLED`.
    3. 2FA Registration Gate: Requires `whatsapp_config.registered_at IS NOT NULL` (PIN verified).
    4. Template Category Gate: Outside the Meta 24-hour customer service window, feedback solicitations require an approved `MARKETING` template; `UTILITY` templates outside the window are hard-blocked.
    5. Test Order Gate: `is_test_order === true` safely skips outbound sending.
- **Classification:** `PASSED` (Unit tested in `src/lib/backend-flows/engine/whatsapp-sender.test.ts`).

### F. Accurate Delivery Tracking
- **Finding:** An HTTP 200 response from Meta Graph API only confirms acceptance (`wamid` issued), not physical device delivery.
- **Remediation Implemented:**
  - Decoupled submission from delivery: Action node returns `submittedToMeta: true, delivered: false`.
  - Delivery webhook mirror in `src/app/api/whatsapp/webhook/route.ts`: Inbound Meta status updates (`sent`, `delivered`, `read`, `failed`) update `restaurant_feedback_dispatch_ledger.status` and `delivered_at`.
- **Classification:** `PASSED` (Unit tested in `src/app/api/whatsapp/webhook/route.test.ts`).

### G. Emergency Controls & Killswitch
- **Finding:** System administrators must be able to halt all outbound messaging immediately without requiring code deployment or Vercel restarts.
- **Remediation Implemented:**
  - Multi-layered killswitch:
    1. System environment variable: `BACKEND_FLOWS_EMERGENCY_PAUSE=true`.
    2. Canvas/node-level pause: `node.data.emergency_paused = true`.
    3. Database account-level pause: `whatsapp_config.metadata.emergency_paused = true`.
- **Classification:** `PASSED` (Unit tested in `src/lib/backend-flows/engine/whatsapp-sender.test.ts`).

---

## Audit Matrix Summary

| Area | Invariant | Enforcement Mechanism | Status |
|---|---|---|---|
| Order Transition | Atomic with outbox | PostgreSQL RPC `transition_restaurant_order_status` | **PASSED** |
| Outbox Consumption | At-least-once, recoverable | `sweepPendingOrderOutboxEvents` via 1-min cron | **PASSED** |
| Feedback Send | Max 1 send per order | Unique constraint `(account_id, order_id, feedback_purpose)` | **PASSED** |
| Runner Branching | Safe skipping on disqualification | `graph-runner.ts` non-retryable step termination | **PASSED** |
| Consent & DND | No messages to opted-out contacts | Tag scanner for `opt_out`, `dnd`, `unsubscribed` | **PASSED** |
| Staff Exclusion | No messages to cafe staff | Tag scanner for `staff`, `admin`, `manager`, `chef` | **PASSED** |
| Sender Verification | Real business sender only | 2FA PIN check + Meta test number hard reject | **PASSED** |
| Meta Compliance | Marketing template required | 24-hour window check + category validation | **PASSED** |
| Delivery Tracking | Acknowledged != Delivered | Inbound webhook status mirror to ledger | **PASSED** |
| Emergency Pause | Zero sends when paused | Three-tier pause check before outbound dispatch | **PASSED** |

---

## Conclusion
The Customer Feedback Automation engine satisfies all production reliability, security, and multi-tenancy requirements. No Critical or High vulnerabilities remain unaddressed.
