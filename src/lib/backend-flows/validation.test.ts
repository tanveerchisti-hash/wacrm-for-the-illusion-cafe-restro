import { describe, it, expect } from 'vitest'
import {
  generateSlug,
  validateCreateInput,
  validateForPublishing,
} from './validation'
import type { BackendFlow, BackendFlowCategory } from './types'

describe('Backend Flows Validation', () => {
  describe('generateSlug', () => {
    it('creates lowercase hyphenated slugs', () => {
      expect(generateSlug('Kitchen Order Pipeline')).toBe('kitchen-order-pipeline')
      expect(generateSlug('  Payment Sync #2!  ')).toBe('payment-sync-2')
      expect(generateSlug('')).toBe('workflow')
    })
  })

  describe('validateCreateInput', () => {
    it('accepts valid input', () => {
      const res = validateCreateInput({
        name: 'Order Fulfilment',
        category: 'order_processing',
        trigger_type: 'order_event',
      })
      expect(res.valid).toBe(true)
      expect(res.errors).toHaveLength(0)
    })

    it('rejects short or empty names', () => {
      const res = validateCreateInput({ name: ' ' })
      expect(res.valid).toBe(false)
      expect(res.errors[0]).toMatch(/at least 2 characters/)
    })

    it('rejects invalid category', () => {
      const res = validateCreateInput({
        name: 'Valid Name',
        category: 'non_existent_category' as unknown as BackendFlowCategory,
      })
      expect(res.valid).toBe(false)
      expect(res.errors[0]).toMatch(/Invalid category/)
    })
  })

  describe('validateForPublishing', () => {
    it('approves a publishable flow', () => {
      const flow: BackendFlow = {
        id: '123',
        account_id: 'acc1',
        created_by: 'u1',
        name: 'Auto Confirm Payment',
        slug: 'auto-confirm-payment',
        description: 'Verifies UPI receipts',
        category: 'payment_reconciliation',
        status: 'draft',
        current_version: 1,
        published_version: null,
        published_at: null,
        published_by: null,
        trigger_type: 'webhook',
        trigger_config: {},
        definition: { nodes: [], edges: [] },
        metadata: {},
        execution_count: 0,
        last_executed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      const res = validateForPublishing(flow)
      expect(res.valid).toBe(true)
    })

    it('rejects flow without nodes array', () => {
      const flow = {
        name: 'Broken Flow',
        slug: 'broken-flow',
        trigger_type: 'manual',
        definition: null,
      } as unknown as BackendFlow
      const res = validateForPublishing(flow)
      expect(res.valid).toBe(false)
      expect(res.errors[0]).toMatch(/valid nodes array/)
    })
  })
})

