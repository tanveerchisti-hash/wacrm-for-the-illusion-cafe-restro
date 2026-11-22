import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getTrialOrderTimers, type TrialOrderStatus } from '@/lib/restaurant/order-trial'
import { isRestaurantTrialEnabled } from '@/lib/restaurant/feature-flag'
import { dispatchRestaurantOrderFlowEvent } from '@/lib/restaurant/flow-integration'
import { enqueueOrderOutboxEvent, dispatchOutboxEventRecord } from '@/lib/restaurant/order-outbox'

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

    // 1. Fetch current order to validate conditional transition
    const { data: existingOrder, error: fetchErr } = await ctx.supabase
      .from('restaurant_trial_orders')
      .select('*')
      .eq('id', orderId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (fetchErr || !existingOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Guard: Terminal/cancelled orders cannot transition
    if (existingOrder.status === 'cancelled' || existingOrder.status === 'kitchen_rejected') {
      return NextResponse.json(
        { error: `Cannot update order with status '${existingOrder.status}'` },
        { status: 409 }
      )
    }

    // Guard: Prevent duplicate transition events if order is already in target status
    if (existingOrder.status === body.status) {
      return NextResponse.json({ success: true, order: existingOrder, unchanged: true })
    }

    const updateFields: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    }

    if (body.status === 'cancelled' && body.cancellation_reason) {
      updateFields.kitchen_rejection_reason = body.cancellation_reason
    }

    const { data: updatedOrder, error } = await ctx.supabase
      .from('restaurant_trial_orders')
      .update(updateFields)
      .eq('id', orderId)
      .eq('account_id', ctx.accountId)
      .select()
      .maybeSingle()

    if (error || !updatedOrder) {
      return NextResponse.json({ error: 'Failed to update order' }, { status: 404 })
    }

    // Determine backend flow event based on new status
    let eventName: 'order.ready' | 'order.completed' | 'order.cancelled' = 'order.ready'
    if (body.status === 'completed') {
      eventName = 'order.completed'
    } else if (body.status === 'cancelled') {
      eventName = 'order.cancelled'
    }

    // For order.completed, use durable transactional outbox to guarantee reliable at-least-once delivery
    // and database-level unique constraint idempotency.
    if (eventName === 'order.completed') {
      const outboxResult = await enqueueOrderOutboxEvent(ctx.supabase, {
        accountId: ctx.accountId,
        orderId: updatedOrder.id,
        eventType: 'order.completed',
        order: updatedOrder,
        contactId: updatedOrder.contact_id,
        conversationId: updatedOrder.conversation_id,
        extraPayload: {
          updatedBy: ctx.userId,
          cancellationReason: body.cancellation_reason || null,
        },
      })

      if (outboxResult.enqueued && outboxResult.outboxId) {
        await dispatchOutboxEventRecord(ctx.supabase, outboxResult.outboxId, {
          accountId: ctx.accountId,
          orderId: updatedOrder.id,
          eventType: 'order.completed',
          order: updatedOrder,
          contactId: updatedOrder.contact_id,
          conversationId: updatedOrder.conversation_id,
          extraPayload: {
            updatedBy: ctx.userId,
            cancellationReason: body.cancellation_reason || null,
          },
        })
      }
    } else {
      await dispatchRestaurantOrderFlowEvent({
        accountId: ctx.accountId,
        event: eventName,
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
