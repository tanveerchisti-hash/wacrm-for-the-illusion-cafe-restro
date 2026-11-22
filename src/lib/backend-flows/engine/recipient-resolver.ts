import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  isValidE164,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils'
import {
  resolveContactSendTarget,
} from '@/lib/whatsapp/wa-identity'

export type RecipientErrorCode =
  | 'RECIPIENT_NOT_FOUND'
  | 'RECIPIENT_INVALID'
  | 'RECIPIENT_TENANT_MISMATCH'
  | 'RECIPIENT_TEST_MODE_BLOCKED'

export interface ResolvedRecipient {
  success: boolean
  contactId?: string
  contactName?: string | null
  conversationId?: string | null
  phone?: string // Digits-only normalized for Meta API
  formattedPhone?: string // International standard with leading +
  isPhone: boolean
  waUserId?: string | null
  accountId: string
  isTestRecipient: boolean
  eligibleForSend: boolean
  errorCode?: RecipientErrorCode
  errorMessage?: string
}

export interface ResolveRecipientParams {
  accountId: string
  orderId?: string | null
  contactId?: string | null
  conversationId?: string | null
  directPhone?: string | null
  directName?: string | null
  isTestOrder?: boolean
  isSimulation?: boolean
  enforceTestWhitelist?: boolean
  testRecipientsOverride?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
}

/**
 * Safely masks a phone number or WhatsApp ID for privacy in logs and execution traces.
 * e.g. "+919876543210" -> "+91*****3210"
 * e.g. "US.1234567890" -> "US.*****7890"
 */
export function maskPhoneNumber(phoneOrId: string | null | undefined): string {
  if (!phoneOrId) return ''
  const trimmed = phoneOrId.trim()
  if (trimmed.length <= 4) return '***'
  const isPlus = trimmed.startsWith('+')
  const clean = isPlus ? trimmed.slice(1) : trimmed
  if (clean.length <= 4) return '***'
  const prefix = isPlus ? '+' + clean.slice(0, 2) : clean.slice(0, 2)
  const suffix = clean.slice(-4)
  return `${prefix}*****${suffix}`
}

/**
 * Parses authorized WhatsApp test recipients from server-side environment variables.
 * Reads from WHATSAPP_TEST_RECIPIENTS, META_TEST_RECIPIENT, or TEST_CUSTOMER_PHONE.
 * Returns normalized digits-only numbers in a Set.
 */
export function getAuthorizedTestRecipients(envOverride?: string): Set<string> {
  const envVal =
    envOverride !== undefined
      ? envOverride
      : (process.env.WHATSAPP_TEST_RECIPIENTS ||
         process.env.META_TEST_RECIPIENT ||
         process.env.TEST_CUSTOMER_PHONE ||
         '')

  const authorized = new Set<string>()
  if (!envVal || typeof envVal !== 'string') return authorized

  for (const part of envVal.split(',')) {
    const raw = part.trim()
    if (!raw) continue
    const sanitized = sanitizePhoneForMeta(raw)
    if (isValidE164(sanitized)) {
      authorized.add(sanitized)
    }
  }

  return authorized
}

/**
 * Determines whether WhatsApp Cloud API test-mode restrictions should be enforced.
 * In test mode, only whitelisted recipients (such as the developer's registered Meta test recipient)
 * are eligible to receive outbound messages.
 */
export function isWhatsAppTestMode(options?: {
  isTestOrder?: boolean
  enforceTestWhitelist?: boolean
  testRecipientsOverride?: string
}): boolean {
  if (options?.enforceTestWhitelist !== undefined) {
    return options.enforceTestWhitelist
  }
  if (options?.isTestOrder) {
    return true
  }

  const envMode = (
    process.env.WHATSAPP_MODE ||
    process.env.WHATSAPP_ENVIRONMENT ||
    ''
  ).toLowerCase().trim()

  if (envMode === 'test' || envMode === 'sandbox' || envMode === 'development') {
    return true
  }

  const testRecipients = getAuthorizedTestRecipients(options?.testRecipientsOverride)
  if (testRecipients.size > 0) {
    return true
  }

  return false
}

/**
 * Resolves and validates a customer recipient for a backend flow execution.
 * Enforces tenant isolation, verified order/contact relationships, E.164 normalization,
 * and Meta test-number recipient whitelist validation.
 */
export async function resolveWorkflowRecipient(
  params: ResolveRecipientParams
): Promise<ResolvedRecipient> {
  // 1. Tenant validation: accountId is strictly required
  if (!params.accountId || typeof params.accountId !== 'string' || !params.accountId.trim()) {
    return {
      success: false,
      accountId: '',
      isPhone: false,
      isTestRecipient: false,
      eligibleForSend: false,
      errorCode: 'RECIPIENT_TENANT_MISMATCH',
      errorMessage: 'Missing or empty tenant accountId in recipient resolution context.',
    }
  }

  const accountId = params.accountId.trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any = params.supabase
  if (!db) {
    try {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        db = supabaseAdmin()
      }
    } catch {
      db = null
    }
  }

  let resolvedContactId = params.contactId ? params.contactId.trim() : null
  let resolvedConversationId = params.conversationId ? params.conversationId.trim() : null
  let isTestOrder = !!params.isTestOrder

  // 2. Order relationship verification (if orderId is provided)
  if (params.orderId) {
    if (!db) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: 'Database connection unavailable to resolve order relationships.',
      }
    }

    const orderId = params.orderId.trim()
    const { data: order, error: orderErr } = await db
      .from('restaurant_trial_orders')
      .select('id, account_id, contact_id, conversation_id, is_test_order')
      .eq('id', orderId)
      .maybeSingle()

    if (orderErr) {
      console.error('[recipient-resolver] Order lookup error:', orderErr.message)
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: `Error loading order "${orderId}".`,
      }
    }

    if (!order) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: `Order "${orderId}" not found in system.`,
      }
    }

    // Tenant isolation enforcement
    if (order.account_id !== accountId) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_TENANT_MISMATCH',
        errorMessage: 'Security violation: Order belongs to a different account.',
      }
    }

    if (!order.contact_id) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: `Order "${orderId}" has no associated contact relationship.`,
      }
    }

    // Verify caller contactId matches order contact_id
    if (resolvedContactId && resolvedContactId !== order.contact_id) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_TENANT_MISMATCH',
        errorMessage: 'Security violation: Contact ID does not match order relationship.',
      }
    }

    resolvedContactId = order.contact_id
    if (order.conversation_id) {
      resolvedConversationId = order.conversation_id
    }
    if (order.is_test_order !== undefined) {
      isTestOrder = !!order.is_test_order
    }
  }

  // 3. Conversation relationship verification (if conversationId is provided)
  if (params.conversationId && db) {
    const convId = params.conversationId.trim()
    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('id, account_id, contact_id')
      .eq('id', convId)
      .maybeSingle()

    if (convErr) {
      console.error('[recipient-resolver] Conversation lookup error:', convErr.message)
    } else if (conv) {
      if (conv.account_id !== accountId) {
        return {
          success: false,
          accountId,
          isPhone: false,
          isTestRecipient: false,
          eligibleForSend: false,
          errorCode: 'RECIPIENT_TENANT_MISMATCH',
          errorMessage: 'Security violation: Conversation belongs to a different account.',
        }
      }

      if (resolvedContactId && conv.contact_id && resolvedContactId !== conv.contact_id) {
        return {
          success: false,
          accountId,
          isPhone: false,
          isTestRecipient: false,
          eligibleForSend: false,
          errorCode: 'RECIPIENT_TENANT_MISMATCH',
          errorMessage: 'Security violation: Conversation does not match contact relationship.',
        }
      }

      if (!resolvedContactId && conv.contact_id) {
        resolvedContactId = conv.contact_id
      }
      if (!resolvedConversationId) {
        resolvedConversationId = conv.id
      }
    }
  }

  // 4. Contact record resolution & verification
  let contactRow: {
    id: string
    account_id: string
    phone: string | null
    name: string | null
    wa_user_id?: string | null
  } | null = null

  if (resolvedContactId) {
    if (!db) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: 'Database connection unavailable to query contact record.',
      }
    }

    const { data: contact, error: contactErr } = await db
      .from('contacts')
      .select('id, account_id, phone, name, wa_user_id')
      .eq('id', resolvedContactId)
      .maybeSingle()

    if (contactErr) {
      console.error('[recipient-resolver] Contact lookup error:', contactErr.message)
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: `Error querying contact "${resolvedContactId}".`,
      }
    }

    if (!contact) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: `Contact "${resolvedContactId}" not found.`,
      }
    }

    // Strict tenant boundary
    if (contact.account_id !== accountId) {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_TENANT_MISMATCH',
        errorMessage: 'Security violation: Contact belongs to a different account.',
      }
    }

    contactRow = contact
  }

  // 5. Fallback for validated simulation / direct mock mode
  if (!contactRow) {
    if (params.isSimulation && params.directPhone) {
      const sanitizedDirect = sanitizePhoneForMeta(params.directPhone)
      if (!isValidE164(sanitizedDirect)) {
        return {
          success: false,
          accountId,
          isPhone: false,
          isTestRecipient: false,
          eligibleForSend: false,
          errorCode: 'RECIPIENT_INVALID',
          errorMessage: `Direct phone number "${maskPhoneNumber(params.directPhone)}" is not a valid E.164 phone number.`,
        }
      }
      contactRow = {
        id: 'sim-contact',
        account_id: accountId,
        phone: sanitizedDirect,
        name: params.directName || 'Simulated Customer',
        wa_user_id: null,
      }
    } else {
      return {
        success: false,
        accountId,
        isPhone: false,
        isTestRecipient: false,
        eligibleForSend: false,
        errorCode: 'RECIPIENT_NOT_FOUND',
        errorMessage: 'No verified contact or order relationship provided for recipient resolution.',
      }
    }
  }

  // 6. WhatsApp Identity Extraction & E.164 Normalization
  const sendTarget = resolveContactSendTarget(contactRow)
  if (!sendTarget) {
    return {
      success: false,
      contactId: contactRow.id,
      contactName: contactRow.name,
      accountId,
      isPhone: false,
      isTestRecipient: false,
      eligibleForSend: false,
      errorCode: 'RECIPIENT_INVALID',
      errorMessage: `Customer "${contactRow.id}" has no valid WhatsApp phone number or business-scoped user ID.`,
    }
  }

  const isPhone = sendTarget.isPhone
  const phone = sendTarget.target // digits-only for Meta API
  const formattedPhone = isPhone ? `+${phone}` : phone
  const waUserId = isPhone ? (contactRow.wa_user_id || null) : phone

  // 7. Meta Test Recipient Whitelist Verification
  const testMode = isWhatsAppTestMode({
    isTestOrder,
    enforceTestWhitelist: params.enforceTestWhitelist,
    testRecipientsOverride: params.testRecipientsOverride,
  })

  const authorizedSet = getAuthorizedTestRecipients(params.testRecipientsOverride)
  const isAuthorized = isPhone && authorizedSet.has(phone)

  if (testMode && authorizedSet.size > 0 && !isAuthorized) {
    return {
      success: true, // Recipient was identified and normalized
      contactId: contactRow.id,
      contactName: contactRow.name,
      conversationId: resolvedConversationId,
      phone,
      formattedPhone,
      isPhone,
      waUserId,
      accountId,
      isTestRecipient: false,
      eligibleForSend: false, // Blocked from sending
      errorCode: 'RECIPIENT_TEST_MODE_BLOCKED',
      errorMessage: `Recipient ${maskPhoneNumber(formattedPhone)} is not authorized under current Meta test number configuration.`,
    }
  }

  return {
    success: true,
    contactId: contactRow.id,
    contactName: contactRow.name,
    conversationId: resolvedConversationId,
    phone,
    formattedPhone,
    isPhone,
    waUserId,
    accountId,
    isTestRecipient: isAuthorized,
    eligibleForSend: true,
  }
}
