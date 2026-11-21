import type { BackendFlow } from '../types'
import type { BackendFlowEvent } from './types'

interface MatcherOptions {
  allowDraft?: boolean
}

/**
 * Evaluates whether an incoming event matches a backend flow's configured trigger.
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

  // Trigger type check
  if (flow.trigger_type !== event.type) {
    return false
  }

  const config = (flow.trigger_config || {}) as Record<string, unknown>

  switch (flow.trigger_type) {
    case 'order_event': {
      const configuredEvent = (config.event as string) || '*'
      if (configuredEvent === '*' || !configuredEvent) {
        return true
      }
      return configuredEvent.toLowerCase() === (event.event || '').toLowerCase()
    }

    case 'webhook': {
      const configuredPath = config.path as string | undefined
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
      const configuredEvent = (config.event as string) || '*'
      if (configuredEvent === '*' || !configuredEvent) return true
      return configuredEvent.toLowerCase() === (event.event || '').toLowerCase()
    }

    default:
      return false
  }
}
