import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  handleRestaurantTrialInbound,
  isOrderConfirmationPhrase,
  parseSummaryFromText,
} from './webhook-handler'

// Mock meta-send so no actual network calls happen
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: vi.fn().mockResolvedValue({ id: 'mock-wamid-text' }),
  engineSendInteractiveButtons: vi.fn().mockResolvedValue({ id: 'mock-wamid-buttons' }),
}))

function createChainedMock(defaultData: unknown = null) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn().mockReturnValue(query)
  query.eq = vi.fn().mockReturnValue(query)
  query.neq = vi.fn().mockReturnValue(query)
  query.in = vi.fn().mockReturnValue(query)
  query.not = vi.fn().mockReturnValue(query)
  query.order = vi.fn().mockReturnValue(query)
  query.limit = vi.fn().mockReturnValue(query)
  query.maybeSingle = vi.fn().mockResolvedValue({ data: defaultData, error: null })
  query.single = vi.fn().mockResolvedValue({ data: defaultData, error: null })
  query.insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: defaultData, error: null }),
    }),
  })
  query.update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(query),
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: defaultData, error: null }),
    }),
  })
  return query
}

describe('Restaurant Order Trial Webhook Handler & Real-World Integrations', () => {
  const ACCOUNT_ID = '546951d0-df9d-438e-a94d-532b7ff89308'
  const CONTACT_ID = 'contact-cust-123'
  const CONVERSATION_ID = 'conv-test-456'
  const USER_ID = 'user-owner-789'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Bug 2: Order confirmation phrases', () => {
    it('recognizes option 1 from summary menus and various confirmation expressions', () => {
      // Option 1
      expect(isOrderConfirmationPhrase('1')).toBe(true)
      expect(isOrderConfirmationPhrase('1.')).toBe(true)
      expect(isOrderConfirmationPhrase('1. Confirm Details')).toBe(true)
      expect(isOrderConfirmationPhrase('1 confirm')).toBe(true)
      expect(isOrderConfirmationPhrase('1. confirm')).toBe(true)

      // Standard English
      expect(isOrderConfirmationPhrase('confirm')).toBe(true)
      expect(isOrderConfirmationPhrase('confirm order')).toBe(true)
      expect(isOrderConfirmationPhrase('confirm details')).toBe(true)
      expect(isOrderConfirmationPhrase('yes confirm')).toBe(true)
      expect(isOrderConfirmationPhrase('yes confirm this')).toBe(true)
      expect(isOrderConfirmationPhrase('confirm this')).toBe(true)
      expect(isOrderConfirmationPhrase('confirm it')).toBe(true)
      expect(isOrderConfirmationPhrase('yes confirm order')).toBe(true)
      expect(isOrderConfirmationPhrase('place order')).toBe(true)
      expect(isOrderConfirmationPhrase('proceed')).toBe(true)

      // Hinglish / Hindi variants
      expect(isOrderConfirmationPhrase('confirm kardo')).toBe(true)
      expect(isOrderConfirmationPhrase('confirm kar do')).toBe(true)
      expect(isOrderConfirmationPhrase('ha confirm')).toBe(true)
      expect(isOrderConfirmationPhrase('haan confirm')).toBe(true)
      expect(isOrderConfirmationPhrase('order confirm kardo')).toBe(true)
      expect(isOrderConfirmationPhrase('ha confirm kar do')).toBe(true)
      expect(isOrderConfirmationPhrase('kardo confirm')).toBe(true)
      expect(isOrderConfirmationPhrase('Order kr de yahi')).toBe(true)
      expect(isOrderConfirmationPhrase('order kardo')).toBe(true)

      // Negative cases: other options or unrelated text
      expect(isOrderConfirmationPhrase('2')).toBe(false)
      expect(isOrderConfirmationPhrase('2. Add More Items')).toBe(false)
      expect(isOrderConfirmationPhrase('3')).toBe(false)
      expect(isOrderConfirmationPhrase('4. Cancel Enquiry')).toBe(false)
      expect(isOrderConfirmationPhrase('cancel')).toBe(false)
      expect(isOrderConfirmationPhrase('menu')).toBe(false)
      expect(isOrderConfirmationPhrase('Hi')).toBe(false)
    })
  })

  describe('Bug 3: Real order parsing and removal of hardcoded fallback', () => {
    it('parses multi-line two-row summaries from AI agent (item on line 1, price on line 2)', () => {
      const summaryText =
        `🍽️ ILLUSION CAFE & RESTAURANT\n\n` +
        `📜 Your Order Summary\n\n` +
        `🍕 1 x Chicken Pizza (7-inch)\n` +
        `₹149 x 1 = ₹149\n\n` +
        `☕ 2 x Cold Coffee (200 ml)\n` +
        `₹99 x 2 = ₹198\n\n` +
        `💰 Food Subtotal: ₹347\n` +
        `🚚 Delivery Charge: FREE (₹300+)\n\n` +
        `💳 Estimated Total: ₹347\n\n` +
        `😋 What's Next?\n\n` +
        `Would you like to confirm these details, add/remove items, or cancel?\n\n` +
        `1️⃣ Confirm Details\n` +
        `2️⃣ Add More Items\n` +
        `3️⃣ Remove an Item\n` +
        `4️⃣ Cancel Enquiry\n\n` +
        `👉 Also, is this for Delivery or Takeaway?`

      const parsed = parseSummaryFromText(summaryText)
      expect(parsed).not.toBeNull()
      expect(parsed?.items).toHaveLength(2)
      expect(parsed?.subtotal).toBe(347)
      expect(parsed?.items[0]).toEqual({
        name: 'Chicken Pizza (7-inch)',
        quantity: 1,
        unit_price: 149,
        total_price: 149,
      })
      expect(parsed?.items[1]).toEqual({
        name: 'Cold Coffee (200 ml)',
        quantity: 2,
        unit_price: 99,
        total_price: 198,
      })
    })

    it('parses real Illusion Cafe order summaries with multiple quantities and prices', () => {
      const summaryText =
        `Here is your order summary:\n` +
        `1. Chicken Malai Box (4 pieces) - ₹119\n` +
        `2. Malai Kabab (4 pieces) - ₹199\n` +
        `3. Cold Coffee (4) - ₹396\n` +
        `4. Malai Chicken Pizza (2) - ₹298\n` +
        `Total: ₹1012\n\n` +
        `Please choose an option below:\n` +
        `1. Confirm Details\n` +
        `2. Add More Items\n` +
        `3. Remove an Item\n` +
        `4. Cancel Enquiry`

      const parsed = parseSummaryFromText(summaryText)
      expect(parsed).not.toBeNull()
      expect(parsed?.items.length).toBe(4)
      expect(parsed?.subtotal).toBe(1012)

      expect(parsed?.items[0]).toEqual({
        name: 'Chicken Malai Box (4 pieces)',
        quantity: 1,
        unit_price: 119,
        total_price: 119,
      })
      expect(parsed?.items[1]).toEqual({
        name: 'Malai Kabab (4 pieces)',
        quantity: 1,
        unit_price: 199,
        total_price: 199,
      })
      expect(parsed?.items[2]).toEqual({
        name: 'Cold Coffee',
        quantity: 4,
        unit_price: 99,
        total_price: 396,
      })
      expect(parsed?.items[3]).toEqual({
        name: 'Malai Chicken Pizza',
        quantity: 2,
        unit_price: 149,
        total_price: 298,
      })
    })

    it('parses emoji and bullet formatted summaries', () => {
      const summaryText =
        `*Order Details:*\n` +
        `• 1x Margherita Pizza - ₹250\n` +
        `• 2x Cold Coffee - ₹160\n` +
        `*Subtotal: ₹410*\n\n` +
        `Reply 1 to confirm`

      const parsed = parseSummaryFromText(summaryText)
      expect(parsed).not.toBeNull()
      expect(parsed?.items.length).toBe(2)
      expect(parsed?.subtotal).toBe(410)
    })

    it('returns null when no food items are in the message, avoiding dummy order creation', () => {
      const nonOrderText =
        `✨ Welcome to *Illusion Cafe & Restaurant*! 🍽️\n\n` +
        `How can we help you today?\n` +
        `1. View Menu\n` +
        `2. Submit Review`

      const parsed = parseSummaryFromText(nonOrderText)
      expect(parsed).toBeNull()
    })

    it('requests clarification and does NOT create a dummy Veg Burger order when summary is unparseable', async () => {
      const db = {
        from: vi.fn((table: string) => {
          if (table === 'restaurant_trial_orders') {
            return createChainedMock(null)
          }
          if (table === 'messages') {
            const query = createChainedMock()
            query.limit = vi.fn().mockResolvedValue({
              data: [
                {
                  content_text:
                    'Your Order Summary:\nSomething went wrong with menu\nConfirm Details (1)',
                },
              ],
              error: null,
            })
            return query
          }
          return createChainedMock(null)
        }),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-1', type: 'text' },
        inboundText: '1. Confirm Details',
        interactiveReplyId: null,
      })

      // Handled with clarification message, without creating order
      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("couldn't confirm the exact items"),
        }),
      )
    })

    it('returns handled: false when inbound is just a generic yes/1 with no prior order summary in conversation', async () => {
      const db = {
        from: vi.fn((table: string) => {
          if (table === 'restaurant_trial_orders') {
            return createChainedMock(null)
          }
          if (table === 'messages') {
            const query = createChainedMock()
            query.limit = vi.fn().mockResolvedValue({
              data: [{ content_text: 'Welcome to our store! We are open 9am to 10pm.' }],
              error: null,
            })
            return query
          }
          return createChainedMock(null)
        }),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-2', type: 'text' },
        inboundText: '1',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(false)
    })
  })

  describe('Bug 5: WhatsApp location processing', () => {
    it('processes native WhatsApp location pin payload and updates delivery address and coordinates', async () => {
      const pendingOrder = {
        id: 'order-101',
        account_id: ACCOUNT_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONVERSATION_ID,
        order_number: 'ORD-101',
        status: 'fulfilment_pending',
        subtotal: 350,
        delivery_fee: 0,
        total_amount: 350,
      }

      const updatedOrder = {
        ...pendingOrder,
        fulfilment_type: 'delivery',
        delivery_address: 'Ummed Sagar Circle, Shahpura',
        delivery_location: { latitude: 25.6124, longitude: 74.9117 },
        status: 'payment_pending',
      }

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'restaurant_trial_settings') {
            return createChainedMock({
              account_id: ACCOUNT_ID,
              delivery_fee: 20,
              restaurant_address: 'Station Road',
              pickup_instructions: 'Counter pickup',
            })
          }
          if (table === 'restaurant_trial_orders') {
            const query = createChainedMock(pendingOrder)
            query.update = vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(query),
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updatedOrder, error: null }),
              }),
            })
            return query
          }
          return createChainedMock(null)
        }),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: {
          id: 'msg-loc-1',
          type: 'location',
          location: {
            latitude: 25.612469,
            longitude: 74.911735,
            name: 'Ummed Sagar Circle',
            address: 'Shahpura, 311404',
          },
        },
        inboundText: '',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
    })

    it('processes GPS coordinates sent as text in delivery stage', async () => {
      const pendingOrder = {
        id: 'order-102',
        account_id: ACCOUNT_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONVERSATION_ID,
        order_number: 'ORD-102',
        status: 'fulfilment_pending',
        subtotal: 200,
        delivery_fee: 20,
        total_amount: 220,
      }

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'restaurant_trial_settings') {
            return createChainedMock({
              account_id: ACCOUNT_ID,
              delivery_fee: 20,
              restaurant_address: 'Station Road',
              pickup_instructions: 'Counter pickup',
            })
          }
          if (table === 'restaurant_trial_orders') {
            const query = createChainedMock(pendingOrder)
            query.update = vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(query),
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: pendingOrder, error: null }),
              }),
            })
            return query
          }
          return createChainedMock(null)
        }),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-txt-loc', type: 'text' },
        inboundText: 'Ummed Sagar Rd, Shahpura - 25.612469, 74.911735',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
    })
  })

  describe('Bug 6: Pending kitchen status gate prevents AI from skipping kitchen approval', () => {
    it('returns handled and sends reminder while order is pending_kitchen', async () => {
      const pendingOrder = {
        id: 'order-103',
        account_id: ACCOUNT_ID,
        contact_id: CONTACT_ID,
        conversation_id: CONVERSATION_ID,
        order_number: 'ORD-103',
        status: 'pending_kitchen',
        subtotal: 300,
        delivery_fee: 0,
        total_amount: 300,
      }

      const db = {
        from: vi.fn(() => createChainedMock(pendingOrder)),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-cust-status', type: 'text' },
        inboundText: 'Where is my order?',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('awaiting kitchen confirmation'),
        }),
      )
    })
  })

  describe('Deterministic Order Placement & Cart Actions', () => {
    it('intercepts multi-item Hinglish food order and deterministically replies with accurate summary', async () => {
      const db = {
        from: vi.fn((table: string) => {
          if (table === 'restaurant_trial_orders') {
            return createChainedMock(null)
          }
          if (table === 'messages') {
            const query = createChainedMock()
            query.limit = vi.fn().mockResolvedValue({ data: [], error: null })
            return query
          }
          return createChainedMock(null)
        }),
      } as unknown as SupabaseClient

      const inboundText = 'Chicken malai box 2 aur malai kabab 2, 4 cold coffee, malai chicken pizza 2 kardo'

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-order-1', type: 'text' },
        inboundText,
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Food Subtotal: ₹1,330'),
        }),
      )
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Chicken Malai Box [4 Pc]'),
        }),
      )
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Malai Kabab [4pc]'),
        }),
      )
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Cold Coffee'),
        }),
      )
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Malai Chicken Pizza'),
        }),
      )
    })

    it('intercepts mandatory test 2: "Ek chicken pizza aur 2 cold coffee"', async () => {
      const db = {
        from: vi.fn(() => createChainedMock(null)),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-order-2', type: 'text' },
        inboundText: 'Ek chicken pizza aur 2 cold coffee',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Food Subtotal: ₹347'),
        }),
      )
    })

    it('handles Option 2 (Add More Items)', async () => {
      const db = {
        from: vi.fn(() => createChainedMock(null)),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-opt-2', type: 'text' },
        inboundText: '2. Add More Items',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Add Items to Order'),
        }),
      )
    })

    it('handles Option 3 (Remove an Item)', async () => {
      const db = {
        from: vi.fn(() => createChainedMock(null)),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-opt-3', type: 'text' },
        inboundText: '3',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Remove an Item'),
        }),
      )
    })

    it('handles Option 4 (Cancel Enquiry)', async () => {
      const db = {
        from: vi.fn(() => createChainedMock(null)),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-opt-4', type: 'text' },
        inboundText: '4. Cancel Enquiry',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Order Enquiry Cancelled'),
        }),
      )
    })

    it('modifies previous cart when removing an item', async () => {
      const previousSummary =
        `🍽️ ILLUSION CAFE & RESTAURANT\n\n` +
        `📜 Your Order Summary\n\n` +
        `🍕 1 x Chicken Pizza (7-inch)\n` +
        `₹149 x 1 = ₹149\n\n` +
        `☕ 2 x Cold Coffee (200 ml)\n` +
        `₹99 x 2 = ₹198\n\n` +
        `💰 Food Subtotal: ₹347\n` +
        `🚚 Delivery Charge: FREE (₹300+)\n\n` +
        `💳 Estimated Total: ₹347\n`

      const db = {
        from: vi.fn((table: string) => {
          if (table === 'restaurant_trial_orders') {
            return createChainedMock(null)
          }
          if (table === 'messages') {
            const query = createChainedMock()
            query.limit = vi.fn().mockResolvedValue({
              data: [{ content_text: previousSummary }],
              error: null,
            })
            return query
          }
          return createChainedMock(null)
        }),
      } as unknown as SupabaseClient

      const result = await handleRestaurantTrialInbound({
        db,
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        configOwnerUserId: USER_ID,
        message: { id: 'msg-mod-1', type: 'text' },
        inboundText: 'cold coffee remove kardo',
        interactiveReplyId: null,
      })

      expect(result.handled).toBe(true)
      const { engineSendText } = await import('@/lib/flows/meta-send')
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Food Subtotal: ₹149'),
        }),
      )
      expect(engineSendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Chicken Pizza [7-inch]'),
        }),
      )
    })
  })
})
