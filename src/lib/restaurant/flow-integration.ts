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

/**
 * Legacy aliases for order event identifiers to guarantee backward compatibility
 * for workflows configured prior to Phase 1 trigger engine fixes.
 */
export const ORDER_EVENT_ALIASES: Record<string, RestaurantOrderEventType> = {
  'order.kitchen_ready': 'order.ready',
  'order.confirmed': 'order.created',
}

/**
 * Normalizes an event name string, resolving known aliases to canonical backend event names.
 */
export function normalizeOrderEventName(eventName: string): string {
  const lower = (eventName || '').trim().toLowerCase()
  return ORDER_EVENT_ALIASES[lower] || lower
}

export interface RestaurantOrderEventMetadata {
  value: RestaurantOrderEventType
  label: string
  description: string
}

/**
 * Canonical registry of real backend restaurant order lifecycle events.
 */
export const RESTAURANT_ORDER_EVENTS: RestaurantOrderEventMetadata[] = [
  {
    value: 'order.created',
    label: 'Order Created (Placed)',
    description: 'Triggered when customer places and confirms order cart',
  },
  {
    value: 'order.ready',
    label: 'Order Ready (Kitchen Ready)',
    description: 'Triggered when food preparation finishes and is ready for serving/pickup',
  },
  {
    value: 'order.completed',
    label: 'Order Completed (Served/Delivered)',
    description: 'Triggered when order is fulfilled, handed over, or delivered to customer',
  },
  {
    value: 'order.kitchen_accepted',
    label: 'Kitchen Accepted',
    description: 'Triggered when kitchen staff accepts incoming order',
  },
  {
    value: 'order.kitchen_rejected',
    label: 'Kitchen Rejected',
    description: 'Triggered when kitchen rejects order with reason',
  },
  {
    value: 'order.preparing',
    label: 'Preparation Started',
    description: 'Triggered when kitchen begins timer countdown preparation',
  },
  {
    value: 'order.payment_verified',
    label: 'Payment Verified',
    description: 'Triggered when cash or UPI payment is verified by staff',
  },
  {
    value: 'order.cancelled',
    label: 'Order Cancelled',
    description: 'Triggered when order is cancelled by customer or staff',
  },
]

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
