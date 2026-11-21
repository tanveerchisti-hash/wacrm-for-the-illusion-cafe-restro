import type { SupabaseClient } from '@supabase/supabase-js'
import type { MenuItem } from './menu-catalog'
import type { ParsedOrderItem } from './order-parser'
import type { TrialOrderItem } from './order-trial'

export interface DraftCartItem {
  itemId: string
  name: string
  category: string
  portion?: string
  emoji?: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface DraftCart {
  id?: string
  accountId: string
  contactId: string
  conversationId?: string | null
  orderingSessionId?: string | null
  items: DraftCartItem[]
  subtotal: number
  status: 'active' | 'confirmed' | 'cancelled'
  createdAt?: string
  updatedAt?: string
}

/**
 * Resilient in-process memory store for draft carts.
 * Ensures carts persist across messages during the lifetime of the process/session
 * even if the database table has not yet been migrated.
 * Keyed by `${accountId}:${contactId}`.
 */
const memoryDraftCarts = new Map<string, DraftCart>()

export function getMemoryCartKey(accountId: string, contactId: string): string {
  return `${accountId}:${contactId}`
}

export function clearMemoryDraftCart(accountId: string, contactId: string): void {
  memoryDraftCarts.delete(getMemoryCartKey(accountId, contactId))
}

export function resetAllMemoryDraftCarts(): void {
  memoryDraftCarts.clear()
}

/**
 * Create a new DraftCart from parsed order items.
 */
export function createDraftCartFromParsedItems(args: {
  accountId: string
  contactId: string
  conversationId?: string | null
  orderingSessionId?: string | null
  parsedItems: ParsedOrderItem[]
}): DraftCart {
  const items: DraftCartItem[] = args.parsedItems.map((pi) => ({
    itemId: pi.item.id,
    name: pi.item.name,
    category: pi.item.category,
    portion: pi.item.portion,
    emoji: pi.item.emoji,
    quantity: pi.quantity,
    unitPrice: pi.unitPrice,
    totalPrice: pi.totalPrice,
  }))

  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0)

  return {
    accountId: args.accountId,
    contactId: args.contactId,
    conversationId: args.conversationId ?? null,
    orderingSessionId: args.orderingSessionId ?? null,
    items,
    subtotal,
    status: 'active',
  }
}

/**
 * Merge newly parsed items into an existing draft cart.
 * If an item is already present, increments quantity; otherwise appends it.
 */
export function mergeItemsIntoDraftCart(
  existingCart: DraftCart,
  newParsedItems: ParsedOrderItem[],
): DraftCart {
  const updatedItems: DraftCartItem[] = existingCart.items.map((i) => ({ ...i }))

  for (const pi of newParsedItems) {
    const existingIndex = updatedItems.findIndex(
      (item) => item.itemId === pi.item.id || item.name.toLowerCase() === pi.item.name.toLowerCase(),
    )

    if (existingIndex >= 0) {
      const existing = updatedItems[existingIndex]
      const newQty = existing.quantity + pi.quantity
      updatedItems[existingIndex] = {
        ...existing,
        quantity: newQty,
        totalPrice: newQty * existing.unitPrice,
      }
    } else {
      updatedItems.push({
        itemId: pi.item.id,
        name: pi.item.name,
        category: pi.item.category,
        portion: pi.item.portion,
        emoji: pi.item.emoji,
        quantity: pi.quantity,
        unitPrice: pi.unitPrice,
        totalPrice: pi.totalPrice,
      })
    }
  }

  const subtotal = updatedItems.reduce((sum, item) => sum + item.totalPrice, 0)

  return {
    ...existingCart,
    items: updatedItems,
    subtotal,
    status: 'active',
  }
}

/**
 * Remove an item or reduce its quantity in an existing draft cart.
 */
export function removeItemFromDraftCart(
  existingCart: DraftCart,
  itemToRemove: MenuItem,
  quantityToRemove?: number,
): DraftCart {
  const updatedItems: DraftCartItem[] = []

  for (const item of existingCart.items) {
    const isMatch =
      item.itemId === itemToRemove.id ||
      item.name.toLowerCase() === itemToRemove.name.toLowerCase()

    if (isMatch) {
      if (quantityToRemove && quantityToRemove < item.quantity) {
        const remainingQty = item.quantity - quantityToRemove
        updatedItems.push({
          ...item,
          quantity: remainingQty,
          totalPrice: remainingQty * item.unitPrice,
        })
      }
      // If quantityToRemove is equal or greater, or undefined, item is dropped.
    } else {
      updatedItems.push({ ...item })
    }
  }

  const subtotal = updatedItems.reduce((sum, item) => sum + item.totalPrice, 0)

  return {
    ...existingCart,
    items: updatedItems,
    subtotal,
    status: 'active',
  }
}

/**
 * Save draft cart to database with in-memory resilient fallback.
 */
export async function saveDraftCart(
  db: SupabaseClient,
  cart: DraftCart,
): Promise<DraftCart> {
  const key = getMemoryCartKey(cart.accountId, cart.contactId)
  memoryDraftCarts.set(key, cart)

  try {
    // Look for existing active cart in database
    const { data: existing } = await db
      .from('restaurant_trial_draft_carts')
      .select('id')
      .eq('account_id', cart.accountId)
      .eq('contact_id', cart.contactId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      const { data: updated, error } = await db
        .from('restaurant_trial_draft_carts')
        .update({
          conversation_id: cart.conversationId,
          ordering_session_id: cart.orderingSessionId,
          items: cart.items,
          subtotal: cart.subtotal,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single()

      if (!error && updated) {
        const result: DraftCart = {
          id: updated.id,
          accountId: updated.account_id,
          contactId: updated.contact_id,
          conversationId: updated.conversation_id,
          orderingSessionId: updated.ordering_session_id,
          items: updated.items,
          subtotal: Number(updated.subtotal),
          status: updated.status,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        }
        memoryDraftCarts.set(key, result)
        return result
      }
    } else {
      const { data: inserted, error } = await db
        .from('restaurant_trial_draft_carts')
        .insert({
          account_id: cart.accountId,
          contact_id: cart.contactId,
          conversation_id: cart.conversationId,
          ordering_session_id: cart.orderingSessionId,
          items: cart.items,
          subtotal: cart.subtotal,
          status: 'active',
        })
        .select('*')
        .single()

      if (!error && inserted) {
        const result: DraftCart = {
          id: inserted.id,
          accountId: inserted.account_id,
          contactId: inserted.contact_id,
          conversationId: inserted.conversation_id,
          orderingSessionId: inserted.ordering_session_id,
          items: inserted.items,
          subtotal: Number(inserted.subtotal),
          status: inserted.status,
          createdAt: inserted.created_at,
          updatedAt: inserted.updated_at,
        }
        memoryDraftCarts.set(key, result)
        return result
      }
    }
  } catch (err) {
    // Database table might not be migrated yet; fallback cleanly to memory
    console.warn('[draft-cart] DB save warning, fallback to memory cart:', err)
  }

  return cart
}

/**
 * Retrieve active draft cart for customer from database or in-memory fallback.
 */
export async function getActiveDraftCart(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<DraftCart | null> {
  const key = getMemoryCartKey(accountId, contactId)

  try {
    const { data, error } = await db
      .from('restaurant_trial_draft_carts')
      .select('*')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && data && Array.isArray(data.items) && data.items.length > 0) {
      const dbCart: DraftCart = {
        id: data.id,
        accountId: data.account_id,
        contactId: data.contact_id,
        conversationId: data.conversation_id,
        orderingSessionId: data.ordering_session_id,
        items: data.items,
        subtotal: Number(data.subtotal),
        status: data.status,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      }
      memoryDraftCarts.set(key, dbCart)
      return dbCart
    }
  } catch (err) {
    console.warn('[draft-cart] DB getActiveDraftCart warning, fallback to memory cart:', err)
  }

  const memCart = memoryDraftCarts.get(key)
  if (memCart && memCart.status === 'active' && memCart.items.length > 0) {
    return memCart
  }

  return null
}

/**
 * Mark draft cart as confirmed after order is placed.
 */
export async function markDraftCartConfirmed(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  const key = getMemoryCartKey(accountId, contactId)
  const memCart = memoryDraftCarts.get(key)
  if (memCart) {
    memCart.status = 'confirmed'
    memoryDraftCarts.delete(key)
  }

  try {
    await db
      .from('restaurant_trial_draft_carts')
      .update({
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active')
  } catch (err) {
    console.warn('[draft-cart] DB markDraftCartConfirmed warning:', err)
  }
}

/**
 * Cancel active draft cart.
 */
export async function cancelDraftCart(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<void> {
  const key = getMemoryCartKey(accountId, contactId)
  memoryDraftCarts.delete(key)

  try {
    await db
      .from('restaurant_trial_draft_carts')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'active')
  } catch (err) {
    console.warn('[draft-cart] DB cancelDraftCart warning:', err)
  }
}

/**
 * Format DraftCart into official WhatsApp message with verified prices and menu options.
 */
export function formatDraftCartSummary(cart: DraftCart): string {
  const lines: string[] = [
    '🍽️ *ILLUSION CAFE & RESTAURANT*',
    '',
    '🧾 *Your Order Summary*',
    '',
  ]

  for (const item of cart.items) {
    const emoji = item.emoji || '🍴'
    lines.push(`${emoji} *${item.quantity} × ${item.name}*`)
    lines.push(`₹${item.unitPrice} × ${item.quantity} = ₹${item.totalPrice}`)
    lines.push('')
  }

  const formattedSubtotal = cart.subtotal.toLocaleString('en-IN')
  lines.push(`💰 *Food Subtotal: ₹${formattedSubtotal}*`)
  lines.push('')
  lines.push('😊 *What\'s Next?*')
  lines.push('')
  lines.push('1️⃣ Confirm Details')
  lines.push('2️⃣ Add More Items')
  lines.push('3️⃣ Remove an Item')
  lines.push('4️⃣ Cancel Enquiry')
  lines.push('')
  lines.push('Reply with 1, 2, 3 or 4.')

  return lines.join('\n')
}

/**
 * Convert DraftCart items into TrialOrderItem array for createTrialOrder.
 */
export function convertDraftCartToTrialOrderItems(cart: DraftCart): TrialOrderItem[] {
  return cart.items.map((i) => ({
    name: i.name,
    quantity: i.quantity,
    unit_price: i.unitPrice,
    total_price: i.totalPrice,
  }))
}
