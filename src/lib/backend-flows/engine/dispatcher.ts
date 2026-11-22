import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { BackendFlow } from '../types'
import type { BackendFlowEvent, FlowExecutionState } from './types'
import { matchesTrigger } from './matcher'
import { executeFlowGraph } from './graph-runner'
import { resolveWorkflowRecipient } from './recipient-resolver'

export interface ExecuteOptions {
  allowDraft?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
}

/**
 * Executes a single workflow run, recording state and results into `backend_flow_runs`.
 */
export async function executeWorkflowRun(
  flow: BackendFlow,
  event: BackendFlowEvent,
  options?: ExecuteOptions
): Promise<FlowExecutionState> {
  const supabase = options?.supabase || supabaseAdmin()
  const runId = crypto.randomUUID()
  const versionNumber = flow.published_version || flow.current_version || 1

  // 1. Insert initial pending/running state
  try {
    await supabase.from('backend_flow_runs').insert({
      id: runId,
      flow_id: flow.id,
      account_id: flow.account_id,
      version_number: versionNumber,
      triggered_by: event.type,
      trigger_payload: event.payload || {},
      status: 'running',
      state: { variables: event.payload || {}, step_runs: [] },
      started_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[backend-flows] Failed to create initial run record:', err)
  }

  // 2. Resolve verified customer recipient before graph traversal
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

  // 3. Execute graph
  const maxRetries = flow.metadata?.max_retries ?? 3
  const timeoutMs = (flow.metadata?.timeout_seconds ?? 300) * 1000

  const executionState = await executeFlowGraph(flow.definition, {
    runId,
    flowId: flow.id,
    accountId: flow.account_id,
    versionNumber,
    initialVariables,
    maxRetries,
    timeoutMs,
    supabase,
  })

  // 3. Persist final execution state to backend_flow_runs
  try {
    await supabase
      .from('backend_flow_runs')
      .update({
        status: executionState.status,
        state: {
          variables: executionState.variables,
          step_runs: executionState.stepRuns,
        },
        error_message: executionState.errorMessage || null,
        completed_at: executionState.completedAt,
        duration_ms: executionState.durationMs,
      })
      .eq('id', runId)

    // Update execution counter and timestamp on flow
    await supabase
      .from('backend_flows')
      .update({
        execution_count: (flow.execution_count || 0) + 1,
        last_executed_at: new Date().toISOString(),
      })
      .eq('id', flow.id)
  } catch (err) {
    console.error('[backend-flows] Failed to persist final run record:', err)
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
  const supabase = options?.supabase || supabaseAdmin()

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
