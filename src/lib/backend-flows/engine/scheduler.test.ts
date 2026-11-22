import { describe, it, expect } from 'vitest'
import {
  claimWaitingRun,
  reclaimStalledResumptions,
  resumeWaitingRun,
  sweepDueWaitingRuns,
} from './scheduler'
import { executeWorkflowRun } from './dispatcher'
import { executeFlowGraph } from './graph-runner'
import type { BackendFlow, BackendFlowDefinition } from '../types'
import type { BackendFlowEvent } from './types'

// Enhanced in-memory database mock modeling PostgreSQL with atomic conditional updates
function createMockDb() {
  const runs: Array<Record<string, unknown>> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flows: Array<any> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const versions: Array<any> = []

  return {
    runs,
    flows,
    versions,
    from(table: string) {
      const getSource = () => {
        if (table === 'backend_flow_runs') return runs
        if (table === 'backend_flows') return flows
        if (table === 'backend_flow_versions') return versions
        return []
      }

      const defaultQueryBuilder = {
        eq: () => defaultQueryBuilder,
        lte: () => defaultQueryBuilder,
        order: () => defaultQueryBuilder,
        limit: () => defaultQueryBuilder,
        maybeSingle: async () => ({ data: null, error: null }),
      }

      if (table !== 'backend_flow_runs' && table !== 'backend_flows' && table !== 'backend_flow_versions') {
        return {
          select: () => defaultQueryBuilder,
        }
      }

      return {
        insert: async (record: Record<string, unknown>) => {
          const source = getSource()
          source.push({ ...record, created_at: record.created_at || new Date().toISOString() })
          return { data: record, error: null }
        },

        select: () => {
          const source = getSource()
          const filters: Array<{ type: 'eq' | 'lte'; col: string; val: unknown }> = []
          let limitCount: number | undefined
          let sortCol: string | undefined
          let sortAsc = true

          const builder = {
            eq: (col: string, val: unknown) => {
              filters.push({ type: 'eq', col, val })
              return builder
            },
            lte: (col: string, val: unknown) => {
              filters.push({ type: 'lte', col, val })
              return builder
            },
            order: (col: string, opts?: { ascending?: boolean }) => {
              sortCol = col
              sortAsc = opts?.ascending ?? true
              return builder
            },
            limit: (n: number) => {
              limitCount = n
              return builder
            },
            maybeSingle: async () => {
              const matches = source.filter((item) =>
                filters.every((f) => {
                  if (f.type === 'eq') return item[f.col] === f.val
                  if (f.type === 'lte') {
                    const itemVal = item[f.col]
                    if (typeof itemVal === 'string' && typeof f.val === 'string') {
                      return itemVal <= f.val
                    }
                    return false
                  }
                  return true
                })
              )
              return { data: matches[0] ? { ...matches[0] } : null, error: null }
            },
            then: (resolve: (val: unknown) => unknown) => {
              let matches = source.filter((item) =>
                filters.every((f) => {
                  if (f.type === 'eq') return item[f.col] === f.val
                  if (f.type === 'lte') {
                    const itemVal = item[f.col]
                    if (typeof itemVal === 'string' && typeof f.val === 'string') {
                      return itemVal <= f.val
                    }
                    return false
                  }
                  return true
                })
              )
              if (sortCol) {
                matches.sort((a, b) => {
                  const valA = (a[sortCol!] as string) || ''
                  const valB = (b[sortCol!] as string) || ''
                  return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA)
                })
              }
              if (limitCount !== undefined) {
                matches = matches.slice(0, limitCount)
              }
              return Promise.resolve(resolve({ data: matches, error: null }))
            },
          }
          return builder
        },

        update: (updates: Record<string, unknown>) => {
          const source = getSource()
          const filters: Array<{ type: 'eq' | 'lte'; col: string; val: unknown }> = []

          const execute = () => {
            const matches = source.filter((item) =>
              filters.every((f) => {
                if (f.type === 'eq') return item[f.col] === f.val
                if (f.type === 'lte') {
                  const itemVal = item[f.col]
                  if (typeof itemVal === 'string' && typeof f.val === 'string') {
                    return itemVal <= f.val
                  }
                  return false
                }
                return true
              })
            )
            for (const m of matches) {
              Object.assign(m, updates)
            }
            return matches
          }

          const builder = {
            eq: (col: string, val: unknown) => {
              filters.push({ type: 'eq', col, val })
              return builder
            },
            lte: (col: string, val: unknown) => {
              filters.push({ type: 'lte', col, val })
              return builder
            },
            select: () => ({
              maybeSingle: async () => {
                const matches = execute()
                return { data: matches[0] ? { ...matches[0] } : null, error: null }
              },
              then: (resolve: (val: unknown) => unknown) => {
                const matches = execute()
                return Promise.resolve(resolve({ data: matches, error: null }))
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

describe('WACRM Backend Flows — Phase 4: Durable Delay Scheduler', () => {
  const baseFlowDefinition: BackendFlowDefinition = {
    nodes: [
      {
        id: 'trig-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: { label: 'Order Completed', subType: 'order_event', event: 'order.completed' },
      },
      {
        id: 'delay-1',
        type: 'action',
        position: { x: 0, y: 100 },
        data: { label: 'Delay 1 Min', subType: 'delay', delayMinutes: 1 },
      },
      {
        id: 'act-kitchen',
        type: 'action',
        position: { x: 0, y: 200 },
        data: { label: 'Kitchen Sync', subType: 'kitchen_sync', kitchenStatus: 'completed' },
      },
    ],
    edges: [
      { id: 'e1', source: 'trig-1', target: 'delay-1' },
      { id: 'e2', source: 'delay-1', target: 'act-kitchen' },
    ],
  }

  const baseFlow: BackendFlow = {
    id: 'flow-feedback-delay',
    account_id: 'acc-tenant-1',
    created_by: 'user-1',
    name: 'Customer Feedback Flow with Delay',
    slug: 'feedback-delay',
    description: 'Waits after order completion before sending feedback request',
    category: 'order_processing',
    status: 'published',
    current_version: 1,
    published_version: 1,
    published_at: new Date().toISOString(),
    published_by: 'user-1',
    trigger_type: 'order_event',
    trigger_config: { event: 'order.completed' },
    definition: baseFlowDefinition,
    metadata: { max_retries: 3, timeout_seconds: 300 },
    execution_count: 0,
    last_executed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  it('Test A: One-Minute Delay pauses execution, leaves downstream actions pending, and resumes when due', async () => {
    const mockDb = createMockDb()
    mockDb.flows.push({ ...baseFlow })

    const event: BackendFlowEvent = {
      accountId: 'acc-tenant-1',
      type: 'order_event',
      event: 'order.completed',
      orderId: 'ord-100',
      payload: { orderNumber: 100 },
    }

    // Step 1: Initial event dispatch
    const initialRun = await executeWorkflowRun(baseFlow, event, { supabase: mockDb })

    // Verify workflow entered 'waiting' state and stopped before act-kitchen
    expect(initialRun.status).toBe('waiting')
    expect(initialRun.waitingUntil).toBeDefined()
    expect(initialRun.pendingNodeIds).toContain('act-kitchen')
    expect(initialRun.stepRuns.map((s) => s.nodeId)).toContain('trig-1')
    expect(initialRun.stepRuns.map((s) => s.nodeId)).toContain('delay-1')
    expect(initialRun.stepRuns.map((s) => s.nodeId)).not.toContain('act-kitchen')

    // Verify database record has 'waiting' status and waiting_until timestamp
    const runInDb = mockDb.runs.find((r) => r.id === initialRun.runId)
    expect(runInDb).toBeDefined()
    expect(runInDb?.status).toBe('waiting')
    expect(runInDb?.waiting_until).toBe(initialRun.waitingUntil)
    expect(runInDb?.completed_at).toBeNull()

    // Step 2: Before deadline (now < waiting_until) -> Scheduler skips the job
    const beforeDeadline = new Date(Date.now() - 1000)
    const earlySweep = await sweepDueWaitingRuns({
      supabase: mockDb,
      now: beforeDeadline,
    })
    expect(earlySweep.processed).toBe(0)
    expect(runInDb?.status).toBe('waiting')

    // Step 3: At or after deadline -> Eligible scheduler sweep resumes it
    const afterDeadline = new Date(Date.now() + 65 * 1000)
    const dueSweep = await sweepDueWaitingRuns({
      supabase: mockDb,
      now: afterDeadline,
    })

    expect(dueSweep.processed).toBe(1)
    expect(runInDb?.status).toBe('completed')
    expect(runInDb?.completed_at).toBeDefined()

    // Downstream action act-kitchen executed cleanly
    const finalState = runInDb?.state as Record<string, unknown>
    const finalStepRuns = (finalState?.step_runs as Array<{ nodeId: string; status: string }>) || []
    expect(finalStepRuns.map((s) => s.nodeId)).toContain('act-kitchen')
  })

  it('Test B: Twenty-Minute Delay calculates correct future timestamp without synchronous waiting', async () => {
    const twentyMinFlowDef: BackendFlowDefinition = {
      ...baseFlowDefinition,
      nodes: [
        baseFlowDefinition.nodes[0],
        {
          id: 'delay-20',
          type: 'action',
          position: { x: 0, y: 100 },
          data: { label: 'Delay 20 Min', subType: 'delay', delayMinutes: 20 },
        },
        baseFlowDefinition.nodes[2],
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'delay-20' },
        { id: 'e2', source: 'delay-20', target: 'act-kitchen' },
      ],
    }

    const t0 = Date.now()
    const result = await executeFlowGraph(twentyMinFlowDef, {
      runId: 'run-20m',
      flowId: 'flow-20m',
      accountId: 'acc-1',
      versionNumber: 1,
      initialVariables: {},
    })
    const elapsedMs = Date.now() - t0

    // Execution must complete in milliseconds without blocking the event loop
    expect(elapsedMs).toBeLessThan(100)
    expect(result.status).toBe('waiting')
    expect(result.waitingUntil).toBeDefined()

    const resumeTime = new Date(result.waitingUntil!).getTime()
    const diffMinutes = (resumeTime - t0) / (60 * 1000)
    expect(Math.round(diffMinutes)).toBe(20)
  })

  it('Test C: Server Restart & State Recovery persists in DB and resumes seamlessly with fresh worker', async () => {
    const mockDb = createMockDb()
    mockDb.flows.push({ ...baseFlow })

    const event: BackendFlowEvent = {
      accountId: 'acc-tenant-1',
      type: 'order_event',
      event: 'order.completed',
      orderId: 'ord-server-crash',
      payload: { customerNote: 'VIP Table' },
    }

    const initialRun = await executeWorkflowRun(baseFlow, event, { supabase: mockDb })
    expect(initialRun.status).toBe('waiting')

    // Simulate complete process termination & fresh scheduler startup
    const freshDbInstance = { ...mockDb }

    const resumeResult = await resumeWaitingRun(freshDbInstance, initialRun.runId)
    expect(resumeResult.resumed).toBe(true)
    expect(resumeResult.status).toBe('completed')

    const persistedRun = freshDbInstance.runs.find((r) => r.id === initialRun.runId)
    expect(persistedRun?.status).toBe('completed')
    const finalState = persistedRun?.state as Record<string, unknown>
    const finalVars = finalState.variables as Record<string, unknown>
    expect(finalVars.customerNote).toBe('VIP Table')
  })

  it('Test D: Concurrent Scheduler Workers obtain exactly one atomic claim', async () => {
    const mockDb = createMockDb()
    const runId = 'run-race-claim'

    mockDb.runs.push({
      id: runId,
      flow_id: baseFlow.id,
      account_id: baseFlow.account_id,
      version_number: 1,
      status: 'waiting',
      waiting_until: new Date(Date.now() - 5000).toISOString(),
      created_at: new Date().toISOString(),
    })

    // Simulate 3 workers competing to claim the same due job simultaneously
    const [w1, w2, w3] = await Promise.all([
      claimWaitingRun(mockDb, runId),
      claimWaitingRun(mockDb, runId),
      claimWaitingRun(mockDb, runId),
    ])

    const successCount = [w1, w2, w3].filter(Boolean).length
    expect(successCount).toBe(1)
  })

  it('Test E: Duplicate Resume Request handles already-claimed or completed runs safely', async () => {
    const mockDb = createMockDb()
    const runId = 'run-already-done'

    mockDb.runs.push({
      id: runId,
      flow_id: baseFlow.id,
      account_id: baseFlow.account_id,
      version_number: 1,
      status: 'completed',
      created_at: new Date().toISOString(),
    })

    const duplicateResume = await resumeWaitingRun(mockDb, runId)
    expect(duplicateResume.resumed).toBe(false)
    expect(duplicateResume.status).toBe('skipped')
  })

  it('Test F: Multiple Sequential Delays pause and resume independently at correct frontiers', async () => {
    const sequentialDelayDef: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start' },
        },
        {
          id: 'delay-A',
          type: 'action',
          position: { x: 0, y: 100 },
          data: { label: 'First Delay', subType: 'delay', delayMinutes: 1 },
        },
        {
          id: 'act-mid',
          type: 'action',
          position: { x: 0, y: 200 },
          data: { label: 'Mid Action', subType: 'kitchen_sync', kitchenStatus: 'preparing' },
        },
        {
          id: 'delay-B',
          type: 'action',
          position: { x: 0, y: 300 },
          data: { label: 'Second Delay', subType: 'delay', delayMinutes: 2 },
        },
        {
          id: 'act-final',
          type: 'action',
          position: { x: 0, y: 400 },
          data: { label: 'Final Action', subType: 'kitchen_sync', kitchenStatus: 'completed' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'delay-A' },
        { id: 'e2', source: 'delay-A', target: 'act-mid' },
        { id: 'e3', source: 'act-mid', target: 'delay-B' },
        { id: 'e4', source: 'delay-B', target: 'act-final' },
      ],
    }

    const mockDb = createMockDb()
    const seqFlow: BackendFlow = {
      ...baseFlow,
      id: 'flow-seq-delays',
      definition: sequentialDelayDef,
    }
    mockDb.flows.push(seqFlow)

    // Phase 1: Start workflow -> Pauses at delay-A
    const run1 = await executeWorkflowRun(seqFlow, {
      accountId: seqFlow.account_id,
      type: 'order_event',
      event: 'order.completed',
      payload: {},
    }, { supabase: mockDb })

    expect(run1.status).toBe('waiting')
    expect(run1.waitingNodeId).toBe('delay-A')
    expect(run1.pendingNodeIds).toEqual(['act-mid'])

    // Phase 2: Resume from delay-A -> Executes act-mid and pauses at delay-B
    const resumeA = await resumeWaitingRun(mockDb, run1.runId)
    expect(resumeA.resumed).toBe(true)
    expect(resumeA.status).toBe('waiting') // Paused again!
    expect(resumeA.executionState?.waitingNodeId).toBe('delay-B')
    expect(resumeA.executionState?.pendingNodeIds).toEqual(['act-final'])

    // Phase 3: Resume from delay-B -> Executes act-final to completion
    const resumeB = await resumeWaitingRun(mockDb, run1.runId)
    expect(resumeB.resumed).toBe(true)
    expect(resumeB.status).toBe('completed')

    const completedSteps = resumeB.executionState?.stepRuns.map((s) => s.nodeId)
    expect(completedSteps).toContain('delay-A')
    expect(completedSteps).toContain('act-mid')
    expect(completedSteps).toContain('delay-B')
    expect(completedSteps).toContain('act-final')
  })

  it('Test G: Workflow Version Change maintains immutable version snapshot for waiting run', async () => {
    const mockDb = createMockDb()
    mockDb.flows.push({ ...baseFlow })

    const event: BackendFlowEvent = {
      accountId: 'acc-tenant-1',
      type: 'order_event',
      event: 'order.completed',
      payload: {},
    }

    const run = await executeWorkflowRun(baseFlow, event, { supabase: mockDb })
    expect(run.status).toBe('waiting')

    // Modify the live workflow definition while the execution is waiting in DB
    const flowInDb = mockDb.flows.find((f) => f.id === baseFlow.id)
    if (flowInDb) {
      flowInDb.current_version = 2
      flowInDb.definition = {
        nodes: [{ id: 'trig-new', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'New v2' } }],
        edges: [],
      }
    }

    // Resume waiting run: must follow saved definition snapshot from v1
    const resumed = await resumeWaitingRun(mockDb, run.runId)
    expect(resumed.resumed).toBe(true)
    expect(resumed.status).toBe('completed')
    // Downstream action from v1 executed successfully
    expect(resumed.executionState?.stepRuns.map((s) => s.nodeId)).toContain('act-kitchen')
  })

  it('Test H: Emergency Pause stops waiting workflow from executing downstream actions', async () => {
    const mockDb = createMockDb()
    const pausedFlow: BackendFlow = {
      ...baseFlow,
      metadata: { ...baseFlow.metadata, is_paused: true },
    }
    mockDb.flows.push(pausedFlow)

    const runId = 'run-paused-test'
    mockDb.runs.push({
      id: runId,
      flow_id: pausedFlow.id,
      account_id: pausedFlow.account_id,
      version_number: 1,
      status: 'waiting',
      waiting_until: new Date(Date.now() - 5000).toISOString(),
      state: {
        pending_node_ids: ['act-kitchen'],
        definition_snapshot: baseFlowDefinition,
      },
      created_at: new Date().toISOString(),
    })

    const sweepResult = await sweepDueWaitingRuns({ supabase: mockDb })
    expect(sweepResult.processed).toBe(0)
    expect(sweepResult.skipped).toBe(1)

    // Run remains waiting and act-kitchen was NOT executed
    const runInDb = mockDb.runs.find((r) => r.id === runId)
    expect(runInDb?.status).toBe('waiting')
  })

  it('Test I: Execution Timeout separates active traversal from delay waiting duration', async () => {
    // Flow configured with 300s active execution timeout
    // Delay set to 20 minutes (1200s > 300s)
    const result = await executeFlowGraph(baseFlowDefinition, {
      runId: 'run-timeout-separation',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      timeoutMs: 300000, // 300 seconds active timeout
      initialVariables: {},
    })

    expect(result.status).toBe('waiting')
    // Must NOT fail with 'timed_out'
    expect(result.status).not.toBe('timed_out')
    expect(result.errorMessage).toBeUndefined()
  })

  it('Test J: Safe Dry-Run Simulator continues immediately without DB jobs or real waiting', async () => {
    const simResult = await executeFlowGraph(baseFlowDefinition, {
      runId: 'sim-fast-1',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      isDryRun: true,
      initialVariables: {},
    })

    // In simulation mode: completes immediately with simulated metadata
    expect(simResult.status).toBe('completed')
    const delayStep = simResult.stepRuns.find((s) => s.nodeId === 'delay-1')
    expect(delayStep).toBeDefined()
    expect(delayStep?.output?.simulated).toBe(true)
    expect(delayStep?.output?.hypotheticalResumeAt).toBeDefined()

    // Downstream action executed in simulation
    const kitchenStep = simResult.stepRuns.find((s) => s.nodeId === 'act-kitchen')
    expect(kitchenStep).toBeDefined()
    expect(kitchenStep?.status).toBe('completed')
  })

  it('Test K: Tenant Isolation prevents cross-tenant claiming or sweeps', async () => {
    const mockDb = createMockDb()
    const runIdTenantA = 'run-tenant-A'
    const runIdTenantB = 'run-tenant-B'

    mockDb.runs.push(
      {
        id: runIdTenantA,
        flow_id: baseFlow.id,
        account_id: 'tenant-ALPHA',
        version_number: 1,
        status: 'waiting',
        waiting_until: new Date(Date.now() - 5000).toISOString(),
        created_at: new Date().toISOString(),
      },
      {
        id: runIdTenantB,
        flow_id: baseFlow.id,
        account_id: 'tenant-BETA',
        version_number: 1,
        status: 'waiting',
        waiting_until: new Date(Date.now() - 5000).toISOString(),
        created_at: new Date().toISOString(),
      }
    )

    // Sweep strictly scoped to tenant ALPHA
    const sweepAlpha = await sweepDueWaitingRuns({
      supabase: mockDb,
      accountId: 'tenant-ALPHA',
    })
    expect(sweepAlpha).toBeDefined()

    // Only tenant ALPHA's job is claimed/processed
    const runA = mockDb.runs.find((r) => r.id === runIdTenantA)
    const runB = mockDb.runs.find((r) => r.id === runIdTenantB)

    expect(runA).toBeDefined()
    expect(runB?.status).toBe('waiting')
  })

  it('Test L: Failure Recovery reclaims crashed workers whose lease expired', async () => {
    const mockDb = createMockDb()
    const runId = 'run-crashed-worker'

    // Simulate worker that crashed 10 minutes ago while resuming
    const pastTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    mockDb.runs.push({
      id: runId,
      flow_id: baseFlow.id,
      account_id: baseFlow.account_id,
      version_number: 1,
      status: 'resuming',
      lease_expires_at: pastTime,
      waiting_until: pastTime,
      created_at: pastTime,
    })

    const reclaimed = await reclaimStalledResumptions(mockDb, new Date())
    expect(reclaimed).toBe(1)

    const recoveredRow = mockDb.runs.find((r) => r.id === runId)
    expect(recoveredRow?.status).toBe('waiting')
    expect(recoveredRow?.lease_expires_at).toBeNull()
  })
})
