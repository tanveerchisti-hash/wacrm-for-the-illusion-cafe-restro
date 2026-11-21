import type {
  BackendFlow,
  BackendFlowCategory,
  BackendFlowTriggerType,
  CreateBackendFlowInput,
  UpdateBackendFlowInput,
} from './types'

export const VALID_CATEGORIES: readonly BackendFlowCategory[] = [
  'general',
  'order_processing',
  'kitchen_sync',
  'payment_reconciliation',
  'custom_integration',
] as const

export const VALID_TRIGGER_TYPES: readonly BackendFlowTriggerType[] = [
  'manual',
  'webhook',
  'schedule',
  'order_event',
  'system_event',
] as const

/**
 * Generate a URL-friendly and unique-friendly slug from a flow name.
 */
export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return base || 'workflow'
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateCreateInput(input: CreateBackendFlowInput): ValidationResult {
  const errors: string[] = []

  if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 2) {
    errors.push('Workflow name must be at least 2 characters long.')
  } else if (input.name.trim().length > 100) {
    errors.push('Workflow name must not exceed 100 characters.')
  }

  if (input.slug !== undefined && input.slug !== null) {
    if (typeof input.slug !== 'string' || !/^[a-z0-9-_]{2,100}$/i.test(input.slug.trim())) {
      errors.push('Slug must be between 2 and 100 characters and contain only letters, numbers, hyphens, and underscores.')
    }
  }

  if (input.category && !VALID_CATEGORIES.includes(input.category)) {
    errors.push(`Invalid category: ${input.category}`)
  }

  if (input.trigger_type && !VALID_TRIGGER_TYPES.includes(input.trigger_type)) {
    errors.push(`Invalid trigger type: ${input.trigger_type}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function validateUpdateInput(input: UpdateBackendFlowInput): ValidationResult {
  const errors: string[] = []

  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2) {
      errors.push('Workflow name must be at least 2 characters long.')
    } else if (input.name.trim().length > 100) {
      errors.push('Workflow name must not exceed 100 characters.')
    }
  }

  if (input.slug !== undefined) {
    if (typeof input.slug !== 'string' || !/^[a-z0-9-_]{2,100}$/i.test(input.slug.trim())) {
      errors.push('Slug must be between 2 and 100 characters and contain only letters, numbers, hyphens, and underscores.')
    }
  }

  if (input.category !== undefined && !VALID_CATEGORIES.includes(input.category)) {
    errors.push(`Invalid category: ${input.category}`)
  }

  if (input.trigger_type !== undefined && !VALID_TRIGGER_TYPES.includes(input.trigger_type)) {
    errors.push(`Invalid trigger type: ${input.trigger_type}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function validateForPublishing(flow: BackendFlow): ValidationResult {
  const errors: string[] = []

  if (!flow.name || flow.name.trim().length < 2) {
    errors.push('Workflow name is required to publish.')
  }

  if (!flow.slug || flow.slug.trim().length < 2) {
    errors.push('Workflow slug is required to publish.')
  }

  if (!VALID_TRIGGER_TYPES.includes(flow.trigger_type)) {
    errors.push(`Invalid trigger type: ${flow.trigger_type}`)
  }

  // Ensure definition structure is valid JSON
  if (!flow.definition || !Array.isArray(flow.definition.nodes)) {
    errors.push('Workflow definition must include a valid nodes array.')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
