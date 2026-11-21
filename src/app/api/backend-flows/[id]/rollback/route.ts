import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/backend-flows/[id]/rollback
 * Restores a workflow's definition and trigger configuration from a historical version snapshot.
 * Requires: 'admin' role or above.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')
    const { supabase, accountId } = ctx

    const body = (await request.json().catch(() => ({}))) as { version_number?: number }
    const versionNumber = body.version_number

    if (!versionNumber || typeof versionNumber !== 'number') {
      return NextResponse.json({ error: 'Valid version_number is required' }, { status: 400 })
    }

    // 1. Fetch the frozen snapshot from backend_flow_versions
    const { data: snapshot, error: snapshotErr } = await supabase
      .from('backend_flow_versions')
      .select('*')
      .eq('flow_id', id)
      .eq('account_id', accountId)
      .eq('version_number', versionNumber)
      .maybeSingle()

    if (snapshotErr || !snapshot) {
      return NextResponse.json(
        { error: `Version snapshot v${versionNumber} not found` },
        { status: 404 }
      )
    }

    // 2. Fetch current flow to get next version increment
    const { data: currentFlow, error: flowErr } = await supabase
      .from('backend_flows')
      .select('current_version')
      .eq('id', id)
      .eq('account_id', accountId)
      .single()

    if (flowErr || !currentFlow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const nextDraftVersion = (currentFlow.current_version || 1) + 1

    // 3. Restore definition onto current draft
    const { data: updatedFlow, error: updateErr } = await supabase
      .from('backend_flows')
      .update({
        definition: snapshot.definition,
        trigger_config: snapshot.trigger_config,
        current_version: nextDraftVersion,
        status: 'draft', // rollback lands as draft for verification
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', accountId)
      .select()
      .single()

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({
      flow: updatedFlow,
      restored_from_version: versionNumber,
      message: `Successfully rolled back to configuration of v${versionNumber}`,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
