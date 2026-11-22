import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchRestaurantOrderFlowEvent, type RestaurantOrderEventType } from './flow-integration'
import type { TrialOrder } from './order-trial'

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
