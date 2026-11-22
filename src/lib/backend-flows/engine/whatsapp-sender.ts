import { supabaseAdmin } from '@/lib/automations/admin-client'
import { interpolateString } from './actions'
import { maskPhoneNumber, type ResolvedRecipient } from './recipient-resolver'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'
import { sendTextMessage, sendTemplateMessage, MetaApiError } from '@/lib/whatsapp/meta-api'
import { phoneVariants, isRecipientNotAllowedError } from '@/lib/whatsapp/phone-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { BackendFlowNode } from '../types'
import type { MessageTemplate } from '@/types'

export interface ConversationWindowCheck {
  isOpen: boolean
  hoursSince: number | null
  lastInboundAt: string | null
}

export interface TemplateValidationResult {
  approved: boolean
  row?: MessageTemplate | null
  language?: string
  reason?: string
}

export interface DispatchWhatsAppOptions {
  node: BackendFlowNode
  vars: Record<string, unknown>
  recipient: ResolvedRecipient
  accountId: string
  isDryRun?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
}

export interface DispatchWhatsAppResult {
  success: boolean
  delivered: boolean
  submittedToMeta?: boolean
  simulated: boolean
  shouldRetry?: boolean
  mode: 'dry_run' | 'disabled_by_default' | 'test_send' | 'live_send'
  whatsappMessageId?: string
  messageId?: string
  to?: string
  formattedMessage?: string
  templateName?: string
  templateLanguage?: string
  templateParams?: string[]
  conversationWindow?: ConversationWindowCheck
  error?: string
  errorCode?: string
  note?: string
  recipient?: {
    contactId?: string
    name?: string
    phone: string
    isTestRecipient?: boolean
    eligibleForSend: boolean
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminClient(providedSupabase?: any) {
  if (providedSupabase) return providedSupabase
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return supabaseAdmin()
}

/**
 * Checks whether the Meta 24-hour customer service window is open for a conversation.
 * Computed strictly from the recipient's latest qualifying inbound WhatsApp message (sender_type='customer').
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkConversationWindow(supabase: any, conversationId?: string | null): Promise<ConversationWindowCheck> {
  if (!supabase?.from || !conversationId) {
    return { isOpen: false, hoursSince: null, lastInboundAt: null }
  }

  try {
    const { data: lastInboundMsg, error } = await supabase
      .from('messages')
      .select('created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !lastInboundMsg?.created_at) {
      return { isOpen: false, hoursSince: null, lastInboundAt: null }
    }

    const lastInboundMs = new Date(lastInboundMsg.created_at).getTime()
    const hoursSince = (Date.now() - lastInboundMs) / (3600 * 1000)
    const isOpen = hoursSince < 24

    return {
      isOpen,
      hoursSince: Math.round(hoursSince * 10) / 10,
      lastInboundAt: lastInboundMsg.created_at,
    }
  } catch (err) {
    console.error('[whatsapp-sender] Error checking conversation window:', err)
    return { isOpen: false, hoursSince: null, lastInboundAt: null }
  }
}

/**
 * Validates that a WhatsApp message template exists in the tenant account and is approved by Meta.
 */
export async function validateTemplateApproved(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  templateName: string,
  requestedLanguage?: string
): Promise<TemplateValidationResult> {
  if (!supabase?.from) {
    return { approved: false, reason: 'Database client unavailable' }
  }

  try {
    const resolved = await resolveTemplateRow(supabase, accountId, templateName, requestedLanguage)
    const row = resolved.row

    if (!row) {
      return {
        approved: false,
        reason: `Template "${templateName}" does not exist in account ${accountId}.`,
      }
    }

    const statusNorm = (row.status || '').toLowerCase().trim()
    if (statusNorm !== 'approved') {
      return {
        approved: false,
        row,
        reason: `Template "${templateName}" is not approved by Meta (current status: ${row.status || 'Draft'}).`,
      }
    }

    return {
      approved: true,
      row,
      language: resolved.language,
    }
  } catch (err) {
    return {
      approved: false,
      reason: err instanceof Error ? err.message : 'Failed to query template record',
    }
  }
}

/**
 * Checks if a string still contains unresolved double-curly placeholders (e.g. {{customerName}}).
 */
export function hasUnresolvedPlaceholders(text: string): boolean {
  if (!text) return false
  return /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/.test(text)
}

/**
 * Production-Safe WhatsApp Action Dispatcher for WACRM Backend Flows.
 * Enforces recipient authorization, 24h conversation window, approved templates, and fail-closed safety.
 */
export async function dispatchBackendFlowWhatsApp(
  options: DispatchWhatsAppOptions
): Promise<DispatchWhatsAppResult> {
  const { node, vars, recipient, accountId, isDryRun } = options
  const supabase = getAdminClient(options.supabase)
  const data = node.data || {}

  // 1. Determine message mode and extract template/text content
  const messageMode: 'text' | 'template' =
    data.messageMode === 'template' || data.templateName || (!data.messageTemplate && data.template_name)
      ? 'template'
      : 'text'

  const rawTemplate =
    (data.messageTemplate as string) ||
    (data.messageBody as string) ||
    (data.text as string) ||
    ''

  const templateName = (data.templateName as string) || (data.template_name as string) || (messageMode === 'template' ? rawTemplate : undefined)
  const templateLanguage = (data.templateLanguage as string) || (data.language as string) || 'en'
  const rawParams = (data.templateParams as string[]) || []

  // Interpolate body text and template parameters
  const formattedMessage = interpolateString(rawTemplate, vars)
  const interpolatedParams = rawParams.map((p) => interpolateString(p, vars))

  const destinationPhone = recipient.formattedPhone || recipient.phone || ''
  const maskedPhone = maskPhoneNumber(recipient.phone || destinationPhone)

  // 2. Mode A: Safe Dry-Run Simulation Mode
  if (isDryRun) {
    return {
      success: true,
      delivered: false,
      simulated: true,
      mode: 'dry_run',
      to: destinationPhone,
      formattedMessage,
      templateName,
      templateLanguage,
      templateParams: interpolatedParams,
      whatsappMessageId: `sim-wamid.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
      recipient: {
        contactId: recipient.contactId || undefined,
        name: recipient.contactName || undefined,
        phone: maskedPhone,
        isTestRecipient: recipient.isTestRecipient,
        eligibleForSend: true,
      },
      note: 'Safe simulation: no external WhatsApp delivery executed.',
    }
  }

  // 3. Emergency Shutdown Guard
  if (process.env.BACKEND_FLOWS_EMERGENCY_PAUSE === 'true') {
    return {
      success: false,
      delivered: false,
      simulated: false,
      shouldRetry: false,
      mode: 'disabled_by_default',
      errorCode: 'EMERGENCY_PAUSED',
      error: '[EMERGENCY_PAUSED] Outbound messaging is currently suspended by emergency shutdown configuration.',
    }
  }

  // 4. Recipient Validation Guard (Phase 2 integration)
  if (!recipient.success || !recipient.phone) {
    return {
      success: false,
      delivered: false,
      simulated: false,
      shouldRetry: false,
      mode: 'disabled_by_default',
      errorCode: recipient.errorCode || 'RECIPIENT_NOT_FOUND',
      error: `[${recipient.errorCode || 'RECIPIENT_NOT_FOUND'}] ${recipient.errorMessage || 'Recipient could not be resolved from order or contact.'}`,
    }
  }

  // 4. Policy Check: Meta 24-Hour Customer Service Window
  const windowCheck = await checkConversationWindow(supabase, recipient.conversationId)

  if (messageMode === 'text') {
    if (!windowCheck.isOpen) {
      const errCode = 'EXPIRED_24H_WINDOW'
      const errMsg =
        'Free-form text message blocked: 24-hour customer service window has expired. Meta WhatsApp policy requires an approved template message outside the window.'
      return {
        success: false,
        delivered: false,
        simulated: false,
        mode: 'disabled_by_default',
        errorCode: errCode,
        error: `[${errCode}] ${errMsg}`,
        formattedMessage,
        conversationWindow: windowCheck,
      }
    }

    // Check for unresolved placeholders in free-form text
    if (hasUnresolvedPlaceholders(formattedMessage)) {
      const errCode = 'UNRESOLVED_VARIABLES'
      const errMsg = `Message contains unresolved variable placeholders: "${formattedMessage}"`
      return {
        success: false,
        delivered: false,
        simulated: false,
        mode: 'disabled_by_default',
        errorCode: errCode,
        error: `[${errCode}] ${errMsg}`,
        formattedMessage,
      }
    }
  } else {
    // Template Mode: Validate that template is approved
    if (!templateName) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        mode: 'disabled_by_default',
        errorCode: 'TEMPLATE_NAME_REQUIRED',
        error: '[TEMPLATE_NAME_REQUIRED] A valid template name is required when message mode is "template".',
      }
    }

    const tplValidation = await validateTemplateApproved(supabase, accountId, templateName, templateLanguage)
    if (!tplValidation.approved) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        mode: 'disabled_by_default',
        errorCode: 'UNAPPROVED_TEMPLATE',
        error: `[UNAPPROVED_TEMPLATE] ${tplValidation.reason}`,
        templateName,
      }
    }
  }

  // 5. Test Environment & Production Sender Safety Guards (Section 2 & 13)
  const isLiveSendEnabled = process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND === 'true'
  const isTestSendEnabled = process.env.BACKEND_FLOWS_ENABLE_TEST_SEND === 'true'

  // If live sending is enabled, enforce rigorous production sender verification
  if (isLiveSendEnabled) {
    if (!supabase?.from) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: 'live_send',
        errorCode: 'PRODUCTION_SENDER_DISABLED',
        error: '[PRODUCTION_SENDER_DISABLED] Database client unavailable for sender verification.',
      }
    }

    const { data: config, error: configErr } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, status, registered_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configErr || !config) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: 'live_send',
        errorCode: 'PRODUCTION_SENDER_DISABLED',
        error: `[PRODUCTION_SENDER_DISABLED] Outbound live messaging is disabled. No verified production sender configured for account ${accountId}.`,
      }
    }

    // Must be officially connected and registered with Meta Cloud API PIN (registered_at != null)
    if (config.status !== 'connected' || !config.registered_at) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: 'live_send',
        errorCode: 'PRODUCTION_SENDER_DISABLED',
        error: '[PRODUCTION_SENDER_DISABLED] Outbound live messaging is disabled in this environment. Meta test number is active or sender is unverified.',
      }
    }

    // Explicitly reject Meta Developer Test Numbers in production sending mode
    const testNumberIds = [
      process.env.META_TEST_PHONE_NUMBER_ID,
      '106540352331505',
    ].filter(Boolean)

    if (testNumberIds.includes(config.phone_number_id)) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: 'live_send',
        errorCode: 'PRODUCTION_SENDER_DISABLED',
        error: '[PRODUCTION_SENDER_DISABLED] Outbound live messaging is disabled in this environment. Meta test number is active.',
      }
    }
  } else if (isTestSendEnabled) {
    // If test mode is enabled, verify the recipient is on the authorized allowlist
    if (!recipient.isTestRecipient) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: 'test_send',
        errorCode: 'RECIPIENT_TEST_MODE_BLOCKED',
        error: `[RECIPIENT_TEST_MODE_BLOCKED] Recipient ${maskedPhone} is not an authorized test number for Meta Cloud API test number.`,
      }
    }
  } else {
    // Default Safe Mode: Outbound sending disabled by default for Phase 5 safety
    return {
      success: true,
      delivered: false,
      simulated: false,
      shouldRetry: false,
      mode: 'disabled_by_default',
      to: destinationPhone,
      formattedMessage,
      templateName,
      templateLanguage,
      templateParams: interpolatedParams,
      conversationWindow: windowCheck,
      recipient: {
        contactId: recipient.contactId || undefined,
        name: recipient.contactName || undefined,
        phone: maskedPhone,
        isTestRecipient: recipient.isTestRecipient,
        eligibleForSend: true,
      },
      note: 'Outbound sending disabled by default for Phase 5 safety. Outbound code path verified and ready.',
    }
  }

  // 6. Execute Dispatch via Meta WhatsApp Cloud API
  if (!supabase?.from) {
    return {
      success: false,
      delivered: false,
      simulated: false,
      shouldRetry: false,
      mode: isLiveSendEnabled ? 'live_send' : 'test_send',
      errorCode: 'DATABASE_CLIENT_UNAVAILABLE',
      error: 'Database client unavailable for Meta dispatch.',
    }
  }

  try {
    const { data: config, error: configErr } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configErr || !config) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: isLiveSendEnabled ? 'live_send' : 'test_send',
        errorCode: 'WHATSAPP_NOT_CONFIGURED',
        error: 'WhatsApp integration is not configured for this account.',
      }
    }

    const accessToken = decrypt(config.access_token)
    const phoneNumberId = config.phone_number_id
    const variants = phoneVariants(destinationPhone)

    let waMessageId = ''
    let lastMetaErr: unknown = null
    let isAmbiguousTimeout = false

    for (const v of variants) {
      try {
        if (messageMode === 'template') {
          const res = await sendTemplateMessage({
            phoneNumberId,
            accessToken,
            to: v,
            templateName: templateName!,
            language: templateLanguage,
            params: interpolatedParams,
          })
          waMessageId = res.messageId
        } else {
          const res = await sendTextMessage({
            phoneNumberId,
            accessToken,
            to: v,
            text: formattedMessage,
          })
          waMessageId = res.messageId
        }
        lastMetaErr = null
        break
      } catch (err) {
        lastMetaErr = err
        const msg = err instanceof Error ? err.message : String(err)
        const lowerMsg = msg.toLowerCase()
        // Guard against ambiguous timeouts: do NOT retry blindly
        if (err instanceof Error && (err.name === 'AbortError' || lowerMsg.includes('timed out') || lowerMsg.includes('timeout') || lowerMsg.includes('etimedout') || lowerMsg.includes('econnreset'))) {
          isAmbiguousTimeout = true
          break
        }
        if (!isRecipientNotAllowedError(msg)) break
      }
    }

    if (isAmbiguousTimeout) {
      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: isLiveSendEnabled ? 'live_send' : 'test_send',
        errorCode: 'META_AMBIGUOUS_TIMEOUT',
        error: '[META_AMBIGUOUS_TIMEOUT] Network timeout during Meta API dispatch. Aborting retries to prevent duplicate customer messages.',
      }
    }

    if (lastMetaErr) {
      const isMetaApiErr = lastMetaErr instanceof MetaApiError
      const errCode = isMetaApiErr ? `META_API_ERROR_${(lastMetaErr as MetaApiError).code}` : 'META_DISPATCH_FAILED'
      const errMsg = lastMetaErr instanceof Error ? lastMetaErr.message : String(lastMetaErr)

      return {
        success: false,
        delivered: false,
        simulated: false,
        shouldRetry: false,
        mode: isLiveSendEnabled ? 'live_send' : 'test_send',
        errorCode: errCode,
        error: `[${errCode}] ${errMsg}`,
      }
    }

    // Persist sent message into messages table
    let messageId: string | undefined
    if (recipient.conversationId) {
      const { data: msgRow } = await supabase
        .from('messages')
        .insert({
          conversation_id: recipient.conversationId,
          sender_type: 'bot',
          content_type: messageMode === 'template' ? 'template' : 'text',
          content_text: formattedMessage,
          template_name: templateName || null,
          message_id: waMessageId,
          status: 'sent',
        })
        .select('id')
        .maybeSingle()

      messageId = msgRow?.id

      // Update conversation last message metadata
      await supabase
        .from('conversations')
        .update({
          last_message_text: formattedMessage,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', recipient.conversationId)
        .eq('account_id', accountId)
    }

    // Synchronize status into restaurant feedback dispatch ledger if this is an order feedback send
    const orderId = (vars.orderId || vars.order_id) as string | undefined
    if (orderId && supabase?.from) {
      try {
        const { updateFeedbackLedgerStatus } = await import('@/lib/restaurant/feedback-eligibility')
        await updateFeedbackLedgerStatus(supabase, {
          accountId,
          orderId,
          status: 'submitted_to_meta',
          whatsappMessageId: waMessageId,
          templateName: templateName || null,
          templateCategory: messageMode === 'template' ? 'MARKETING' : null,
        })
      } catch (ledgerErr) {
        console.error('[whatsapp-sender] Ledger update failed:', ledgerErr)
      }
    }

    return {
      success: true,
      delivered: false, // Delivery is confirmed asynchronously via status webhook, not synchronously upon HTTP POST
      submittedToMeta: true,
      simulated: false,
      mode: isLiveSendEnabled ? 'live_send' : 'test_send',
      whatsappMessageId: waMessageId,
      messageId,
      to: destinationPhone,
      formattedMessage,
      templateName,
      templateLanguage,
      templateParams: interpolatedParams,
      conversationWindow: windowCheck,
      recipient: {
        contactId: recipient.contactId || undefined,
        name: recipient.contactName || undefined,
        phone: maskedPhone,
        isTestRecipient: recipient.isTestRecipient,
        eligibleForSend: true,
      },
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      delivered: false,
      simulated: false,
      shouldRetry: false,
      mode: isLiveSendEnabled ? 'live_send' : 'test_send',
      errorCode: 'META_DISPATCH_EXCEPTION',
      error: `[META_DISPATCH_EXCEPTION] ${errMsg}`,
    }
  }
}
