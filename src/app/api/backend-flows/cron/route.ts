import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sweepDueWaitingRuns } from '@/lib/backend-flows/engine/scheduler'

/**
 * GET /api/backend-flows/cron
 *
 * Scheduled cron worker endpoint to sweep and resume due waiting executions
 * in the WACRM Backend Flows engine.
 *
 * Authentication:
 * Requires shared secret via `x-cron-secret` matching `AUTOMATION_CRON_SECRET`.
 * Uses constant-time buffer comparison to prevent timing attacks.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)

  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = supabaseAdmin()
    const summary = await sweepDueWaitingRuns({
      supabase: admin,
      now: new Date(),
      batchSize: 50,
    })

    return NextResponse.json({
      success: true,
      processed: summary.processed,
      reclaimed: summary.reclaimed,
      skipped: summary.skipped,
      errors: summary.errors,
    })
  } catch (err) {
    console.error('[backend-flows-cron] Sweep error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sweep failed' },
      { status: 500 }
    )
  }
}
