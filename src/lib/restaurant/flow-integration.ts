import { dispatchBackendFlowEvent } from '@/lib/backend-flows/engine/dispatcher'
import type { BackendFlowEvent } from '@/lib/backend-flows/engine/types'
import type { TrialOrder } from './order-trial'

export type RestaurantOrderEventType =
  | 'order.created'
  | 'order.kitchen_accepted'
  | 'order.kitchen_rejected'
  | 'order.fulfilment_updated'
  | 'order.payment_selected'
  | 'order.payment_verified'
  | 'order.preparing'
  | 'order.ready'
  | 'order.completed'
  | 'order.cancelled'

export interface DispatchRestaurantEventOptions {
  accountId: string
  contactId?: string | null
  conversationId?: string | null
  event: RestaurantOrderEventType
  order: Partial<TrialOrder> & { id: string; order_number: string }
  extraPayload?: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
}

/**
 * Safely dispatches restaurant lifecycle events into the Backend Flows Execution Engine.
 *
 * Guarantees:
 * - Non-blocking / fault-tolerant: Any workflow error is caught and logged; it will
 *   NEVER break or interrupt customer WhatsApp ordering or kitchen operations.
 * - Tenancy isolation: Restricted to the designated restaurant `accountId`.
 */
export async function dispatchRestaurantOrderFlowEvent(
  options: DispatchRestaurantEventOptions
): Promise<void> {
  const {
    accountId,
    contactId,
    conversationId,
    event,
    order,
    extraPayload,
    supabase,
  } = options

  if (!accountId || !order?.id) {
    return
  }

  try {
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

    const flowEvent: BackendFlowEvent = {
      accountId,
      type: 'order_event',
      event,
      payload,
      contactId: (contactId || order.contact_id) || undefined,
      orderId: order.id,
      conversationId: (conversationId || order.conversation_id) || undefined,
    }

    await dispatchBackendFlowEvent(flowEvent, { supabase })
  } catch (err) {
    // Critical safety requirement: Never crash live restaurant ordering
    console.error(`[backend-flows:restaurant] Event dispatch error for ${event}:`, err)
  }
}
