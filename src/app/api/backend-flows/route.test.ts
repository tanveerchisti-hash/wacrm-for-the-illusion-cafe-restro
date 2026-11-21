import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireRole = vi.fn()
const mockToErrorResponse = vi.fn((err: unknown) => {
  const message = err instanceof Error ? err.message : 'auth failed'
  return Response.json({ error: message }, { status: 403 })
})

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async (role?: string) => mockRequireRole(role)),
  toErrorResponse: vi.fn((err: unknown) => mockToErrorResponse(err)),
}))

import { GET, POST } from './route'

describe('/api/backend-flows API Route', () => {
  let fakeData: Record<string, unknown>[] = []
  let mockSupabase: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    fakeData = [
      {
        id: 'flow-1',
        account_id: 'acc-1',
        name: 'Order Pipeline',
        slug: 'order-pipeline',
        category: 'order_processing',
        status: 'published',
        current_version: 2,
        updated_at: '2026-11-21T10:00:00Z',
      },
      {
        id: 'flow-2',
        account_id: 'acc-1',
        name: 'Kitchen Notify',
        slug: 'kitchen-notify',
        category: 'kitchen_sync',
        status: 'draft',
        current_version: 1,
        updated_at: '2026-11-21T11:00:00Z',
      },
    ]

    mockSupabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockImplementation(() => ({
          data: fakeData,
          error: null,
        })),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => ({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'new-flow-id', ...payload },
              error: null,
            }),
          }),
        })),
      })),
    }

    mockRequireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'user-1',
      role: 'agent',
    })
  })

  describe('GET', () => {
    it('returns workflow list for authorized caller', async () => {
      const req = new Request('http://localhost/api/backend-flows')
      const res = await GET(req)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.flows).toHaveLength(2)
      expect(mockRequireRole).toHaveBeenCalledWith('viewer')
    })
  })

  describe('POST', () => {
    it('creates draft workflow with valid name and slug', async () => {
      const req = new Request('http://localhost/api/backend-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Payment Reconciliation',
          category: 'payment_reconciliation',
          trigger_type: 'webhook',
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(201)

      const json = await res.json()
      expect(json.flow.id).toBe('new-flow-id')
      expect(json.flow.name).toBe('Payment Reconciliation')
      expect(json.flow.slug).toBe('payment-reconciliation')
      expect(json.flow.status).toBe('draft')
      expect(mockRequireRole).toHaveBeenCalledWith('agent')
    })

    it('returns 400 when name is missing or too short', async () => {
      const req = new Request('http://localhost/api/backend-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' ' }),
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toMatch(/at least 2 characters/)
    })
  })
})
