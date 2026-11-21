import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/backend-flows/[id]/runs
 * Lists execution history for a specific workflow.
 * Requires: 'viewer' role or above.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer')
    const { supabase, accountId } = ctx
    const { id } = await context.params

    const { data: runs, error } = await supabase
      .from('backend_flow_runs')
      .select('*')
      .eq('flow_id', id)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ runs: runs || [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
