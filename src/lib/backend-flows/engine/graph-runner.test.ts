/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { executeFlowGraph } from './graph-runner'
import type { BackendFlowDefinition } from '../types'

describe('Backend Flow Graph Runner', () => {
  it('executes a linear Trigger -> Action pipeline successfully', async () => {
    const definition: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Order Created', subType: 'order_event' },
        },
        {
          id: 'act-1',
          type: 'action',
          position: { x: 0, y: 150 },
          data: {
            label: 'Kitchen Sync',
            subType: 'kitchen_sync',
            kitchenStatus: 'preparing',
            prepTimeMinutes: 25,
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'trig-1',
          target: 'act-1',
        },
      ],
    }

    const result = await executeFlowGraph(definition, {
      runId: 'run-test-1',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      initialVariables: { orderId: 'ord-123' },
    })

    expect(result.status).toBe('completed')
    expect(result.stepRuns).toHaveLength(2)
    expect(result.stepRuns[0].nodeType).toBe('trigger')
    expect(result.stepRuns[1].nodeType).toBe('action')
    expect(result.stepRuns[1].output?.kitchenStatus).toBe('preparing')
  })

  it('correctly routes through condition True branch when expression matches', async () => {
    const definition: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Order Start' },
        },
        {
          id: 'cond-1',
          type: 'condition',
          position: { x: 0, y: 100 },
          data: {
            label: 'Check VIP Amount',
            field: 'order.subtotal',
            operator: 'greater_than',
            value: '1000',
          },
        },
        {
          id: 'act-vip',
          type: 'action',
          position: { x: -100, y: 200 },
          data: { label: 'VIP Notification', subType: 'whatsapp_message', messageTemplate: 'VIP Alert' },
        },
        {
          id: 'act-standard',
          type: 'action',
          position: { x: 100, y: 200 },
          data: { label: 'Standard Notification', subType: 'whatsapp_message', messageTemplate: 'Standard' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'cond-1' },
        { id: 'e2', source: 'cond-1', target: 'act-vip', sourceHandle: 'true' },
        { id: 'e3', source: 'cond-1', target: 'act-standard', sourceHandle: 'false' },
      ],
    }

    // High order total: should route to VIP action
    const vipResult = await executeFlowGraph(definition, {
      runId: 'run-vip',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      isDryRun: true,
      initialVariables: { order: { subtotal: 1330 }, customerPhone: '+919876543210' },
    })

    expect(vipResult.status).toBe('completed')
    const visitedNodes = vipResult.stepRuns.map((s) => s.nodeId)
    expect(visitedNodes).toContain('act-vip')
    expect(visitedNodes).not.toContain('act-standard')

    // Low order total: should route to standard action
    const standardResult = await executeFlowGraph(definition, {
      runId: 'run-standard',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      isDryRun: true,
      initialVariables: { order: { subtotal: 450 }, customerPhone: '+919876543210' },
    })

    expect(standardResult.status).toBe('completed')
    const standardNodes = standardResult.stepRuns.map((s) => s.nodeId)
    expect(standardNodes).toContain('act-standard')
    expect(standardNodes).not.toContain('act-vip')
  })

  it('fails and terminates execution on invalid action endpoint', async () => {
    const definition: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start' },
        },
        {
          id: 'act-bad',
          type: 'action',
          position: { x: 0, y: 100 },
          data: {
            label: 'Call External API',
            subType: 'http_request',
            endpointUrl: '', // empty URL fails
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'act-bad' },
      ],
    }

    const result = await executeFlowGraph(definition, {
      runId: 'run-fail',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      initialVariables: {},
      maxRetries: 1,
    })

    expect(result.status).toBe('failed')
    expect(result.errorMessage).toContain('Endpoint URL is empty')
  })

  it('safely skips execution when an eligibility action returns skipped=true without retrying', async () => {
    const definition: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Order Completed', subType: 'order_event' },
        },
        {
          id: 'act-eligibility',
          type: 'action',
          position: { x: 0, y: 100 },
          data: {
            label: 'Check Eligibility',
            subType: 'restaurant_feedback_eligibility',
          },
        },
        {
          id: 'act-msg',
          type: 'action',
          position: { x: 0, y: 200 },
          data: {
            label: 'Send Feedback',
            subType: 'whatsapp_message',
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'act-eligibility' },
        { id: 'e2', source: 'act-eligibility', target: 'act-msg' },
      ],
    }

    // Mock an ineligible order (status is preparing, not completed)
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'ord-ineligible', status: 'preparing' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }

    const result = await executeFlowGraph(definition, {
      runId: 'run-ineligible',
      flowId: 'flow-1',
      accountId: 'acc-1',
      versionNumber: 1,
      initialVariables: { orderId: 'ord-ineligible' },
      maxRetries: 3,
      supabase: mockSupabase as any,
    })

    // Overall status is completed (terminated safely as skipped, not crashed)
    expect(result.status).toBe('completed')
    expect(result.stepRuns).toHaveLength(2) // Trigger + Eligibility (skipped)
    const eligibilityStep = result.stepRuns.find((s) => s.nodeId === 'act-eligibility')
    expect(eligibilityStep?.status).toBe('skipped')
    expect(eligibilityStep?.error).toContain('ORDER_NOT_COMPLETED')

    // Downstream WhatsApp action was NOT run
    const messageStep = result.stepRuns.find((s) => s.nodeId === 'act-msg')
    expect(messageStep).toBeUndefined()
  })
})
