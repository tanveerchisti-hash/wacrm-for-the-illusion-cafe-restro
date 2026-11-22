/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enqueueOrderOutboxEvent, dispatchOutboxEventRecord } from './order-outbox'
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
})
