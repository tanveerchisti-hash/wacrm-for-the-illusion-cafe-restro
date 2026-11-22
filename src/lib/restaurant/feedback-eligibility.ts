import type { SupabaseClient } from '@supabase/supabase-js'
import { checkConversationWindow, validateTemplateApproved, type ConversationWindowCheck } from '@/lib/backend-flows/engine/whatsapp-sender'
import { maskPhoneNumber } from '@/lib/backend-flows/engine/recipient-resolver'

export interface FeedbackEligibilityResult {
  eligible: boolean
  skipped?: boolean
  shouldRetry?: boolean
  code?: string
  reason?: string
  order?: Record<string, unknown>
  contact?: Record<string, unknown>
  customerPhone?: string
  customerName?: string
  windowCheck?: ConversationWindowCheck
  metadata?: Record<string, unknown>
}

export interface FeedbackEligibilityArgs {
  accountId: string
  orderId?: string | null
  contactId?: string | null
  conversationId?: string | null
  isDryRun?: boolean
  supabase: SupabaseClient
}

/** Standard opt-out and DND tags recognized across WACRM */
export const OPT_OUT_TAGS = [
  'opt_out',
  'opt-out',
  'dnd',
  'do_not_disturb',
  'unsubscribe',
  'no_marketing',
  'no_promotions',
]

/** Tags identifying internal cafe or restaurant staff */
export const STAFF_TAGS = ['staff', 'employee', 'internal', 'chef', 'driver', 'admin']

/**
 * Checks whether a list of contact tags contains any matching string (case-insensitive).
 */
export function hasMatchingTag(contactTags: string[] | null | undefined, targetTags: string[]): boolean {
  if (!Array.isArray(contactTags) || contactTags.length === 0) return false
  const normalized = contactTags.map((t) => String(t).trim().toLowerCase())
  return targetTags.some((target) => normalized.includes(target.toLowerCase()))
}

/**
 * Phase 3: Validates customer feedback eligibility before scheduling the 20-minute delay.
 * Database-level checks ensure tenant isolation, completed order state, customer consent,
 * staff exclusion, and ledger idempotency.
 */
export async function validateRestaurantFeedbackEligibility(
  args: FeedbackEligibilityArgs
): Promise<FeedbackEligibilityResult> {
  const { accountId, orderId, isDryRun, supabase } = args

  if (!accountId || !orderId) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'MISSING_REQUIRED_IDENTIFIERS',
      reason: 'Order ID and Account ID are required for feedback validation.',
    }
  }

  // 1. Fetch order scoped strictly by account_id (tenant isolation)
  const { data: order, error: orderErr } = await supabase
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (orderErr || !order) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'ORDER_NOT_FOUND',
      reason: `Order ${orderId} does not exist in account ${accountId}.`,
    }
  }

  // 2. Validate Order State: Must be strictly 'completed'
  if (order.status !== 'completed') {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'ORDER_NOT_COMPLETED',
      reason: `Order ${order.order_number || orderId} is in status '${order.status}', expected 'completed'.`,
      order,
    }
  }

  // 3. Test Order Isolation Guard
  // Test orders are prohibited from sending production customer feedback messages.
  const isLiveSendEnabled = process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND === 'true'
  if (order.is_test_order && isLiveSendEnabled && !isDryRun) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'TEST_ORDER_SKIPPED',
      reason: `Order ${order.order_number} is marked is_test_order=true; production feedback is suppressed.`,
      order,
    }
  }

  // 4. Resolve Contact & Customer Relationship
  const contactId = args.contactId || order.contact_id
  if (!contactId) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'MISSING_CUSTOMER_CONTACT',
      reason: `Order ${order.order_number} has no associated customer contact ID.`,
      order,
    }
  }

  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('id, name, phone, tags, metadata')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (contactErr || !contact) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'CONTACT_NOT_FOUND',
      reason: `Contact ${contactId} does not exist in account ${accountId}.`,
      order,
    }
  }

  // 5. Consent & Opt-Out Verification
  const contactTags: string[] = Array.isArray(contact.tags) ? contact.tags : []
  if (hasMatchingTag(contactTags, OPT_OUT_TAGS)) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'CUSTOMER_OPTED_OUT',
      reason: `Customer ${contact.name || maskPhoneNumber(contact.phone)} has opted out of automated messaging (tags: ${contactTags.join(', ')}).`,
      order,
      contact,
    }
  }

  // 6. Staff / Internal User Exclusion Guard
  if (hasMatchingTag(contactTags, STAFF_TAGS)) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'STAFF_RECIPIENT_EXCLUDED',
      reason: `Recipient is identified as internal restaurant staff (tags: ${contactTags.join(', ')}).`,
      order,
      contact,
    }
  }

  // 7. Tenant-Scoped Feedback Dispatch Ledger Check (Atomic Idempotency)
  // Ensures that for a given (account_id, order_id, 'customer_order_feedback'),
  // only one feedback workflow can ever be initiated.
  if (!isDryRun) {
    const { data: existingLedger } = await supabase
      .from('restaurant_feedback_dispatch_ledger')
      .select('id, status, whatsapp_message_id, created_at')
      .eq('account_id', accountId)
      .eq('order_id', orderId)
      .eq('feedback_purpose', 'customer_order_feedback')
      .maybeSingle()

    if (existingLedger) {
      const activeStatuses = ['initiated', 'pending_send', 'submitted_to_meta', 'sent', 'delivered', 'read']
      if (activeStatuses.includes(existingLedger.status)) {
        return {
          eligible: false,
          skipped: true,
          shouldRetry: false,
          code: 'FEEDBACK_ALREADY_INITIATED',
          reason: `Feedback for order ${order.order_number} has already been recorded in ledger with status '${existingLedger.status}'.`,
          order,
          contact,
        }
      }
    } else {
      // Initialize atomic claim in ledger
      await supabase
        .from('restaurant_feedback_dispatch_ledger')
        .insert({
          account_id: accountId,
          order_id: orderId,
          contact_id: contact.id,
          conversation_id: order.conversation_id || args.conversationId || null,
          feedback_purpose: 'customer_order_feedback',
          status: 'initiated',
          is_test_order: !!order.is_test_order,
          metadata: { orderNumber: order.order_number },
        })
        .select('id')
        .maybeSingle()
    }
  }

  return {
    eligible: true,
    order,
    contact,
    customerPhone: contact.phone,
    customerName: contact.name || undefined,
  }
}

/**
 * Phase 5: Pre-Send Revalidation immediately before WhatsApp feedback dispatch.
 * Re-queries live database state after the 20-minute delay expires.
 */
export async function revalidateRestaurantFeedbackEligibility(
  args: FeedbackEligibilityArgs
): Promise<FeedbackEligibilityResult> {
  const { accountId, orderId, isDryRun, supabase } = args

  if (!accountId || !orderId) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'MISSING_REQUIRED_IDENTIFIERS',
      reason: 'Order ID and Account ID are required for pre-send revalidation.',
    }
  }

  // 1. Re-check Order Status
  const { data: order, error: orderErr } = await supabase
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (orderErr || !order) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'ORDER_NOT_FOUND',
      reason: 'Order could not be found during pre-send revalidation.',
    }
  }

  // If order was cancelled, refunded, or altered during the 20-minute delay:
  if (order.status !== 'completed') {
    if (!isDryRun) {
      await updateFeedbackLedgerStatus(supabase, {
        accountId,
        orderId,
        status: 'blocked',
        blockReason: `Order status changed from completed to '${order.status}' during delay.`,
      })
    }

    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'ORDER_STATUS_CHANGED',
      reason: `Order ${order.order_number} is now in status '${order.status}'. Feedback send cancelled.`,
      order,
    }
  }

  // 2. Re-check Customer Consent & Opt-Out
  const contactId = args.contactId || order.contact_id
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, name, phone, tags')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (!contact) {
    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'CONTACT_NOT_FOUND',
      reason: 'Customer contact could not be found during pre-send revalidation.',
      order,
    }
  }

  const contactTags: string[] = Array.isArray(contact.tags) ? contact.tags : []
  if (hasMatchingTag(contactTags, OPT_OUT_TAGS)) {
    if (!isDryRun) {
      await updateFeedbackLedgerStatus(supabase, {
        accountId,
        orderId,
        status: 'blocked',
        blockReason: 'Customer opted out during delay period.',
      })
    }

    return {
      eligible: false,
      skipped: true,
      shouldRetry: false,
      code: 'CUSTOMER_OPTED_OUT',
      reason: `Customer ${contact.name || maskPhoneNumber(contact.phone)} opted out during the delay period.`,
      order,
      contact,
    }
  }

  // 3. Re-check Ledger State (Duplicate Send Prevention)
  if (!isDryRun) {
    const { data: ledger } = await supabase
      .from('restaurant_feedback_dispatch_ledger')
      .select('id, status, whatsapp_message_id')
      .eq('account_id', accountId)
      .eq('order_id', orderId)
      .eq('feedback_purpose', 'customer_order_feedback')
      .maybeSingle()

    if (ledger) {
      const alreadySentStatuses = ['submitted_to_meta', 'sent', 'delivered', 'read']
      if (alreadySentStatuses.includes(ledger.status)) {
        return {
          eligible: false,
          skipped: true,
          shouldRetry: false,
          code: 'FEEDBACK_ALREADY_SENT',
          reason: `Feedback already submitted to Meta (status: ${ledger.status}, wamid: ${ledger.whatsapp_message_id}).`,
          order,
          contact,
        }
      }
    }
  }

  // 4. Policy Check: Meta 24-Hour Customer Service Window & Template Compliance
  const conversationId = order.conversation_id || args.conversationId
  const windowCheck = await checkConversationWindow(supabase, conversationId)

  // If outside 24h window, verify that an approved template exists
  if (!windowCheck.isOpen) {
    let templateValidation = await validateTemplateApproved(supabase, accountId, 'customer_feedback', 'en')
    if (!templateValidation.approved) {
      const fallbackValidation = await validateTemplateApproved(supabase, accountId, 'illusion_cafe_service_update', 'en')
      if (fallbackValidation.approved) {
        templateValidation = fallbackValidation
      }
    }
    if (!templateValidation.approved) {
      if (!isDryRun) {
        await updateFeedbackLedgerStatus(supabase, {
          accountId,
          orderId,
          status: 'blocked',
          blockReason: `24-hour window closed and approved template 'customer_feedback' is missing: ${templateValidation.reason}`,
        })
      }

      return {
        eligible: false,
        skipped: true,
        shouldRetry: false,
        code: 'TEMPLATE_UNAVAILABLE_OUTSIDE_WINDOW',
        reason: `24-hour customer service window expired, and approved template is unavailable: ${templateValidation.reason}`,
        windowCheck,
        order,
        contact,
      }
    }
  }

  return {
    eligible: true,
    order,
    contact,
    customerPhone: contact.phone,
    customerName: contact.name || undefined,
    windowCheck,
  }
}

/**
 * Updates the feedback dispatch ledger status and synchronizes with restaurant_trial_orders.
 */
export async function updateFeedbackLedgerStatus(
  supabase: SupabaseClient,
  options: {
    accountId: string
    orderId: string
    status: 'initiated' | 'pending_send' | 'submitted_to_meta' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | 'blocked'
    blockReason?: string | null
    whatsappMessageId?: string | null
    templateName?: string | null
    templateCategory?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  const { accountId, orderId, status, blockReason, whatsappMessageId, templateName, templateCategory, metadata } = options

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (blockReason !== undefined) patch.block_reason = blockReason
  if (whatsappMessageId !== undefined) patch.whatsapp_message_id = whatsappMessageId
  if (templateName !== undefined) patch.template_name = templateName
  if (templateCategory !== undefined) patch.template_category = templateCategory
  if (status === 'submitted_to_meta') patch.submitted_at = new Date().toISOString()
  if (status === 'delivered') patch.delivered_at = new Date().toISOString()
  if (metadata) patch.metadata = metadata

  try {
    await supabase
      .from('restaurant_feedback_dispatch_ledger')
      .update(patch)
      .eq('account_id', accountId)
      .eq('order_id', orderId)
      .eq('feedback_purpose', 'customer_order_feedback')

    // Also update high-level status on restaurant_trial_orders
    const orderPatch: Record<string, unknown> = {}
    if (status === 'submitted_to_meta' || status === 'sent') {
      orderPatch.feedback_requested_at = new Date().toISOString()
      orderPatch.feedback_status = 'submitted'
    } else if (status === 'delivered') {
      orderPatch.feedback_status = 'delivered'
    } else if (status === 'blocked' || status === 'skipped') {
      orderPatch.feedback_status = status
    } else if (status === 'failed') {
      orderPatch.feedback_status = 'failed'
    }

    if (Object.keys(orderPatch).length > 0) {
      await supabase
        .from('restaurant_trial_orders')
        .update(orderPatch)
        .eq('id', orderId)
        .eq('account_id', accountId)
    }
  } catch (err) {
    console.error('[feedback-ledger] Error updating ledger status:', err)
  }
}
