import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/backend-flows/[id]/versions
 * Lists all immutable version snapshots for a workflow.
 * Available to: 'viewer' role or above.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('viewer')
    const { supabase, accountId } = ctx

    const { data: versions, error } = await supabase
      .from('backend_flow_versions')
      .select('*')
      .eq('flow_id', id)
      .eq('account_id', accountId)
      .order('version_number', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ versions: versions ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
