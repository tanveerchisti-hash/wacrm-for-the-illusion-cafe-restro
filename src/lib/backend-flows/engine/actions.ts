import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { BackendFlowNode } from '../types'
import {
  resolveWorkflowRecipient,
  maskPhoneNumber,
  type ResolvedRecipient,
} from './recipient-resolver'
import { dispatchBackendFlowWhatsApp } from './whatsapp-sender'

/**
 * Resolves a dotted path (e.g. 'order.subtotal' or 'customer.phone') from a variable context.
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined
  const parts = path.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Interpolates template strings containing {{variable.path}}.
 */
export function interpolateString(template: string, vars: Record<string, unknown>): string {
  if (!template) return ''
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    const val = getNestedValue(vars, path)
    return val !== undefined && val !== null ? String(val) : ''
  })
}

/**
 * Evaluates a condition node against current flow variables.
 */
export function evaluateConditionNode(
  node: BackendFlowNode,
  vars: Record<string, unknown>
): boolean {
  const data = node.data || {}
  const fieldPath = (data.field as string) || ''
  const operator = (data.operator as string) || 'equals'
  const targetValue = (data.value as string) || ''

  const actualValue = getNestedValue(vars, fieldPath)
  const actualStr = actualValue !== undefined && actualValue !== null ? String(actualValue) : ''

  switch (operator) {
    case 'equals':
      return actualStr.toLowerCase() === targetValue.toLowerCase()

    case 'not_equals':
      return actualStr.toLowerCase() !== targetValue.toLowerCase()

    case 'greater_than': {
      const numActual = Number(actualValue)
      const numTarget = Number(targetValue)
      if (isNaN(numActual) || isNaN(numTarget)) return false
      return numActual > numTarget
    }

    case 'less_than': {
      const numActual = Number(actualValue)
      const numTarget = Number(targetValue)
      if (isNaN(numActual) || isNaN(numTarget)) return false
      return numActual < numTarget
    }

    case 'contains':
      return actualStr.toLowerCase().includes(targetValue.toLowerCase())

    default:
      return false
  }
}

export interface ActionExecutionOutput {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export interface ActionExecutionOptions {
  isDryRun?: boolean
  accountId?: string
  recipient?: ResolvedRecipient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
}

/**
 * Executes a single action node with variable context.
 */
export async function executeActionNode(
  node: BackendFlowNode,
  vars: Record<string, unknown>,
  options?: ActionExecutionOptions
): Promise<ActionExecutionOutput> {
  const data = node.data || {}
  const subType = (data.subType as string) || 'whatsapp_message'

  switch (subType) {
    case 'whatsapp_message': {
      const rawTemplate = (data.messageTemplate as string) || ''
      const formattedMessage = interpolateString(rawTemplate, vars)

      // Resolve recipient through existing context or dedicated secure resolver
      let recipient = options?.recipient || (vars.recipient as ResolvedRecipient | undefined)

      if (!recipient) {
        const accountId =
          options?.accountId ||
          (vars.accountId as string) ||
          (vars.account_id as string) ||
          ''
        const orderId = (vars.orderId || vars.order_id) as string | undefined
        const contactId = (vars.contactId || vars.contact_id) as string | undefined
        const conversationId = (vars.conversationId || vars.conversation_id) as string | undefined
        const directPhone = (
          vars.customerPhone ||
          vars.phone ||
          (vars.customer as Record<string, unknown> | undefined)?.phone
        ) as string | undefined
        const directName = (
          vars.customerName ||
          vars.name ||
          (vars.customer as Record<string, unknown> | undefined)?.name
        ) as string | undefined

        recipient = await resolveWorkflowRecipient({
          accountId,
          orderId,
          contactId,
          conversationId,
          directPhone,
          directName,
          isSimulation: options?.isDryRun,
          supabase: options?.supabase,
        })
      }

      if (!recipient || !recipient.success) {
        const errCode = recipient?.errorCode || 'RECIPIENT_NOT_FOUND'
        const errMsg = recipient?.errorMessage || 'Recipient could not be resolved from order or contact.'
        return {
          success: false,
          error: `[${errCode}] ${errMsg}`,
          data: {
            delivered: false,
            simulated: !!options?.isDryRun,
            formattedMessage,
            errorCode: errCode,
            errorMessage: errMsg,
          },
        }
      }

      if (!recipient.eligibleForSend) {
        const errCode = recipient.errorCode || 'RECIPIENT_TEST_MODE_BLOCKED'
        const errMsg = recipient.errorMessage || 'Recipient not authorized in test mode.'
        return {
          success: false,
          error: `[${errCode}] ${errMsg}`,
          data: {
            delivered: false,
            simulated: !!options?.isDryRun,
            formattedMessage,
            to: recipient.formattedPhone || recipient.phone,
            recipient: {
              contactId: recipient.contactId,
              name: recipient.contactName,
              phone: maskPhoneNumber(recipient.phone || ''),
              isTestRecipient: false,
              eligibleForSend: false,
            },
            errorCode: errCode,
            errorMessage: errMsg,
          },
        }
      }

      // Execute production-safe WhatsApp dispatching through Phase 5 messaging architecture
      const accountId =
        options?.accountId ||
        (vars.accountId as string) ||
        (vars.account_id as string) ||
        ''

      const dispatchResult = await dispatchBackendFlowWhatsApp({
        node,
        vars,
        recipient,
        accountId,
        isDryRun: options?.isDryRun,
        supabase: options?.supabase,
      })

      if (!dispatchResult.success) {
        return {
          success: false,
          error: dispatchResult.error || `[${dispatchResult.errorCode || 'DISPATCH_ERROR'}] Dispatch failed.`,
          data: {
            ...dispatchResult,
            to: recipient.formattedPhone || recipient.phone,
          },
        }
      }

      return {
        success: true,
        data: {
          ...dispatchResult,
          to: recipient.formattedPhone || recipient.phone,
        },
      }
    }

    case 'kitchen_sync': {
      const kitchenStatus = (data.kitchenStatus as string) || 'preparing'
      const prepTimeMinutes = (data.prepTimeMinutes as number) || 20
      return {
        success: true,
        data: {
          synced: !options?.isDryRun,
          simulated: !!options?.isDryRun,
          kitchenStatus,
          prepTimeMinutes,
          updatedAt: new Date().toISOString(),
        },
      }
    }

    case 'payment_check': {
      const order = (vars.order || {}) as Record<string, unknown>
      const isPaid = order.payment_status === 'paid' || order.status === 'confirmed'
      return {
        success: true,
        data: {
          verified: true,
          simulated: !!options?.isDryRun,
          isPaid,
          paymentMethod: order.payment_method || 'upi',
        },
      }
    }

    case 'http_request': {
      const rawUrl = (data.endpointUrl as string) || ''
      const method = (data.httpMethod as string) || 'POST'

      if (!rawUrl) {
        return { success: false, error: 'Endpoint URL is empty' }
      }

      const url = interpolateString(rawUrl, vars)

      if (options?.isDryRun) {
        return {
          success: true,
          data: {
            simulated: true,
            method,
            url,
            note: 'Dry-run simulation: external HTTP request skipped',
          },
        }
      }

      // SSRF Security Validation
      const isDeliverable = await isDeliverableUrl(url).catch(() => false)
      if (!isDeliverable) {
        return {
          success: false,
          error: `Blocked request to non-routable or private address: ${url}`,
        }
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: method !== 'GET' ? JSON.stringify(vars) : undefined,
          signal: controller.signal,
          redirect: 'manual',
        })
        clearTimeout(timeoutId)

        const responseText = await res.text().catch(() => '')
        return {
          success: res.ok,
          data: {
            status: res.status,
            body: responseText.slice(0, 500),
          },
          error: !res.ok ? `HTTP ${res.status}: ${res.statusText}` : undefined,
        }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'HTTP request failed',
        }
      }
    }

    case 'delay': {
      const rawMinutes = data.delayMinutes ?? data.waitDuration
      const delayMinutes =
        typeof rawMinutes === 'number' && !isNaN(rawMinutes) && rawMinutes > 0
          ? Math.min(1440, rawMinutes)
          : 1

      const rawSeconds = data.delaySeconds
      const delaySeconds =
        typeof rawSeconds === 'number' && !isNaN(rawSeconds) && rawSeconds > 0
          ? rawSeconds
          : undefined

      const delayMs =
        delaySeconds !== undefined
          ? Math.round(delaySeconds * 1000)
          : Math.round(delayMinutes * 60 * 1000)

      const scheduledResumeAt = new Date(Date.now() + delayMs).toISOString()

      if (options?.isDryRun) {
        return {
          success: true,
          data: {
            simulated: true,
            delayScheduled: true,
            delayMinutes,
            delaySeconds,
            delayMs,
            hypotheticalResumeAt: scheduledResumeAt,
            note: 'Dry-run simulation: delay evaluated immediately without pausing execution',
          },
        }
      }

      return {
        success: true,
        data: {
          delayScheduled: true,
          delayMinutes,
          delaySeconds,
          delayMs,
          scheduledResumeAt,
          waitingUntil: scheduledResumeAt,
        },
      }
    }

    case 'tag_contact': {
      const tagName = (data.tagName as string) || ''
      return {
        success: true,
        data: {
          tagApplied: tagName,
        },
      }
    }

    default:
      return { success: true, data: { actionExecuted: subType } }
  }
}
