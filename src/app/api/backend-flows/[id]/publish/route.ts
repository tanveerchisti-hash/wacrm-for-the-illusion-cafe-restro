import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { validateForPublishing } from '@/lib/backend-flows/validation'
import type { BackendFlow } from '@/lib/backend-flows/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/backend-flows/[id]/publish
 * Freezes the current definition as an immutable version snapshot,
 * increments the version counter, and sets status to 'published'.
 * Requires: 'admin' role or above.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')
    const { supabase, accountId, userId } = ctx

    const body = (await request.json().catch(() => ({}))) as { change_summary?: string }

    // Fetch existing flow
    const { data: flow, error: fetchErr } = await supabase
      .from('backend_flows')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .single()

    if (fetchErr || !flow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    // Validate for publication
    const validation = validateForPublishing(flow as BackendFlow)
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Cannot publish: ${validation.errors.join(', ')}` },
        { status: 400 },
      )
    }

    const versionToFreeze = flow.current_version || 1
    const now = new Date().toISOString()

    // 1. Snapshot into backend_flow_versions
    const { error: versionErr } = await supabase.from('backend_flow_versions').insert({
      flow_id: flow.id,
      account_id: accountId,
      version_number: versionToFreeze,
      definition: flow.definition,
      trigger_config: flow.trigger_config,
      change_summary: body.change_summary?.trim() || `Published version ${versionToFreeze}`,
      created_by: userId,
      created_at: now,
    })

    if (versionErr) {
      return NextResponse.json(
        { error: `Failed to create version snapshot: ${versionErr.message}` },
        { status: 500 },
      )
    }

    // 2. Update backend_flows to published status and bump current_version
    const { data: updatedFlow, error: updateErr } = await supabase
      .from('backend_flows')
      .update({
        status: 'published',
        published_version: versionToFreeze,
        published_at: now,
        published_by: userId,
        current_version: versionToFreeze + 1,
        updated_at: now,
      })
      .eq('id', flow.id)
      .eq('account_id', accountId)
      .select('*')
      .single()

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ flow: updatedFlow })
  } catch (err) {
    return toErrorResponse(err)
  }
}
