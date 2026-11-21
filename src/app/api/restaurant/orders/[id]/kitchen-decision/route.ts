import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { acceptKitchenOrder, rejectKitchenOrder } from '@/lib/restaurant/order-trial'
import { isRestaurantTrialEnabled } from '@/lib/restaurant/feature-flag'

/**
 * POST /api/restaurant/orders/[id]/kitchen-decision
 * Staff Accept or Reject decision for pending kitchen orders.
 * Exactly two decisions: 'accept' | 'reject'
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id: orderId } = await params

    if (!isRestaurantTrialEnabled({ accountId: ctx.accountId, scope: 'staff' })) {
      return NextResponse.json(
        { error: 'Restaurant order trial feature is disabled' },
        { status: 403 },
      )
    }

    let body: { decision?: 'accept' | 'reject'; reason?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    const { decision, reason } = body
    if (!decision || (decision !== 'accept' && decision !== 'reject')) {
      return NextResponse.json(
        { error: 'Valid decision ("accept" or "reject") is required' },
        { status: 400 },
      )
    }

    if (decision === 'accept') {
      const order = await acceptKitchenOrder(ctx.supabase, {
        orderId,
        accountId: ctx.accountId,
        userId: ctx.userId,
      })
      return NextResponse.json({ success: true, order })
    } else {
      const order = await rejectKitchenOrder(ctx.supabase, {
        orderId,
        accountId: ctx.accountId,
        userId: ctx.userId,
        reason,
      })
      return NextResponse.json({ success: true, order })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (errorMsg.includes('already processed') || errorMsg.includes('Cannot accept')) {
      return NextResponse.json({ error: errorMsg }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}
