-- Migration: 202611220002_backend_flows_delay_scheduler.sql
-- Purpose: Add durable delay scheduler columns, partial indexes, and status constraints to backend_flow_runs
-- Safe, additive, backward-compatible migration for WACRM Backend Flows Phase 4.

-- 1. Add scheduler columns to public.backend_flow_runs
ALTER TABLE public.backend_flow_runs
  ADD COLUMN IF NOT EXISTS waiting_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waiting_node_id TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- 2. Update status CHECK constraint to allow 'waiting' and 'resuming' states
ALTER TABLE public.backend_flow_runs
  DROP CONSTRAINT IF EXISTS backend_flow_runs_status_check;

ALTER TABLE public.backend_flow_runs
  ADD CONSTRAINT backend_flow_runs_status_check
  CHECK (status IN ('pending', 'running', 'waiting', 'resuming', 'completed', 'failed', 'cancelled', 'timed_out'));

-- 3. Fast partial index for querying due waiting executions
CREATE INDEX IF NOT EXISTS idx_backend_flow_runs_waiting_due
  ON public.backend_flow_runs (waiting_until)
  WHERE status = 'waiting' AND waiting_until IS NOT NULL;

-- 4. Fast partial index for crashed worker lease recovery
CREATE INDEX IF NOT EXISTS idx_backend_flow_runs_resuming_lease
  ON public.backend_flow_runs (lease_expires_at)
  WHERE status = 'resuming' AND lease_expires_at IS NOT NULL;
