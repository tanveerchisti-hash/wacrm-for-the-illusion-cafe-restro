import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

const mockRequireRole = vi.fn()
vi.mock('@/lib/auth/account', () => ({
  requireRole: (role?: string) => mockRequireRole(role),
  toErrorResponse: (err: unknown) => {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Error' }), {
      status: 500,
    })
  },
}))

describe('GET /api/backend-flows/[id]/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists workflow execution runs for authorized viewer', async () => {
    const mockRuns = [
      { id: 'run-1', flow_id: 'f-1', status: 'completed', duration_ms: 120 },
      { id: 'run-2', flow_id: 'f-1', status: 'failed', duration_ms: 50 },
    ]

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockRuns, error: null }),
      }),
    }

    mockRequireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'user-1',
    })

    const req = new Request('http://localhost/api/backend-flows/f-1/runs')
    const res = await GET(req, { params: Promise.resolve({ id: 'f-1' }) })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.runs).toHaveLength(2)
    expect(data.runs[0].id).toBe('run-1')
  })
})
