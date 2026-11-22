-- Migration: 202611220001_backend_flows_idempotency.sql
-- Purpose: Add idempotency_key and partial unique index to public.backend_flow_runs
-- Safe, additive, backward-compatible migration for WACRM Backend Flows Phase 3.

-- 1. Add idempotency_key column if not exists
ALTER TABLE public.backend_flow_runs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- 2. Partial unique index to enforce strict tenant + workflow idempotency
-- Existing historical rows with NULL idempotency_key remain unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_backend_flow_runs_idempotency
  ON public.backend_flow_runs (account_id, flow_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Fast lookup index by account and idempotency key
CREATE INDEX IF NOT EXISTS idx_backend_flow_runs_account_idempotency
  ON public.backend_flow_runs (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
