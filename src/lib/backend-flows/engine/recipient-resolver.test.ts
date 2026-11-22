import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveWorkflowRecipient,
  maskPhoneNumber,
  getAuthorizedTestRecipients,
  isWhatsAppTestMode,
} from './recipient-resolver'
import { executeActionNode } from './actions'
import type { BackendFlowNode } from '../types'

describe('Backend Flows Recipient Resolver (Phase 2)', () => {
  const ACCOUNT_A = 'acc-restaurant-aaa'
  const ACCOUNT_B = 'acc-competitor-bbb'

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.WHATSAPP_TEST_RECIPIENTS
    delete process.env.META_TEST_RECIPIENT
    delete process.env.TEST_CUSTOMER_PHONE
    delete process.env.WHATSAPP_MODE
    delete process.env.WHATSAPP_ENVIRONMENT
  })

  // Helper to build a mock Supabase client for tests
  function createMockSupabase(dbState: {
    orders?: Record<string, Record<string, unknown>>
    contacts?: Record<string, Record<string, unknown>>
    conversations?: Record<string, Record<string, unknown>>
  }) {
    return {
      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {}

        const queryBuilder = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: unknown) => {
            filters[col] = val
            return queryBuilder
          }),
          maybeSingle: vi.fn(async () => {
            if (table === 'restaurant_trial_orders') {
              const id = filters['id'] as string
              const order = dbState.orders?.[id]
              return { data: order || null, error: null }
            }
            if (table === 'contacts') {
              const id = filters['id'] as string
              const contact = dbState.contacts?.[id]
              return { data: contact || null, error: null }
            }
            if (table === 'conversations') {
              const id = filters['id'] as string
              const conv = dbState.conversations?.[id]
              return { data: conv || null, error: null }
            }
            return { data: null, error: null }
          }),
        }

        return queryBuilder
      }),
    }
  }

  // =========================================================================
  // Test A — Valid Customer
  // =========================================================================
  it('Test A: resolves valid customer recipient from order and contact relationships', async () => {
    const mockDb = createMockSupabase({
      orders: {
        'ord-101': {
          id: 'ord-101',
          account_id: ACCOUNT_A,
          contact_id: 'con-1',
          order_number: '101',
          is_test_order: false,
        },
      },
      contacts: {
        'con-1': {
          id: 'con-1',
          account_id: ACCOUNT_A,
          name: 'Priya Sharma',
          phone: '+91 98765 43210',
          wa_user_id: null,
        },
      },
    })

    const result = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-101',
      supabase: mockDb,
    })

    expect(result.success).toBe(true)
    expect(result.contactId).toBe('con-1')
    expect(result.contactName).toBe('Priya Sharma')
    expect(result.phone).toBe('919876543210')
    expect(result.formattedPhone).toBe('+919876543210')
    expect(result.isPhone).toBe(true)
    expect(result.eligibleForSend).toBe(true)
    expect(result.errorCode).toBeUndefined()
  })

  // =========================================================================
  // Test B — Missing Contact
  // =========================================================================
  it('Test B: fails with RECIPIENT_NOT_FOUND when order has no contact relationship or contact is missing', async () => {
    // Case 1: Order exists but contact_id is null
    const mockDbMissingRel = createMockSupabase({
      orders: {
        'ord-no-contact': {
          id: 'ord-no-contact',
          account_id: ACCOUNT_A,
          contact_id: null,
        },
      },
    })

    const res1 = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-no-contact',
      supabase: mockDbMissingRel,
    })

    expect(res1.success).toBe(false)
    expect(res1.errorCode).toBe('RECIPIENT_NOT_FOUND')
    expect(res1.phone).toBeUndefined()

    // Case 2: Contact ID specified does not exist in contacts table
    const mockDbMissingRow = createMockSupabase({
      orders: {
        'ord-orphan': {
          id: 'ord-orphan',
          account_id: ACCOUNT_A,
          contact_id: 'con-does-not-exist',
        },
      },
      contacts: {},
    })

    const res2 = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-orphan',
      supabase: mockDbMissingRow,
    })

    expect(res2.success).toBe(false)
    expect(res2.errorCode).toBe('RECIPIENT_NOT_FOUND')
    expect(res2.phone).toBeUndefined()
  })

  // =========================================================================
  // Test C — Missing Phone Number
  // =========================================================================
  it('Test C: fails with RECIPIENT_INVALID when customer has no valid WhatsApp number', async () => {
    const mockDb = createMockSupabase({
      orders: {
        'ord-102': {
          id: 'ord-102',
          account_id: ACCOUNT_A,
          contact_id: 'con-no-phone',
        },
      },
      contacts: {
        'con-no-phone': {
          id: 'con-no-phone',
          account_id: ACCOUNT_A,
          name: 'Walk-in Guest',
          phone: '', // empty
          wa_user_id: null,
        },
      },
    })

    const result = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-102',
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('RECIPIENT_INVALID')
    expect(result.errorMessage).toContain('no valid WhatsApp phone number')
  })

  // =========================================================================
  // Test D — Cross-Tenant Access
  // =========================================================================
  it('Test D: enforces strict tenant isolation and denies cross-tenant access', async () => {
    const mockDb = createMockSupabase({
      orders: {
        'ord-tenant-b': {
          id: 'ord-tenant-b',
          account_id: ACCOUNT_B, // Belongs to Competitor B
          contact_id: 'con-b',
        },
      },
      contacts: {
        'con-b': {
          id: 'con-b',
          account_id: ACCOUNT_B,
          name: 'Competitor Customer',
          phone: '+919999999999',
        },
      },
    })

    // Account A tries to resolve Account B's order
    const result = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-tenant-b',
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('RECIPIENT_TENANT_MISMATCH')
    expect(result.phone).toBeUndefined()
    expect(result.contactName).toBeUndefined()
  })

  // =========================================================================
  // Test E — WhatsApp Test Mode (Blocked)
  // =========================================================================
  it('Test E: blocks outbound messaging when recipient is not in authorized Meta test whitelist', async () => {
    // Authorized test recipient is developer personal number: 919000000000
    process.env.WHATSAPP_TEST_RECIPIENTS = '+91 90000 00000'
    process.env.WHATSAPP_MODE = 'test'

    const mockDb = createMockSupabase({
      orders: {
        'ord-customer': {
          id: 'ord-customer',
          account_id: ACCOUNT_A,
          contact_id: 'con-real-customer',
          is_test_order: true,
        },
      },
      contacts: {
        'con-real-customer': {
          id: 'con-real-customer',
          account_id: ACCOUNT_A,
          name: 'Real Dining Customer',
          phone: '+91 98765 11111', // Not in authorized list
        },
      },
    })

    const result = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-customer',
      supabase: mockDb,
    })

    // Identified and normalized, but send is blocked
    expect(result.success).toBe(true)
    expect(result.eligibleForSend).toBe(false)
    expect(result.isTestRecipient).toBe(false)
    expect(result.errorCode).toBe('RECIPIENT_TEST_MODE_BLOCKED')
    expect(result.errorMessage).toContain('not authorized under current Meta test number configuration')
  })

  // =========================================================================
  // Test F — Authorized Test Recipient
  // =========================================================================
  it('Test F: allows controlled testing when resolved contact matches authorized test recipient', async () => {
    process.env.WHATSAPP_TEST_RECIPIENTS = '+91 90000 00000, +1 415 555 2671'
    process.env.WHATSAPP_MODE = 'test'

    const mockDb = createMockSupabase({
      orders: {
        'ord-dev-test': {
          id: 'ord-dev-test',
          account_id: ACCOUNT_A,
          contact_id: 'con-dev',
          is_test_order: true,
        },
      },
      contacts: {
        'con-dev': {
          id: 'con-dev',
          account_id: ACCOUNT_A,
          name: 'Authorized Dev Tester',
          phone: '+91 90000 00000',
        },
      },
    })

    const result = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      orderId: 'ord-dev-test',
      supabase: mockDb,
    })

    expect(result.success).toBe(true)
    expect(result.eligibleForSend).toBe(true)
    expect(result.isTestRecipient).toBe(true)
    expect(result.phone).toBe('919000000000')
    expect(result.errorCode).toBeUndefined()
  })

  // =========================================================================
  // Test G — International Phone Formatting
  // =========================================================================
  it('Test G: correctly normalizes international formats and rejects non-E.164 numbers', async () => {
    // UK format: +44 7911 123456
    const mockDbUK = createMockSupabase({
      contacts: {
        'con-uk': { id: 'con-uk', account_id: ACCOUNT_A, phone: '+44 (7911) 123-456' },
      },
    })
    const ukRes = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      contactId: 'con-uk',
      supabase: mockDbUK,
    })
    expect(ukRes.success).toBe(true)
    expect(ukRes.phone).toBe('447911123456')
    expect(ukRes.formattedPhone).toBe('+447911123456')

    // US format: +1 (415) 555-2671
    const mockDbUS = createMockSupabase({
      contacts: {
        'con-us': { id: 'con-us', account_id: ACCOUNT_A, phone: '+1 415 555 2671' },
      },
    })
    const usRes = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      contactId: 'con-us',
      supabase: mockDbUS,
    })
    expect(usRes.success).toBe(true)
    expect(usRes.phone).toBe('14155552671')
    expect(usRes.formattedPhone).toBe('+14155552671')

    // UAE format: +971 50 123 4567
    const mockDbUAE = createMockSupabase({
      contacts: {
        'con-uae': { id: 'con-uae', account_id: ACCOUNT_A, phone: '+971 50 123 4567' },
      },
    })
    const uaeRes = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      contactId: 'con-uae',
      supabase: mockDbUAE,
    })
    expect(uaeRes.success).toBe(true)
    expect(uaeRes.phone).toBe('971501234567')

    // Invalid format: "12345"
    const mockDbInvalid = createMockSupabase({
      contacts: {
        'con-bad': { id: 'con-bad', account_id: ACCOUNT_A, phone: '12345' },
      },
    })
    const badRes = await resolveWorkflowRecipient({
      accountId: ACCOUNT_A,
      contactId: 'con-bad',
      supabase: mockDbInvalid,
    })
    expect(badRes.success).toBe(false)
    expect(badRes.errorCode).toBe('RECIPIENT_INVALID')
  })

  // =========================================================================
  // Test H — Masking, Security & WhatsApp Action Integration
  // =========================================================================
  it('Test H: masks phone numbers for safe logging and executes whatsapp_message action safely', async () => {
    expect(maskPhoneNumber('+919876543210')).toBe('+91*****3210')
    expect(maskPhoneNumber('14155552671')).toBe('14*****2671')
    expect(maskPhoneNumber('123')).toBe('***')
    expect(maskPhoneNumber('')).toBe('')

    // WhatsApp action node with resolved recipient
    const node: BackendFlowNode = {
      id: 'act-msg-1',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageTemplate: 'Hello {{customerName}}, your order {{orderNumber}} is ready!',
      },
    }

    const vars = {
      orderNumber: '101',
      customerName: 'Aarav Patel',
      customerPhone: '+919876543210',
      recipient: {
        success: true,
        contactId: 'con-1',
        contactName: 'Aarav Patel',
        phone: '919876543210',
        formattedPhone: '+919876543210',
        isPhone: true,
        accountId: ACCOUNT_A,
        isTestRecipient: false,
        eligibleForSend: true,
      },
    }

    const output = await executeActionNode(node, vars, { isDryRun: true, accountId: ACCOUNT_A })
    expect(output.success).toBe(true)
    expect(output.data?.formattedMessage).toBe('Hello Aarav Patel, your order 101 is ready!')
    expect(output.data?.to).toBe('+919876543210')
    expect(output.data?.simulated).toBe(true)
    expect(output.data?.delivered).toBe(false) // No real message sent
    const recipientData = output.data?.recipient as Record<string, unknown> | undefined
    expect(recipientData?.phone).toBe('91*****3210') // Masked in trace
  })

  it('rejects whatsapp_message action execution when recipient cannot be resolved', async () => {
    const node: BackendFlowNode = {
      id: 'act-msg-fail',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageTemplate: 'Your order is ready',
      },
    }

    // No recipient, no phone, no order
    const output = await executeActionNode(node, {}, { isDryRun: false, accountId: ACCOUNT_A })
    expect(output.success).toBe(false)
    expect(output.error).toContain('RECIPIENT_NOT_FOUND')
    expect(output.data?.delivered).toBe(false)
  })

  it('correctly identifies test mode and parses authorized test recipients', () => {
    expect(isWhatsAppTestMode({ isTestOrder: true })).toBe(true)
    expect(isWhatsAppTestMode({ enforceTestWhitelist: false })).toBe(false)

    const recipients = getAuthorizedTestRecipients('+91 90000 00000, 14155552671, invalid')
    expect(recipients.has('919000000000')).toBe(true)
    expect(recipients.has('14155552671')).toBe(true)
    expect(recipients.has('invalid')).toBe(false)
    expect(recipients.size).toBe(2)
  })
})
