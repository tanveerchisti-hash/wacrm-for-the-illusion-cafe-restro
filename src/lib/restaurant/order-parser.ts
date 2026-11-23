import { findCatalogItem, type MenuItem } from './menu-catalog'

const HINDI_NUMBER_MAP: Record<string, number> = {
  ek: 1,
  aik: 1,
  one: 1,
  do: 2,
  doo: 2,
  two: 2,
  teen: 3,
  tin: 3,
  three: 3,
  char: 4,
  chaar: 4,
  four: 4,
  panch: 5,
  paanch: 5,
  five: 5,
  chhe: 6,
  chhah: 6,
  che: 6,
  six: 6,
  sat: 7,
  saat: 7,
  seven: 7,
  aath: 8,
  ath: 8,
  eight: 8,
  nau: 9,
  no: 9,
  nine: 9,
  das: 10,
  dus: 10,
  ten: 10,
}

export interface ParsedOrderItem {
  item: MenuItem
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface OrderCartResult {
  items: ParsedOrderItem[]
  subtotal: number
  formattedSummary: string
}

/**
 * Clean common filler words in Hinglish ordering phrases.
 */
function cleanFillerWords(text: string): string {
  return text
    .replace(
      /\b(?:ye\s+order\s+confirm\s*(?:kar\s*do|kardo|kr\s*do|krdo|kar\s*de|karde|kr\s*de|krde)?|order\s+confirm\s*(?:kar\s*do|kardo|kr\s*do|krdo|kar\s*de|karde|kr\s*de|krde)?|confirm\s*(?:kar\s*do|kardo|kr\s*do|krdo|kar\s*de|karde|kr\s*de|krde|karo|kijiye)?|ye\s+order|ye|yahi|bhi|hoga|kardo|kar\s*do|kar\s*de|karde|kr\s*do|krdo|kr\s*de|krde|karo|kijiye|chahiye|mangwa\s*do|mangwa\s*de|bhej\s*do|bhej\s*de|bhejde|bana\s*do|bana\s*de|banade|pack\s*kardo|pack\s*karo|pack\s*kar\s*de|pack\s*kr\s*de|add\s*kardo|add\s*kar\s*do|add\s*kar\s*de|add\s*kr\s*de|add|de\s*do|dedo|de\s*de|dede|de\s*dijiye|kar\s*dijiye|kardijiye|lena\s*hai|karwaye|please|pls|bhai)\b/gi,
      '',
    )
    .trim()
}

/**
 * Extract number from word or digit.
 */
function parseQuantity(token: string): number | null {
  const clean = token.toLowerCase().trim()
  if (HINDI_NUMBER_MAP[clean] !== undefined) {
    return HINDI_NUMBER_MAP[clean]
  }
  const num = parseInt(clean, 10)
  if (!isNaN(num) && num > 0 && num <= 100) {
    return num
  }
  return null
}

/**
 * Parses customer food orders from Hindi, Hinglish, and English messages.
 */
export function parseCustomerOrder(message: string): OrderCartResult | null {
  const text = message.trim()
  if (!text || text.length < 3) return null

  // Cart removal requests should not be parsed as food additions
  if (isRemoveItemRequest(text)) {
    return null
  }

  // Check if message is a general question / menu request rather than an order placement
  const hasQuestionMarker =
    /\?$/.test(text) ||
    /\b(?:hai\s+kya|hoga\s+kya|milega\s+kya|available\s+hai|available|dikhao|bhejo\s+menu|price|rate|kitne\s+ka)\b/i.test(
      text,
    ) ||
    /^(?:kya\b|menu\b|view\s+menu|hi\b|hello\b|hey\b)/i.test(text)

  const hasOrderIntent =
    /\b(?:kardo|kar\s*do|karo|order|chahiye|add|mangwa|pack|bhejo|de\s*do)\b/i.test(text) ||
    /\b(?:\d+|ek|aik|do|doo|teen|tin|char|chaar|panch|paanch|chhe|chhah|che|sat|saat|aath|ath|nau|das|dus)\b/i.test(
      text,
    )

  if (hasQuestionMarker && !hasOrderIntent) {
    return null
  }

  // Split into candidate chunks by conjunctions: aur, and, &, +, commas, newlines
  const rawChunks = text
    .split(/(?:,|\n|\baur\b|\band\b|&|\+|\bsaath\s+mein\b|\bsath\s+me\b)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0)

  const parsedItems: ParsedOrderItem[] = []

  for (let rawChunk of rawChunks) {
    // Strip bullet or list index prefix like "1. ", "2. ", "• "
    rawChunk = rawChunk.replace(/^(?:[-*•]+\s*|\d+[.)]\s*)/, '').trim()
    const chunk = cleanFillerWords(rawChunk)
    if (!chunk) continue

    let qty = 1
    let itemQuery = chunk

    // Pattern A: Quantity at beginning: e.g. "4 cold coffee" or "ek chicken pizza" or "2x burger"
    const startMatch = chunk.match(/^(\d+|[a-zA-Z]+)\s*(?:[xX*]\s*)?(.+)$/i)
    if (startMatch) {
      const parsedQty = parseQuantity(startMatch[1])
      if (parsedQty !== null) {
        qty = parsedQty
        itemQuery = startMatch[2].trim()
      }
    }

    // Pattern B: Quantity at end: e.g. "Chicken malai box 2" or "cold coffee do"
    const endMatch = itemQuery.match(/^(.+?)\s+(\d+|[a-zA-Z]+)(?:\s*(?:pc|pcs|piece|pieces))?$/i)
    if (endMatch) {
      const parsedQty = parseQuantity(endMatch[2])
      if (parsedQty !== null) {
        qty = parsedQty
        itemQuery = endMatch[1].trim()
      }
    }

    // Try finding catalog item
    const catalogItem = findCatalogItem(itemQuery)
    if (catalogItem) {
      const existing = parsedItems.find((p) => p.item.id === catalogItem.id)
      if (existing) {
        existing.quantity += qty
        existing.totalPrice = existing.quantity * existing.unitPrice
      } else {
        parsedItems.push({
          item: catalogItem,
          quantity: qty,
          unitPrice: catalogItem.price,
          totalPrice: qty * catalogItem.price,
        })
      }
    }
  }

  if (parsedItems.length === 0) return null

  const subtotal = parsedItems.reduce((acc, i) => acc + i.totalPrice, 0)
  const formattedSummary = formatOrderSummary(parsedItems, subtotal)

  return {
    items: parsedItems,
    subtotal,
    formattedSummary,
  }
}

/**
 * Detect if message is a request to remove an item from the cart.
 */
export function isRemoveItemRequest(text: string): boolean {
  return /\b(?:remove|hata\s*do|hatado|delete|nikal\s*do|cancel\s*(?:item|wala))\b/i.test(text)
}

/**
 * Handle cart additions or removals based on an active cart.
 */
export function modifyOrderCart(
  message: string,
  existingItems: ParsedOrderItem[],
): OrderCartResult | null {
  const text = message.trim().toLowerCase()

  // 1. Remove item request: "remove cold coffee", "pizza hata do", "cold coffee cancel"
  if (isRemoveItemRequest(text)) {
    const itemQuery = text
      .replace(/\b(?:remove|hata\s*do|hatado|delete|nikal\s*do|cancel|item|kardo|kar\s*do|please|pls)\b/gi, '')
      .trim()
    const targetItem = findCatalogItem(itemQuery)
    if (targetItem) {
      const updated = existingItems.filter((i) => i.item.id !== targetItem.id)
      const subtotal = updated.reduce((acc, i) => acc + i.totalPrice, 0)
      return {
        items: updated,
        subtotal,
        formattedSummary:
          updated.length > 0
            ? formatOrderSummary(updated, subtotal)
            : `🗑️ *Item Removed!*\n\nYour cart is now empty. Please reply with the items you'd like to order, or send 'menu' to view our menu.`,
      }
    }
  }

  // 2. Add more items request
  const newItemsResult = parseCustomerOrder(message)
  if (newItemsResult && newItemsResult.items.length > 0) {
    const updated = [...existingItems]
    for (const newItem of newItemsResult.items) {
      const existing = updated.find((i) => i.item.id === newItem.item.id)
      if (existing) {
        existing.quantity += newItem.quantity
        existing.totalPrice = existing.quantity * existing.unitPrice
      } else {
        updated.push(newItem)
      }
    }
    const subtotal = updated.reduce((acc, i) => acc + i.totalPrice, 0)
    return {
      items: updated,
      subtotal,
      formattedSummary: formatOrderSummary(updated, subtotal),
    }
  }

  return null
}

/**
 * Format deterministic WhatsApp order summary matching Section 7.
 */
export function formatOrderSummary(items: ParsedOrderItem[], subtotal: number): string {
  const formattedSubtotal = subtotal.toLocaleString('en-IN')

  const itemLines = items
    .map(
      (i) =>
        `${i.item.emoji} *${i.quantity} × ${i.item.name}*\n` +
        `₹${i.unitPrice} × ${i.quantity} = ₹${i.totalPrice.toLocaleString('en-IN')}`,
    )
    .join('\n\n')

  return (
    `🍽️ *ILLUSION CAFE & RESTAURANT*\n\n` +
    `🧾 *Your Order Summary*\n\n` +
    `${itemLines}\n\n` +
    `💰 *Food Subtotal: ₹${formattedSubtotal}*\n\n` +
    `😊 *What's Next?*\n\n` +
    `1️⃣ Confirm Details\n` +
    `2️⃣ Add More Items\n` +
    `3️⃣ Remove an Item\n` +
    `4️⃣ Cancel Enquiry\n\n` +
    `Reply with 1, 2, 3 or 4.`
  )
}
