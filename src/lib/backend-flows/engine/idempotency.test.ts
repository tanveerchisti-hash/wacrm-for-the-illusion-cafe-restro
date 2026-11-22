import { describe, it, expect } from 'vitest'
import {
  generateEventFingerprint,
  generateWorkflowIdempotencyKey,
  claimWorkflowExecution,
  isDuplicateClaim,
} from './idempotency'
import { executeWorkflowRun } from './dispatcher'
import type { BackendFlow } from '../types'
import type { BackendFlowEvent, StepExecutionResult } from './types'

// In-memory mock representing PostgreSQL backend_flow_runs table with unique index
function createMockSupabase() {
  const runs: Array<Record<string, unknown>> = []

  return {
    runs,
    from(table: string) {
      const defaultQueryBuilder = {
        eq: () => defaultQueryBuilder,
        order: () => defaultQueryBuilder,
        limit: () => defaultQueryBuilder,
        maybeSingle: async () => ({ data: null, error: null }),
      }

      if (table !== 'backend_flow_runs' && table !== 'backend_flows') {
        return {
          select: () => defaultQueryBuilder,
        }
      }

      if (table === 'backend_flows') {
        return {
          update: () => ({
            eq: () => ({ data: null, error: null }),
          }),
        }
      }

      return {
        // Insert with unique constraint simulation
        insert: async (record: Record<string, unknown>) => {
          if (record.idempotency_key) {
            const duplicate = runs.find(
              (r) =>
                r.account_id === record.account_id &&
                r.flow_id === record.flow_id &&
                r.idempotency_key === record.idempotency_key
            )
            if (duplicate) {
              return {
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "idx_backend_flow_runs_idempotency"',
                },
              }
            }
          }
          runs.push({ ...record, created_at: new Date().toISOString() })
          return { data: record, error: null }
        },

        // Select query builder
        select: () => {
          let filtered = [...runs]
          const builder = {
            eq: (col: string, val: unknown) => {
              filtered = filtered.filter((r) => r[col] === val)
              return builder
            },
            order: () => builder,
            limit: () => builder,
            maybeSingle: async () => {
              return { data: filtered[0] || null, error: null }
            },
          }
          return builder
        },

        // Update query builder with optimistic locking and deferred execution
        update: (updates: Record<string, unknown>) => {
          const filters: Array<{ col: string; val: unknown }> = []
          const execute = () => {
            const matches = runs.filter((r) =>
              filters.every((f) => r[f.col] === f.val)
            )
            for (const m of matches) {
              Object.assign(m, updates)
            }
            return matches
          }

          const builder = {
            eq: (col: string, val: unknown) => {
              filters.push({ col, val })
              return builder
            },
            select: () => ({
              maybeSingle: async () => {
                const matches = execute()
                return { data: matches[0] ? { ...matches[0] } : null, error: null }
              },
            }),
            then: (resolve: (val: unknown) => unknown) => {
              const matches = execute()
              return Promise.resolve(resolve({ data: matches, error: null }))
            },
          }
          return builder
        },
      }
    },
  }
}

describe('Idempotency Engine — Fingerprint & Key Generation', () => {
  it('Scenario H1: uses explicit idempotencyKey when provided', () => {
    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      idempotencyKey: 'custom-idem-12345',
      payload: { foo: 'bar' },
    }
    expect(generateEventFingerprint(event)).toBe('custom-idem-12345')
  })

  it('Scenario H2: uses upstream eventId or payload identifiers', () => {
    const eventWithId: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'webhook',
      eventId: 'evt_meta_9876',
      payload: {},
    }
    expect(generateEventFingerprint(eventWithId)).toBe('event:evt_meta_9876')

    const eventWithPayloadMeta: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'webhook',
      payload: { meta_message_id: 'wamid.HBgLMTIzNDU' },
    }
    expect(generateEventFingerprint(eventWithPayloadMeta)).toBe('payload:wamid.HBgLMTIzNDU')
  })

  it('Scenario C1: derives distinct fingerprints for sequential restaurant order transitions', () => {
    const eventCreated: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.created',
      orderId: 'ord-101',
      payload: { status: 'created', orderNumber: 101 },
    }
    const eventReady: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      payload: { status: 'ready', orderNumber: 101 },
    }
    const eventCompleted: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.completed',
      orderId: 'ord-101',
      payload: { status: 'completed', orderNumber: 101 },
    }

    const fpCreated = generateEventFingerprint(eventCreated)
    const fpReady = generateEventFingerprint(eventReady)
    const fpCompleted = generateEventFingerprint(eventCompleted)

    expect(fpCreated).toBe('order:ord-101:order.created')
    expect(fpReady).toBe('order:ord-101:order.ready')
    expect(fpCompleted).toBe('order:ord-101:order.completed')
    expect(fpCreated).not.toBe(fpReady)
    expect(fpReady).not.toBe(fpCompleted)
  })

  it('Scenario D1: enforces multi-tenant key isolation for identical order numbers', () => {
    const eventTenantA: BackendFlowEvent = {
      accountId: 'tenant-restro-A',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-99',
      payload: {},
    }
    const eventTenantB: BackendFlowEvent = {
      accountId: 'tenant-restro-B',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-99',
      payload: {},
    }

    const keyA = generateWorkflowIdempotencyKey({
      accountId: 'tenant-restro-A',
      flowId: 'flow-feedback',
      event: eventTenantA,
    })
    const keyB = generateWorkflowIdempotencyKey({
      accountId: 'tenant-restro-B',
      flowId: 'flow-feedback',
      event: eventTenantB,
    })

    expect(keyA).toBe('tenant-restro-A:flow-feedback:order:ord-99:order.ready')
    expect(keyB).toBe('tenant-restro-B:flow-feedback:order:ord-99:order.ready')
    expect(keyA).not.toBe(keyB)
  })

  it('Scenario G: generates distinct replay keys when isReplay is set', () => {
    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      isReplay: true,
      payload: {},
    }

    const replayKey = generateWorkflowIdempotencyKey({
      accountId: 'acc-1',
      flowId: 'flow-1',
      event,
      isReplay: true,
    })

    expect(replayKey.startsWith('replay:acc-1:flow-1:order:ord-101:order.ready:')).toBe(true)
  })
})

describe('Idempotency Engine — Atomic Claims & Concurrency', () => {
  it('Scenario A: fresh claim succeeds and records running status', async () => {
    const mockDb = createMockSupabase()
    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      payload: {},
    }
    const idempotencyKey = generateWorkflowIdempotencyKey({
      accountId: 'acc-1',
      flowId: 'flow-1',
      event,
    })

    const claim = await claimWorkflowExecution({
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      event,
      idempotencyKey,
      supabase: mockDb,
    })

    expect(claim.claimed).toBe(true)
    expect(claim.claimStatus).toBe('claimed')
    expect(claim.runId).toBeDefined()
    expect(mockDb.runs).toHaveLength(1)
    expect(mockDb.runs[0].status).toBe('running')
  })

  it('Scenario B: detects duplicate when identical event is already completed', async () => {
    const mockDb = createMockSupabase()
    const idempotencyKey = 'acc-1:flow-1:order:ord-101:order.ready'

    // Simulate prior completed execution in database
    mockDb.runs.push({
      id: 'prior-run-123',
      flow_id: 'flow-1',
      account_id: 'acc-1',
      version_number: 1,
      idempotency_key: idempotencyKey,
      status: 'completed',
      state: { variables: { resolved: true }, step_runs: [{ nodeId: 'act-1', status: 'completed' }] },
      created_at: new Date().toISOString(),
    })

    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      payload: {},
    }

    const claim = await claimWorkflowExecution({
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      event,
      idempotencyKey,
      supabase: mockDb,
    })

    expect(claim.claimed).toBe(false)
    expect(claim.claimStatus).toBe('duplicate_completed')
    expect(isDuplicateClaim(claim.claimStatus)).toBe(true)
    expect(claim.runId).toBe('prior-run-123')
    expect(claim.previousStepRuns).toHaveLength(1)
  })

  it('Scenario E: reclaims failed execution within maxRetries limit', async () => {
    const mockDb = createMockSupabase()
    const idempotencyKey = 'acc-1:flow-1:order:ord-101:order.ready'

    mockDb.runs.push({
      id: 'failed-run-456',
      flow_id: 'flow-1',
      account_id: 'acc-1',
      version_number: 1,
      idempotency_key: idempotencyKey,
      status: 'failed',
      state: { retry_count: 1, step_runs: [{ nodeId: 'act-1', status: 'completed' }] },
      created_at: new Date().toISOString(),
    })

    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      payload: {},
    }

    const claim = await claimWorkflowExecution({
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      event,
      idempotencyKey,
      maxRetries: 3,
      supabase: mockDb,
    })

    expect(claim.claimed).toBe(true)
    expect(claim.claimStatus).toBe('reclaimed_failed')
    expect(claim.runId).toBe('failed-run-456')
    expect(claim.previousStepRuns).toHaveLength(1)
  })

  it('Scenario E2: suppresses execution if maxRetries has been exceeded', async () => {
    const mockDb = createMockSupabase()
    const idempotencyKey = 'acc-1:flow-1:order:ord-101:order.ready'

    mockDb.runs.push({
      id: 'exhausted-run-789',
      flow_id: 'flow-1',
      account_id: 'acc-1',
      version_number: 1,
      idempotency_key: idempotencyKey,
      status: 'failed',
      state: { retry_count: 3 },
      created_at: new Date().toISOString(),
    })

    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      payload: {},
    }

    const claim = await claimWorkflowExecution({
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      event,
      idempotencyKey,
      maxRetries: 3,
      supabase: mockDb,
    })

    expect(claim.claimed).toBe(false)
    expect(claim.claimStatus).toBe('duplicate_permanently_failed')
    expect(isDuplicateClaim(claim.claimStatus)).toBe(true)
  })

  it('Scenario F: reclaims crashed / stale worker exceeding timeout', async () => {
    const mockDb = createMockSupabase()
    const idempotencyKey = 'acc-1:flow-1:order:ord-101:order.ready'

    // Run started 30 minutes ago and stuck in 'running'
    const staleTime = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    mockDb.runs.push({
      id: 'stale-run-999',
      flow_id: 'flow-1',
      account_id: 'acc-1',
      version_number: 1,
      idempotency_key: idempotencyKey,
      status: 'running',
      started_at: staleTime,
      state: { retry_count: 0 },
      created_at: staleTime,
    })

    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-101',
      payload: {},
    }

    const claim = await claimWorkflowExecution({
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      event,
      idempotencyKey,
      staleTimeoutMs: 10 * 60 * 1000, // 10 minutes
      supabase: mockDb,
    })

    expect(claim.claimed).toBe(true)
    expect(claim.claimStatus).toBe('reclaimed_stale')
    expect(claim.runId).toBe('stale-run-999')
  })
})

describe('End-to-End Workflow Execution with Idempotency & Action Suppression', () => {
  const sampleFlow: BackendFlow = {
    id: 'flow-feedback-101',
    account_id: 'acc-1',
    created_by: 'user-1',
    name: 'Customer Feedback Flow',
    slug: 'customer-feedback-flow',
    description: 'Sends feedback request after order ready',
    category: 'order_processing',
    status: 'published',
    current_version: 1,
    published_version: 1,
    published_at: new Date().toISOString(),
    published_by: 'user-1',
    trigger_type: 'order_event',
    trigger_config: { event: 'order.ready' },
    definition: {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Order Ready', subType: 'order_event', event: 'order.ready' },
        },
        {
          id: 'act-kitchen',
          type: 'action',
          position: { x: 0, y: 150 },
          data: { label: 'Kitchen Sync', subType: 'kitchen_sync', kitchenStatus: 'completed' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'act-kitchen' },
      ],
    },
    metadata: { max_retries: 3, timeout_seconds: 300 },
    execution_count: 0,
    last_executed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  it('prevents duplicate workflow execution on identical redelivered event', async () => {
    const mockDb = createMockSupabase()
    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-202',
      payload: { orderNumber: 202 },
    }

    // First execution: should claim and succeed
    const firstRun = await executeWorkflowRun(sampleFlow, event, { supabase: mockDb })
    expect(firstRun.status).toBe('completed')
    expect(firstRun.isDuplicate).toBeFalsy()
    expect(firstRun.stepRuns).toHaveLength(2)

    // Second execution with identical event: should detect duplicate and return prior state
    const secondRun = await executeWorkflowRun(sampleFlow, event, { supabase: mockDb })
    expect(secondRun.isDuplicate).toBe(true)
    expect(secondRun.runId).toBe(firstRun.runId)
    expect(secondRun.status).toBe('completed')
  })

  it('preserves completed steps and suppresses repeated actions on recovery', async () => {
    const mockDb = createMockSupabase()
    const idempotencyKey = 'acc-1:flow-feedback-101:order:ord-303:order.ready'

    // Simulate prior failed run where act-kitchen had already succeeded before network dropped
    const priorStep: StepExecutionResult = {
      nodeId: 'act-kitchen',
      nodeType: 'action',
      subType: 'kitchen_sync',
      status: 'completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 42,
      input: { orderId: 'ord-303' },
      output: { kitchenStatus: 'completed', synced: true },
    }

    mockDb.runs.push({
      id: 'run-partial-fail',
      flow_id: 'flow-feedback-101',
      account_id: 'acc-1',
      version_number: 1,
      idempotency_key: idempotencyKey,
      status: 'failed',
      state: {
        variables: { orderId: 'ord-303' },
        step_runs: [priorStep],
        retry_count: 0,
      },
      created_at: new Date().toISOString(),
    })

    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-303',
      payload: {},
    }

    const recoveredRun = await executeWorkflowRun(sampleFlow, event, { supabase: mockDb })

    expect(recoveredRun.status).toBe('completed')
    // Check that act-kitchen reused the completed result without re-executing
    const kitchenStep = recoveredRun.stepRuns.find((s) => s.nodeId === 'act-kitchen')
    expect(kitchenStep).toBeDefined()
    expect(kitchenStep?.reused).toBe(true)
  })

  it('handles simultaneous concurrent dispatches with exactly one winner', async () => {
    const mockDb = createMockSupabase()
    const event: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-race-1',
      payload: {},
    }

    const [run1, run2] = await Promise.all([
      executeWorkflowRun(sampleFlow, event, { supabase: mockDb }),
      executeWorkflowRun(sampleFlow, event, { supabase: mockDb }),
    ])

    const duplicates = [run1, run2].filter((r) => r.isDuplicate)
    const originals = [run1, run2].filter((r) => !r.isDuplicate)

    expect(originals).toHaveLength(1)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].originalRunId).toBe(originals[0].runId)
  })

  it('allows all valid sequential order lifecycle events for the same order', async () => {
    const mockDb = createMockSupabase()
    const orderId = 'ord-lifecycle-55'

    const eventCreated: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.created',
      orderId,
      payload: { status: 'created' },
    }
    const eventReady: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId,
      payload: { status: 'ready' },
    }
    const eventCompleted: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.completed',
      orderId,
      payload: { status: 'completed' },
    }

    const runCreated = await executeWorkflowRun(sampleFlow, eventCreated, { supabase: mockDb })
    const runReady = await executeWorkflowRun(sampleFlow, eventReady, { supabase: mockDb })
    const runCompleted = await executeWorkflowRun(sampleFlow, eventCompleted, { supabase: mockDb })

    expect(runCreated.isDuplicate).toBeFalsy()
    expect(runReady.isDuplicate).toBeFalsy()
    expect(runCompleted.isDuplicate).toBeFalsy()

    expect(runCreated.idempotencyKey).toContain('order:ord-lifecycle-55:order.created')
    expect(runReady.idempotencyKey).toContain('order:ord-lifecycle-55:order.ready')
    expect(runCompleted.idempotencyKey).toContain('order:ord-lifecycle-55:order.completed')
  })

  it('permits independent execution across different tenant accounts for identical order IDs', async () => {
    const mockDb = createMockSupabase()
    const flowTenantB: BackendFlow = {
      ...sampleFlow,
      id: 'flow-tenant-b',
      account_id: 'acc-tenant-b',
    }

    const eventTenantA: BackendFlowEvent = {
      accountId: 'acc-1',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-common-99',
      payload: {},
    }
    const eventTenantB: BackendFlowEvent = {
      accountId: 'acc-tenant-b',
      type: 'order_event',
      event: 'order.ready',
      orderId: 'ord-common-99',
      payload: {},
    }

    const runA = await executeWorkflowRun(sampleFlow, eventTenantA, { supabase: mockDb })
    const runB = await executeWorkflowRun(flowTenantB, eventTenantB, { supabase: mockDb })

    expect(runA.isDuplicate).toBeFalsy()
    expect(runB.isDuplicate).toBeFalsy()
    expect(runA.accountId).toBe('acc-1')
    expect(runB.accountId).toBe('acc-tenant-b')
  })
})
