import { describe, it, expect } from 'vitest'
import { validateCanvasDefinition } from './canvas-validation'
import type { BackendFlowDefinition } from './types'

describe('Canvas Validation Engine', () => {
  it('fails if canvas is empty', () => {
    const emptyDef: BackendFlowDefinition = { nodes: [], edges: [] }
    const res = validateCanvasDefinition(emptyDef)
    expect(res.valid).toBe(false)
    expect(res.errors[0].message).toContain('empty')
  })

  it('fails if there are no trigger nodes', () => {
    const noTriggerDef: BackendFlowDefinition = {
      nodes: [
        {
          id: 'action-1',
          type: 'action',
          position: { x: 0, y: 0 },
          data: { label: 'Send WhatsApp' },
        },
      ],
      edges: [],
    }
    const res = validateCanvasDefinition(noTriggerDef)
    expect(res.valid).toBe(false)
    expect(res.errors[0].message).toContain('at least one trigger')
  })

  it('passes and validates a connected trigger and action pipeline', () => {
    const validDef: BackendFlowDefinition = {
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
          data: { label: 'Kitchen Sync', subType: 'kitchen_sync' },
        },
      ],
      edges: [
        {
          id: 'e-1',
          source: 'trig-1',
          target: 'act-1',
        },
      ],
    }
    const res = validateCanvasDefinition(validDef)
    expect(res.valid).toBe(true)
    expect(res.errors).toHaveLength(0)
    expect(res.warnings).toHaveLength(0)
  })

  it('flags dangling edges pointing to nonexistent nodes', () => {
    const brokenDef: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Order Trigger' },
        },
      ],
      edges: [
        {
          id: 'e-broken',
          source: 'trig-1',
          target: 'missing-node-999',
        },
      ],
    }
    const res = validateCanvasDefinition(brokenDef)
    expect(res.valid).toBe(false)
    expect(res.errors.some((e) => e.message.includes('missing-node-999'))).toBe(true)
  })

  it('warns on disconnected action nodes', () => {
    const disconnectedDef: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Order Trigger' },
        },
        {
          id: 'act-isolated',
          type: 'action',
          position: { x: 300, y: 300 },
          data: { label: 'Orphan Action' },
        },
      ],
      edges: [],
    }
    const res = validateCanvasDefinition(disconnectedDef)
    expect(res.valid).toBe(true) // Warnings do not strictly invalidate syntax
    expect(res.warnings.some((w) => w.message.includes('disconnected'))).toBe(true)
  })

  it('warns when condition node is missing true or false branch', () => {
    const conditionDef: BackendFlowDefinition = {
      nodes: [
        {
          id: 'trig-1',
          type: 'trigger',
          position: { x: 0, y: 0 },
          data: { label: 'Start' },
        },
        {
          id: 'cond-1',
          type: 'condition',
          position: { x: 0, y: 150 },
          data: { label: 'Subtotal > 1000' },
        },
        {
          id: 'act-true',
          type: 'action',
          position: { x: -100, y: 300 },
          data: { label: 'VIP Notification' },
        },
      ],
      edges: [
        { id: 'e1', source: 'trig-1', target: 'cond-1' },
        { id: 'e2', source: 'cond-1', target: 'act-true', sourceHandle: 'true' },
      ],
    }
    const res = validateCanvasDefinition(conditionDef)
    expect(res.valid).toBe(true)
    expect(res.warnings.some((w) => w.message.includes('missing a "False" branch'))).toBe(true)
  })
})
