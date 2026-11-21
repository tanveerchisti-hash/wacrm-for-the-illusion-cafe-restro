import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveTrialOrder,
  updateOrderFulfilment,
  processPaymentMethod,
  createTrialOrder,
  type TrialOrderItem,
} from './order-trial'
import { engineSendText } from '@/lib/flows/meta-send'

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

  // 2. Explicit English and Hinglish phrases (e.g. "confirm", "yes confirm", "ha confirm", "confirm kardo", "order confirm")
  if (
    /^(?:(?:ha|haan|ji\s+ha|yes|ok|okay)[,.\s]+)?(?:confirm(?:\s+(?:order|details|my\s+order|kardo|kar\s*do|kijiye|karo))?|order\s+confirm(?:\s*(?:kardo|kar\s*do))?|place\s+order|proceed|kardo\s+confirm)$/i.test(
      trimmed,
    )
  ) {
    return true
  }

  // Natural response after a confirmation request (not just an exact menu option).
  if (/^(?:yes|yeah|haan?|ji)(?:[,\s]+)(?:please\s+)?confirm(?:\s+(?:this|it|order|details|this\s+order))?\.?$/i.test(trimmed)) {
    return true
  }

  return false
}

/**
 * Parses itemized lines and total from a recent bot order summary message.
 * Supports real-world WhatsApp summaries with emojis, multiline prices,
 * formatted item lines, and item options.
 *
 * Example summary inputs:
 * "1. Chicken Malai Box (4 pieces) - ₹119"
 * "2. Malai Kabab (4 pieces) - ₹199"
 * "3. Cold Coffee (4) - ₹396"
 * "• 1x Margherita Pizza - ₹250"
 * "Total: ₹964"
 */
export function parseSummaryFromText(summaryText: string): {
  items: TrialOrderItem[]
  subtotal: number
} | null {
  const lines = summaryText.split('\n').map((l) => l.trim()).filter(Boolean)
  const items: TrialOrderItem[] = []
  let subtotal = 0
  let foodSubtotalSeen = false
  let pendingTwoLineItem: { name: string; quantity: number } | null = null

  // Filter out non-food menu options presented to customer
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
  ]

  for (const line of lines) {
    // The actual WhatsApp summary uses a two-line layout:
    // "🍕 1 × Chicken Pizza (7-inch)" then "₹149 × 1 = ₹149".
    // The old one-line regexp silently skipped both lines, leaving no kitchen order.
    const normalizedLine = line.replace(/[*_]/g, '').trim()
    const formula = normalizedLine.match(/^₹\s*([\d,]+(?:\.\d+)?)\s*[xX×]\s*(\d+)\s*=\s*₹\s*([\d,]+(?:\.\d+)?)$/u)
    if (formula) {
      if (pendingTwoLineItem) {
        const unitPrice = Number(formula[1].replace(/,/g, ''))
        const priceQuantity = Number(formula[2])
        const totalPrice = Number(formula[3].replace(/,/g, ''))
        if (
          priceQuantity !== pendingTwoLineItem.quantity ||
          !Number.isFinite(totalPrice) ||
          !Number.isFinite(unitPrice) ||
          Math.abs(unitPrice * priceQuantity - totalPrice) > 0.01
        ) {
          return null // Fail closed instead of charging the wrong amount.
        }
        items.push({
          name: pendingTwoLineItem.name,
          quantity: priceQuantity,
          unit_price: unitPrice,
          total_price: totalPrice,
        })
      }
      pendingTwoLineItem = null
      continue
    }

    // Remove emoji/bullet prefix from numbered item header, without removing
    // size descriptions such as "(7-inch)" or "(200 ml)" from the name.
    const itemHeader = normalizedLine
      .replace(/^[^A-Za-z0-9]+/u, '')
      .match(/^(\d+)\s*[xX×]\s+([^₹=]+)$/u)
    if (itemHeader) {
      pendingTwoLineItem = {
        quantity: Number(itemHeader[1]),
        name: itemHeader[2].trim(),
      }
      continue
    }
    pendingTwoLineItem = null

    // 1. Skip non-item option lines
    if (ignoredOptionPatterns.some((pattern) => pattern.test(line))) {
      continue
    }

    // 2. Check for Total / Subtotal line
    const totalMatch = line.match(
      /(?:\*|_)?(?:total(?:\s+amount)?|subtotal|bill|grand\s*total)(?:\*|_)?[\s*:\-–=]+(?:\*|_)?₹?\s*(\d+(?:\.\d+)?)/i,
    )
    if (totalMatch) {
      const parsedTotal = parseFloat(totalMatch[1])
      if (parsedTotal > 0) {
        if (/food\s*subtotal/i.test(line)) {
          subtotal = parsedTotal
          foodSubtotalSeen = true
        } else if (!foodSubtotalSeen) {
          subtotal = parsedTotal
        }
      }
      continue
    }

    // 3. Match items with price.
    // Supports patterns:
    // "- 2x Veg Burger: ₹240"
    // "1. Chicken Malai Box (4 pieces) - ₹119"
    // "• 2x Malai Chicken Pizza (7 inch) - ₹298"
    // "Cold Coffee (4) - ₹396"
    // "🍕 1x Margherita Pizza : ₹250"
    // "2x Cheese Maggi @ ₹79 = ₹158"
    const match = line.match(
      /^(?:[-*•🍕🍔🥤🥪🍟🍗\d]+[.)\s\-]*\s*)?(?:(\d+)\s*[xX]\s+)?([A-Za-z0-9\s()&'\/]+?)(?:\s*\((\d+)\))?\s*[@:\-–=]+\s*₹?\s*(\d+(?:\.\d+)?)(?:\s*[@=]\s*₹?\s*(\d+(?:\.\d+)?))?/u,
    )

    if (match) {
      let rawName = match[2] ? match[2].trim() : ''
      rawName = rawName.replace(/^[*_#•\-–\s]+|[*_#\s]+$/g, '').trim()

      if (
        !rawName ||
        /^(?:total|subtotal|bill|amount|order\s*summary|here\s*is|please\s*choose)$/i.test(rawName)
      ) {
        continue
      }

      let quantity = 1
      if (match[1]) {
        quantity = parseInt(match[1], 10) || 1
      } else if (match[3]) {
        quantity = parseInt(match[3], 10) || 1
      }

      let totalPrice = 0
      let unitPrice = 0

      const priceVal1 = parseFloat(match[4]) || 0
      const priceVal2 = match[5] ? parseFloat(match[5]) : 0

      if (priceVal2 > 0) {
        unitPrice = priceVal1
        totalPrice = priceVal2
      } else {
        totalPrice = priceVal1
        unitPrice = quantity > 0 ? Math.round((totalPrice / quantity) * 100) / 100 : totalPrice
      }

      if (totalPrice > 0 && rawName.length >= 3) {
        items.push({
          name: rawName,
          quantity,
          unit_price: unitPrice,
          total_price: totalPrice,
        })
      }
    }
  }

  if (items.length === 0) return null
  const calculatedSubtotal = Math.round(items.reduce((acc, item) => acc + item.total_price, 0) * 100) / 100
  if (subtotal > 0 && Math.abs(subtotal - calculatedSubtotal) > 0.01) {
    return null // Summary and item totals disagree; do not create an incorrect order.
  }
  return { items, subtotal: subtotal || calculatedSubtotal }
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
  // CASE 2: No active order yet — Check for final order confirmation
  // ==========================================================
  if (isOrderConfirmationPhrase(inboundText)) {
    // Look up recent bot messages to extract item summary
    const { data: recentMsgs } = await db
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'bot')
      .order('created_at', { ascending: false })
      .limit(12)

    let parsedSummary: { items: TrialOrderItem[]; subtotal: number } | null = null

    for (const msg of recentMsgs ?? []) {
      const summaryText = msg.content_text || ''
      // Require an actual order summary, not a previous conversational mention
      // of a price. "1" must never create an order from an unrelated message.
      if (
        /(?:your\s+order\s+summary|order\s+(?:summary|details))/i.test(summaryText) &&
        /(?:confirm\s+details|confirm\s+order|reply\s+1\s+to\s+confirm)/i.test(summaryText)
      ) {
        parsedSummary = parseSummaryFromText(summaryText)
        if (parsedSummary) break
      }
    }

    // Bug 3 Fix: If no summary was matched, request clarification instead of creating dummy Veg Burger!
    if (!parsedSummary || parsedSummary.items.length === 0) {
      // Only consume the message if it looked like an order confirmation attempt
      if (textLower === '1' && (!recentMsgs || recentMsgs.length === 0)) {
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

  return { handled: false }
}
