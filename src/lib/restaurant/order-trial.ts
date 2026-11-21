import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendText, engineSendInteractiveButtons, engineSendMedia } from '@/lib/flows/meta-send'

export type TrialOrderStatus =
  | 'pending_kitchen'
  | 'kitchen_accepted'
  | 'kitchen_rejected'
  | 'fulfilment_pending'
  | 'payment_pending'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'

export type FulfilmentType = 'delivery' | 'takeaway'
export type PaymentMethod = 'cash' | 'upi'
export type PaymentStatus = 'pending_collection' | 'awaiting_verification' | 'verified'

export interface TrialOrderItem {
  name: string
  quantity: number
  unit_price: number
  total_price: number
  duration_minutes?: number
}

export interface TrialOrder {
  id: string
  account_id: string
  contact_id: string
  conversation_id: string | null
  ordering_session_id: string | null
  order_number: string
  status: TrialOrderStatus
  items: TrialOrderItem[]
  subtotal: number
  delivery_fee: number
  total_amount: number
  fulfilment_type: FulfilmentType | null
  delivery_address: string | null
  delivery_location: Record<string, unknown> | null
  payment_method: PaymentMethod | null
  payment_status: PaymentStatus | null
  is_test_order: boolean
  kitchen_decision_by: string | null
  kitchen_decision_at: string | null
  kitchen_rejection_reason: string | null
  payment_confirmed_by: string | null
  payment_confirmed_at: string | null
  preparation_started_at: string | null
  estimated_prep_minutes: number | null
  created_at: string
  updated_at: string
}

export interface TrialItemTimer {
  id: string
  order_id: string
  account_id: string
  item_name: string
  quantity: number
  unit_price: number
  total_price: number
  duration_minutes: number
  started_at: string | null
  expires_at: string | null
  status: 'pending' | 'preparing' | 'completed'
  created_at: string
}

export interface RestaurantTrialSettings {
  accountId: string
  restaurantName: string
  restaurantAddress: string
  pickupInstructions: string
  deliveryFee: number
  testUpiId: string
  testQrCodeUrl: string | null
  defaultPrepMinutes: number
  itemPrepDurations: Record<string, number>
}

export const DEFAULT_TRIAL_SETTINGS: Omit<RestaurantTrialSettings, 'accountId'> = {
  restaurantName: 'The Illusion Cafe & Restaurant',
  restaurantAddress: 'The Illusion Cafe & Restaurant, Main Market / Station Road',
  pickupInstructions: 'Please collect your order at the counter when notified.',
  deliveryFee: 20.0,
  testUpiId: '9352326442-8@ybl',
  testQrCodeUrl: null,
  defaultPrepMinutes: 15,
  itemPrepDurations: {
    pizza: 20,
    burger: 12,
    pasta: 15,
    coffee: 5,
    tea: 5,
    beverage: 5,
    sandwich: 10,
    fries: 8,
  },
}

/**
 * Fetch trial settings for an account, falling back to defaults if not yet configured.
 */
export async function getRestaurantTrialSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<RestaurantTrialSettings> {
  const { data, error } = await db
    .from('restaurant_trial_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !data) {
    return {
      accountId,
      ...DEFAULT_TRIAL_SETTINGS,
    }
  }

  return {
    accountId: data.account_id,
    restaurantName: data.restaurant_name ?? DEFAULT_TRIAL_SETTINGS.restaurantName,
    restaurantAddress: data.restaurant_address ?? DEFAULT_TRIAL_SETTINGS.restaurantAddress,
    pickupInstructions: data.pickup_instructions ?? DEFAULT_TRIAL_SETTINGS.pickupInstructions,
    deliveryFee: Number(data.delivery_fee) || DEFAULT_TRIAL_SETTINGS.deliveryFee,
    testUpiId: data.test_upi_id ?? DEFAULT_TRIAL_SETTINGS.testUpiId,
    testQrCodeUrl: data.test_qr_code_url ?? DEFAULT_TRIAL_SETTINGS.testQrCodeUrl,
    defaultPrepMinutes: Number(data.default_prep_minutes) || DEFAULT_TRIAL_SETTINGS.defaultPrepMinutes,
    itemPrepDurations: data.item_prep_durations ?? DEFAULT_TRIAL_SETTINGS.itemPrepDurations,
  }
}

/**
 * Resolve item preparation duration based on item name and configured durations.
 */
export function resolveItemPrepDuration(
  itemName: string,
  settings: RestaurantTrialSettings,
): number {
  const normalized = itemName.toLowerCase().trim()
  for (const [key, duration] of Object.entries(settings.itemPrepDurations)) {
    if (normalized.includes(key.toLowerCase())) {
      return Number(duration) || settings.defaultPrepMinutes
    }
  }
  return settings.defaultPrepMinutes
}

/**
 * Find the active (non-terminal) trial order for a customer.
 */
export async function getActiveTrialOrder(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<TrialOrder | null> {
  const { data, error } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .not('status', 'in', '("completed","cancelled","kitchen_rejected")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[order-trial] getActiveTrialOrder error:', error)
    return null
  }

  return (data as TrialOrder | null) ?? null
}

export interface CreateTrialOrderArgs {
  accountId: string
  contactId: string
  conversationId?: string | null
  orderingSessionId?: string | null
  items: TrialOrderItem[]
  subtotal: number
}

/**
 * Create a persistent trial order in `pending_kitchen` status.
 * Prevents duplicates if an active pending kitchen order already exists.
 */
export async function createTrialOrder(
  db: SupabaseClient,
  args: CreateTrialOrderArgs,
): Promise<TrialOrder> {
  const { accountId, contactId, conversationId, orderingSessionId, items, subtotal } = args

  // Check if an existing pending_kitchen order already exists to prevent duplicate processing
  const existing = await getActiveTrialOrder(db, accountId, contactId)
  if (existing && existing.status === 'pending_kitchen') {
    return existing
  }

  const settings = await getRestaurantTrialSettings(db, accountId)
  const orderNumber = `ORD-${Date.now().toString().slice(-6)}`

  // Enrich items with duration
  const enrichedItems: TrialOrderItem[] = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price || item.unit_price * item.quantity,
    duration_minutes: item.duration_minutes || resolveItemPrepDuration(item.name, settings),
  }))

  const { data: order, error } = await db
    .from('restaurant_trial_orders')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      ordering_session_id: orderingSessionId,
      order_number: orderNumber,
      status: 'pending_kitchen',
      items: enrichedItems,
      subtotal,
      delivery_fee: 0.0,
      total_amount: subtotal,
      is_test_order: true,
    })
    .select('*')
    .single()

  if (error || !order) {
    console.error('[order-trial] createTrialOrder failed:', error)
    throw new Error(`Failed to create trial order: ${error?.message}`)
  }

  // Create item records
  const itemRows = enrichedItems.map((item) => ({
    order_id: order.id,
    account_id: accountId,
    item_name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    total_price: item.total_price,
    duration_minutes: item.duration_minutes,
    status: 'pending',
  }))

  const { error: itemError } = await db
    .from('restaurant_trial_order_items')
    .insert(itemRows)

  if (itemError) {
    console.error('[order-trial] item insertion failed:', itemError)
  }

  return order as TrialOrder
}

/**
 * Handle staff kitchen acceptance of an order.
 * - Persists accepted status
 * - Sends WhatsApp message asking Delivery or Takeaway
 * - Transitions order to fulfilment_pending
 */
export async function acceptKitchenOrder(
  db: SupabaseClient,
  args: {
    orderId: string
    accountId: string
    userId: string
    configOwnerUserId?: string
  },
): Promise<TrialOrder> {
  const { orderId, accountId, userId, configOwnerUserId = userId } = args

  // Guard: fetch order and check status
  const { data: order, error } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .single()

  if (error || !order) {
    throw new Error('Order not found')
  }

  if (order.status !== 'pending_kitchen') {
    throw new Error(`Cannot accept order with status '${order.status}' (already processed)`)
  }

  const nowIso = new Date().toISOString()

  const { data: updated, error: updateError } = await db
    .from('restaurant_trial_orders')
    .update({
      status: 'fulfilment_pending',
      kitchen_decision_by: userId,
      kitchen_decision_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', orderId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (updateError || !updated) {
    throw new Error(`Failed to accept order: ${updateError?.message}`)
  }

  // Send WhatsApp message to customer automatically
  if (order.conversation_id && order.contact_id) {
    const promptText =
      `✅ *Great news!* Your order *#${order.order_number}* has been *ACCEPTED* by the kitchen.\n\n` +
      `Would you like *Delivery* or *Takeaway*?`

    try {
      await engineSendInteractiveButtons({
        accountId,
        userId: configOwnerUserId,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        bodyText: promptText,
        buttons: [
          { id: 'fulfilment_delivery', title: '🛵 Delivery' },
          { id: 'fulfilment_takeaway', title: '🛍️ Takeaway' },
        ],
      })
    } catch {
      // Fallback to plain text if interactive buttons encounter issues
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        text: `${promptText}\n\n(Please reply "Delivery" or "Takeaway")`,
      }).catch((err) => console.error('[order-trial] accept notification failed:', err))
    }
  }

  return updated as TrialOrder
}

/**
 * Handle staff kitchen rejection of an order.
 * - Persists rejection status
 * - Sends WhatsApp message informing customer
 * - Stops the order workflow
 */
export async function rejectKitchenOrder(
  db: SupabaseClient,
  args: {
    orderId: string
    accountId: string
    userId: string
    reason?: string
    configOwnerUserId?: string
  },
): Promise<TrialOrder> {
  const { orderId, accountId, userId, reason, configOwnerUserId = userId } = args

  const { data: order, error } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .single()

  if (error || !order) {
    throw new Error('Order not found')
  }

  if (order.status !== 'pending_kitchen') {
    throw new Error(`Cannot reject order with status '${order.status}' (already processed)`)
  }

  const nowIso = new Date().toISOString()

  const { data: updated, error: updateError } = await db
    .from('restaurant_trial_orders')
    .update({
      status: 'kitchen_rejected',
      kitchen_decision_by: userId,
      kitchen_decision_at: nowIso,
      kitchen_rejection_reason: reason || 'Kitchen is currently unable to fulfill this order',
      updated_at: nowIso,
    })
    .eq('id', orderId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (updateError || !updated) {
    throw new Error(`Failed to reject order: ${updateError?.message}`)
  }

  // Send WhatsApp notification to customer
  if (order.conversation_id && order.contact_id) {
    const reasonText = reason ? `\nReason: ${reason}` : ''
    const rejectionMessage =
      `❌ We're sorry, but the kitchen could not accept your order *#${order.order_number}* at this time.${reasonText}\n\n` +
      `Thank you for reaching out to us!`

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId: order.conversation_id,
      contactId: order.contact_id,
      text: rejectionMessage,
    }).catch((err) => console.error('[order-trial] reject notification failed:', err))
  }

  return updated as TrialOrder
}

/**
 * Calculate delivery fee based on the restaurant's official policy:
 * - Orders of ₹300 or above: FREE delivery (₹0.00)
 * - Orders below ₹300: ₹20.00 delivery fee (or configured fee)
 */
export function calculateDeliveryFee(subtotal: number, baseFee: number = 20): number {
  if (subtotal >= 300) {
    return 0.0
  }
  return baseFee > 0 ? baseFee : 20.0
}

/**
 * Update fulfilment method (Delivery or Takeaway) and transition to payment_pending.
 */
export async function updateOrderFulfilment(
  db: SupabaseClient,
  args: {
    orderId: string
    accountId: string
    fulfilmentType: FulfilmentType
    address?: string | null
    location?: Record<string, unknown> | null
    configOwnerUserId?: string
  },
): Promise<{ order: TrialOrder; messageText: string }> {
  const { orderId, accountId, fulfilmentType, address, location, configOwnerUserId } = args

  const { data: order, error } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .single()

  if (error || !order) throw new Error('Order not found')

  const settings = await getRestaurantTrialSettings(db, accountId)
  const deliveryFee =
    fulfilmentType === 'delivery'
      ? calculateDeliveryFee(Number(order.subtotal), settings.deliveryFee)
      : 0.0
  const totalAmount = Number(order.subtotal) + deliveryFee
  const nowIso = new Date().toISOString()

  const { data: updated, error: updateError } = await db
    .from('restaurant_trial_orders')
    .update({
      fulfilment_type: fulfilmentType,
      delivery_address: address ?? null,
      delivery_location: location ?? null,
      delivery_fee: deliveryFee,
      total_amount: totalAmount,
      status: 'payment_pending',
      updated_at: nowIso,
    })
    .eq('id', orderId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (updateError || !updated) {
    throw new Error(`Failed to update fulfilment: ${updateError?.message}`)
  }

  let messageText = ''
  if (fulfilmentType === 'delivery') {
    const addrText = address ? `\n📍 Delivery Address: ${address}` : ''
    const feeText = deliveryFee === 0 ? 'FREE (₹0.00 for orders ₹300+)' : `₹${deliveryFee}`
    messageText =
      `🛵 *Delivery Confirmed!*${addrText}\n` +
      `Subtotal: ₹${order.subtotal}\n` +
      `Delivery Fee: ${feeText}\n` +
      `*Total Amount: ₹${totalAmount}*\n\n` +
      `How would you like to pay? Please choose *Cash* or *UPI / Online*.`
  } else {
    messageText =
      `🛍️ *Takeaway Confirmed!*\n` +
      `📍 Pickup Address: ${settings.restaurantAddress}\n` +
      `ℹ️ ${settings.pickupInstructions}\n\n` +
      `*Total Amount: ₹${totalAmount}*\n\n` +
      `How would you like to pay? Please choose *Cash* or *UPI / Online*.`
  }

  if (order.conversation_id && order.contact_id && configOwnerUserId) {
    try {
      await engineSendInteractiveButtons({
        accountId,
        userId: configOwnerUserId,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        bodyText: messageText,
        buttons: [
          { id: 'pay_cash', title: '💵 Cash' },
          { id: 'pay_upi', title: '📱 UPI / Online' },
        ],
      })
    } catch {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        text: `${messageText}\n\n(Please reply "Cash" or "UPI")`,
      }).catch((err) => console.error('[order-trial] payment prompt failed:', err))
    }
  }

  return { order: updated as TrialOrder, messageText }
}

/**
 * Process customer payment method choice (Cash or UPI).
 * - Cash: sets payment_status='pending_collection', status='preparing', starts preparation timers immediately!
 * - UPI: sets payment_status='awaiting_verification', sends TEST UPI/QR details, awaits staff manual verification.
 */
export async function processPaymentMethod(
  db: SupabaseClient,
  args: {
    orderId: string
    accountId: string
    paymentMethod: PaymentMethod
    configOwnerUserId?: string
  },
): Promise<{ order: TrialOrder; messageText: string }> {
  const { orderId, accountId, paymentMethod, configOwnerUserId } = args

  const { data: order, error } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .single()

  if (error || !order) throw new Error('Order not found')

  // Validation: Order must be in payment_pending status and accepted by kitchen
  if (order.status === 'pending_kitchen') {
    throw new Error('Order is awaiting kitchen confirmation before payment can be selected')
  }
  if (order.status === 'kitchen_rejected') {
    throw new Error('Cannot process payment for a rejected order')
  }
  if (order.payment_status === 'verified') {
    throw new Error('Payment is already verified for this order')
  }

  // Prevent duplicate QR and payment messages from webhook retries or repeated customer button taps
  if (
    paymentMethod === 'upi' &&
    order.payment_status === 'awaiting_verification' &&
    order.payment_method === 'upi'
  ) {
    const duplicateNotice =
      `📱 Your payment for order *#${order.order_number}* is already *awaiting staff verification*.\n\n` +
      `Our staff will confirm receipt shortly, and your preparation timer will begin immediately upon confirmation.`
    return { order: order as TrialOrder, messageText: duplicateNotice }
  }

  const settings = await getRestaurantTrialSettings(db, accountId)
  const nowIso = new Date().toISOString()

  if (paymentMethod === 'cash') {
    // Cash: Authorize preparation immediately without marking payment as received
    const { data: updated, error: updateError } = await db
      .from('restaurant_trial_orders')
      .update({
        payment_method: 'cash',
        payment_status: 'pending_collection',
        status: 'preparing',
        preparation_started_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', orderId)
      .eq('account_id', accountId)
      .select('*')
      .single()

    if (updateError || !updated) throw new Error(updateError?.message)

    // Start item-wise countdown timers
    const timers = await startItemTimers(db, orderId, accountId)
    const maxDuration = Math.max(...timers.map((t) => t.duration_minutes), settings.defaultPrepMinutes)

    const messageText =
      `💵 *Payment Method: Cash* (payable at ${order.fulfilment_type === 'delivery' ? 'delivery' : 'pickup'}).\n\n` +
      `👨‍🍳 *Chef has started preparing your order!* Estimated preparation time: ~${maxDuration} minutes.\n` +
      `We will notify you once your order is ready!`

    if (order.conversation_id && order.contact_id && configOwnerUserId) {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        text: messageText,
      }).catch((err) => console.error('[order-trial] cash confirmation send failed:', err))
    }

    return { order: updated as TrialOrder, messageText }
  } else {
    // UPI / Online: Awaiting manual staff verification
    const { data: updated, error: updateError } = await db
      .from('restaurant_trial_orders')
      .update({
        payment_method: 'upi',
        payment_status: 'awaiting_verification',
        updated_at: nowIso,
      })
      .eq('id', orderId)
      .eq('account_id', accountId)
      .select('*')
      .single()

    if (updateError || !updated) throw new Error(updateError?.message)

    const upiId = settings.testUpiId || '9352326442-8@ybl'
    const qrUrl = settings.testQrCodeUrl

    // 1. Deliver QR image via WhatsApp media if configured
    let mediaSent = false
    if (qrUrl && order.conversation_id && order.contact_id && configOwnerUserId) {
      try {
        await engineSendMedia({
          accountId,
          userId: configOwnerUserId,
          conversationId: order.conversation_id,
          contactId: order.contact_id,
          kind: 'image',
          link: qrUrl,
          caption: `PhonePe QR - ${settings.restaurantName}`,
        })
        mediaSent = true
      } catch (mediaErr) {
        console.error(
          '[order-trial] Failed to deliver PhonePe QR code media:',
          mediaErr instanceof Error ? mediaErr.message : String(mediaErr),
        )
      }
    }

    const payableAmount = order.total_amount ?? order.subtotal ?? 0

    // 2. Format payment instructions
    const messageText = mediaSent
      ? `📱 *UPI / Online Payment*\n\n` +
        `💳 *UPI ID:* ${upiId}\n\n` +
        `💰 *Amount Payable: ₹${payableAmount}*\n\n` +
        `📸 Scan the QR code above or use the UPI ID to pay.\n\n` +
        `✅ After completing payment, reply *Paid*.\n\n` +
        `⏳ Our restaurant staff will manually verify payment before preparation begins.`
      : qrUrl
        ? `📱 *UPI / Online Payment*\n\n` +
          `💳 *UPI ID:* ${upiId}\n\n` +
          `💰 *Amount Payable: ₹${payableAmount}*\n\n` +
          `⚠️ *Notice:* We could not deliver the QR code image at this moment. Please use the UPI ID above to complete your payment, or request our staff for assistance.\n\n` +
          `✅ After completing payment, reply *Paid*.\n\n` +
          `⏳ Our restaurant staff will manually verify payment before preparation begins.`
        : `📱 *UPI / Online Payment*\n\n` +
          `💳 *UPI ID:* ${upiId}\n\n` +
          `💰 *Amount Payable: ₹${payableAmount}*\n\n` +
          `📲 Please use the UPI ID above to complete your payment.\n\n` +
          `✅ After completing payment, reply *Paid*.\n\n` +
          `⏳ Our restaurant staff will manually verify payment before preparation begins.`

    if (order.conversation_id && order.contact_id && configOwnerUserId) {
      await engineSendText({
        accountId,
        userId: configOwnerUserId,
        conversationId: order.conversation_id,
        contactId: order.contact_id,
        text: messageText,
      }).catch((err) => console.error('[order-trial] upi details send failed:', err))
    }

    return { order: updated as TrialOrder, messageText }
  }
}

/**
 * Staff manual confirmation of UPI payment.
 * - Updates payment_status to 'verified'
 * - Starts preparation and triggers item countdown timers!
 * - Sends customer notification
 */
export async function confirmUpiPayment(
  db: SupabaseClient,
  args: {
    orderId: string
    accountId: string
    userId: string
    configOwnerUserId?: string
  },
): Promise<TrialOrder> {
  const { orderId, accountId, userId, configOwnerUserId = userId } = args

  const { data: order, error } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .single()

  if (error || !order) throw new Error('Order not found')

  if (order.payment_method !== 'upi' || order.payment_status === 'verified') {
    throw new Error('Order is not awaiting UPI payment verification')
  }

  const settings = await getRestaurantTrialSettings(db, accountId)
  const nowIso = new Date().toISOString()

  const { data: updated, error: updateError } = await db
    .from('restaurant_trial_orders')
    .update({
      payment_status: 'verified',
      payment_confirmed_at: nowIso,
      payment_confirmed_by: userId,
      status: 'preparing',
      preparation_started_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', orderId)
    .eq('account_id', accountId)
    .select('*')
    .single()

  if (updateError || !updated) throw new Error(updateError?.message)

  // Start item countdown timers
  const timers = await startItemTimers(db, orderId, accountId)
  const maxDuration = Math.max(...timers.map((t) => t.duration_minutes), settings.defaultPrepMinutes)

  if (order.conversation_id && order.contact_id) {
    const notifyText =
      `✅ *Payment Verified!* Your online payment of ₹${order.total_amount} has been confirmed by our staff.\n\n` +
      `👨‍🍳 *Chef has started preparing your order!* Estimated preparation time: ~${maxDuration} minutes.`

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId: order.conversation_id,
      contactId: order.contact_id,
      text: notifyText,
    }).catch((err) => console.error('[order-trial] upi verification notification failed:', err))
  }

  return updated as TrialOrder
}

/**
 * Start and persist separate preparation countdown for each ordered item using database timestamps.
 * Resilient to page refreshes and server restarts.
 */
export async function startItemTimers(
  db: SupabaseClient,
  orderId: string,
  accountId: string,
  now: Date = new Date(),
): Promise<TrialItemTimer[]> {
  const { data: items, error } = await db
    .from('restaurant_trial_order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('account_id', accountId)

  if (error || !items || items.length === 0) return []

  const nowIso = now.toISOString()
  const updatedTimers: TrialItemTimer[] = []

  for (const item of items) {
    // Only start if not already preparing or completed
    if (item.status === 'pending') {
      const expiresAt = new Date(now.getTime() + item.duration_minutes * 60 * 1000).toISOString()
      const { data: updated } = await db
        .from('restaurant_trial_order_items')
        .update({
          started_at: nowIso,
          expires_at: expiresAt,
          status: 'preparing',
        })
        .eq('id', item.id)
        .select('*')
        .single()

      if (updated) updatedTimers.push(updated as TrialItemTimer)
    } else {
      updatedTimers.push(item as TrialItemTimer)
    }
  }

  // Update order's estimated prep minutes
  const maxMinutes = Math.max(...updatedTimers.map((t) => t.duration_minutes), 15)
  await db
    .from('restaurant_trial_orders')
    .update({
      estimated_prep_minutes: maxMinutes,
      preparation_started_at: nowIso,
    })
    .eq('id', orderId)
    .eq('account_id', accountId)

  return updatedTimers
}

/**
 * Fetch all item countdown timers for an order.
 */
export async function getTrialOrderTimers(
  db: SupabaseClient,
  orderId: string,
  accountId: string,
): Promise<TrialItemTimer[]> {
  const { data, error } = await db
    .from('restaurant_trial_order_items')
    .select('*')
    .eq('order_id', orderId)
    .eq('account_id', accountId)
    .order('duration_minutes', { ascending: false })

  if (error) {
    console.error('[order-trial] getTrialOrderTimers failed:', error)
    return []
  }

  return (data as TrialItemTimer[]) ?? []
}

/**
 * Extract [[ORDER_CONFIRMED: {...}]] marker from LLM output.
 */
export function extractOrderConfirmedMarker(text: string): {
  cleanText: string
  payload: { items: TrialOrderItem[]; subtotal: number } | null
} {
  const match = text.match(/\[\[ORDER_CONFIRMED:\s*(\{[\s\S]*?\})\s*\]\]/)
  if (!match) {
    return { cleanText: text, payload: null }
  }

  try {
    const raw = JSON.parse(match[1])
    const items: TrialOrderItem[] = Array.isArray(raw.items)
      ? raw.items.map((i: Record<string, unknown>) => ({
          name: String(i.name || 'Menu Item'),
          quantity: Math.max(1, Number(i.quantity) || 1),
          unit_price: Number(i.unit_price) || 0,
          total_price:
            Number(i.total_price) ||
            (Number(i.unit_price) || 0) * Math.max(1, Number(i.quantity) || 1),
        }))
      : []

    const subtotal =
      Number(raw.subtotal) || items.reduce((acc, i) => acc + i.total_price, 0)
    const cleanText = text.replace(match[0], '').trim()
    return { cleanText, payload: { items, subtotal } }
  } catch (err) {
    console.warn('[order-trial] failed to parse ORDER_CONFIRMED marker:', err)
    return { cleanText: text.replace(match[0], '').trim(), payload: null }
  }
}

