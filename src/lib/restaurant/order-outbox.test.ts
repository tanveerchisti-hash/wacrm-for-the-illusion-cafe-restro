/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  enqueueOrderOutboxEvent,
  dispatchOutboxEventRecord,
  transitionOrderStatusAtomically,
  sweepPendingOrderOutboxEvents,
} from './order-outbox'
import * as flowIntegration from './flow-integration'

vi.mock('./flow-integration', () => ({
  dispatchRestaurantOrderFlowEvent: vi.fn(),
}))

describe('Restaurant Order Transactional Outbox (order-outbox.ts)', () => {
  const mockOrder = {
    id: 'ord-outbox-1',
    order_number: '101',
    status: 'completed' as const,
    account_id: 'acc-1',
    contact_id: 'cnt-1',
    conversation_id: 'conv-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('atomically enqueues an order.completed event into outbox', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'outbox-rec-1' },
              error: null,
            }),
          }),
        }),
      }),
    }

    const result = await enqueueOrderOutboxEvent(mockSupabase as any, {
      accountId: 'acc-1',
      orderId: 'ord-outbox-1',
      eventType: 'order.completed',
      order: mockOrder,
    })

    expect(result.enqueued).toBe(true)
    expect(result.outboxId).toBe('outbox-rec-1')
    expect(mockSupabase.from).toHaveBeenCalledWith('restaurant_order_outbox_events')
  })

  it('detects duplicate events on unique constraint violation (23505)', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }),
          }),
        }),
      }),
    }

    const result = await enqueueOrderOutboxEvent(mockSupabase as any, {
      accountId: 'acc-1',
      orderId: 'ord-outbox-1',
      eventType: 'order.completed',
      order: mockOrder,
    })

    expect(result.enqueued).toBe(false)
    expect(result.isDuplicate).toBe(true)
  })

  it('dispatches outbox event and updates status to dispatched', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
      }),
    }

    const dispatched = await dispatchOutboxEventRecord(mockSupabase as any, 'outbox-rec-1', {
      accountId: 'acc-1',
      orderId: 'ord-outbox-1',
      eventType: 'order.completed',
      order: mockOrder,
    })

    expect(dispatched).toBe(true)
    expect(flowIntegration.dispatchRestaurantOrderFlowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        event: 'order.completed',
      })
    )
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'dispatched' }))
  })

  it('records failed status if dispatchRestaurantOrderFlowEvent throws', async () => {
    vi.mocked(flowIntegration.dispatchRestaurantOrderFlowEvent).mockRejectedValueOnce(
      new Error('Engine crash')
    )

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
      }),
    }

    const dispatched = await dispatchOutboxEventRecord(mockSupabase as any, 'outbox-rec-1', {
      accountId: 'acc-1',
      orderId: 'ord-outbox-1',
      eventType: 'order.completed',
      order: mockOrder,
    })

    expect(dispatched).toBe(false)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_message: 'Engine crash',
      })
    )
  })

  it('transitionOrderStatusAtomically calls RPC and returns order and outbox ID', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          order: { ...mockOrder, status: 'completed' },
          outbox_id: 'outbox-rpc-1',
          event_type: 'order.completed',
          unchanged: false,
        },
        error: null,
      }),
    }

    const res = await transitionOrderStatusAtomically(mockSupabase as any, {
      accountId: 'acc-1',
      orderId: 'ord-outbox-1',
      newStatus: 'completed',
    })

    expect(res.success).toBe(true)
    expect(res.outboxId).toBe('outbox-rpc-1')
    expect(res.order?.status).toBe('completed')
    expect(mockSupabase.rpc).toHaveBeenCalledWith('transition_restaurant_order_status', {
      p_account_id: 'acc-1',
      p_order_id: 'ord-outbox-1',
      p_new_status: 'completed',
      p_cancellation_reason: null,
      p_updated_by: null,
    })
  })

  it('sweepPendingOrderOutboxEvents sweeps pending records and marks them dispatched', async () => {
    const candidate = {
      id: 'outbox-pending-1',
      account_id: 'acc-1',
      order_id: 'ord-101',
      event_type: 'order.completed',
      payload: {
        orderId: 'ord-101',
        orderNumber: '101',
        status: 'completed',
      },
      status: 'pending',
      retry_count: 0,
      created_at: new Date().toISOString(),
    }

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: candidate, error: null }),
          }),
        }),
        error: null,
      }),
    })

    const mockSelectChain: Record<string, any> = {}
    mockSelectChain.or = vi.fn().mockReturnValue(mockSelectChain)
    mockSelectChain.lt = vi.fn().mockReturnValue(mockSelectChain)
    mockSelectChain.order = vi.fn().mockReturnValue(mockSelectChain)
    mockSelectChain.limit = vi.fn().mockResolvedValue({ data: [candidate], error: null })

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_order_outbox_events') {
          return {
            select: vi.fn().mockReturnValue(mockSelectChain),
            update: mockUpdate,
          }
        }
        return {}
      }),
    }

    const summary = await sweepPendingOrderOutboxEvents(mockSupabase as any, 10)
    expect(summary.scanned).toBe(1)
    expect(summary.dispatched).toBe(1)
    expect(summary.failed).toBe(0)
    expect(flowIntegration.dispatchRestaurantOrderFlowEvent).toHaveBeenCalled()
  })
})
