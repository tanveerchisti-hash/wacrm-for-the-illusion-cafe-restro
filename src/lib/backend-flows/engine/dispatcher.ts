import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { BackendFlow } from '../types'
import type { BackendFlowEvent, FlowExecutionState, StepExecutionResult } from './types'
import { matchesTrigger } from './matcher'
import { executeFlowGraph } from './graph-runner'
import { resolveWorkflowRecipient } from './recipient-resolver'
import {
  generateWorkflowIdempotencyKey,
  claimWorkflowExecution,
} from './idempotency'

export interface ExecuteOptions {
  allowDraft?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
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
 * Executes a single workflow run, recording state and results into `backend_flow_runs`.
 */
export async function executeWorkflowRun(
  flow: BackendFlow,
  event: BackendFlowEvent,
  options?: ExecuteOptions
): Promise<FlowExecutionState> {
  const supabase = getAdminClient(options?.supabase)
  const versionNumber = flow.published_version || flow.current_version || 1
  const maxRetries = flow.metadata?.max_retries ?? 3
  const timeoutMs = (flow.metadata?.timeout_seconds ?? 300) * 1000

  // 1. Generate unique workflow-scoped idempotency key
  const idempotencyKey = generateWorkflowIdempotencyKey({
    accountId: flow.account_id,
    flowId: flow.id,
    event,
    isReplay: event.isReplay,
  })

  // 2. Claim execution atomically in backend_flow_runs
  const claim = await claimWorkflowExecution({
    flowId: flow.id,
    accountId: flow.account_id,
    versionNumber,
    event,
    idempotencyKey,
    staleTimeoutMs: timeoutMs * 2,
    maxRetries,
    supabase,
  })

  // 3. If duplicate invocation or non-reclaimable, return existing execution state
  if (!claim.claimed) {
    const existing = claim.existingRun
    const existingStatus = (existing?.status as FlowExecutionState['status']) || 'completed'
    const existingState = (existing?.state || {}) as Record<string, unknown>
    const stepRuns = (existingState.step_runs as StepExecutionResult[]) || claim.previousStepRuns || []
    const variables = (existingState.variables as Record<string, unknown>) || (event.payload as Record<string, unknown>) || {}

    return {
      runId: claim.runId,
      flowId: flow.id,
      accountId: flow.account_id,
      versionNumber,
      status: existingStatus,
      variables,
      stepRuns,
      startedAt: (existing?.started_at as string) || new Date().toISOString(),
      completedAt: (existing?.completed_at as string) || new Date().toISOString(),
      durationMs: (existing?.duration_ms as number) || 0,
      idempotencyKey,
      isDuplicate: true,
      originalRunId: claim.runId,
    }
  }

  const runId = claim.runId

  // 4. Resolve verified customer recipient before graph traversal
  const resolvedRecipient = await resolveWorkflowRecipient({
    accountId: flow.account_id,
    orderId: event.orderId || (event.payload?.orderId as string),
    contactId: event.contactId || (event.payload?.contactId as string),
    conversationId: event.conversationId || (event.payload?.conversationId as string),
    supabase,
  })

  const customerPhone = resolvedRecipient.success
    ? (resolvedRecipient.formattedPhone || resolvedRecipient.phone)
    : undefined
  const customerName = resolvedRecipient.success
    ? resolvedRecipient.contactName
    : undefined

  const initialVariables: Record<string, unknown> = {
    ...event.payload,
    contactId: resolvedRecipient.contactId || event.contactId || (event.payload?.contactId as string),
    orderId: event.orderId || (event.payload?.orderId as string),
    conversationId: event.conversationId || (event.payload?.conversationId as string),
    ...(customerPhone ? { customerPhone, phone: customerPhone } : {}),
    ...(customerName ? { customerName, name: customerName } : {}),
    recipient: resolvedRecipient,
  }

  // 5. Execute graph with action-level idempotency support
  const executionState = await executeFlowGraph(flow.definition, {
    runId,
    flowId: flow.id,
    accountId: flow.account_id,
    versionNumber,
    initialVariables,
    maxRetries,
    timeoutMs,
    supabase,
    idempotencyKey,
    previousStepRuns: claim.previousStepRuns,
  })

  // 6. Persist final or waiting execution state to backend_flow_runs
  if (supabase?.from) {
    try {
      if (executionState.status === 'waiting') {
        await supabase
          .from('backend_flow_runs')
          .update({
            status: 'waiting',
            waiting_until: executionState.waitingUntil,
            waiting_node_id: executionState.waitingNodeId,
            state: {
              variables: executionState.variables,
              step_runs: executionState.stepRuns,
              pending_node_ids: executionState.pendingNodeIds,
              waiting_node_id: executionState.waitingNodeId,
              waiting_until: executionState.waitingUntil,
              definition_snapshot: flow.definition,
              idempotency_key: idempotencyKey,
            },
            completed_at: null,
            duration_ms: executionState.durationMs,
          })
          .eq('id', runId)
      } else {
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
            completed_at: executionState.completedAt,
            duration_ms: executionState.durationMs,
          })
          .eq('id', runId)

        // Update execution counter and timestamp on flow when run has reached terminal completion
        await supabase
          .from('backend_flows')
          .update({
            execution_count: (flow.execution_count || 0) + 1,
            last_executed_at: new Date().toISOString(),
          })
          .eq('id', flow.id)
      }
    } catch (err) {
      console.error('[backend-flows] Failed to persist final run record:', err)
    }
  }

  return executionState
}

/**
 * Dispatches a system event to all matching published workflows in the tenant account.
 */
export async function dispatchBackendFlowEvent(
  event: BackendFlowEvent,
  options?: ExecuteOptions
): Promise<FlowExecutionState[]> {
  const supabase = getAdminClient(options?.supabase)

  const tableRef = supabase?.from?.('backend_flows')
  if (!tableRef || typeof tableRef.select !== 'function') {
    return []
  }

  let query = tableRef
    .select('*')
    .eq('account_id', event.accountId)

  if (!options?.allowDraft) {
    query = query.eq('status', 'published')
  }

  const { data: flows, error } = await query

  if (error || !flows || flows.length === 0) {
    return []
  }

  const matchingFlows = (flows as BackendFlow[]).filter((flow) =>
    matchesTrigger(flow, event, options)
  )

  const results: FlowExecutionState[] = []
  for (const flow of matchingFlows) {
    const runResult = await executeWorkflowRun(flow, event, options)
    results.push(runResult)
  }

  return results
}
