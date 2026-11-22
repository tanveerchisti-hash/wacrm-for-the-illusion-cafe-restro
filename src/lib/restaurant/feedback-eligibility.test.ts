/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  validateRestaurantFeedbackEligibility,
  revalidateRestaurantFeedbackEligibility,
  updateFeedbackLedgerStatus,
  hasMatchingTag,
  OPT_OUT_TAGS,
  STAFF_TAGS,
} from './feedback-eligibility'
import * as whatsappSender from '@/lib/backend-flows/engine/whatsapp-sender'

vi.mock('@/lib/backend-flows/engine/whatsapp-sender', () => ({
  checkConversationWindow: vi.fn(),
  validateTemplateApproved: vi.fn(),
}))

describe('Restaurant Feedback Eligibility Adapter (feedback-eligibility.ts)', () => {
  const mockOrder = {
    id: 'ord-fb-1',
    account_id: 'acc-fb-1',
    order_number: '101',
    status: 'completed',
    contact_id: 'cnt-fb-1',
    conversation_id: 'conv-fb-1',
    is_test_order: false,
  }

  const mockContact = {
    id: 'cnt-fb-1',
    account_id: 'acc-fb-1',
    name: 'Tanveer Customer',
    phone: '+919876543210',
    tags: ['loyal_customer'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND
    vi.mocked(whatsappSender.checkConversationWindow).mockResolvedValue({
      isOpen: true,
      hoursSince: 2,
      lastInboundAt: new Date().toISOString(),
    })
    vi.mocked(whatsappSender.validateTemplateApproved).mockResolvedValue({
      approved: true,
    })
  })

  it('validates tag matching helper for opt-out and staff tags', () => {
    expect(hasMatchingTag(['vip', 'DND'], OPT_OUT_TAGS)).toBe(true)
    expect(hasMatchingTag(['opt_out'], OPT_OUT_TAGS)).toBe(true)
    expect(hasMatchingTag(['STAFF'], STAFF_TAGS)).toBe(true)
    expect(hasMatchingTag(['dining', 'takeaway'], OPT_OUT_TAGS)).toBe(false)
    expect(hasMatchingTag(null, OPT_OUT_TAGS)).toBe(false)
  })

  it('validates a fully eligible completed order successfully', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockContact, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'restaurant_feedback_dispatch_ledger') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'ledg-1' }, error: null }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await validateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(true)
    expect(res.customerPhone).toBe('+919876543210')
    expect(res.customerName).toBe('Tanveer Customer')
  })

  it('rejects an order that is not in completed status (e.g. preparing)', async () => {
    const preparingOrder = { ...mockOrder, status: 'preparing' }
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: preparingOrder, error: null }),
            }),
          }),
        }),
      }),
    }

    const res = await validateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.skipped).toBe(true)
    expect(res.code).toBe('ORDER_NOT_COMPLETED')
  })

  it('rejects and safely skips customer who has opted out (DND tag)', async () => {
    const optedOutContact = { ...mockContact, tags: ['dnd', 'loyal'] }
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: optedOutContact, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await validateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.skipped).toBe(true)
    expect(res.shouldRetry).toBe(false)
    expect(res.code).toBe('CUSTOMER_OPTED_OUT')
  })

  it('excludes staff members from receiving customer feedback requests', async () => {
    const staffContact = { ...mockContact, tags: ['staff', 'chef'] }
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: staffContact, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await validateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.skipped).toBe(true)
    expect(res.code).toBe('STAFF_RECIPIENT_EXCLUDED')
  })

  it('suppresses production feedback for test orders when live send is enabled', async () => {
    process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND = 'true'
    const testOrder = { ...mockOrder, is_test_order: true }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: testOrder, error: null }),
            }),
          }),
        }),
      }),
    }

    const res = await validateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.skipped).toBe(true)
    expect(res.code).toBe('TEST_ORDER_SKIPPED')
  })

  it('prevents duplicate feedback when ledger already records a previous initiation or send', async () => {
    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockContact, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'restaurant_feedback_dispatch_ledger') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 'ledg-1', status: 'submitted_to_meta' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await validateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.skipped).toBe(true)
    expect(res.code).toBe('FEEDBACK_ALREADY_INITIATED')
  })

  it('pre-send revalidation cancels send if order was cancelled during the 20-minute delay', async () => {
    const cancelledOrder = { ...mockOrder, status: 'cancelled' }
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    })

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: cancelledOrder, error: null }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'restaurant_feedback_dispatch_ledger') {
          return {
            update: mockUpdate,
          }
        }
        return {}
      }),
    }

    const res = await revalidateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.code).toBe('ORDER_STATUS_CHANGED')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
      })
    )
  })

  it('pre-send revalidation verifies template approval if 24-hour customer window is closed', async () => {
    vi.mocked(whatsappSender.checkConversationWindow).mockResolvedValueOnce({
      isOpen: false,
      hoursSince: 28,
      lastInboundAt: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
    })
    vi.mocked(whatsappSender.validateTemplateApproved).mockResolvedValueOnce({
      approved: false,
      reason: 'Template not approved in account',
    })

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === 'contacts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockContact, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'restaurant_feedback_dispatch_ledger') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                  }),
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const res = await revalidateRestaurantFeedbackEligibility({
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      supabase: mockSupabase as any,
    })

    expect(res.eligible).toBe(false)
    expect(res.code).toBe('TEMPLATE_UNAVAILABLE_OUTSIDE_WINDOW')
  })

  it('updates ledger status and order status upon submission and delivery', async () => {
    const mockOrderUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
    const mockLedgerUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    })

    const mockSupabase = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_feedback_dispatch_ledger') {
          return { update: mockLedgerUpdate }
        }
        if (table === 'restaurant_trial_orders') {
          return { update: mockOrderUpdate }
        }
        return {}
      }),
    }

    await updateFeedbackLedgerStatus(mockSupabase as any, {
      accountId: 'acc-fb-1',
      orderId: 'ord-fb-1',
      status: 'submitted_to_meta',
      whatsappMessageId: 'wamid-12345',
      templateName: 'customer_feedback',
    })

    expect(mockLedgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'submitted_to_meta',
        whatsapp_message_id: 'wamid-12345',
      })
    )
    expect(mockOrderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback_status: 'submitted',
      })
    )
  })
})
