import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { executeFlowGraph } from '@/lib/backend-flows/engine/graph-runner'
import type { BackendFlow, BackendFlowDefinition } from '@/lib/backend-flows/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/backend-flows/[id]/simulate
 * Executes a safe, in-memory dry-run simulation of the workflow without side-effects.
 * Requires: 'viewer' role or above.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const ctx = await requireRole('viewer')
    const { supabase, accountId } = ctx

    const { data: flow, error: fetchErr } = await supabase
      .from('backend_flows')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .single()

    if (fetchErr || !flow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      payload?: Record<string, unknown>
      definition?: BackendFlowDefinition
    }

    const payload = body.payload || {}
    const definition = body.definition || (flow as BackendFlow).definition

    const simulationResult = await executeFlowGraph(definition, {
      runId: `sim-${Date.now().toString(36)}`,
      flowId: flow.id,
      accountId,
      versionNumber: (flow as BackendFlow).current_version || 1,
      initialVariables: {
        ...payload,
        is_simulation: true,
      },
      isDryRun: true,
      maxRetries: 1,
      timeoutMs: 15000,
      supabase,
    })

    return NextResponse.json({ simulation: simulationResult })
  } catch (err) {
    return toErrorResponse(err)
  }
}
