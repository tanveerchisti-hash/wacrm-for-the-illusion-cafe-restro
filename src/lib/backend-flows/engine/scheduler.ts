import { supabaseAdmin } from '@/lib/automations/admin-client'
import { executeFlowGraph } from './graph-runner'
import type { BackendFlow, BackendFlowDefinition } from '../types'
import type { FlowExecutionState, StepExecutionResult } from './types'

export interface ResumeRunResult {
  resumed: boolean
  runId: string
  status: string
  reason?: string
  executionState?: FlowExecutionState
}

export interface SweepOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
  now?: Date
  batchSize?: number
  accountId?: string
  leaseMs?: number
}

export interface SweepResult {
  processed: number
  reclaimed: number
  skipped: number
  errors: string[]
  results: ResumeRunResult[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminClient(providedSupabase?: any) {
  if (providedSupabase) return providedSupabase
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return supabaseAdmin()
}

/**
 * Atomically claims a waiting run for resumption.
 * Guarantees that only ONE worker can resume this execution.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function claimWaitingRun(supabase: any, runId: string, leaseMs = 300000): Promise<boolean> {
  if (!supabase?.from) return false

  const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString()

  const { data, error } = await supabase
    .from('backend_flow_runs')
    .update({
      status: 'resuming',
      lease_expires_at: leaseExpiresAt,
    })
    .eq('id', runId)
    .eq('status', 'waiting') // Optimistic concurrency lock
    .select()
    .maybeSingle()

  if (error || !data) {
    return false
  }

  return true
}

/**
 * Recovers runs that crashed while in 'resuming' status past their lease expiry.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reclaimStalledResumptions(supabase: any, now = new Date()): Promise<number> {
  if (!supabase?.from) return 0

  const { data, error } = await supabase
    .from('backend_flow_runs')
    .update({
      status: 'waiting',
      lease_expires_at: null,
    })
    .eq('status', 'resuming')
    .lte('lease_expires_at', now.toISOString())
    .select('id')

  if (error || !data) return 0
  return data.length
}

/**
 * Resumes execution of a waiting workflow run from its persisted frontier.
 */
export async function resumeWaitingRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providedSupabase: any,
  runId: string,
  options?: { accountId?: string; isAlreadyClaimed?: boolean; leaseMs?: number }
): Promise<ResumeRunResult> {
  const supabase = getAdminClient(providedSupabase)
  if (!supabase?.from) {
    return { resumed: false, runId, status: 'error', reason: 'Database client unavailable' }
  }

  // 1. If not already claimed, claim execution atomically
  if (!options?.isAlreadyClaimed) {
    const claimed = await claimWaitingRun(supabase, runId, options?.leaseMs)
    if (!claimed) {
      return { resumed: false, runId, status: 'skipped', reason: 'Claim failed or already claimed' }
    }
  }

  // 2. Fetch run record with tenant check
  let runQuery = supabase.from('backend_flow_runs').select('*').eq('id', runId)
  if (options?.accountId) {
    runQuery = runQuery.eq('account_id', options.accountId)
  }
  const { data: run, error: runErr } = await runQuery.maybeSingle()

  if (runErr || !run) {
    // Release claim on failure
    await supabase.from('backend_flow_runs').update({ status: 'waiting', lease_expires_at: null }).eq('id', runId)
    return { resumed: false, runId, status: 'error', reason: runErr?.message || 'Run not found' }
  }

  // 3. Fetch parent flow for pause/archived status checks
  const { data: flow } = await supabase
    .from('backend_flows')
    .select('*')
    .eq('id', run.flow_id)
    .eq('account_id', run.account_id)
    .maybeSingle()

  // 3.1 Check emergency pause policy
  if (flow?.metadata?.is_paused === true) {
    // Flow is emergency-paused: keep run parked in waiting state without executing downstream actions
    await supabase.from('backend_flow_runs').update({ status: 'waiting', lease_expires_at: null }).eq('id', runId)
    return { resumed: false, runId, status: 'paused', reason: 'Parent workflow is emergency-paused' }
  }

  if (flow?.status === 'archived' || !flow) {
    // Flow was archived or deleted: cancel pending run
    await supabase
      .from('backend_flow_runs')
      .update({
        status: 'cancelled',
        error_message: 'Parent workflow was archived or disabled while run was waiting.',
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
    return { resumed: false, runId, status: 'cancelled', reason: 'Parent workflow archived or removed' }
  }

  // 4. Resolve immutable definition snapshot
  // Order: 1. State snapshot (pinned at execution start) -> 2. Version table -> 3. Current flow definition
  const runState = (run.state || {}) as Record<string, unknown>
  let definition = runState.definition_snapshot as BackendFlowDefinition | undefined

  if (!definition) {
    const { data: versionRow } = await supabase
      .from('backend_flow_versions')
      .select('definition')
      .eq('flow_id', run.flow_id)
      .eq('version_number', run.version_number)
      .maybeSingle()

    definition = (versionRow?.definition || flow.definition) as BackendFlowDefinition
  }

  // 5. Restore execution frontier, variables, and step history
  const resumeFromNodeIds = (runState.pending_node_ids as string[]) || []
  const previousStepRuns = (runState.step_runs as StepExecutionResult[]) || []
  const initialVariables = (runState.variables as Record<string, unknown>) || {}
  const idempotencyKey = run.idempotency_key || (runState.idempotency_key as string)

  // 6. Execute graph from frontier
  const maxRetries = (flow as BackendFlow)?.metadata?.max_retries ?? 3
  const timeoutMs = ((flow as BackendFlow)?.metadata?.timeout_seconds ?? 300) * 1000

  const executionState = await executeFlowGraph(definition, {
    runId: run.id,
    flowId: run.flow_id,
    accountId: run.account_id,
    versionNumber: run.version_number,
    initialVariables,
    previousStepRuns,
    resumeFromNodeIds,
    idempotencyKey,
    maxRetries,
    timeoutMs,
    supabase,
  })

  // 7. Persist resumed execution state
  try {
    if (executionState.status === 'waiting') {
      // Re-entered delay state (e.g. sequential delay)
      await supabase
        .from('backend_flow_runs')
        .update({
          status: 'waiting',
          waiting_until: executionState.waitingUntil,
          waiting_node_id: executionState.waitingNodeId,
          lease_expires_at: null,
          state: {
            variables: executionState.variables,
            step_runs: executionState.stepRuns,
            pending_node_ids: executionState.pendingNodeIds,
            waiting_node_id: executionState.waitingNodeId,
            waiting_until: executionState.waitingUntil,
            definition_snapshot: definition,
            idempotency_key: idempotencyKey,
          },
          duration_ms: (run.duration_ms || 0) + (executionState.durationMs || 0),
        })
        .eq('id', run.id)
    } else {
      // Terminal state (completed, failed, timed_out)
      await supabase
        .from('backend_flow_runs')
        .update({
          status: executionState.status,
          state: {
            variables: executionState.variables,
            step_runs: executionState.stepRuns,
            idempotency_key: idempotencyKey,
          },
          error_message: executionState.errorMessage || null,
          completed_at: executionState.completedAt || new Date().toISOString(),
          duration_ms: (run.duration_ms || 0) + (executionState.durationMs || 0),
          lease_expires_at: null,
        })
        .eq('id', run.id)

      if (executionState.status === 'completed') {
        await supabase
          .from('backend_flows')
          .update({
            execution_count: (flow.execution_count || 0) + 1,
            last_executed_at: new Date().toISOString(),
          })
          .eq('id', flow.id)
      }
    }
  } catch (err) {
    console.error('[backend-flows-scheduler] Error updating run record:', err)
  }

  return {
    resumed: true,
    runId: run.id,
    status: executionState.status,
    executionState,
  }
}

/**
 * Sweeps all due waiting executions across tenant accounts and resumes them.
 */
export async function sweepDueWaitingRuns(options?: SweepOptions): Promise<SweepResult> {
  const supabase = getAdminClient(options?.supabase)
  const now = options?.now || new Date()
  const batchSize = options?.batchSize || 50
  const leaseMs = options?.leaseMs || 300000

  const summary: SweepResult = {
    processed: 0,
    reclaimed: 0,
    skipped: 0,
    errors: [],
    results: [],
  }

  if (!supabase?.from) {
    return summary
  }

  // 1. Reclaim stalled resumptions whose leases expired
  summary.reclaimed = await reclaimStalledResumptions(supabase, now)

  // 2. Query due waiting runs
  let query = supabase
    .from('backend_flow_runs')
    .select('id, flow_id, account_id, waiting_until')
    .eq('status', 'waiting')
    .lte('waiting_until', now.toISOString())
    .order('waiting_until', { ascending: true })
    .limit(batchSize)

  if (options?.accountId) {
    query = query.eq('account_id', options.accountId)
  }

  const { data: dueRuns, error: queryErr } = await query

  if (queryErr) {
    summary.errors.push(`Query due runs failed: ${queryErr.message}`)
    return summary
  }

  if (!dueRuns || dueRuns.length === 0) {
    return summary
  }

  // 3. Process each due run with atomic locking
  for (const row of dueRuns) {
    const claimed = await claimWaitingRun(supabase, row.id as string, leaseMs)
    if (!claimed) {
      summary.skipped++
      continue
    }

    try {
      const result = await resumeWaitingRun(supabase, row.id as string, {
        accountId: row.account_id as string,
        isAlreadyClaimed: true,
        leaseMs,
      })

      summary.results.push(result)
      if (result.resumed) {
        summary.processed++
      } else {
        summary.skipped++
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      summary.errors.push(`Resume run ${row.id} failed: ${errMsg}`)
      // Release claim
      await supabase
        .from('backend_flow_runs')
        .update({ status: 'waiting', lease_expires_at: null })
        .eq('id', row.id)
    }
  }

  return summary
}
