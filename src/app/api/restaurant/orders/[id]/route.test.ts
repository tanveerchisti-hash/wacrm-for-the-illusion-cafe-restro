import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'
import * as accountAuth from '@/lib/auth/account'
import * as featureFlag from '@/lib/restaurant/feature-flag'
import * as flowIntegration from '@/lib/restaurant/flow-integration'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((err) => new Response(JSON.stringify({ error: String(err) }), { status: 500 })),
}))

vi.mock('@/lib/restaurant/feature-flag', () => ({
  isRestaurantTrialEnabled: vi.fn(),
}))

vi.mock('@/lib/restaurant/flow-integration', () => ({
  dispatchRestaurantOrderFlowEvent: vi.fn(),
}))

vi.mock('@/lib/restaurant/order-trial', () => ({
  getTrialOrderTimers: vi.fn().mockResolvedValue([]),
}))

describe('GET & PATCH /api/restaurant/orders/[id]', () => {
  const mockOrder = {
    id: 'ord-123',
    account_id: 'acc-1',
    order_number: '101',
    status: 'preparing',
    total_amount: 1330,
  }

  const mockSupabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockOrder, error: null }),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { ...mockOrder, status: 'ready' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(accountAuth.requireRole).mockResolvedValue({
      accountId: 'acc-1',
      userId: 'user-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: mockSupabase as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    vi.mocked(featureFlag.isRestaurantTrialEnabled).mockReturnValue(true)
  })

  it('GET /api/restaurant/orders/[id] returns order details', async () => {
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'ord-123' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.order.id).toBe('ord-123')
    expect(json.order.timers).toEqual([])
  })

  it('PATCH /api/restaurant/orders/[id] updates status to ready and dispatches flow event', async () => {
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ready' }),
    })

    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'ord-123' }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.order.status).toBe('ready')

    expect(flowIntegration.dispatchRestaurantOrderFlowEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        event: 'order.ready',
      })
    )
  })

  it('PATCH rejects invalid status update', async () => {
    const req = new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'invalid_status' }),
    })

    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'ord-123' }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Status must be one of')
  })
})
