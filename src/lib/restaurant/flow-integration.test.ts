import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  dispatchRestaurantOrderFlowEvent,
} from './flow-integration'
import * as dispatcher from '@/lib/backend-flows/engine/dispatcher'

vi.mock('@/lib/backend-flows/engine/dispatcher', () => ({
  dispatchBackendFlowEvent: vi.fn().mockResolvedValue([]),
}))

describe('Restaurant Backend Flow Integration', () => {
  const accountId = 'acc-trial-1'
  const mockOrder = {
    id: 'ord-101',
    order_number: '101',
    status: 'pending_kitchen' as const,
    subtotal: 1330,
    total_amount: 1330,
    items: [{ name: 'Butter Chicken', quantity: 2, unit_price: 450, total_price: 900 }],
    contact_id: 'con-1',
    conversation_id: 'conv-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches order.created event with normalized payload', async () => {
    await dispatchRestaurantOrderFlowEvent({
      accountId,
      contactId: 'con-1',
      conversationId: 'conv-1',
      event: 'order.created',
      order: mockOrder,
    })

    expect(dispatcher.dispatchBackendFlowEvent).toHaveBeenCalledTimes(1)
    expect(dispatcher.dispatchBackendFlowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-trial-1',
        type: 'order_event',
        event: 'order.created',
        orderId: 'ord-101',
        payload: expect.objectContaining({
          orderId: 'ord-101',
          orderNumber: '101',
          subtotal: 1330,
        }),
      }),
      expect.anything()
    )
  })

  it('dispatches order.kitchen_accepted event with extra decision payload', async () => {
    await dispatchRestaurantOrderFlowEvent({
      accountId,
      event: 'order.kitchen_accepted',
      order: { ...mockOrder, status: 'fulfilment_pending' },
      extraPayload: { kitchenDecisionBy: 'staff-user-1' },
    })

    expect(dispatcher.dispatchBackendFlowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-trial-1',
        type: 'order_event',
        event: 'order.kitchen_accepted',
        payload: expect.objectContaining({
          kitchenDecisionBy: 'staff-user-1',
        }),
      }),
      expect.anything()
    )
  })

  it('dispatches order.payment_verified event upon UPI confirmation', async () => {
    await dispatchRestaurantOrderFlowEvent({
      accountId,
      event: 'order.payment_verified',
      order: { ...mockOrder, status: 'preparing', payment_status: 'verified' },
      extraPayload: { paymentMethod: 'upi', paymentConfirmedBy: 'staff-user-1' },
    })

    expect(dispatcher.dispatchBackendFlowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'order.payment_verified',
        payload: expect.objectContaining({
          paymentMethod: 'upi',
          paymentConfirmedBy: 'staff-user-1',
        }),
      }),
      expect.anything()
    )
  })

  it('safely catches errors and never throws when backend flow dispatcher errors', async () => {
    vi.mocked(dispatcher.dispatchBackendFlowEvent).mockRejectedValueOnce(
      new Error('Engine DB connection failure')
    )

    // Should complete cleanly without throwing
    await expect(
      dispatchRestaurantOrderFlowEvent({
        accountId,
        event: 'order.created',
        order: mockOrder,
      })
    ).resolves.not.toThrow()
  })

  it('safely exits early when accountId or order.id is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchRestaurantOrderFlowEvent({} as any)
    expect(dispatcher.dispatchBackendFlowEvent).not.toHaveBeenCalled()
  })
})
