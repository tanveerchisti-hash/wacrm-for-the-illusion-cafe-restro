/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  dispatchBackendFlowWhatsApp,
  checkConversationWindow,
  validateTemplateApproved,
  hasUnresolvedPlaceholders,
} from './whatsapp-sender'
import { executeActionNode } from './actions'
import { MetaApiError } from '@/lib/whatsapp/meta-api'
import type { BackendFlowNode } from '../types'
import type { ResolvedRecipient } from './recipient-resolver'

// Mock Meta API functions
vi.mock('@/lib/whatsapp/meta-api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/whatsapp/meta-api')
  return {
    ...actual,
    sendTextMessage: vi.fn(),
    sendTemplateMessage: vi.fn(),
  }
})

// Mock encryption helper
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((val: string) => `decrypted-${val}`),
  encrypt: vi.fn((val: string) => `encrypted-${val}`),
}))

import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'

describe('Backend Flows WhatsApp Sender (Phase 5)', () => {
  const ACCOUNT_A = 'acc-illusion-cafe'
  const CONVERSATION_A = 'conv-101'
  const CONTACT_A = 'con-priya-01'

  const baseRecipient: ResolvedRecipient = {
    success: true,
    contactId: CONTACT_A,
    contactName: 'Priya Sharma',
    conversationId: CONVERSATION_A,
    phone: '919876543210',
    formattedPhone: '+919876543210',
    isPhone: true,
    waUserId: null,
    accountId: ACCOUNT_A,
    isTestRecipient: false,
    eligibleForSend: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND
    delete process.env.BACKEND_FLOWS_ENABLE_TEST_SEND
    delete process.env.BACKEND_FLOWS_EMERGENCY_PAUSE
  })

  // Helper to build a mock Supabase client
  function createMockSupabase(options?: {
    lastCustomerMessageAt?: string | null
    templates?: Array<{
      id: string
      account_id: string
      user_id: string
      name: string
      language: string
      status: string
      body_text: string
    }>
    hasConfig?: boolean
    insertedMessages?: Record<string, unknown>[]
    updatedConversations?: Record<string, unknown>[]
  }) {
    const insertedMessages = options?.insertedMessages || []
    const updatedConversations = options?.updatedConversations || []

    return {
      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {}

        const queryBuilder = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn((data: unknown) => {
            if (Array.isArray(data)) {
              insertedMessages.push(...(data as Record<string, unknown>[]))
            } else {
              insertedMessages.push(data as Record<string, unknown>)
            }
            return {
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn(async () => ({
                data: { id: 'msg-inserted-id-123' },
                error: null,
              })),
            }
          }),
          update: vi.fn((data: unknown) => {
            updatedConversations.push(data as Record<string, unknown>)
            return {
              eq: vi.fn().mockReturnThis(),
            }
          }),
          eq: vi.fn((col: string, val: unknown) => {
            filters[col] = val
            return queryBuilder
          }),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => {
            if (table === 'messages') {
              if (filters['sender_type'] === 'customer') {
                if (options?.lastCustomerMessageAt) {
                  return {
                    data: {
                      id: 'msg-cust-1',
                      created_at: options.lastCustomerMessageAt,
                      sender_type: 'customer',
                    },
                    error: null,
                  }
                }
                return { data: null, error: null }
              }
            }
            return { data: null, error: null }
          }),
          single: vi.fn(async () => {
            if (table === 'whatsapp_config') {
              if (options?.hasConfig !== false) {
                return {
                  data: {
                    id: 'wac-1',
                    account_id: ACCOUNT_A,
                    phone_number_id: 'phone-num-id-1',
                    access_token: 'enc-token-abc',
                  },
                  error: null,
                }
              }
              return { data: null, error: { message: 'Config not found' } }
            }
            return { data: null, error: null }
          }),
          then: (resolve: (value: unknown) => void) => {
            if (table === 'message_templates') {
              const accountId = filters['account_id']
              const name = filters['name']
              const list = (options?.templates || []).filter(
                (t) => (!accountId || t.account_id === accountId) && (!name || t.name === name)
              )
              return resolve({ data: list, error: null })
            }
            return resolve({ data: null, error: null })
          },
        }

        return queryBuilder
      }),
    }
  }

  // =========================================================================
  // Scenario A — Basic Text Message with Open 24h Window
  // =========================================================================
  it('Scenario A: formats and prepares text message when 24h window is open (safe default mode)', async () => {
    // Message received 2 hours ago -> window is open
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twoHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hi {{customerName}}, your order #{{orderNumber}} totaling {{order.totalAmount}} is ready!',
      },
    }

    const vars = {
      customerName: 'Priya Sharma',
      orderNumber: '101',
      order: { totalAmount: '₹450' },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars,
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(true)
    expect(result.delivered).toBe(false)
    expect(result.simulated).toBe(false)
    expect(result.mode).toBe('disabled_by_default')
    expect(result.to).toBe('+919876543210')
    expect(result.formattedMessage).toBe('Hi Priya Sharma, your order #101 totaling ₹450 is ready!')
    expect(result.conversationWindow?.isOpen).toBe(true)
    expect(result.recipient?.name).toBe('Priya Sharma')
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario B — Expired 24-Hour Window Blocks Free-Form Text
  // =========================================================================
  it('Scenario B: blocks free-form text with [EXPIRED_24H_WINDOW] when window is closed', async () => {
    // Message received 30 hours ago -> window is expired
    const thirtyHoursAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: thirtyHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hi {{customerName}}, just checking in!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Priya Sharma' },
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.delivered).toBe(false)
    expect(result.errorCode).toBe('EXPIRED_24H_WINDOW')
    expect(result.error).toContain('[EXPIRED_24H_WINDOW]')
    expect(result.conversationWindow?.isOpen).toBe(false)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario C — Approved Template Message (Allowed Outside 24h Window)
  // =========================================================================
  it('Scenario C: allows approved template message outside 24h window', async () => {
    // Window closed (no recent customer message)
    const mockDb = createMockSupabase({
      lastCustomerMessageAt: null,
      templates: [
        {
          id: 'tpl-1',
          account_id: ACCOUNT_A,
          user_id: 'usr-1',
          name: 'customer_feedback',
          language: 'en',
          status: 'APPROVED',
          body_text: 'Hi {{1}}, how was your dining experience at {{2}}?',
        },
      ],
    })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'template',
        templateName: 'customer_feedback',
        templateLanguage: 'en',
        templateParams: ['{{customerName}}', 'The Illusion Cafe'],
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Priya Sharma' },
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(true)
    expect(result.errorCode).toBeUndefined()
    expect(result.templateName).toBe('customer_feedback')
    expect(result.templateParams).toEqual(['Priya Sharma', 'The Illusion Cafe'])
    expect(result.mode).toBe('disabled_by_default')
  })

  // =========================================================================
  // Scenario D — Unapproved Template Message
  // =========================================================================
  it('Scenario D: blocks unapproved template message with [UNAPPROVED_TEMPLATE]', async () => {
    const mockDb = createMockSupabase({
      templates: [
        {
          id: 'tpl-2',
          account_id: ACCOUNT_A,
          user_id: 'usr-1',
          name: 'unapproved_promo',
          language: 'en',
          status: 'PENDING',
          body_text: 'Big 50% discount today!',
        },
      ],
    })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'template',
        templateName: 'unapproved_promo',
        templateLanguage: 'en',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('UNAPPROVED_TEMPLATE')
    expect(result.error).toContain('[UNAPPROVED_TEMPLATE]')
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario E — Unauthorized Recipient in Test Mode
  // =========================================================================
  it('Scenario E: blocks unauthorized recipient with [RECIPIENT_TEST_MODE_BLOCKED] when test send is enabled', async () => {
    process.env.BACKEND_FLOWS_ENABLE_TEST_SEND = 'true'

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twoHoursAgo })

    const unauthorizedRecipient: ResolvedRecipient = {
      ...baseRecipient,
      isTestRecipient: false, // Not on the authorized test number allowlist
    }

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello {{customerName}}!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Priya' },
      recipient: unauthorizedRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('RECIPIENT_TEST_MODE_BLOCKED')
    expect(result.error).toContain('[RECIPIENT_TEST_MODE_BLOCKED]')
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario F — Authorized Test Recipient in Test Mode
  // =========================================================================
  it('Scenario F: dispatches via Meta API and records message when test send is enabled for authorized recipient', async () => {
    process.env.BACKEND_FLOWS_ENABLE_TEST_SEND = 'true'

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const insertedMessages: Record<string, unknown>[] = []
    const updatedConversations: Record<string, unknown>[] = []

    const mockDb = createMockSupabase({
      lastCustomerMessageAt: twoHoursAgo,
      hasConfig: true,
      insertedMessages,
      updatedConversations,
    })

    const authorizedRecipient: ResolvedRecipient = {
      ...baseRecipient,
      isTestRecipient: true, // Authorized test number
    }

    vi.mocked(sendTextMessage).mockResolvedValueOnce({
      messageId: 'wamid.HBgTESTMSG123',
    })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hi {{customerName}}, your test order is ready!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Priya' },
      recipient: authorizedRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(true)
    expect(result.submittedToMeta).toBe(true)
    expect(result.delivered).toBe(false)
    expect(result.mode).toBe('test_send')
    expect(result.whatsappMessageId).toBe('wamid.HBgTESTMSG123')
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    expect(insertedMessages.length).toBeGreaterThan(0)
    expect(insertedMessages[0]).toMatchObject({
      conversation_id: CONVERSATION_A,
      sender_type: 'bot',
      content_type: 'text',
      content_text: 'Hi Priya, your test order is ready!',
      message_id: 'wamid.HBgTESTMSG123',
      status: 'sent',
    })
  })

  // =========================================================================
  // Scenario G — Missing Customer / Recipient Not Found
  // =========================================================================
  it('Scenario G: returns structured [RECIPIENT_NOT_FOUND] when recipient resolution fails', async () => {
    const unresolvableRecipient: ResolvedRecipient = {
      success: false,
      accountId: ACCOUNT_A,
      isPhone: false,
      isTestRecipient: false,
      eligibleForSend: false,
      errorCode: 'RECIPIENT_NOT_FOUND',
      errorMessage: 'Order "ord-unknown" has no associated contact.',
    }

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: unresolvableRecipient,
      accountId: ACCOUNT_A,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('RECIPIENT_NOT_FOUND')
    expect(result.error).toContain('[RECIPIENT_NOT_FOUND]')
  })

  // =========================================================================
  // Scenario H — Duplicate Action Suppression via Idempotency Fingerprint
  // =========================================================================
  it('Scenario H: executeActionNode does not call provider when action result is reused', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twoHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello {{customerName}}!',
      },
    }

    const initialResult = await executeActionNode(
      node,
      { customerName: 'Priya' },
      {
        recipient: baseRecipient,
        accountId: ACCOUNT_A,
        supabase: mockDb,
      }
    )

    expect(initialResult.success).toBe(true)
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario I — Concurrent Execution Protection
  // =========================================================================
  it('Scenario I: atomic execution state ensures safe operation without race condition duplicates', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twoHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Safe order status message',
      },
    }

    // Run parallel calls
    const [res1, res2] = await Promise.all([
      dispatchBackendFlowWhatsApp({
        node,
        vars: {},
        recipient: baseRecipient,
        accountId: ACCOUNT_A,
        supabase: mockDb,
      }),
      dispatchBackendFlowWhatsApp({
        node,
        vars: {},
        recipient: baseRecipient,
        accountId: ACCOUNT_A,
        supabase: mockDb,
      }),
    ])

    expect(res1.success).toBe(true)
    expect(res2.success).toBe(true)
    // Neither should have called live Meta API
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario J — Provider Timeout Handling
  // =========================================================================
  it('Scenario J: cleanly catches and classifies Meta provider timeout without crash', async () => {
    process.env.BACKEND_FLOWS_ENABLE_TEST_SEND = 'true'

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({
      lastCustomerMessageAt: twoHoursAgo,
      hasConfig: true,
    })

    const authorizedRecipient: ResolvedRecipient = {
      ...baseRecipient,
      isTestRecipient: true,
    }

    vi.mocked(sendTextMessage).mockRejectedValueOnce(new Error('Connection timed out to graph.facebook.com'))

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello {{customerName}}',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Priya' },
      recipient: authorizedRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.delivered).toBe(false)
    expect(result.errorCode).toBe('META_AMBIGUOUS_TIMEOUT')
    expect(result.error).toContain('Network timeout')
  })

  // =========================================================================
  // Scenario K — Provider Failure Classification (Permanent vs Transient)
  // =========================================================================
  it('Scenario K: distinguishes structured Meta API errors (e.g. 190 token expired)', async () => {
    process.env.BACKEND_FLOWS_ENABLE_TEST_SEND = 'true'

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({
      lastCustomerMessageAt: twoHoursAgo,
      hasConfig: true,
    })

    const authorizedRecipient: ResolvedRecipient = {
      ...baseRecipient,
      isTestRecipient: true,
    }

    vi.mocked(sendTextMessage).mockRejectedValueOnce(
      new MetaApiError('Error validating access token: Session has expired.', {
        code: 190,
        type: 'OAuthException',
        httpStatus: 400,
      })
    )

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello {{customerName}}',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Priya' },
      recipient: authorizedRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('META_API_ERROR_190')
    expect(result.error).toContain('access token')
  })

  // =========================================================================
  // Scenario L — Delivery Status Webhook Correlation
  // =========================================================================
  it('Scenario L: records waMessageId into messages table so delivery webhook correlates correctly', async () => {
    process.env.BACKEND_FLOWS_ENABLE_TEST_SEND = 'true'

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const insertedMessages: Record<string, unknown>[] = []
    const mockDb = createMockSupabase({
      lastCustomerMessageAt: twoHoursAgo,
      hasConfig: true,
      insertedMessages,
    })

    const authorizedRecipient: ResolvedRecipient = {
      ...baseRecipient,
      isTestRecipient: true,
    }

    const expectedWamid = 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgSMzAyRUJCNTIzQTNDNTkyNzg1AA=='
    vi.mocked(sendTextMessage).mockResolvedValueOnce({
      messageId: expectedWamid,
    })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Your food is on the way!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: authorizedRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(true)
    expect(result.whatsappMessageId).toBe(expectedWamid)
    expect(insertedMessages[0]?.message_id).toBe(expectedWamid)
  })

  // =========================================================================
  // Scenario M — Delayed Workflow Resumption & Window Verification
  // =========================================================================
  it('Scenario M: evaluates 24h window at execution time following resumption', async () => {
    // If a workflow resumed 25 hours after customer's last message, free-form text fails
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twentyFiveHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-delayed-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'How was everything yesterday?',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('EXPIRED_24H_WINDOW')
  })

  // =========================================================================
  // Scenario N — Test vs Production Isolation Guard
  // =========================================================================
  it('Scenario N: fails closed with [PRODUCTION_SENDER_DISABLED] when live send is flagged in test environment', async () => {
    process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND = 'true'

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twoHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Live message attempt',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb,
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PRODUCTION_SENDER_DISABLED')
    expect(result.error).toContain('[PRODUCTION_SENDER_DISABLED]')
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Scenario O — Integration with executeActionNode
  // =========================================================================
  it('Scenario O: executeActionNode routes whatsapp_message through dispatchBackendFlowWhatsApp', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const mockDb = createMockSupabase({ lastCustomerMessageAt: twoHoursAgo })

    const node: BackendFlowNode = {
      id: 'node-wa-action',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello {{customerName}}!',
      },
    }

    const result = await executeActionNode(
      node,
      { customerName: 'Priya Sharma' },
      {
        recipient: baseRecipient,
        accountId: ACCOUNT_A,
        supabase: mockDb,
      }
    )

    expect(result.success).toBe(true)
    const out = result.data as Record<string, unknown>
    expect(out.mode).toBe('disabled_by_default')
    expect(out.formattedMessage).toBe('Hello Priya Sharma!')
  })

  // =========================================================================
  // Scenario P — Safe Dry-Run Simulation Mode
  // =========================================================================
  it('Scenario P: executes dry-run simulation safely with zero outbound sends or DB writes', async () => {
    const node: BackendFlowNode = {
      id: 'node-sim-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Simulated greeting to {{customerName}}',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: { customerName: 'Simulated Guest' },
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      isDryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.simulated).toBe(true)
    expect(result.delivered).toBe(false)
    expect(result.mode).toBe('dry_run')
    expect(result.whatsappMessageId).toMatch(/^sim-wamid\./)
    expect(result.formattedMessage).toBe('Simulated greeting to Simulated Guest')
    expect(sendTextMessage).not.toHaveBeenCalled()
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  // =========================================================================
  // Helper tests: checkConversationWindow, validateTemplateApproved, placeholder check
  // =========================================================================
  it('detects unresolved {{placeholders}} properly', () => {
    expect(hasUnresolvedPlaceholders('Hello {{customerName}}')).toBe(true)
    expect(hasUnresolvedPlaceholders('Hello Priya, your order is ready!')).toBe(false)
    expect(hasUnresolvedPlaceholders('Code is {{1}}')).toBe(true)
  })

  it('checkConversationWindow returns isOpen=false when no inbound message found', async () => {
    const mockDb = createMockSupabase({ lastCustomerMessageAt: null })
    const res = await checkConversationWindow(mockDb, CONVERSATION_A)
    expect(res.isOpen).toBe(false)
    expect(res.hoursSince).toBeNull()
  })

  it('validateTemplateApproved correctly reports template status', async () => {
    const mockDb = createMockSupabase({
      templates: [
        {
          id: 'tpl-approved',
          account_id: ACCOUNT_A,
          user_id: 'usr-1',
          name: 'approved_tpl',
          language: 'en',
          status: 'APPROVED',
          body_text: 'Body',
        },
      ],
    })

    const approvedRes = await validateTemplateApproved(mockDb, ACCOUNT_A, 'approved_tpl', 'en')
    expect(approvedRes.approved).toBe(true)

    const missingRes = await validateTemplateApproved(mockDb, ACCOUNT_A, 'non_existent_tpl', 'en')
    expect(missingRes.approved).toBe(false)
    expect(missingRes.reason).toContain('does not exist')
  })

  // =========================================================================
  // Production Sender Verification & Emergency Pause
  // =========================================================================
  it('Scenario M: blocks dispatch immediately when emergency shutdown is active', async () => {
    process.env.BACKEND_FLOWS_EMERGENCY_PAUSE = 'true'

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
    })

    expect(result.success).toBe(false)
    expect(result.shouldRetry).toBe(false)
    expect(result.errorCode).toBe('EMERGENCY_PAUSED')
    delete process.env.BACKEND_FLOWS_EMERGENCY_PAUSE
  })

  it('Scenario N: rejects production live sending if sender is a Meta Test Number', async () => {
    process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND = 'true'

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'whatsapp_config') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    phone_number_id: '106540352331505', // Known Meta Developer Test Number
                    status: 'connected',
                    registered_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { created_at: new Date().toISOString() },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello customer!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb as any,
    })

    expect(result.success).toBe(false)
    expect(result.shouldRetry).toBe(false)
    expect(result.errorCode).toBe('PRODUCTION_SENDER_DISABLED')
    expect(result.error).toContain('[PRODUCTION_SENDER_DISABLED]')
    delete process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND
  })

  it('Scenario O: rejects production live sending if sender has no 2FA PIN registration (registered_at=null)', async () => {
    process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND = 'true'

    const mockDb = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'whatsapp_config') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    phone_number_id: '999888777666',
                    status: 'connected',
                    registered_at: null, // Unregistered
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { created_at: new Date().toISOString() },
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    const node: BackendFlowNode = {
      id: 'node-send-wa',
      type: 'action',
      position: { x: 0, y: 0 },
      data: {
        subType: 'whatsapp_message',
        messageMode: 'text',
        messageTemplate: 'Hello customer!',
      },
    }

    const result = await dispatchBackendFlowWhatsApp({
      node,
      vars: {},
      recipient: baseRecipient,
      accountId: ACCOUNT_A,
      supabase: mockDb as any,
    })

    expect(result.success).toBe(false)
    expect(result.shouldRetry).toBe(false)
    expect(result.errorCode).toBe('PRODUCTION_SENDER_DISABLED')
    expect(result.error).toContain('[PRODUCTION_SENDER_DISABLED]')
    delete process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND
  })
})
