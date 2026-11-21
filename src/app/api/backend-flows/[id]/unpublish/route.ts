import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/backend-flows/[id]/unpublish
 * Reverts a published workflow to 'draft' status.
 * Requires: 'admin' role or above.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')
    const { supabase, accountId } = ctx

    const { data: flow, error } = await supabase
      .from('backend_flows')
      .update({
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()

    if (error || !flow) {
      return NextResponse.json({ error: error?.message || 'Workflow not found' }, { status: 404 })
    }

    return NextResponse.json({ flow })
  } catch (err) {
    return toErrorResponse(err)
  }
}
