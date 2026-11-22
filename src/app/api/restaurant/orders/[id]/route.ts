import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getTrialOrderTimers, type TrialOrderStatus } from '@/lib/restaurant/order-trial'
import { isRestaurantTrialEnabled } from '@/lib/restaurant/feature-flag'
import {
  dispatchRestaurantOrderFlowEvent,
  type RestaurantOrderEventType,
} from '@/lib/restaurant/flow-integration'
import {
  dispatchOutboxEventRecord,
  transitionOrderStatusAtomically,
} from '@/lib/restaurant/order-outbox'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/restaurant/orders/[id]
 * Fetch single order details and active item timers.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('viewer')
    const { id: orderId } = await context.params

    if (!isRestaurantTrialEnabled({ accountId: ctx.accountId, scope: 'dashboard' })) {
      return NextResponse.json(
        { error: 'Restaurant trial feature is disabled' },
        { status: 403 }
      )
    }

    const { data: order, error } = await ctx.supabase
      .from('restaurant_trial_orders')
      .select('*')
      .eq('id', orderId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (error || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const timers = await getTrialOrderTimers(ctx.supabase, order.id, ctx.accountId)

    return NextResponse.json({ order: { ...order, timers } })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/restaurant/orders/[id]
 * Staff updates delivery or preparation status (e.g. ready, completed, cancelled).
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const ctx = await requireRole('agent')
    const { id: orderId } = await context.params

    if (!isRestaurantTrialEnabled({ accountId: ctx.accountId, scope: 'staff' })) {
      return NextResponse.json(
        { error: 'Restaurant trial feature is disabled' },
        { status: 403 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as {
      status?: TrialOrderStatus
      cancellation_reason?: string
    }

    const allowedStatuses: TrialOrderStatus[] = ['ready', 'completed', 'cancelled']
    if (!body.status || !allowedStatuses.includes(body.status)) {
      return NextResponse.json(
        {
          error: `Status must be one of: ${allowedStatuses.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // 1. Atomically transition order status and enqueue outbox event in database
    const transitionResult = await transitionOrderStatusAtomically(ctx.supabase, {
      accountId: ctx.accountId,
      orderId,
      newStatus: body.status,
      cancellationReason: body.cancellation_reason || null,
      updatedBy: ctx.userId,
    })

    if (!transitionResult.success) {
      const statusCode = transitionResult.code === 'ORDER_NOT_FOUND' ? 404 : 409
      return NextResponse.json(
        { error: transitionResult.error || 'Failed to update order' },
        { status: statusCode }
      )
    }

    if (transitionResult.unchanged) {
      return NextResponse.json({ success: true, order: transitionResult.order, unchanged: true })
    }

    const updatedOrder = transitionResult.order!

    // 2. If outbox event was generated (e.g. order.completed), trigger immediate dispatch
    if (transitionResult.outboxId) {
      await dispatchOutboxEventRecord(ctx.supabase, transitionResult.outboxId, {
        accountId: ctx.accountId,
        orderId: updatedOrder.id,
        eventType: (transitionResult.eventType as RestaurantOrderEventType) || 'order.completed',
        order: updatedOrder,
        contactId: updatedOrder.contact_id,
        conversationId: updatedOrder.conversation_id,
        extraPayload: {
          updatedBy: ctx.userId,
          cancellationReason: body.cancellation_reason || null,
        },
      })
    } else if (transitionResult.eventType && transitionResult.eventType !== 'order.completed') {
      await dispatchRestaurantOrderFlowEvent({
        accountId: ctx.accountId,
        event: transitionResult.eventType as RestaurantOrderEventType,
        order: updatedOrder,
        extraPayload: {
          updatedBy: ctx.userId,
          cancellationReason: body.cancellation_reason || null,
        },
        supabase: ctx.supabase,
      })
    }

    return NextResponse.json({ success: true, order: updatedOrder })
  } catch (err) {
    return toErrorResponse(err)
  }
}
