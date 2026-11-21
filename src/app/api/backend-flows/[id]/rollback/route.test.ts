import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const mockRequireRole = vi.fn()
vi.mock('@/lib/auth/account', () => ({
  requireRole: (role?: string) => mockRequireRole(role),
  toErrorResponse: (err: unknown) => {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Error' }), {
      status: 500,
    })
  },
}))

describe('POST /api/backend-flows/[id]/rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects if version_number is missing or invalid', async () => {
    mockRequireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acc-1',
      userId: 'user-1',
    })

    const req = new Request('http://localhost/api/backend-flows/f-1/rollback', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'f-1' }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Valid version_number is required')
  })

  it('restores snapshot definition and updates flow', async () => {
    const mockSnapshot = {
      id: 'snap-1',
      flow_id: 'f-1',
      version_number: 2,
      definition: { nodes: [{ id: 'n1', type: 'trigger' }], edges: [] },
      trigger_config: { event: 'order.created' },
    }

    const mockCurrentFlow = {
      id: 'f-1',
      current_version: 3,
    }

    const mockUpdatedFlow = {
      id: 'f-1',
      current_version: 4,
      status: 'draft',
      definition: mockSnapshot.definition,
    }

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'backend_flow_versions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockSnapshot, error: null }),
          }
        }
        if (table === 'backend_flows') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockCurrentFlow, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: mockUpdatedFlow, error: null }),
              }),
            }),
          }
        }
        return {}
      }),
    }

    mockRequireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'user-1',
    })

    const req = new Request('http://localhost/api/backend-flows/f-1/rollback', {
      method: 'POST',
      body: JSON.stringify({ version_number: 2 }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'f-1' }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.restored_from_version).toBe(2)
    expect(data.flow.current_version).toBe(4)
  })
})
