import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { validateUpdateInput } from '@/lib/backend-flows/validation'
import type { UpdateBackendFlowInput } from '@/lib/backend-flows/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/backend-flows/[id]
 * Fetch a single backend workflow by id.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('viewer')
    const { supabase, accountId } = ctx

    const { data: flow, error } = await supabase
      .from('backend_flows')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .single()

    if (error || !flow) {
      return NextResponse.json({ error: 'Backend workflow not found' }, { status: 404 })
    }

    return NextResponse.json({ flow })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/backend-flows/[id]
 * Updates workflow details, definition, metadata, or triggers.
 * Requires: 'agent' role or above.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('agent')
    const { supabase, accountId } = ctx

    const body = (await request.json().catch(() => null)) as UpdateBackendFlowInput | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const validation = validateUpdateInput(body)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join(', ') }, { status: 400 })
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (body.name !== undefined) updates.name = body.name.trim()
    if (body.slug !== undefined) updates.slug = body.slug.trim()
    if (body.description !== undefined) updates.description = body.description?.trim() || null
    if (body.category !== undefined) updates.category = body.category
    if (body.trigger_type !== undefined) updates.trigger_type = body.trigger_type
    if (body.trigger_config !== undefined) updates.trigger_config = body.trigger_config
    if (body.definition !== undefined) updates.definition = body.definition
    if (body.metadata !== undefined) updates.metadata = body.metadata

    const { data: updatedFlow, error } = await supabase
      .from('backend_flows')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single()

    if (error || !updatedFlow) {
      return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ flow: updatedFlow })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/backend-flows/[id]
 * Deletes or archives a workflow.
 * Requires: 'admin' role or above.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('admin')
    const { supabase, accountId } = ctx

    const { error } = await supabase
      .from('backend_flows')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
