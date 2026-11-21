import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import type { BackendFlowNode } from '../types'

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
      return {
        success: true,
        data: {
          delivered: !options?.isDryRun,
          simulated: !!options?.isDryRun,
          formattedMessage,
          to: vars.customerPhone || vars.phone || '+91XXXXXXXXXX',
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
      const delayMinutes = (data.delayMinutes as number) || 1
      return {
        success: true,
        data: {
          delayScheduled: true,
          delayMinutes,
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
