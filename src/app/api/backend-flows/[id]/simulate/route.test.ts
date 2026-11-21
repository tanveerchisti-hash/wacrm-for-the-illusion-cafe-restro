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

describe('POST /api/backend-flows/[id]/simulate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs dry-run simulation successfully', async () => {
    const mockFlow = {
      id: 'f-1',
      account_id: 'acc-1',
      definition: {
        nodes: [
          { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start' } },
          { id: 'a1', type: 'action', position: { x: 0, y: 100 }, data: { label: 'Msg', subType: 'whatsapp_message' } },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'a1' }],
      },
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockFlow, error: null }),
      }),
    }

    mockRequireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'user-1',
    })

    const req = new Request('http://localhost/api/backend-flows/f-1/simulate', {
      method: 'POST',
      body: JSON.stringify({ payload: { customerName: 'Tanveer' } }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'f-1' }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.simulation).toBeDefined()
    expect(data.simulation.status).toBe('completed')
    expect(data.simulation.stepRuns).toHaveLength(2)
  })
})
