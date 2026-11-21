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
  isRemoveItemRequest,
} from './order-parser'
import { findCatalogItem } from './menu-catalog'
import {
  getActiveDraftCart,
  saveDraftCart,
  createDraftCartFromParsedItems,
  mergeItemsIntoDraftCart,
  removeItemFromDraftCart,
  markDraftCartConfirmed,
  cancelDraftCart,
  formatDraftCartSummary,
  convertDraftCartToTrialOrderItems,
  type DraftCart,
} from './draft-cart'

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
  const normalized = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\uFEFF]/g, '')
    .replace(/[.,!।]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?:kardo|krdo|kr do)\b/g, 'kar do')
    .replace(/\bkar\s+di\s+jiye\b/g, 'kar dijiye')
    .replace(/\b(?:banado|bnado)\b/g, 'bana do')
    .replace(/\bbhejdo\b/g, 'bhej do')
    .replace(/\blagado\b/g, 'laga do')
    .replace(/\b(?:thik|thek)\b/g, 'theek')

  // Never interpret questions, cancellations or cart edits as confirmation.
  if (
    !normalized ||
    /[?？]/.test(text) ||
    /\b(?:no|not|don't|dont|never|mat|nahi|nahin|cancel|reject|stop|ruk|ruko|remove|hata|delete|add|change|badal|edit|wait)\b/.test(normalized)
  ) {
    return false
  }

  // Option 1 and its variations.
  if (
    /^1(?:\s*(?:confirm(?:\s+(?:details|order))?|details|yes|haan))?$/.test(normalized)
  ) {
    return true
  }

  // Short positive replies. The caller must verify an active draft cart.
  if (
    /^(?:haanji|hanji|haan ji|han ji|haan|han|ha|ji|yes|ok|okay|sure|bilkul)(?:\s+(?:ji|please))?$/.test(normalized)
  ) {
    return true
  }

  // Remove optional polite prefixes.
  const intent = normalized
    .replace(
      /^(?:(?:haanji|hanji|haan ji|han ji|haan|han|ha|ji|yes|yeah|yup|ok|okay|sure|bilkul|please|plz|bhai|ab)\s+)+/,
      ''
    )
    .trim()

  const confirmationPatterns: RegExp[] = [
    // Confirm, confirm order, confirm kar do, confirm kar dijiye.
    /^(?:i\s+|order\s+)?confirm(?:ed)?(?:\s+(?:this|it|details|(?:the\s+)?order))?(?:\s+(?:kar do|kar dijiye|karwa do|karo|kijiye|kr de|kar de|please))?$/,

    // Done, final, pakka, done kar do, order final kar do.
    /^(?:(?:ye|mera|is|iss|this)\s+)?(?:order\s+)?(?:done|final|pakka)(?:\s+(?:kar do|kar dijiye|karwa do|karo|kijiye|hai))?$/,

    // Bana do, bhej do, order laga do, order place kar do.
    /^(?:(?:ye|mera|is|iss|this)\s+)?(?:order\s+)?(?:bana|banwa|bna|bhej|laga|ready|taiyar|tayyar|place|send)(?:\s+(?:kar do|kar dijiye|karwa do|karo|kijiye|do|de do|dijiye|kar de))$/,

    // Theek hai, theek kar do, sahi hai, haan theek hai bana do.
    /^(?:theek|sahi)(?:\s+hai)?(?:\s+(?:kar do|kar dijiye|karwa do|karo|kijiye|bana do|bhej do|order kar do))?$/,

    // Kar do, kardo, kar dijiye, order kar do.
    /^(?:order\s+)?(?:kar do|kar dijiye|karwa do|karo|kijiye|kr de|kar de|do it)$/,

    // Order kr de yahi.
    /^(?:order\s+)?kr\s+de\s+yahi$/,

    // Bana ke bhej do.
    /^(?:order\s+)?bana\s+ke\s+bhej\s+(?:do|dijiye)$/,

    // English confirmation commands.
    /^(?:place\s+(?:the\s+)?order|send\s+(?:the\s+)?order|send\s+it|go\s+ahead|proceed(?:\s+with\s+(?:the\s+)?order)?)$/,
  ]

  return confirmationPatterns.some((pattern) => pattern.test(intent))
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
      // Idempotent confirmation replay protection: if customer sends "1" or confirm again, do not re-order
      if (isOrderConfirmationPhrase(inboundText)) {
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text:
            `⏳ Your Order *#${activeOrder.order_number}* is already received and awaiting kitchen confirmation.\n\n` +
            `We will notify you here as soon as our kitchen confirms your order!`,
        }).catch((err) => console.error('[order-trial] duplicate confirm notification error:', err))

        return { handled: true }
      }

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
  // CASE 2: No active order yet — Check options, cart & confirmation
  // ==========================================================

  // Option 4: Cancel Enquiry
  if (
    textLower === '4' ||
    textLower === '4.' ||
    textLower === '4. cancel enquiry' ||
    textLower === '4 cancel' ||
    textLower === 'cancel enquiry' ||
    textLower === 'cancel order'
  ) {
    await cancelDraftCart(db, accountId, contactId)
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

  // STEP 2A: Cart Removal Request (e.g. "cold coffee remove kardo", "pizza hata do")
  const isRemove = isRemoveItemRequest(inboundText)
  if (isRemove) {
    const existingCart = await getActiveDraftCart(db, accountId, contactId)
    if (existingCart && existingCart.items.length > 0) {
      const rawText = inboundText
        .replace(/\b(?:remove|hata\s*do|cancel|hatao|delete)\b/gi, '')
        .replace(/\b(?:kardo|kar\s*do|se|from\s*cart|ko)\b/gi, '')
        .trim()

      const itemToRemove = findCatalogItem(rawText)
      if (itemToRemove) {
        const updatedCart = removeItemFromDraftCart(existingCart, itemToRemove)
        if (updatedCart.items.length === 0) {
          await cancelDraftCart(db, accountId, contactId)
          await engineSendText({
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: `🗑️ *Cart Updated*\n\nYour cart is now empty. Please reply with the items you'd like to order, or send 'menu' to view our menu.`,
          }).catch((err) => console.error('[order-trial] empty cart send error:', err))
          return { handled: true }
        }

        const savedCart = await saveDraftCart(db, updatedCart)
        const summaryText = formatDraftCartSummary(savedCart)
        await engineSendText({
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: summaryText,
        }).catch((err) => console.error('[order-trial] cart modify send error:', err))

        return { handled: true }
      }
    }
  }

  // STEP 2B: Check for NEW or MODIFIED Food Items in the inbound message!
  // If customer provides items together with "confirm kar do" (e.g. Test C:
  // "Chicken malai box 2 aur malai kabab 2, 4 cold coffee, malai chicken pizza 2 ye order confirm kar do"),
  // process the items first, save to draft cart, and display summary for explicit confirmation.
  const orderResult = parseCustomerOrder(inboundText)
  if (orderResult && orderResult.items.length > 0) {
    // Check if customer is explicitly adding items to an existing draft cart
    const isExplicitAdd = /\b(?:aur\b|add\b|bhi\b)/i.test(inboundText)
    const existingCart = await getActiveDraftCart(db, accountId, contactId)

    let updatedCart: DraftCart

    if (existingCart && isExplicitAdd) {
      updatedCart = mergeItemsIntoDraftCart(existingCart, orderResult.items)
    } else {
      let activeSessionId: string | null = null
      try {
        const { data: activeSession } = await db
          .from('ordering_sessions')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', contactId)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle()

        if (activeSession?.id) {
          activeSessionId = activeSession.id
        }
      } catch {
        // Table or lookup error: ignore and continue
      }

      updatedCart = createDraftCartFromParsedItems({
        accountId,
        contactId,
        conversationId,
        orderingSessionId: activeSessionId,
        parsedItems: orderResult.items,
      })
    }

    // Persist draft cart (database + in-memory store)
    const savedCart = await saveDraftCart(db, updatedCart)

    // Generate WhatsApp order summary strictly from the saved structured draft cart
    const summaryText = formatDraftCartSummary(savedCart)

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: summaryText,
    }).catch((err) => console.error('[order-trial] order summary send error:', err))

    return { handled: true }
  }

  // STEP 2C: Final Order Confirmation ("1", "Confirm Details", "Yes confirm this", "Order confirm kardo")
  if (isOrderConfirmationPhrase(inboundText)) {
    // Retrieve the saved structured draft cart as the single source of truth
    const draftCart = await getActiveDraftCart(db, accountId, contactId)

    if (!draftCart || !draftCart.items || draftCart.items.length === 0) {
      // If no draft exists, politely explain that no saved cart was found.
      // Do not attempt to parse old chat messages.
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text:
          `🛒 *No active order found.*\n\n` +
          `Please reply with the items and quantities you'd like to order (e.g. "1 Chicken Pizza and 2 Cold Coffee"), ` +
          `or send 'menu' to view our menu.`,
      }).catch((err) => console.error('[order-trial] no draft cart send error:', err))

      return { handled: true }
    }

    const trialItems = convertDraftCartToTrialOrderItems(draftCart)
    const subtotal = draftCart.subtotal

    // Idempotent creation: createTrialOrder checks if an order in pending_kitchen already exists
    const newOrder = await createTrialOrder(db, {
      accountId,
      contactId,
      conversationId,
      orderingSessionId: draftCart.orderingSessionId,
      items: trialItems,
      subtotal,
    })

    // Mark draft cart as confirmed so it cannot be re-confirmed
    await markDraftCartConfirmed(db, accountId, contactId)

    const confirmationMsg =
      `📋 *Order #${newOrder.order_number} Received!*\n\n` +
      `Items:\n${trialItems.map((i) => `• ${i.quantity}x ${i.name} - ₹${i.total_price}`).join('\n')}\n` +
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
