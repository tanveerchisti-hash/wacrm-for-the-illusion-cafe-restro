import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { generateSlug, validateCreateInput } from '@/lib/backend-flows/validation'
import type { CreateBackendFlowInput } from '@/lib/backend-flows/types'

/**
 * GET /api/backend-flows
 * Lists all backend workflows for the caller's account.
 * Supports query params: ?search=...&status=...&category=...
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer')
    const { supabase, accountId } = ctx

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')?.trim()
    const status = searchParams.get('status')?.trim()
    const category = searchParams.get('category')?.trim()

    let query = supabase
      .from('backend_flows')
      .select('*')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })

    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    if (category && category !== 'all') {
      query = query.eq('category', category)
    }

    if (search) {
      query = query.ilike('name', `%${search}%`)
    }

    const { data: flows, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ flows: flows ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/backend-flows
 * Creates a new backend workflow in 'draft' status.
 * Requires: 'agent' role or above.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const { supabase, accountId, userId } = ctx

    const body = (await request.json().catch(() => null)) as CreateBackendFlowInput | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
    }

    const validation = validateCreateInput(body)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors.join(', ') }, { status: 400 })
    }

    const name = body.name.trim()
    let slug = body.slug?.trim() || generateSlug(name)

    // Ensure unique slug within the account
    const { data: existingWithSlug } = await supabase
      .from('backend_flows')
      .select('id')
      .eq('account_id', accountId)
      .eq('slug', slug)
      .maybeSingle()

    if (existingWithSlug) {
      slug = `${slug}-${Date.now().toString(36)}`
    }

    const newFlow = {
      account_id: accountId,
      created_by: userId,
      name,
      slug,
      description: body.description?.trim() || null,
      category: body.category || 'general',
      status: 'draft',
      current_version: 1,
      trigger_type: body.trigger_type || 'manual',
      trigger_config: body.trigger_config || {},
      definition: body.definition || {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      metadata: body.metadata || {
        timeout_seconds: 300,
        max_retries: 3,
        concurrency_limit: 5,
      },
    }

    const { data, error } = await supabase
      .from('backend_flows')
      .insert(newFlow)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ flow: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
