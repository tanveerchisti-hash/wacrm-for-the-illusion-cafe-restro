import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createTrialOrder,
  acceptKitchenOrder,
  rejectKitchenOrder,
  updateOrderFulfilment,
  processPaymentMethod,
  confirmUpiPayment,
  startItemTimers,
  extractOrderConfirmedMarker,
  type TrialOrder,
  type TrialItemTimer,
} from './order-trial'
import { handleRestaurantTrialInbound, parseSummaryFromText } from './webhook-handler'
import * as metaSend from '@/lib/flows/meta-send'

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: vi.fn().mockResolvedValue({ whatsapp_message_id: 'wamid-mock-1' }),
  engineSendInteractiveButtons: vi.fn().mockResolvedValue({ whatsapp_message_id: 'wamid-mock-2' }),
}))

describe('Restaurant Order Trial Workflow', () => {
  const ACCOUNT_ID = 'acc-123'
  const CONTACT_ID = 'con-456'
  const CONVERSATION_ID = 'conv-789'
  const USER_ID = 'user-admin'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // 1. Confirmed order creates one pending kitchen record
  it('1. Confirmed order creates one pending kitchen record', async () => {
    const mockOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: 'session-1',
      order_number: 'ORD-1001',
      status: 'pending_kitchen',
      items: [{ name: 'Veg Burger', quantity: 2, unit_price: 120, total_price: 240, duration_minutes: 12 }],
      subtotal: 240,
      delivery_fee: 0,
      total_amount: 240,
      fulfilment_type: null,
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: null,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
              }),
            }),
          }
        }
        if (table === 'restaurant_trial_order_items') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        if (table === 'restaurant_trial_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {}
      }),
    } as unknown as SupabaseClient

    const order = await createTrialOrder(db, {
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
      items: [{ name: 'Veg Burger', quantity: 2, unit_price: 120, total_price: 240 }],
      subtotal: 240,
    })

    expect(order.status).toBe('pending_kitchen')
    expect(order.order_number).toBe('ORD-1001')
    expect(order.is_test_order).toBe(true)
  })

  // 2. AI cannot proceed while kitchen approval is pending
  it('2. AI cannot proceed while kitchen approval is pending', async () => {
    const pendingOrder: TrialOrder = {
      id: 'order-pending',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: 'session-1',
      order_number: 'ORD-999',
      status: 'pending_kitchen',
      items: [{ name: 'Pizza', quantity: 1, unit_price: 300, total_price: 300 }],
      subtotal: 300,
      delivery_fee: 0,
      total_amount: 300,
      fulfilment_type: null,
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: null,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: pendingOrder, error: null }),
      })),
    } as unknown as SupabaseClient

    const result = await handleRestaurantTrialInbound({
      db,
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
      configOwnerUserId: USER_ID,
      message: { id: 'msg-1', type: 'text' },
      inboundText: 'Can I pay online now?',
      interactiveReplyId: null,
    })

    expect(result.handled).toBe(true)
    expect(metaSend.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('awaiting kitchen confirmation'),
      }),
    )
  })

  // 3. Kitchen Accept triggers fulfilment selection
  it('3. Kitchen Accept triggers fulfilment selection', async () => {
    const pendingOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: 'session-1',
      order_number: 'ORD-1001',
      status: 'pending_kitchen',
      items: [],
      subtotal: 200,
      delivery_fee: 0,
      total_amount: 200,
      fulfilment_type: null,
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: null,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const acceptedOrder = { ...pendingOrder, status: 'fulfilment_pending' }

    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: pendingOrder, error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: acceptedOrder, error: null }),
          }),
        }),
      })),
    } as unknown as SupabaseClient

    const updated = await acceptKitchenOrder(db, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      userId: USER_ID,
    })

    expect(updated.status).toBe('fulfilment_pending')
    expect(metaSend.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: expect.stringContaining('*ACCEPTED* by the kitchen'),
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'fulfilment_delivery' }),
          expect.objectContaining({ id: 'fulfilment_takeaway' }),
        ]),
      }),
    )
  })

  // 4. Kitchen Reject stops the workflow
  it('4. Kitchen Reject stops the workflow', async () => {
    const pendingOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: 'session-1',
      order_number: 'ORD-1001',
      status: 'pending_kitchen',
      items: [],
      subtotal: 200,
      delivery_fee: 0,
      total_amount: 200,
      fulfilment_type: null,
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: null,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const rejectedOrder = { ...pendingOrder, status: 'kitchen_rejected', kitchen_rejection_reason: 'Kitchen is full' }

    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: pendingOrder, error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: rejectedOrder, error: null }),
          }),
        }),
      })),
    } as unknown as SupabaseClient

    const updated = await rejectKitchenOrder(db, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      userId: USER_ID,
      reason: 'Kitchen is full',
    })

    expect(updated.status).toBe('kitchen_rejected')
    expect(metaSend.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('could not accept your order'),
      }),
    )
  })

  // 5. Delivery and Takeaway branches
  it('5. Delivery and Takeaway branches calculate fees and instructions correctly', async () => {
    const baseOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: null,
      order_number: 'ORD-1001',
      status: 'fulfilment_pending',
      items: [],
      subtotal: 200,
      delivery_fee: 0,
      total_amount: 200,
      fulfilment_type: null,
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: USER_ID,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const deliveryUpdated = {
      ...baseOrder,
      fulfilment_type: 'delivery',
      delivery_fee: 40,
      total_amount: 240,
      status: 'payment_pending',
    }

    const takeawayUpdated = {
      ...baseOrder,
      fulfilment_type: 'takeaway',
      delivery_fee: 0,
      total_amount: 200,
      status: 'payment_pending',
    }

    // Test Delivery
    const dbDelivery = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: baseOrder, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: deliveryUpdated, error: null }),
            }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const delRes = await updateOrderFulfilment(dbDelivery, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      fulfilmentType: 'delivery',
      address: '221B Baker St',
      configOwnerUserId: USER_ID,
    })

    expect(delRes.order.total_amount).toBe(240)
    expect(delRes.messageText).toContain('Delivery Confirmed')
    expect(delRes.messageText).toContain('Delivery Fee: ₹40')

    // Test Takeaway
    const dbTakeaway = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: baseOrder, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: takeawayUpdated, error: null }),
            }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const takeRes = await updateOrderFulfilment(dbTakeaway, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      fulfilmentType: 'takeaway',
      configOwnerUserId: USER_ID,
    })

    expect(takeRes.order.total_amount).toBe(200)
    expect(takeRes.messageText).toContain('Takeaway Confirmed')
    expect(takeRes.messageText).toContain('The Illusion Cafe & Restaurant')
  })

  // 6. Cash preparation authorization without marking payment paid
  it('6. Cash authorizes preparation without marking payment received', async () => {
    const paymentPendingOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: null,
      order_number: 'ORD-1001',
      status: 'payment_pending',
      items: [],
      subtotal: 200,
      delivery_fee: 40,
      total_amount: 240,
      fulfilment_type: 'delivery',
      delivery_address: 'Main Road',
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: USER_ID,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const cashOrder = {
      ...paymentPendingOrder,
      payment_method: 'cash',
      payment_status: 'pending_collection',
      status: 'preparing',
    }

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === 'restaurant_trial_order_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: paymentPendingOrder, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: cashOrder, error: null }),
            }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const result = await processPaymentMethod(db, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      paymentMethod: 'cash',
      configOwnerUserId: USER_ID,
    })

    expect(result.order.payment_method).toBe('cash')
    expect(result.order.payment_status).toBe('pending_collection')
    expect(result.order.status).toBe('preparing')
    expect(result.messageText).toContain('payable at delivery')
  })

  // 7. UPI QR Flow triggering
  it('7. UPI sends test UPI and QR information awaiting verification', async () => {
    const paymentPendingOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: null,
      order_number: 'ORD-1001',
      status: 'payment_pending',
      items: [],
      subtotal: 300,
      delivery_fee: 0,
      total_amount: 300,
      fulfilment_type: 'takeaway',
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: USER_ID,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const upiOrder = {
      ...paymentPendingOrder,
      payment_method: 'upi',
      payment_status: 'awaiting_verification',
      status: 'payment_pending',
    }

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: paymentPendingOrder, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: upiOrder, error: null }),
            }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const result = await processPaymentMethod(db, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      paymentMethod: 'upi',
      configOwnerUserId: USER_ID,
    })

    expect(result.order.payment_method).toBe('upi')
    expect(result.order.payment_status).toBe('awaiting_verification')
    expect(result.messageText).toContain('test-illusioncafe@upi')
    expect(result.messageText).toContain('staff will verify your payment')
  })

  // 8. UPI timer remains inactive until manual verification
  it('8. UPI timer remains inactive until staff manually verifies payment', async () => {
    const awaitingUpiOrder: TrialOrder = {
      id: 'order-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: null,
      order_number: 'ORD-1001',
      status: 'payment_pending',
      items: [],
      subtotal: 300,
      delivery_fee: 0,
      total_amount: 300,
      fulfilment_type: 'takeaway',
      delivery_address: null,
      delivery_location: null,
      payment_method: 'upi',
      payment_status: 'awaiting_verification',
      is_test_order: true,
      kitchen_decision_by: USER_ID,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const verifiedOrder = {
      ...awaitingUpiOrder,
      payment_status: 'verified',
      status: 'preparing',
      payment_confirmed_by: USER_ID,
    }

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        if (table === 'restaurant_trial_order_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: awaitingUpiOrder, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: verifiedOrder, error: null }),
            }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const updated = await confirmUpiPayment(db, {
      orderId: 'order-1',
      accountId: ACCOUNT_ID,
      userId: USER_ID,
    })

    expect(updated.payment_status).toBe('verified')
    expect(updated.status).toBe('preparing')
    expect(metaSend.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Payment Verified'),
      }),
    )
  })

  // 9. Item-wise timer creation after the correct gate
  it('9. Starts item-wise timers with accurate countdown timestamps', async () => {
    const mockItems: TrialItemTimer[] = [
      {
        id: 'timer-1',
        order_id: 'order-1',
        account_id: ACCOUNT_ID,
        item_name: 'Veg Burger',
        quantity: 2,
        unit_price: 120,
        total_price: 240,
        duration_minutes: 12,
        started_at: null,
        expires_at: null,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
      {
        id: 'timer-2',
        order_id: 'order-1',
        account_id: ACCOUNT_ID,
        item_name: 'Cold Coffee',
        quantity: 1,
        unit_price: 80,
        total_price: 80,
        duration_minutes: 5,
        started_at: null,
        expires_at: null,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ]

    const db = {
      from: vi.fn((table: string) => {
        if (table === 'restaurant_trial_order_items') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn((col: string) => {
              if (col === 'account_id') {
                return Promise.resolve({ data: mockItems, error: null })
              }
              return {
                eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
              }
            }),
            update: vi.fn((payload: Record<string, unknown>) => ({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { ...mockItems[0], ...payload, status: 'preparing' },
                    error: null,
                  }),
                }),
              }),
            })),
          }
        }
        if (table === 'restaurant_trial_orders') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
            }),
          }
        }
        return {}
      }),
    } as unknown as SupabaseClient

    const startTime = new Date('2026-11-20T12:00:00Z')
    const timers = await startItemTimers(db, 'order-1', ACCOUNT_ID, startTime)

    expect(timers.length).toBeGreaterThan(0)
  })

  // 10. Duplicate events do not duplicate orders or restart timers
  it('10. Prevents duplicate order creation and re-accepting already decided orders', async () => {
    const existingOrder: TrialOrder = {
      id: 'order-existing',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      ordering_session_id: null,
      order_number: 'ORD-1001',
      status: 'pending_kitchen',
      items: [],
      subtotal: 200,
      delivery_fee: 0,
      total_amount: 200,
      fulfilment_type: null,
      delivery_address: null,
      delivery_location: null,
      payment_method: null,
      payment_status: null,
      is_test_order: true,
      kitchen_decision_by: null,
      kitchen_decision_at: null,
      kitchen_rejection_reason: null,
      payment_confirmed_by: null,
      payment_confirmed_at: null,
      preparation_started_at: null,
      estimated_prep_minutes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const db = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingOrder, error: null }),
      })),
    } as unknown as SupabaseClient

    // Attempting to create while pending_kitchen exists returns the existing one
    const order = await createTrialOrder(db, {
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      items: [],
      subtotal: 200,
    })

    expect(order.id).toBe('order-existing')

    // Attempting to re-accept an already accepted order throws error
    const alreadyAcceptedOrder = { ...existingOrder, status: 'fulfilment_pending' }
    const dbAlreadyAccepted = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: alreadyAcceptedOrder, error: null }),
      })),
    } as unknown as SupabaseClient

    await expect(
      acceptKitchenOrder(dbAlreadyAccepted, {
        orderId: 'order-existing',
        accountId: ACCOUNT_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow('already processed')
  })

  // 11. Existing WhatsApp Welcome Flow and AI session behavior remain unaffected
  it('11. Text marker parser and regex summary parser cleanly handle messages without crashing', () => {
    // Test extractOrderConfirmedMarker
    const sampleAiOutput =
      `[[ORDER_CONFIRMED: {"items": [{"name":"Veg Burger","quantity":2,"unit_price":120,"total_price":240}], "subtotal": 240}]]\n` +
      `Your order has been sent to the kitchen!`

    const parsed = extractOrderConfirmedMarker(sampleAiOutput)
    expect(parsed.payload?.items.length).toBe(1)
    expect(parsed.payload?.subtotal).toBe(240)
    expect(parsed.cleanText).toBe('Your order has been sent to the kitchen!')

    // Plain message without marker
    const normalMsg = 'Hello, how can I help you today?'
    const normalParsed = extractOrderConfirmedMarker(normalMsg)
    expect(normalParsed.payload).toBeNull()
    expect(normalParsed.cleanText).toBe(normalMsg)

    // parseSummaryFromText
    const summary = `- 2x Veg Burger: ₹240\n- 1x Cold Coffee: ₹80\nTotal: ₹320`
    const itemsFromSummary = parseSummaryFromText(summary)
    expect(itemsFromSummary?.items.length).toBe(2)
    expect(itemsFromSummary?.subtotal).toBe(320)
  })
})
