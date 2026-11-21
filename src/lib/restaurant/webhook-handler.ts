import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveTrialOrder,
  updateOrderFulfilment,
  processPaymentMethod,
  createTrialOrder,
  type TrialOrderItem,
} from './order-trial'
import { engineSendText } from '@/lib/flows/meta-send'
import {
  parseCustomerOrder,
  modifyOrderCart,
  isRemoveItemRequest,
  type ParsedOrderItem,
} from './order-parser'
import { findCatalogItem } from './menu-catalog'

export interface TrialInboundArgs {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  configOwnerUserId: string
  message: {
    id: string
    type: string
    location?: { latitude: number; longitude: number; name?: string; address?: string }
  }
  inboundText: string
  interactiveReplyId: string | null
}

/**
 * Check if the inbound customer message signifies final order confirmation.
 * Handles option "1" from summary menus, standard English phrases, and Hinglish variants.
 */
export function isOrderConfirmationPhrase(text: string): boolean {
  const trimmed = text.trim().toLowerCase()

  // 1. Option 1 from summary menus: "1", "1.", "1. confirm details", "1 confirm", "1 details"
  if (/^1(?:[.)\s\-:]*(?:confirm(?:\s+details|\s+order)?|yes|ha|haan)?)?$/i.test(trimmed)) {
    return true
  }

  // 2. Explicit confirmation phrases in English, Hindi, or Hinglish:
  // e.g. "confirm", "yes confirm", "yes confirm this", "confirm this", "confirm it", "please confirm",
  // "order confirm kardo", "order kr de yahi", "ha confirm", "place order", "proceed"
  if (
    /\bconfirm\b/i.test(trimmed) ||
    /^(?:yes|ha|haan|ji\s+ha|ok|okay)[,.\s]*(?:confirm|kardo|kar\s*do|kijiye|karo|proceed|place\s*order)?$/i.test(trimmed) ||
    /^(?:order\s*(?:kr\s*de|kardo|kar\s*do|karo|place|confirm|lagado|laga\s*do))/i.test(trimmed) ||
    /^(?:place\s*order|proceed\s*with\s*order|proceed)$/i.test(trimmed)
  ) {
    return true
  }

  return false
}

/**
 * Parses itemized lines and total from a recent bot order summary message.
 * Supports:
 * - Single-line item with price (e.g. "• 1x Chicken Pizza (7-inch) - ₹149")
 * - Two-line format (Line 1: "🍕 1 x Chicken Pizza (7-inch)", Line 2: "₹149 x 1 = ₹149")
 * - Subtotals & estimated totals (e.g. "Food Subtotal: ₹347", "Estimated Total: ₹347")
 */
export function parseSummaryFromText(summaryText: string): {
  items: TrialOrderItem[]
  subtotal: number
} | null {
  const lines = summaryText.split('\n').map((l) => l.trim()).filter(Boolean)
  const items: TrialOrderItem[] = []
  let subtotal = 0

  // Filter out non-food menu options and action labels presented to customer
  const ignoredOptionPatterns = [
    /confirm\s*(?:details|order)/i,
    /add\s*more\s*items/i,
    /remove\s*(?:an\s*)?item/i,
    /cancel\s*(?:enquiry|order)/i,
    /main\s*menu/i,
    /choose\s*(?:an\s*)?option/i,
    /reply\s*with/i,
    /delivery\s*(?:or|vs)\s*takeaway/i,
    /cash\s*or\s*upi/i,
    /view\s*menu/i,
    /submit\s*review/i,
    /what'?s\s*next/i,
    /would\s*you\s*like\s*to/i,
    /delivery\s*charge/i,
    /illusion\s*cafe/i,
    /your\s*order\s*summary/i,
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (ignoredOptionPatterns.some((pattern) => pattern.test(line))) {
      continue
    }

    // 1. Check for Total / Subtotal line
    const totalMatch = line.match(
      /(?:\*|_)?(?:food\s*subtotal|subtotal|estimated\s*total|total\s*amount|grand\s*total|bill|total)(?:\*|_)?[\s*:\-–=]+(?:\*|_)?₹?\s*(\d+(?:\.\d+)?)/i,
    )
    if (totalMatch) {
      const parsedTotal = parseFloat(totalMatch[1])
      if (parsedTotal > 0 && subtotal === 0) {
        subtotal = parsedTotal
      }
      continue
    }

    // 2. Pattern 1: Single-line item with price
    // "🍕 1 x Chicken Pizza (7-inch) - ₹149" or "- 2x Veg Burger: ₹240" or "Cold Coffee (2) @ ₹99 = ₹198"
    const singleMatch = line.match(
      /^(?:[-*•🍕🍔🥤☕🥪🍟🍗\d]+[.)\s\-]*\s*)?(?:(\d+)\s*[xX]\s+)?([A-Za-z0-9\s()&'\/\[\]\-]+?)(?:\s*\((\d+)\))?\s*[@:\-–=]+\s*₹?\s*(\d+(?:\.\d+)?)(?:\s*[@=xX]\s*₹?\s*(\d+(?:\.\d+)?))?$/u,
    )
    if (singleMatch && singleMatch[4]) {
      const rawName = (singleMatch[2] || '').replace(/^[*_#•\-–\s]+|[*_#\s]+$/g, '').trim()
      if (
        rawName &&
        !/^(?:total|subtotal|bill|amount|order\s*summary|estimated|delivery)$/i.test(rawName)
      ) {
        let quantity = 1
        if (singleMatch[1]) quantity = parseInt(singleMatch[1], 10) || 1
        else if (singleMatch[3]) quantity = parseInt(singleMatch[3], 10) || 1

        const priceVal1 = parseFloat(singleMatch[4]) || 0
        const priceVal2 = singleMatch[5] ? parseFloat(singleMatch[5]) : 0
        const totalPrice = priceVal2 > 0 ? priceVal2 : priceVal1
        const unitPrice = quantity > 0 ? Math.round((totalPrice / quantity) * 100) / 100 : totalPrice

        items.push({ name: rawName, quantity, unit_price: unitPrice, total_price: totalPrice })
        continue
      }
    }

    // 3. Pattern 2: Two-line format
    // Line i: "🍕 1 x Chicken Pizza (7-inch)"
    // Line i+1: "₹149 x 1 = ₹149" or "₹149" or "@ ₹149 = ₹149"
    const itemHeaderMatch = line.match(
      /^(?:[-*•🍕🍔🥤☕🥪🍟🍗\d]+[.)\s\-]*\s*)?(?:(\d+)\s*[xX]\s+)?([A-Za-z0-9\s()&'\/\[\]\-]+?)(?:\s*\((\d+)\))?$/u,
    )
    if (itemHeaderMatch && i + 1 < lines.length) {
      const rawName = (itemHeaderMatch[2] || '').replace(/^[*_#•\-–\s]+|[*_#\s]+$/g, '').trim()
      const nextLine = lines[i + 1]
      const priceCalcMatch = nextLine.match(
        /^₹?\s*(\d+(?:\.\d+)?)\s*(?:[xX*@]\s*(\d+))?\s*(?:=\s*₹?\s*(\d+(?:\.\d+)?))?$/,
      )

      if (
        rawName &&
        rawName.length >= 3 &&
        priceCalcMatch &&
        !/^(?:total|subtotal|bill|amount|estimated|delivery)$/i.test(rawName)
      ) {
        let quantity = 1
        if (itemHeaderMatch[1]) quantity = parseInt(itemHeaderMatch[1], 10) || 1
        else if (itemHeaderMatch[3]) quantity = parseInt(itemHeaderMatch[3], 10) || 1
        else if (priceCalcMatch[2]) quantity = parseInt(priceCalcMatch[2], 10) || 1

        const unitPrice = parseFloat(priceCalcMatch[1]) || 0
        const totalPrice = priceCalcMatch[3] ? parseFloat(priceCalcMatch[3]) : unitPrice * quantity

        items.push({ name: rawName, quantity, unit_price: unitPrice, total_price: totalPrice })
        i++ // consume nextLine as price
        continue
      }
    }
  }

  if (items.length === 0) return null
  if (subtotal === 0) {
    subtotal = items.reduce((acc, i) => acc + i.total_price, 0)
  }

  return { items, subtotal }
}

/**
 * Handle restaurant trial ordering stages in the webhook pipeline.
 * Returns { handled: true } if the message was consumed by the trial workflow,
 * preventing duplicate AI replies or flow routing.
 */
export async function handleRestaurantTrialInbound(
  args: TrialInboundArgs,
): Promise<{ handled: boolean }> {
  const {
    db,
    accountId,
    contactId,
    conversationId,
    configOwnerUserId,
    message,
    inboundText,
    interactiveReplyId,
  } = args

  const textLower = inboundText.toLowerCase().trim()
  const activeOrder = await getActiveTrialOrder(db, accountId, contactId)

  // ==========================================================
  // CASE 1: Active order exists
  // ==========================================================
  if (activeOrder) {
    // Stage 1 Gate: Order is awaiting kitchen confirmation
    // Do NOT let AI proceed to delivery or payment while kitchen approval is pending
    if (activeOrder.status === 'pending_kitchen') {
      const reminder =
        `⏳ Your order *#${activeOrder.order_number}* is currently awaiting kitchen confirmation ` +
        `(target response: 2–3 minutes). Please wait while our kitchen reviews your order — we will update you shortly!`

      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: reminder,
      }).catch((err) => console.error('[order-trial] pending kitchen reminder error:', err))

      return { handled: true }
    }

    // Stage 3: Fulfilment Selection (Delivery vs Takeaway)
    if (activeOrder.status === 'fulfilment_pending') {
      // 1. Native WhatsApp location pin payload
      if (message.type === 'location' && message.location) {
        const loc = message.location
        const address =
          [loc.name, loc.address].filter(Boolean).join(', ') ||
          `${loc.latitude}, ${loc.longitude}`

        await updateOrderFulfilment(db, {
          orderId: activeOrder.id,
          accountId,
          fulfilmentType: 'delivery',
          address,
          location: loc,
          configOwnerUserId,
        })

        return { handled: true }
      }

      // 2. Text containing GPS coordinates (e.g. from shared WhatsApp location text)
      const hasGpsCoordinates = /[-+]?\d{1,2}\.\d+[\s,]+[-+]?\d{1,3}\.\d+/.test(inboundText)
      if (hasGpsCoordinates) {
        const coordMatch = inboundText.match(/([-+]?\d{1,2}\.\d+)[\s,]+([-+]?\d{1,3}\.\d+)/)
        const locationObj = coordMatch
          ? { latitude: parseFloat(coordMatch[1]), longitude: parseFloat(coordMatch[2]) }
          : null

        await updateOrderFulfilment(db, {
          orderId: activeOrder.id,
          accountId,
          fulfilmentType: 'delivery',
          address: inboundText.trim(),
          location: locationObj,
          configOwnerUserId,
        })

        return { handled: true }
      }

      // 3. User tapped or typed Delivery
      if (
        interactiveReplyId === 'fulfilment_delivery' ||
        textLower === 'delivery' ||
        textLower === '1'
      ) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: `🛵 *Delivery Selected!*\n\nPlease reply with your full delivery address or share your location pin via WhatsApp.`,
        }).catch((err) => console.error('[order-trial] delivery prompt failed:', err))

        return { handled: true }
      }

      // 4. User sent address as text
      if (
        textLower.length > 5 &&
        !textLower.includes('takeaway') &&
        !textLower.includes('pickup') &&
        textLower !== 'delivery'
      ) {
        await updateOrderFulfilment(db, {
          orderId: activeOrder.id,
          accountId,
          fulfilmentType: 'delivery',
          address: inboundText.trim(),
          configOwnerUserId,
        })

        return { handled: true }
      }

      // 5. User tapped or sent Takeaway
      if (
        interactiveReplyId === 'fulfilment_takeaway' ||
        textLower.includes('takeaway') ||
        textLower.includes('pickup') ||
        textLower === '2'
      ) {
        await updateOrderFulfilment(db, {
          orderId: activeOrder.id,
          accountId,
          fulfilmentType: 'takeaway',
          configOwnerUserId,
        })

        return { handled: true }
      }
    }

    // Stage 4: Payment Method Selection (Cash vs UPI/Online)
    if (activeOrder.status === 'payment_pending') {
      if (
        interactiveReplyId === 'pay_cash' ||
        textLower === 'cash' ||
        textLower.includes('cod') ||
        textLower === '1'
      ) {
        await processPaymentMethod(db, {
          orderId: activeOrder.id,
          accountId,
          paymentMethod: 'cash',
          configOwnerUserId,
        })

        return { handled: true }
      }

      if (
        interactiveReplyId === 'pay_upi' ||
        textLower === 'upi' ||
        textLower.includes('online') ||
        textLower.includes('gpay') ||
        textLower.includes('phonepe') ||
        textLower === '2'
      ) {
        await processPaymentMethod(db, {
          orderId: activeOrder.id,
          accountId,
          paymentMethod: 'upi',
          configOwnerUserId,
        })

        return { handled: true }
      }
    }

    // If order is awaiting UPI payment verification, remind the customer
    if (activeOrder.payment_status === 'awaiting_verification') {
      const waitMsg =
        `📱 Your payment for order *#${activeOrder.order_number}* is currently *awaiting staff verification*.\n\n` +
        `Our staff will confirm receipt shortly, and your preparation timer will begin immediately upon confirmation.`

      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: waitMsg,
      }).catch((err) => console.error('[order-trial] wait verification error:', err))

      return { handled: true }
    }
  }

  // ==========================================================
  // CASE 2: No active order yet — Check options, confirmation & orders
  // ==========================================================

  // Option 4: Cancel Enquiry
  if (
    textLower === '4' ||
    textLower === '4.' ||
    textLower === '4. cancel enquiry' ||
    textLower === '4 cancel' ||
    textLower === 'cancel enquiry'
  ) {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: `❌ *Order Enquiry Cancelled*\n\nYour enquiry has been cancelled. Send 'menu' anytime when you're ready to explore or place an order!`,
    }).catch((err) => console.error('[order-trial] cancel send error:', err))

    return { handled: true }
  }

  // Option 2: Add More Items prompt
  if (
    textLower === '2' ||
    textLower === '2.' ||
    textLower === '2. add more items' ||
    textLower === 'add more items'
  ) {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: `📝 *Add Items to Order*\n\nPlease reply with the items you'd like to add (e.g. "1 Cold Coffee" or "2 Chicken Burger").`,
    }).catch((err) => console.error('[order-trial] add more items prompt error:', err))

    return { handled: true }
  }

  // Option 3: Remove an Item prompt
  if (
    textLower === '3' ||
    textLower === '3.' ||
    textLower === '3. remove an item' ||
    textLower === 'remove an item'
  ) {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: `🗑️ *Remove an Item*\n\nPlease reply with the item name you'd like to remove (e.g. "remove cold coffee" or "pizza hata do").`,
    }).catch((err) => console.error('[order-trial] remove item prompt error:', err))

    return { handled: true }
  }

  // Option 1: Final Order Confirmation ("1", "Confirm Details", "Yes confirm this", "Order kr de yahi")
  if (isOrderConfirmationPhrase(inboundText)) {
    // Look up recent outbound messages (bot or AI agent) to extract item summary
    const { data: recentMsgs } = await db
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conversationId)
      .neq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(10)

    let parsedSummary: { items: TrialOrderItem[]; subtotal: number } | null = null

    for (const msg of recentMsgs ?? []) {
      if (msg.content_text) {
        parsedSummary = parseSummaryFromText(msg.content_text)
        if (parsedSummary && parsedSummary.items.length > 0) break
      }
    }

    if (!parsedSummary || parsedSummary.items.length === 0) {
      // Check if recent outbound messages actually attempted to present an order summary
      const hadSummaryAttempt = (recentMsgs ?? []).some((m) =>
        /(?:order\s*summary|food\s*subtotal|estimated\s*total|what'?s\s*next|confirm\s*details)/i.test(
          m.content_text || '',
        ),
      )

      // If no summary attempt was found, this message was just a general conversation word ("yes", "ok", etc.)
      // Return handled: false so the normal conversational AI / flow handles it
      if (!hadSummaryAttempt) {
        return { handled: false }
      }

      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text:
          `We couldn't confirm the exact items for your order. ` +
          `Please reply with the items and quantities you'd like to order (e.g. "1 Chicken Pizza and 2 Cold Coffee"), ` +
          `or send 'menu' to view our menu.`,
      }).catch((err) => console.error('[order-trial] clarification send error:', err))

      return { handled: true }
    }

    const { items, subtotal } = parsedSummary

    const newOrder = await createTrialOrder(db, {
      accountId,
      contactId,
      conversationId,
      items,
      subtotal,
    })

    const confirmationMsg =
      `📋 *Order #${newOrder.order_number} Received!*\n\n` +
      `Items:\n${items.map((i) => `• ${i.quantity}x ${i.name} - ₹${i.total_price}`).join('\n')}\n` +
      `*Total: ₹${subtotal}*\n\n` +
      `⏳ Your order is now *awaiting kitchen confirmation* (target response: 2–3 minutes).\n` +
      `We will notify you here as soon as our kitchen confirms your order!`

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: confirmationMsg,
    }).catch((err) => console.error('[order-trial] order received send error:', err))

    return { handled: true }
  }

  // Cart Modification: Check if customer is asking to modify existing cart (add/remove)
  const isRemove = isRemoveItemRequest(inboundText)
  const isAdd = /\b(?:aur\b|add\b|bhi\b)/i.test(inboundText)

  if (isRemove || isAdd) {
    const { data: recentMsgs } = await db
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conversationId)
      .neq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(5)

    let previousParsed: { items: TrialOrderItem[]; subtotal: number } | null = null
    for (const msg of recentMsgs ?? []) {
      if (msg.content_text) {
        previousParsed = parseSummaryFromText(msg.content_text)
        if (previousParsed && previousParsed.items.length > 0) break
      }
    }

    if (previousParsed && previousParsed.items.length > 0) {
      const existingCart: ParsedOrderItem[] = []
      for (const pi of previousParsed.items) {
        const catItem = findCatalogItem(pi.name)
        if (catItem) {
          existingCart.push({
            item: catItem,
            quantity: pi.quantity,
            unitPrice: pi.unit_price,
            totalPrice: pi.total_price,
          })
        }
      }

      if (existingCart.length > 0) {
        const modResult = modifyOrderCart(inboundText, existingCart)
        if (modResult) {
          await engineSendText({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: modResult.formattedSummary,
          }).catch((err) => console.error('[order-trial] cart modify send error:', err))

          return { handled: true }
        }
      }
    }
  }

  // Deterministic Food Order Placement:
  // e.g. "Chicken malai box 2 aur malai kabab 2, 4 cold coffee, malai chicken pizza 2 kardo"
  // or "Ek chicken pizza aur 2 cold coffee"
  const orderResult = parseCustomerOrder(inboundText)
  if (orderResult && orderResult.items.length > 0) {
    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: orderResult.formattedSummary,
    }).catch((err) => console.error('[order-trial] order summary send error:', err))

    return { handled: true }
  }

  return { handled: false }
}
