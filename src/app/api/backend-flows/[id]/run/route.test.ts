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

describe('POST /api/backend-flows/[id]/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects if workflow is not found', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }

    mockRequireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'user-1',
    })

    const req = new Request('http://localhost/api/backend-flows/f-none/run', {
      method: 'POST',
      body: JSON.stringify({ payload: {} }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'f-none' }) })
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Workflow not found')
  })

  it('executes workflow run and returns state', async () => {
    const mockFlow = {
      id: 'f-1',
      account_id: 'acc-1',
      name: 'Test Flow',
      status: 'draft',
      trigger_type: 'manual',
      trigger_config: {},
      definition: {
        nodes: [
          { id: 't1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start' } },
          { id: 'a1', type: 'action', position: { x: 0, y: 100 }, data: { label: 'Sync', subType: 'kitchen_sync' } },
        ],
        edges: [{ id: 'e1', source: 't1', target: 'a1' }],
      },
      metadata: {},
      execution_count: 0,
    }

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'backend_flows') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockFlow, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'backend_flow_runs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
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

    const req = new Request('http://localhost/api/backend-flows/f-1/run', {
      method: 'POST',
      body: JSON.stringify({ payload: { testVar: 'hello' } }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'f-1' }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.run).toBeDefined()
    expect(data.run.status).toBe('completed')
    expect(data.run.stepRuns).toHaveLength(2)
  })
})
