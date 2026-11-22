import type { BackendFlow } from '../types'
import type { BackendFlowEvent } from './types'
import { normalizeOrderEventName } from '@/lib/restaurant/flow-integration'

interface MatcherOptions {
  allowDraft?: boolean
}

/**
 * Evaluates whether an incoming event matches a backend flow's configured trigger.
 * Supports canonical events, visual canvas trigger nodes, and legacy alias normalization.
 */
export function matchesTrigger(
  flow: BackendFlow,
  event: BackendFlowEvent,
  options?: MatcherOptions
): boolean {
  // Tenancy check: must belong to the same account
  if (flow.account_id !== event.accountId) {
    return false
  }

  // Emergency safety pause check: paused workflows are bypassed
  const metadata = (flow.metadata || {}) as Record<string, unknown>
  if (metadata.is_paused === true) {
    return false
  }

  // Lifecycle check: only published workflows execute in production unless allowDraft is set
  if (flow.status !== 'published' && !options?.allowDraft) {
    return false
  }

  // Inspect both top-level metadata and visual canvas trigger node
  const canvasTriggerNode = flow.definition?.nodes?.find((n) => n.type === 'trigger')
  const canvasSubType = canvasTriggerNode?.data?.subType as string | undefined
  const canvasEvent = canvasTriggerNode?.data?.event as string | undefined

  // Trigger type check: matches top-level trigger_type or canvas trigger node subType
  const triggerTypeMatches =
    flow.trigger_type === event.type || canvasSubType === event.type

  if (!triggerTypeMatches) {
    return false
  }

  const effectiveTriggerType = flow.trigger_type === event.type ? flow.trigger_type : canvasSubType
  const config = (flow.trigger_config || {}) as Record<string, unknown>

  switch (effectiveTriggerType) {
    case 'order_event': {
      const configuredEvent =
        (config.event as string) || canvasEvent || '*'

      if (configuredEvent === '*' || !configuredEvent) {
        return true
      }

      const normalizedConfigured = normalizeOrderEventName(configuredEvent)
      const normalizedIncoming = normalizeOrderEventName(event.event || '')

      return normalizedConfigured === normalizedIncoming
    }

    case 'webhook': {
      const configuredPath =
        (config.path as string | undefined) ||
        (canvasTriggerNode?.data?.endpointUrl as string | undefined)

      if (!configuredPath) return true
      const incomingPath = (event.payload?.path as string) || ''
      return configuredPath.toLowerCase() === incomingPath.toLowerCase()
    }

    case 'manual': {
      return true
    }

    case 'schedule': {
      return true
    }

    case 'system_event': {
      const configuredEvent =
        (config.event as string) || canvasEvent || '*'

      if (configuredEvent === '*' || !configuredEvent) return true
      return configuredEvent.toLowerCase() === (event.event || '').toLowerCase()
    }

    default:
      return false
  }
}
