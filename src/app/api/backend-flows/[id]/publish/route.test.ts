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

import { POST } from './route'

describe('POST /api/backend-flows/[id]/publish', () => {
  let mockSupabase: Record<string, unknown>
  let fakeFlow: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    fakeFlow = {
      id: 'flow-123',
      account_id: 'acc-1',
      name: 'Kitchen Live Sync',
      slug: 'kitchen-live-sync',
      category: 'kitchen_sync',
      status: 'draft',
      current_version: 1,
      trigger_type: 'order_event',
      trigger_config: { event: 'order.created' },
      definition: { nodes: [{ id: 'n1', type: 'order', position: { x: 0, y: 0 }, data: {} }], edges: [] },
      metadata: {},
    }

    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'backend_flow_versions') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: fakeFlow, error: null }),
          update: vi.fn().mockImplementation((updates: Record<string, unknown>) => ({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { ...fakeFlow, ...updates },
                error: null,
              }),
            }),
          })),
        }
      }),
    }

    mockRequireRole.mockResolvedValue({
      supabase: mockSupabase,
      accountId: 'acc-1',
      userId: 'admin-1',
      role: 'admin',
    })
  })

  it('publishes workflow, creates version snapshot, and increments version number', async () => {
    const req = new Request('http://localhost/api/backend-flows/flow-123/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ change_summary: 'Initial production release' }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: 'flow-123' }) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.flow.status).toBe('published')
    expect(json.flow.published_version).toBe(1)
    expect(json.flow.current_version).toBe(2)
    expect(json.flow.published_by).toBe('admin-1')
    expect(mockRequireRole).toHaveBeenCalledWith('admin')
  })
})
