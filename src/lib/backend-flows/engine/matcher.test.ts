import { describe, it, expect } from 'vitest'
import { matchesTrigger } from './matcher'
import type { BackendFlow } from '../types'
import type { BackendFlowEvent } from './types'

describe('Backend Flow Trigger Matcher', () => {
  const baseFlow: BackendFlow = {
    id: 'flow-1',
    account_id: 'acc-123',
    created_by: 'user-1',
    name: 'Order Lifecycle Flow',
    slug: 'order-lifecycle',
    description: null,
    category: 'order_processing',
    status: 'published',
    current_version: 1,
    published_version: 1,
    published_at: new Date().toISOString(),
    published_by: 'user-1',
    trigger_type: 'order_event',
    trigger_config: { event: 'order.created' },
    definition: { nodes: [], edges: [] },
    metadata: {},
    execution_count: 0,
    last_executed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  it('matches matching order event and account', () => {
    const event: BackendFlowEvent = {
      accountId: 'acc-123',
      type: 'order_event',
      event: 'order.created',
      payload: { id: 'ord-1' },
    }
    expect(matchesTrigger(baseFlow, event)).toBe(true)
  })

  it('rejects if account_id does not match (tenant isolation)', () => {
    const event: BackendFlowEvent = {
      accountId: 'other-acc-999',
      type: 'order_event',
      event: 'order.created',
      payload: { id: 'ord-1' },
    }
    expect(matchesTrigger(baseFlow, event)).toBe(false)
  })

  it('bypasses execution if workflow is paused (emergency activation safety)', () => {
    const pausedFlow: BackendFlow = {
      ...baseFlow,
      metadata: { is_paused: true },
    }
    const event: BackendFlowEvent = {
      accountId: 'acc-123',
      type: 'order_event',
      event: 'order.created',
      payload: { id: 'ord-1' },
    }
    expect(matchesTrigger(pausedFlow, event)).toBe(false)
  })

  it('rejects draft workflows in production mode', () => {
    const draftFlow: BackendFlow = {
      ...baseFlow,
      status: 'draft',
    }
    const event: BackendFlowEvent = {
      accountId: 'acc-123',
      type: 'order_event',
      event: 'order.created',
      payload: {},
    }
    expect(matchesTrigger(draftFlow, event)).toBe(false)
    expect(matchesTrigger(draftFlow, event, { allowDraft: true })).toBe(true)
  })

  it('matches wildcard order event triggers', () => {
    const wildcardFlow: BackendFlow = {
      ...baseFlow,
      trigger_config: { event: '*' },
    }
    const event: BackendFlowEvent = {
      accountId: 'acc-123',
      type: 'order_event',
      event: 'order.confirmed',
      payload: {},
    }
    expect(matchesTrigger(wildcardFlow, event)).toBe(true)
  })

  it('rejects mismatching order event names', () => {
    const event: BackendFlowEvent = {
      accountId: 'acc-123',
      type: 'order_event',
      event: 'order.cancelled',
      payload: {},
    }
    expect(matchesTrigger(baseFlow, event)).toBe(false)
  })

  it('matches manual execution triggers', () => {
    const manualFlow: BackendFlow = {
      ...baseFlow,
      trigger_type: 'manual',
      trigger_config: {},
    }
    const event: BackendFlowEvent = {
      accountId: 'acc-123',
      type: 'manual',
      payload: {},
    }
    expect(matchesTrigger(manualFlow, event)).toBe(true)
  })
})
