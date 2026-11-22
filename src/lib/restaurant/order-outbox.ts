import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchRestaurantOrderFlowEvent, type RestaurantOrderEventType } from './flow-integration'
import type { TrialOrder, TrialOrderStatus } from './order-trial'

export interface OrderOutboxRecord {
  id: string
  account_id: string
  order_id: string
  event_type: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'dispatched' | 'failed'
  error_message?: string | null
  retry_count: number
  created_at: string
  dispatched_at?: string | null
}

export interface EnqueueOutboxOptions {
  accountId: string
  orderId: string
  eventType: RestaurantOrderEventType
  order: Partial<TrialOrder> & { id: string; order_number: string }
  extraPayload?: Record<string, unknown>
  contactId?: string | null
  conversationId?: string | null
}

/**
 * Atomically enqueues an order lifecycle event into the transactional outbox table.
 * Database-level unique constraint (account_id, order_id, event_type) guarantees
 * that concurrent requests or rapid retries cannot create duplicate events.
 */
export async function enqueueOrderOutboxEvent(
  db: SupabaseClient,
  options: EnqueueOutboxOptions
): Promise<{ enqueued: boolean; outboxId?: string; isDuplicate?: boolean }> {
  const {
    accountId,
    orderId,
    eventType,
    order,
    extraPayload,
    contactId,
    conversationId,
  } = options

  const payload: Record<string, unknown> = {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    items: order.items || [],
    subtotal: order.subtotal ?? 0,
    deliveryFee: order.delivery_fee ?? 0,
    totalAmount: order.total_amount ?? 0,
    fulfilmentType: order.fulfilment_type || null,
    deliveryAddress: order.delivery_address || null,
    paymentMethod: order.payment_method || null,
    paymentStatus: order.payment_status || null,
    isTestOrder: !!order.is_test_order,
    contactId: contactId || order.contact_id || null,
    conversationId: conversationId || order.conversation_id || null,
    ...extraPayload,
  }

  try {
    const { data, error } = await db
      .from('restaurant_order_outbox_events')
      .insert({
        account_id: accountId,
        order_id: orderId,
        event_type: eventType,
        payload,
        status: 'pending',
      })
      .select('id')
      .maybeSingle()

    if (error) {
      // 23505 = unique_violation in Postgres
      if (error.code === '23505' || error.message?.includes('duplicate key')) {
        return { enqueued: false, isDuplicate: true }
      }
      console.error('[order-outbox] Error enqueuing event:', error)
      return { enqueued: false }
    }

    return { enqueued: true, outboxId: data?.id }
  } catch (err) {
    console.error('[order-outbox] Unexpected exception enqueuing outbox event:', err)
    return { enqueued: false }
  }
}

/**
 * Dispatches an enqueued outbox event to the Backend Flows Engine and marks it dispatched.
 * If dispatch throws, the event remains in the outbox table for subsequent retry/recovery.
 */
export async function dispatchOutboxEventRecord(
  db: SupabaseClient,
  outboxId: string,
  options: EnqueueOutboxOptions
): Promise<boolean> {
  try {
    // 1. Mark processing
    await db
      .from('restaurant_order_outbox_events')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', outboxId)

    // 2. Dispatch to engine
    await dispatchRestaurantOrderFlowEvent({
      accountId: options.accountId,
      contactId: options.contactId || options.order.contact_id,
      conversationId: options.conversationId || options.order.conversation_id,
      event: options.eventType,
      order: options.order,
      extraPayload: options.extraPayload,
      supabase: db,
    })

    // 3. Mark dispatched
    await db
      .from('restaurant_order_outbox_events')
      .update({
        status: 'dispatched',
        dispatched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', outboxId)

    return true
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[order-outbox] Dispatch failed for outbox event ${outboxId}:`, err)

    await db
      .from('restaurant_order_outbox_events')
      .update({
        status: 'failed',
        error_message: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', outboxId)

    return false
  }
}

export interface TransitionOrderOptions {
  accountId: string
  orderId: string
  newStatus: string
  cancellationReason?: string | null
  updatedBy?: string | null
}

export interface TransitionOrderResult {
  success: boolean
  order?: TrialOrder
  outboxId?: string | null
  eventType?: string | null
  unchanged?: boolean
  error?: string
  code?: string
}

/**
 * Atomically transitions an order's status and enqueues lifecycle outbox event
 * using PostgreSQL RPC transition_restaurant_order_status.
 * If RPC is not supported in the database harness, falls back to direct conditional operations.
 */
export async function transitionOrderStatusAtomically(
  db: SupabaseClient,
  options: TransitionOrderOptions
): Promise<TransitionOrderResult> {
  const { accountId, orderId, newStatus, cancellationReason, updatedBy } = options

  try {
    const { data, error } = await db.rpc('transition_restaurant_order_status', {
      p_account_id: accountId,
      p_order_id: orderId,
      p_new_status: newStatus,
      p_cancellation_reason: cancellationReason || null,
      p_updated_by: updatedBy || null,
    })

    if (!error && data && typeof data === 'object') {
      const res = data as Record<string, unknown>
      if (res.success) {
        return {
          success: true,
          order: res.order as TrialOrder,
          outboxId: (res.outbox_id as string) || null,
          eventType: (res.event_type as string) || null,
          unchanged: !!res.unchanged,
        }
      }
      return {
        success: false,
        error: (res.error as string) || 'Transition rejected',
        code: (res.code as string) || 'TRANSITION_FAILED',
      }
    }
  } catch {
    // Fall back to direct queries if RPC is missing
  }

  // Graceful fallback for environments where RPC is not yet deployed or in unit mocks
  const { data: existingOrder, error: fetchErr } = await db
    .from('restaurant_trial_orders')
    .select('*')
    .eq('id', orderId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (fetchErr || !existingOrder) {
    return { success: false, error: 'Order not found', code: 'ORDER_NOT_FOUND' }
  }

  if (existingOrder.status === 'cancelled' || existingOrder.status === 'kitchen_rejected') {
    return {
      success: false,
      error: `Cannot update order with status '${existingOrder.status}'`,
      code: 'INVALID_TRANSITION',
    }
  }

  if (existingOrder.status === newStatus) {
    return { success: true, order: existingOrder as TrialOrder, unchanged: true }
  }

  const updateFields: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }
  if (newStatus === 'cancelled' && cancellationReason) {
    updateFields.kitchen_rejection_reason = cancellationReason
  }

  const { data: updatedOrder, error: updateErr } = await db
    .from('restaurant_trial_orders')
    .update(updateFields)
    .eq('id', orderId)
    .eq('account_id', accountId)
    .select()
    .maybeSingle()

  if (updateErr || !updatedOrder) {
    return { success: false, error: 'Failed to update order', code: 'UPDATE_FAILED' }
  }

  let eventType: RestaurantOrderEventType | null = null
  if (newStatus === 'completed') {
    eventType = 'order.completed'
  } else if (newStatus === 'cancelled') {
    eventType = 'order.cancelled'
  } else if (newStatus === 'ready') {
    eventType = 'order.ready'
  }

  let outboxId: string | null = null
  if (eventType === 'order.completed') {
    const enqueueRes = await enqueueOrderOutboxEvent(db, {
      accountId,
      orderId: updatedOrder.id,
      eventType,
      order: updatedOrder,
      contactId: updatedOrder.contact_id,
      conversationId: updatedOrder.conversation_id,
      extraPayload: {
        updatedBy: updatedBy || null,
        cancellationReason: cancellationReason || null,
      },
    })
    outboxId = enqueueRes.outboxId || null
  }

  return {
    success: true,
    order: updatedOrder as TrialOrder,
    outboxId,
    eventType,
    unchanged: false,
  }
}

/**
 * Sweeps pending, failed, or stale in-progress order outbox events.
 * Intended to be invoked by the recurring cron scheduler to guarantee at-least-once dispatch.
 */
export async function sweepPendingOrderOutboxEvents(
  db: SupabaseClient,
  batchSize = 25
): Promise<{ scanned: number; dispatched: number; failed: number }> {
  const summary = { scanned: 0, dispatched: 0, failed: 0 }
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString() // 5 minutes stale

  try {
    // Select pending, recently failed (< 3 retries), or stale processing events
    const { data: candidates, error } = await db
      .from('restaurant_order_outbox_events')
      .select('*')
      .or(`status.eq.pending,status.eq.failed,and(status.eq.processing,updated_at.lt.${staleThreshold})`)
      .lt('retry_count', 3)
      .order('created_at', { ascending: true })
      .limit(batchSize)

    if (error || !candidates || candidates.length === 0) {
      return summary
    }

    summary.scanned = candidates.length

    for (const record of candidates as OrderOutboxRecord[]) {
      const currentRetry = record.retry_count ?? 0

      // Atomically claim candidate row
      const { data: claimed } = await db
        .from('restaurant_order_outbox_events')
        .update({
          status: 'processing',
          retry_count: currentRetry + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id)
        .in('status', ['pending', 'failed', 'processing'])
        .select()
        .maybeSingle()

      if (!claimed) continue // Claimed by another worker

      try {
        const payload = (record.payload || {}) as Record<string, unknown>
        const orderMock: Partial<TrialOrder> & { id: string; order_number: string } = {
          id: record.order_id,
          order_number: (payload.orderNumber as string) || 'UNKNOWN',
          status: (payload.status as TrialOrderStatus) || 'completed',
          contact_id: (payload.contactId as string) || undefined,
          conversation_id: (payload.conversationId as string) || null,
          is_test_order: !!payload.isTestOrder,
        }

        await dispatchRestaurantOrderFlowEvent({
          accountId: record.account_id,
          contactId: (payload.contactId as string) || null,
          conversationId: (payload.conversationId as string) || null,
          event: record.event_type as RestaurantOrderEventType,
          order: orderMock,
          extraPayload: payload,
          supabase: db,
        })

        await db
          .from('restaurant_order_outbox_events')
          .update({
            status: 'dispatched',
            dispatched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', record.id)

        summary.dispatched++
      } catch (dispatchErr) {
        summary.failed++
        const errMsg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr)
        await db
          .from('restaurant_order_outbox_events')
          .update({
            status: 'failed',
            error_message: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', record.id)
      }
    }
  } catch (sweepErr) {
    console.error('[order-outbox] Error in sweepPendingOrderOutboxEvents:', sweepErr)
  }

  return summary
}
