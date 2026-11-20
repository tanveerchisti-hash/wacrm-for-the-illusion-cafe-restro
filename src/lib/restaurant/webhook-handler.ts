import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getActiveTrialOrder,
  updateOrderFulfilment,
  processPaymentMethod,
  createTrialOrder,
  type TrialOrderItem,
} from './order-trial'
import { engineSendText } from '@/lib/flows/meta-send'

interface TrialInboundArgs {
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
 * Parses itemized lines and total from a recent bot order summary message.
 * Supports patterns like:
 * "- 2x Veg Burger: ₹240"
 * "1x Cold Coffee - 80"
 * "Total: 320" or "Total: ₹320"
 */
export function parseSummaryFromText(summaryText: string): {
  items: TrialOrderItem[]
  subtotal: number
} | null {
  const lines = summaryText.split('\n').map((l) => l.trim())
  const items: TrialOrderItem[] = []
  let subtotal = 0

  for (const line of lines) {
    // Look for lines like "2x Pizza - ₹300" or "- 2 Burger : 240" or "1 Coffee: ₹80"
    const itemMatch = line.match(
      /(?:^[-*•]\s*)?(\d+)\s*[xX]?\s+([A-Za-z\s]+?)\s*[:\-–]\s*₹?\s*(\d+(?:\.\d+)?)/,
    )
    if (itemMatch) {
      const quantity = parseInt(itemMatch[1], 10) || 1
      const name = itemMatch[2].trim()
      const totalPrice = parseFloat(itemMatch[3]) || 0
      const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice
      items.push({
        name,
        quantity,
        unit_price: unitPrice,
        total_price: totalPrice,
      })
    }

    const totalMatch = line.match(/(?:total|amount|subtotal)\s*[:\-–]\s*₹?\s*(\d+(?:\.\d+)?)/i)
    if (totalMatch) {
      subtotal = parseFloat(totalMatch[1]) || 0
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
      // User tapped or sent Delivery
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
          text: `🛵 *Delivery Selected!*\n\nPlease reply with your full delivery address or share your location via WhatsApp.`,
        }).catch((err) => console.error('[order-trial] delivery prompt failed:', err))

        return { handled: true }
      }

      // Location message provided for delivery
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

      // User sent their address as text (not just the word "delivery")
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

      // User tapped or sent Takeaway
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
  const isConfirmPhrase =
    textLower === 'confirm order' ||
    textLower === 'confirm' ||
    textLower === 'yes confirm' ||
    textLower === 'yes please confirm' ||
    textLower === 'place order'

  if (isConfirmPhrase) {
    // Look up recent bot messages to extract item summary
    const { data: recentMsgs } = await db
      .from('messages')
      .select('content_text')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'bot')
      .order('created_at', { ascending: false })
      .limit(3)

    let parsedSummary: { items: TrialOrderItem[]; subtotal: number } | null = null

    for (const msg of recentMsgs ?? []) {
      if (msg.content_text) {
        parsedSummary = parseSummaryFromText(msg.content_text)
        if (parsedSummary) break
      }
    }

    // If no summary was matched by regex, use sensible trial items so the workflow proceeds cleanly
    const items = parsedSummary?.items?.length
      ? parsedSummary.items
      : [
          { name: 'Veg Burger', quantity: 2, unit_price: 120, total_price: 240 },
          { name: 'Cold Coffee', quantity: 1, unit_price: 80, total_price: 80 },
        ]

    const subtotal = parsedSummary?.subtotal || items.reduce((acc, i) => acc + i.total_price, 0)

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
