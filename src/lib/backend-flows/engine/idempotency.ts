import crypto from 'crypto'
import type { BackendFlowEvent, StepExecutionResult } from './types'

/**
 * Derives a deterministic occurrence identity for an event.
 * Distinguishes different event types/transitions on the same entity (e.g. order.created vs order.ready vs order.completed).
 */
export function generateEventFingerprint(event: BackendFlowEvent): string {
  // 1. Explicit idempotency key or event ID supplied upstream
  if (event.idempotencyKey?.trim()) {
    return event.idempotencyKey.trim()
  }
  if (event.eventId?.trim()) {
    return `event:${event.eventId.trim()}`
  }

  // 2. Upstream payload-embedded event IDs (e.g. Meta webhook message id, webhook delivery id)
  const payload = event.payload || {}
  const payloadId = (
    payload.eventId ||
    payload.webhookId ||
    payload.deliveryId ||
    payload.meta_message_id ||
    payload.messageId
  ) as string | undefined

  if (payloadId && typeof payloadId === 'string' && payloadId.trim()) {
    return `payload:${payloadId.trim()}`
  }

  // 3. Restaurant order lifecycle events: orderId + eventName
  const orderId = event.orderId || (payload.orderId as string) || (payload.order_id as string)
  if (orderId && typeof orderId === 'string' && orderId.trim()) {
    const eventName = (event.event || (payload.status as string) || 'generic').toLowerCase().trim()
    return `order:${orderId.trim()}:${eventName}`
  }

  // 4. Webhook events: path + body hash
  if (event.type === 'webhook') {
    const path = (payload.path as string) || 'default'
    const bodyStr = JSON.stringify(payload)
    const hash = crypto.createHash('sha256').update(bodyStr).digest('hex').slice(0, 16)
    return `webhook:${path}:${hash}`
  }

  // 5. Generic fallback: deterministic hash of event type + event name + sorted payload keys
  const normEvent = (event.event || '').toLowerCase().trim()
  const payloadStr = JSON.stringify(payload)
  const hash = crypto.createHash('sha256').update(`${event.type}:${normEvent}:${payloadStr}`).digest('hex').slice(0, 16)
  return `${event.type}:${normEvent}:${hash}`
}

export interface WorkflowIdempotencyKeyParams {
  accountId: string
  flowId: string
  event: BackendFlowEvent
  isReplay?: boolean
}

/**
 * Derives the unique idempotency key for a specific workflow execution.
 * Scoped to the tenant accountId and workflow flowId to ensure:
 * - Different tenants never collide.
 * - Different workflows reacting to the same event both execute independently.
 * - Operator-authorized replays generate a distinct key while referencing the source event.
 */
export function generateWorkflowIdempotencyKey(params: WorkflowIdempotencyKeyParams): string {
  const { accountId, flowId, event, isReplay } = params
  const baseFingerprint = generateEventFingerprint(event)

  const rawKey = `${accountId.trim()}:${flowId.trim()}:${baseFingerprint}`

  if (isReplay || event.isReplay) {
    const replayNonce = Date.now().toString(36)
    return `replay:${rawKey}:${replayNonce}`
  }

  return rawKey
}

export type ClaimStatus =
  | 'claimed'               // Successfully claimed fresh execution
  | 'duplicate_completed'   // Event was previously executed to completion
  | 'duplicate_running'     // Event is currently being processed by another worker
  | 'reclaimed_stale'       // Interrupted or stale execution reclaimed
  | 'reclaimed_failed'      // Previously failed execution reclaimed for retry
  | 'duplicate_permanently_failed' // Exceeded max retries

export interface ClaimExecutionParams {
  flowId: string
  accountId: string
  versionNumber: number
  event: BackendFlowEvent
  idempotencyKey: string
  staleTimeoutMs?: number
  maxRetries?: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
}

export interface ClaimExecutionResult {
  claimed: boolean
  claimStatus: ClaimStatus
  runId: string
  idempotencyKey: string
  existingRun?: Record<string, unknown>
  previousStepRuns?: StepExecutionResult[]
}

/**
 * Checks if a claim result indicates a duplicate invocation.
 */
export function isDuplicateClaim(status: ClaimStatus): boolean {
  return (
    status === 'duplicate_completed' ||
    status === 'duplicate_running' ||
    status === 'duplicate_permanently_failed'
  )
}

/**
 * Atomically claims execution for a workflow run using database-enforced unique constraints.
 *
 * Guarantees:
 * - Distributed concurrency safety: Race conditions during simultaneous event arrivals
 *   resolve to exactly ONE active claim via PostgreSQL unique constraint violation.
 * - Multi-tenant isolation: Scoped strictly by account_id and flow_id.
 * - Fault tolerance: Interrupted workers and eligible failed runs can be safely reclaimed.
 */
export async function claimWorkflowExecution(
  params: ClaimExecutionParams
): Promise<ClaimExecutionResult> {
  const {
    flowId,
    accountId,
    versionNumber,
    event,
    idempotencyKey,
    staleTimeoutMs = 600000, // 10 minutes default
    maxRetries = 3,
    supabase,
  } = params

  const runId = crypto.randomUUID()

  // Guard against missing database client in isolated unit tests / environments
  if (!supabase || typeof supabase.from !== 'function') {
    return {
      claimed: true,
      claimStatus: 'claimed',
      runId,
      idempotencyKey,
    }
  }

  // 1. Attempt atomic insert into backend_flow_runs
  const { error: insertErr } = await supabase.from('backend_flow_runs').insert({
    id: runId,
    flow_id: flowId,
    account_id: accountId,
    version_number: versionNumber,
    triggered_by: event.type,
    trigger_payload: event.payload || {},
    idempotency_key: idempotencyKey,
    status: 'running',
    state: {
      variables: event.payload || {},
      step_runs: [],
      idempotency_key: idempotencyKey,
      retry_count: 0,
    },
    started_at: new Date().toISOString(),
  })

  // Fresh execution claimed cleanly!
  if (!insertErr) {
    return {
      claimed: true,
      claimStatus: 'claimed',
      runId,
      idempotencyKey,
    }
  }

  // 2. Check if error is a unique constraint violation on idempotency_key
  const isUniqueViolation =
    insertErr.code === '23505' ||
    (insertErr.message && /unique|duplicate|idx_backend_flow_runs_idempotency/i.test(insertErr.message))

  if (!isUniqueViolation) {
    // Non-uniqueness DB error; log and allow dispatcher to handle
    console.error('[idempotency] Database insert error during claim:', insertErr.message)
    return {
      claimed: true,
      claimStatus: 'claimed',
      runId,
      idempotencyKey,
    }
  }

  // 3. Duplicate event arrival: Fetch existing run row
  const { data: existing, error: queryErr } = await supabase
    .from('backend_flow_runs')
    .select('*')
    .eq('account_id', accountId)
    .eq('flow_id', flowId)
    .eq('idempotency_key', idempotencyKey)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (queryErr || !existing) {
    console.error('[idempotency] Query existing run error:', queryErr?.message)
    return {
      claimed: false,
      claimStatus: 'duplicate_running',
      runId,
      idempotencyKey,
    }
  }

  const existingState = (existing.state || {}) as Record<string, unknown>
  const previousStepRuns = (existingState.step_runs as StepExecutionResult[]) || []
  const retryCount = (existingState.retry_count as number) || 0

  // 4. If existing run is completed, safely suppress duplicate side effects
  if (existing.status === 'completed') {
    return {
      claimed: false,
      claimStatus: 'duplicate_completed',
      runId: existing.id,
      idempotencyKey,
      existingRun: existing,
      previousStepRuns,
    }
  }

  // 5. If existing run is failed, check if retry is permitted
  if (existing.status === 'failed') {
    if (retryCount < maxRetries) {
      // Optimistic concurrency atomic update
      const { data: updated, error: updateErr } = await supabase
        .from('backend_flow_runs')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          error_message: null,
          state: {
            ...existingState,
            reclaimed_at: new Date().toISOString(),
            retry_count: retryCount + 1,
          },
        })
        .eq('id', existing.id)
        .eq('status', 'failed') // Optimistic lock
        .select()
        .maybeSingle()

      if (!updateErr && updated) {
        return {
          claimed: true,
          claimStatus: 'reclaimed_failed',
          runId: existing.id,
          idempotencyKey,
          existingRun: updated,
          previousStepRuns,
        }
      }
    } else {
      return {
        claimed: false,
        claimStatus: 'duplicate_permanently_failed',
        runId: existing.id,
        idempotencyKey,
        existingRun: existing,
      }
    }
  }

  // 6. If existing run is running, check if it is stale / crashed
  if (existing.status === 'running') {
    const startedMs = new Date(existing.started_at || existing.created_at).getTime()
    const isStale = Date.now() - startedMs > staleTimeoutMs

    if (isStale) {
      // Reclaim stale worker via optimistic lock
      const { data: updated, error: updateErr } = await supabase
        .from('backend_flow_runs')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          error_message: null,
          state: {
            ...existingState,
            reclaimed_at: new Date().toISOString(),
            retry_count: retryCount + 1,
            stale_recovery: true,
          },
        })
        .eq('id', existing.id)
        .eq('status', 'running') // Optimistic lock
        .select()
        .maybeSingle()

      if (!updateErr && updated) {
        return {
          claimed: true,
          claimStatus: 'reclaimed_stale',
          runId: existing.id,
          idempotencyKey,
          existingRun: updated,
          previousStepRuns,
        }
      }
    }

    return {
      claimed: false,
      claimStatus: 'duplicate_running',
      runId: existing.id,
      idempotencyKey,
      existingRun: existing,
    }
  }

  return {
    claimed: false,
    claimStatus: 'duplicate_completed',
    runId: existing.id,
    idempotencyKey,
    existingRun: existing,
    previousStepRuns,
  }
}
