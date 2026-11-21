import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createDraftCartFromParsedItems,
  mergeItemsIntoDraftCart,
  removeItemFromDraftCart,
  saveDraftCart,
  getActiveDraftCart,
  markDraftCartConfirmed,
  cancelDraftCart,
  formatDraftCartSummary,
  convertDraftCartToTrialOrderItems,
  resetAllMemoryDraftCarts,
} from './draft-cart'
import { findCatalogItem } from './menu-catalog'
import { parseCustomerOrder } from './order-parser'

function createMockDb(initialData: unknown = null) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn().mockReturnValue(query)
  query.eq = vi.fn().mockReturnValue(query)
  query.order = vi.fn().mockReturnValue(query)
  query.limit = vi.fn().mockReturnValue(query)
  query.maybeSingle = vi.fn().mockResolvedValue({ data: initialData, error: null })
  query.single = vi.fn().mockResolvedValue({ data: initialData, error: null })
  query.insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: initialData, error: null }),
    }),
  })
  query.update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue(query),
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: initialData, error: null }),
    }),
  })
  return {
    from: vi.fn().mockReturnValue(query),
  } as unknown as SupabaseClient
}

describe('Restaurant Draft Cart Management', () => {
  const ACCOUNT_ID = 'test-acct-1'
  const CONTACT_ID = 'test-contact-1'

  beforeEach(() => {
    resetAllMemoryDraftCarts()
    vi.clearAllMocks()
  })

  it('creates draft cart from parsed order items and computes correct subtotal', () => {
    const parsed = parseCustomerOrder('Chicken malai box 2 aur malai kabab 2, 4 cold coffee, malai chicken pizza 2 kardo')
    expect(parsed).not.toBeNull()
    expect(parsed?.items.length).toBe(4)

    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: parsed!.items,
    })

    expect(cart.accountId).toBe(ACCOUNT_ID)
    expect(cart.contactId).toBe(CONTACT_ID)
    expect(cart.items).toHaveLength(4)
    expect(cart.subtotal).toBe(1330)
    expect(cart.status).toBe('active')
  })

  it('merges new items into existing cart and increments quantity for duplicates', () => {
    const initial = parseCustomerOrder('1 Chicken Pizza aur 2 Cold Coffee')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: initial.items,
    })
    expect(cart.subtotal).toBe(347)

    // Add another Cold Coffee
    const addition = parseCustomerOrder('aur 1 cold coffee add kardo')!
    const updated = mergeItemsIntoDraftCart(cart, addition.items)

    expect(updated.items).toHaveLength(2)
    const coffeeItem = updated.items.find((i) => i.itemId === 'cold-coffee-200ml')
    expect(coffeeItem?.quantity).toBe(3)
    expect(coffeeItem?.totalPrice).toBe(297) // 3 * 99
    expect(updated.subtotal).toBe(446) // 149 + 297
  })

  it('removes item from cart and recalculates subtotal', () => {
    const initial = parseCustomerOrder('1 Chicken Pizza aur 2 Cold Coffee')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: initial.items,
    })

    const coffeeCatalogItem = findCatalogItem('cold coffee')!
    const updated = removeItemFromDraftCart(cart, coffeeCatalogItem)

    expect(updated.items).toHaveLength(1)
    expect(updated.items[0].itemId).toBe('chicken-pizza-7inch')
    expect(updated.subtotal).toBe(149)
  })

  it('saves and retrieves active draft cart using in-memory fallback when DB table does not exist', async () => {
    // DB returns error simulating unmigrated table
    const failingDb = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockRejectedValue(new Error('relation does not exist')),
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockRejectedValue(new Error('relation does not exist')),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const initial = parseCustomerOrder('Ek chicken pizza aur 2 cold coffee')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: initial.items,
    })

    // Should not throw, saves to memory fallback
    await saveDraftCart(failingDb, cart)

    // Should retrieve from memory fallback
    const retrieved = await getActiveDraftCart(failingDb, ACCOUNT_ID, CONTACT_ID)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.subtotal).toBe(347)
    expect(retrieved?.items).toHaveLength(2)
  })

  it('marks draft cart confirmed and clears active cart', async () => {
    const mockDb = createMockDb()
    const initial = parseCustomerOrder('1 Cold Coffee')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: initial.items,
    })

    await saveDraftCart(mockDb, cart)
    await markDraftCartConfirmed(mockDb, ACCOUNT_ID, CONTACT_ID)

    const retrieved = await getActiveDraftCart(mockDb, ACCOUNT_ID, CONTACT_ID)
    expect(retrieved).toBeNull()
  })

  it('cancels active draft cart', async () => {
    const mockDb = createMockDb()
    const initial = parseCustomerOrder('1 Cold Coffee')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: initial.items,
    })

    await saveDraftCart(mockDb, cart)
    await cancelDraftCart(mockDb, ACCOUNT_ID, CONTACT_ID)

    const retrieved = await getActiveDraftCart(mockDb, ACCOUNT_ID, CONTACT_ID)
    expect(retrieved).toBeNull()
  })

  it('formats draft cart summary into exact official WhatsApp message with menu options', () => {
    const parsed = parseCustomerOrder('Chicken malai box 2 aur malai kabab 2, 4 cold coffee, malai chicken pizza 2 kardo')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: parsed.items,
    })

    const summary = formatDraftCartSummary(cart)
    expect(summary).toContain('ILLUSION CAFE & RESTAURANT')
    expect(summary).toContain('2 × Chicken Malai Box [4 Pc]')
    expect(summary).toContain('Food Subtotal: ₹1,330')
    expect(summary).toContain('1️⃣ Confirm Details')
    expect(summary).toContain('2️⃣ Add More Items')
    expect(summary).toContain('3️⃣ Remove an Item')
    expect(summary).toContain('4️⃣ Cancel Enquiry')
  })

  it('converts draft cart items to TrialOrderItem format for order creation', () => {
    const parsed = parseCustomerOrder('1 Chicken Pizza aur 2 Cold Coffee')!
    const cart = createDraftCartFromParsedItems({
      accountId: ACCOUNT_ID,
      contactId: CONTACT_ID,
      parsedItems: parsed.items,
    })

    const trialItems = convertDraftCartToTrialOrderItems(cart)
    expect(trialItems).toHaveLength(2)
    expect(trialItems[0]).toEqual({
      name: 'Chicken Pizza [7-inch]',
      quantity: 1,
      unit_price: 149,
      total_price: 149,
    })
    expect(trialItems[1]).toEqual({
      name: 'Cold Coffee [200 ml]',
      quantity: 2,
      unit_price: 99,
      total_price: 198,
    })
  })
})
