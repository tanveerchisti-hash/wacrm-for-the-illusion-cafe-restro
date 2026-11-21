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
      initialVariables: { order: { subtotal: 1330 } },
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
      initialVariables: { order: { subtotal: 450 } },
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
})
