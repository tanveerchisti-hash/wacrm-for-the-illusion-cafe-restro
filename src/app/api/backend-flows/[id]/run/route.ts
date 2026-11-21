import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { executeWorkflowRun } from '@/lib/backend-flows/engine/dispatcher'
import type { BackendFlow } from '@/lib/backend-flows/types'

/**
 * POST /api/backend-flows/[id]/run
 * Triggers an immediate execution of a backend workflow (for testing or manual dispatch).
 * Requires: 'agent' role or above.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, accountId } = ctx
    const { id } = await context.params

    const { data: flow, error: fetchErr } = await supabase
      .from('backend_flows')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (fetchErr || !flow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const payload = (body.payload as Record<string, unknown>) || {}

    const runResult = await executeWorkflowRun(
      flow as BackendFlow,
      {
        accountId,
        type: (flow as BackendFlow).trigger_type,
        event: (flow as BackendFlow).trigger_config?.event as string | undefined,
        payload,
      },
      { allowDraft: true, supabase } // allow testing drafts
    )

    return NextResponse.json({ run: runResult })
  } catch (err) {
    return toErrorResponse(err)
  }
}
