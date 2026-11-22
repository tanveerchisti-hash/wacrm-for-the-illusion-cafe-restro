import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          lte: () => ({ select: async () => ({ data: [], error: null }) }),
          select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
      select: () => ({
        eq: () => ({
          lte: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

describe('GET /api/backend-flows/cron', () => {
  const originalSecret = process.env.AUTOMATION_CRON_SECRET

  beforeEach(() => {
    process.env.AUTOMATION_CRON_SECRET = 'test-secret-123'
  })

  afterEach(() => {
    process.env.AUTOMATION_CRON_SECRET = originalSecret
  })

  it('rejects with 503 when AUTOMATION_CRON_SECRET is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const req = new Request('http://localhost/api/backend-flows/cron')
    const res = await GET(req)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('cron not configured')
  })

  it('rejects with 401 when x-cron-secret header is missing or incorrect', async () => {
    const reqMissing = new Request('http://localhost/api/backend-flows/cron')
    const resMissing = await GET(reqMissing)
    expect(resMissing.status).toBe(401)

    const reqWrong = new Request('http://localhost/api/backend-flows/cron', {
      headers: { 'x-cron-secret': 'wrong-secret' },
    })
    const resWrong = await GET(reqWrong)
    expect(resWrong.status).toBe(401)
  })

  it('authenticates and executes sweep successfully when valid secret is provided', async () => {
    const req = new Request('http://localhost/api/backend-flows/cron', {
      headers: { 'x-cron-secret': 'test-secret-123' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.processed).toBe(0)
    expect(body.reclaimed).toBe(0)
  })
})
