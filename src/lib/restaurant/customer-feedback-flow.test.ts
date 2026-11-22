/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeFlowGraph } from '@/lib/backend-flows/engine/graph-runner'
import type { BackendFlowDefinition } from '@/lib/backend-flows/types'
import * as whatsappSender from '@/lib/backend-flows/engine/whatsapp-sender'

vi.mock('@/lib/backend-flows/engine/whatsapp-sender', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/backend-flows/engine/whatsapp-sender')
  return {
    ...actual,
    checkConversationWindow: vi.fn(),
    validateTemplateApproved: vi.fn(),
  }
})

describe('End-to-End Customer Feedback Automation Pipeline', () => {
  const ACCOUNT_ID = 'acc-illusion-prod'
  const ORDER_ID = 'ord-completed-101'
  const CONTACT_ID = 'cnt-customer-55'
  const CONVERSATION_ID = 'conv-customer-55'

  const feedbackPipelineDefinition: BackendFlowDefinition = {
    nodes: [
      {
        id: 'trigger_order_completed',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          label: 'Order Completed Trigger',
          subType: 'order_event',
          event: 'order.completed',
        },
      },
      {
        id: 'action_eligibility_check',
        type: 'action',
        position: { x: 0, y: 160 },
        data: {
          label: 'Validate Feedback Eligibility',
          subType: 'restaurant_feedback_eligibility',
        },
      },
      {
        id: 'action_feedback_delay',
        type: 'action',
        position: { x: 0, y: 320 },
        data: {
          label: '20-Minute Delay Timer',
          subType: 'delay',
          delayMinutes: 20,
        },
      },
      {
        id: 'action_presend_revalidation',
        type: 'action',
        position: { x: 0, y: 480 },
        data: {
          label: 'Pre-Send Revalidation',
          subType: 'restaurant_feedback_revalidation',
        },
      },
      {
        id: 'action_whatsapp_feedback',
        type: 'action',
        position: { x: 0, y: 640 },
        data: {
          label: 'Customer Feedback Request',
          subType: 'whatsapp_message',
          messageMode: 'template',
          templateName: 'customer_feedback',
          templateLanguage: 'en',
          templateParams: ['{{customerName}}', '{{orderNumber}}'],
          messageTemplate: 'Thank you {{customerName}} for dining with us! Order #{{orderNumber}} has been completed.',
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'trigger_order_completed',
        target: 'action_eligibility_check',
      },
      {
        id: 'e2',
        source: 'action_eligibility_check',
        target: 'action_feedback_delay',
      },
      {
        id: 'e3',
        source: 'action_feedback_delay',
        target: 'action_presend_revalidation',
      },
      {
        id: 'e4',
        source: 'action_presend_revalidation',
        target: 'action_whatsapp_feedback',
      },
    ],
  }

  const mockOrder = {
    id: ORDER_ID,
    account_id: ACCOUNT_ID,
    order_number: '101',
    status: 'completed',
    contact_id: CONTACT_ID,
    conversation_id: CONVERSATION_ID,
    is_test_order: false,
    total_amount: 850,
  }

  const mockContact = {
    id: CONTACT_ID,
    account_id: ACCOUNT_ID,
    name: 'Rajesh Kumar',
    phone: '+919876543210',
    tags: ['diner'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.BACKEND_FLOWS_ENABLE_LIVE_SEND
    delete process.env.BACKEND_FLOWS_ENABLE_TEST_SEND
    delete process.env.BACKEND_FLOWS_EMERGENCY_PAUSE

    vi.mocked(whatsappSender.checkConversationWindow).mockResolvedValue({
      isOpen: true,
      hoursSince: 1,
      lastInboundAt: new Date().toISOString(),
    })
    vi.mocked(whatsappSender.validateTemplateApproved).mockResolvedValue({
      approved: true,
      language: 'en',
    })
  })

  function createMockDb(overrides?: {
    orderStatus?: string
    contactTags?: string[]
    ledgerStatus?: string
    windowOpen?: boolean
    templateApproved?: boolean
  }) {
    const order = { ...mockOrder, status: overrides?.orderStatus || 'completed' }
    const contact = { ...mockContact, tags: overrides?.contactTags || ['diner'] }
    const ledger = overrides?.ledgerStatus ? { id: 'ledg-1', status: overrides.ledgerStatus } : null

    if (overrides?.windowOpen !== undefined) {
      vi.mocked(whatsappSender.checkConversationWindow).mockResolvedValue({
        isOpen: overrides.windowOpen,
        hoursSince: overrides.windowOpen ? 1 : 26,
        lastInboundAt: new Date().toISOString(),
      })
    }

    if (overrides?.templateApproved !== undefined) {
      vi.mocked(whatsappSender.validateTemplateApproved).mockResolvedValue({
        approved: overrides.templateApproved,
        reason: overrides.templateApproved ? undefined : 'Template unapproved',
      })
    }

    return {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'restaurant_trial_orders') {
          const chain: any = {}
          chain.select = vi.fn().mockReturnValue(chain)
          chain.eq = vi.fn().mockReturnValue(chain)
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: order, error: null })
          chain.update = vi.fn().mockReturnValue(chain)
          return chain
        }
        if (table === 'contacts') {
          const chain: any = {}
          chain.select = vi.fn().mockReturnValue(chain)
          chain.eq = vi.fn().mockReturnValue(chain)
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: contact, error: null })
          return chain
        }
        if (table === 'restaurant_feedback_dispatch_ledger') {
          const chain: any = {}
          chain.select = vi.fn().mockReturnValue(chain)
          chain.eq = vi.fn().mockReturnValue(chain)
          chain.maybeSingle = vi.fn().mockResolvedValue({ data: ledger, error: null })
          chain.insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'ledg-new' }, error: null }),
            }),
          })
          chain.update = vi.fn().mockReturnValue(chain)
          return chain
        }
        if (table === 'conversations') {
          const chain: any = {}
          chain.select = vi.fn().mockReturnValue(chain)
          chain.eq = vi.fn().mockReturnValue(chain)
          chain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: CONVERSATION_ID, account_id: ACCOUNT_ID, contact_id: CONTACT_ID },
            error: null,
          })
          chain.update = vi.fn().mockReturnValue(chain)
          return chain
        }
        const defaultChain: any = {}
        defaultChain.select = vi.fn().mockReturnValue(defaultChain)
        defaultChain.eq = vi.fn().mockReturnValue(defaultChain)
        defaultChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
        defaultChain.update = vi.fn().mockReturnValue(defaultChain)
        defaultChain.insert = vi.fn().mockReturnValue(defaultChain)
        return defaultChain
      }),
    }
  }

  it('runs the full 5-node pipeline successfully in safe simulation / dry-run mode', async () => {
    const mockDb = createMockDb()

    const result = await executeFlowGraph(feedbackPipelineDefinition, {
      runId: 'run-sim-1',
      flowId: 'flow-feedback-prod',
      accountId: ACCOUNT_ID,
      versionNumber: 1,
      isDryRun: true,
      initialVariables: {
        orderId: ORDER_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        customerName: 'Rajesh Kumar',
        orderNumber: '101',
      },
      supabase: mockDb as any,
    })

    expect(result.status).toBe('completed')
    expect(result.stepRuns).toHaveLength(5)
    expect(result.stepRuns[0].nodeId).toBe('trigger_order_completed')
    expect(result.stepRuns[1].nodeId).toBe('action_eligibility_check')
    expect(result.stepRuns[1].status).toBe('completed')
    expect(result.stepRuns[2].nodeId).toBe('action_feedback_delay')
    expect(result.stepRuns[2].output?.delayMinutes).toBe(20)
    expect(result.stepRuns[3].nodeId).toBe('action_presend_revalidation')
    expect(result.stepRuns[3].status).toBe('completed')
    expect(result.stepRuns[4].nodeId).toBe('action_whatsapp_feedback')
    expect(result.stepRuns[4].output?.simulated).toBe(true)
  })

  it('pauses at 20-minute delay and enters waiting state during production live execution', async () => {
    const mockDb = createMockDb()

    const result = await executeFlowGraph(feedbackPipelineDefinition, {
      runId: 'run-live-pause',
      flowId: 'flow-feedback-prod',
      accountId: ACCOUNT_ID,
      versionNumber: 1,
      isDryRun: false, // Live durable pause
      initialVariables: {
        orderId: ORDER_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        customerName: 'Rajesh Kumar',
        orderNumber: '101',
      },
      supabase: mockDb as any,
    })

    expect(result.status).toBe('waiting')
    expect(result.waitingNodeId).toBe('action_feedback_delay')
    expect(result.waitingUntil).toBeDefined()
    expect(result.pendingNodeIds).toContain('action_presend_revalidation')

    // Downstream revalidation and whatsapp actions have NOT run yet
    const ranNodes = result.stepRuns.map((s) => s.nodeId)
    expect(ranNodes).not.toContain('action_presend_revalidation')
    expect(ranNodes).not.toContain('action_whatsapp_feedback')
  })

  it('safely terminates at eligibility check when customer has opted out (DND)', async () => {
    const mockDb = createMockDb({ contactTags: ['dnd', 'regular'] })

    const result = await executeFlowGraph(feedbackPipelineDefinition, {
      runId: 'run-optout',
      flowId: 'flow-feedback-prod',
      accountId: ACCOUNT_ID,
      versionNumber: 1,
      isDryRun: true,
      initialVariables: {
        orderId: ORDER_ID,
        contactId: CONTACT_ID,
      },
      supabase: mockDb as any,
    })

    // Finished cleanly as completed without crashing
    expect(result.status).toBe('completed')
    expect(result.stepRuns).toHaveLength(2) // Trigger + Eligibility
    const eligibilityStep = result.stepRuns[1]
    expect(eligibilityStep.status).toBe('skipped')
    expect(eligibilityStep.error).toContain('CUSTOMER_OPTED_OUT')

    // Delay and WhatsApp send never executed
    const stepIds = result.stepRuns.map((s) => s.nodeId)
    expect(stepIds).not.toContain('action_feedback_delay')
    expect(stepIds).not.toContain('action_whatsapp_feedback')
  })

  it('safely terminates at eligibility check when order was cancelled', async () => {
    const mockDb = createMockDb({ orderStatus: 'cancelled' })

    const result = await executeFlowGraph(feedbackPipelineDefinition, {
      runId: 'run-cancelled-order',
      flowId: 'flow-feedback-prod',
      accountId: ACCOUNT_ID,
      versionNumber: 1,
      isDryRun: true,
      initialVariables: {
        orderId: ORDER_ID,
        contactId: CONTACT_ID,
      },
      supabase: mockDb as any,
    })

    expect(result.status).toBe('completed')
    expect(result.stepRuns).toHaveLength(2)
    const eligibilityStep = result.stepRuns[1]
    expect(eligibilityStep.status).toBe('skipped')
    expect(eligibilityStep.error).toContain('ORDER_NOT_COMPLETED')
  })

  it('pre-send revalidation blocks send if order status changed to cancelled during the 20-minute delay', async () => {
    // Resuming after 20-minute delay from frontier node 'action_presend_revalidation'
    const mockDb = createMockDb({ orderStatus: 'cancelled' })

    const result = await executeFlowGraph(feedbackPipelineDefinition, {
      runId: 'run-resume-cancelled',
      flowId: 'flow-feedback-prod',
      accountId: ACCOUNT_ID,
      versionNumber: 1,
      isDryRun: true,
      resumeFromNodeIds: ['action_presend_revalidation'],
      initialVariables: {
        orderId: ORDER_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
      },
      supabase: mockDb as any,
    })

    expect(result.status).toBe('completed')
    const revalStep = result.stepRuns.find((s) => s.nodeId === 'action_presend_revalidation')
    expect(revalStep?.status).toBe('skipped')
    expect(revalStep?.error).toContain('ORDER_STATUS_CHANGED')

    // WhatsApp feedback was not sent
    const messageStep = result.stepRuns.find((s) => s.nodeId === 'action_whatsapp_feedback')
    expect(messageStep).toBeUndefined()
  })

  it('pre-send revalidation blocks send if 24h window closed and template is unapproved', async () => {
    const mockDb = createMockDb({
      windowOpen: false,
      templateApproved: false,
    })

    const result = await executeFlowGraph(feedbackPipelineDefinition, {
      runId: 'run-resume-unapproved-tpl',
      flowId: 'flow-feedback-prod',
      accountId: ACCOUNT_ID,
      versionNumber: 1,
      isDryRun: true,
      resumeFromNodeIds: ['action_presend_revalidation'],
      initialVariables: {
        orderId: ORDER_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
      },
      supabase: mockDb as any,
    })

    expect(result.status).toBe('completed')
    const revalStep = result.stepRuns.find((s) => s.nodeId === 'action_presend_revalidation')
    expect(revalStep?.status).toBe('skipped')
    expect(revalStep?.error).toContain('TEMPLATE_UNAVAILABLE_OUTSIDE_WINDOW')

    const messageStep = result.stepRuns.find((s) => s.nodeId === 'action_whatsapp_feedback')
    expect(messageStep).toBeUndefined()
  })
})
