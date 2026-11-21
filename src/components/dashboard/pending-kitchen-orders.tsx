'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Check, X, Clock, UtensilsCrossed, CreditCard, AlertCircle, RefreshCw } from 'lucide-react'
import { formatInr } from '@/lib/currency'
import type { TrialOrder, TrialItemTimer } from '@/lib/restaurant/order-trial'

interface EnrichedOrder extends TrialOrder {
  timers?: TrialItemTimer[]
}

export function PendingKitchenOrdersCard() {
  const [orders, setOrders] = useState<EnrichedOrder[]>([])
  const [enabled, setEnabled] = useState<boolean>(true)
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/restaurant/orders')
      if (!res.ok) throw new Error('Failed to load restaurant orders')
      const data = await res.json()
      if (data.enabled === false) {
        setEnabled(false)
        return
      }
      setEnabled(true)
      setOrders(data.orders || [])
    } catch (err) {
      console.error('[kitchen-dashboard] fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    const pollInterval = window.setInterval(fetchOrders, 10_000)
    return () => window.clearInterval(pollInterval)
  }, [fetchOrders])

  // Real-time second tick for resilient item countdowns
  useEffect(() => {
    const timerTick = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timerTick)
  }, [])

  const handleKitchenDecision = async (orderId: string, decision: 'accept' | 'reject') => {
    setProcessingId(orderId)
    try {
      const res = await fetch(`/api/restaurant/orders/${orderId}/kitchen-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process kitchen decision')
      }

      toast.success(
        decision === 'accept'
          ? 'Order ACCEPTED. WhatsApp notification sent.'
          : 'Order REJECTED. WhatsApp notification sent.',
      )
      await fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kitchen action failed')
    } finally {
      setProcessingId(null)
    }
  }

  const handleConfirmPayment = async (orderId: string) => {
    setProcessingId(orderId)
    try {
      const res = await fetch(`/api/restaurant/orders/${orderId}/confirm-payment`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to verify payment')
      }

      toast.success('Payment verified! Preparation timer started.')
      await fetchOrders()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment confirmation failed')
    } finally {
      setProcessingId(null)
    }
  }

  const formatCountdown = (expiresAtStr: string | null) => {
    if (!expiresAtStr) return 'Pending'
    const expiresAt = new Date(expiresAtStr).getTime()
    const diffSeconds = Math.floor((expiresAt - now) / 1000)

    if (diffSeconds <= 0) {
      return 'Timer elapsed — awaiting staff ready check'
    }

    const mins = Math.floor(diffSeconds / 60)
    const secs = diffSeconds % 60
    return `${mins}m ${secs.toString().padStart(2, '0')}s remaining`
  }

  const pendingKitchenOrders = orders.filter((o) => o.status === 'pending_kitchen')
  const inProgressOrders = orders.filter(
    (o) =>
      o.status === 'fulfilment_pending' ||
      (o.status === 'payment_pending' && o.payment_status !== 'awaiting_verification'),
  )
  const awaitingPaymentOrders = orders.filter(
    (o) => o.payment_method === 'upi' && o.payment_status === 'awaiting_verification',
  )
  const preparingOrders = orders.filter((o) => o.status === 'preparing')

  if (!enabled) {
    return null
  }

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <UtensilsCrossed className="h-5 w-5 text-primary" />
            Kitchen Orders & Preparation Timers (Trial)
          </CardTitle>
          <CardDescription>
            Approval gate, UPI payment verification and resilient item countdowns.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOrders}
          disabled={loading}
          className="h-8 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* SECTION 1: PENDING KITCHEN APPROVAL */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground uppercase">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending Kitchen Orders ({pendingKitchenOrders.length})
            </h4>
          </div>

          {pendingKitchenOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
              No orders waiting for kitchen approval right now.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pendingKitchenOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {order.order_number}
                      </span>
                      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                        Pending Kitchen
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Received: {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>

                    <div className="rounded border border-border/60 bg-background/50 p-2.5">
                      <div className="text-xs font-medium text-foreground mb-1.5">Items:</div>
                      <ul className="space-y-1 text-xs">
                        {order.items.map((item, idx) => (
                          <li key={idx} className="flex justify-between text-muted-foreground">
                            <span>
                              {item.quantity}x {item.name}
                            </span>
                            <span className="font-medium text-foreground">
                              {formatInr(item.total_price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex justify-between border-t border-border/40 pt-1.5 text-xs font-bold text-foreground">
                        <span>Total</span>
                        <span>{formatInr(order.total_amount)}</span>
                      </div>
                    </div>
                  </div>

                  {/* EXACTLY TWO BUTTONS: ACCEPT AND REJECT */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                      disabled={processingId === order.id}
                      onClick={() => handleKitchenDecision(order.id, 'accept')}
                    >
                      <Check className="h-4 w-4" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-1"
                      disabled={processingId === order.id}
                      onClick={() => handleKitchenDecision(order.id, 'reject')}
                    >
                      <X className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION 1.5: IN-PROGRESS CUSTOMER CHECKOUT (Delivery / Payment Selection) */}
        {inProgressOrders.length > 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground uppercase">
              <RefreshCw className="h-4 w-4 text-sky-500" />
              In-Progress Customer Checkout ({inProgressOrders.length})
            </h4>

            <div className="grid gap-3 md:grid-cols-2">
              {inProgressOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col justify-between rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {order.order_number}
                      </span>
                      <Badge variant="outline" className="border-sky-500 text-sky-600 dark:text-sky-400">
                        {order.status === 'fulfilment_pending'
                          ? 'Choosing Delivery / Takeaway'
                          : 'Selecting Payment Method'}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Accepted: {order.kitchen_decision_at ? new Date(order.kitchen_decision_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently'}
                    </div>

                    <div className="rounded border border-border/60 bg-background/50 p-2.5">
                      <ul className="space-y-1 text-xs">
                        {order.items.map((item, idx) => (
                          <li key={idx} className="flex justify-between text-muted-foreground">
                            <span>
                              {item.quantity}x {item.name}
                            </span>
                            <span className="font-medium text-foreground">
                              {formatInr(item.total_price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex justify-between border-t border-border/40 pt-1.5 text-xs font-bold text-foreground">
                        <span>Total Amount</span>
                        <span>{formatInr(order.total_amount)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-sky-500/20 bg-sky-500/10 p-2 text-xs text-sky-700 dark:text-sky-300">
                    Customer is interacting with WhatsApp bot to finalize{' '}
                    {order.status === 'fulfilment_pending' ? 'delivery details' : 'payment'}.
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 2: AWAITING PAYMENT VERIFICATION (UPI) */}
        {awaitingPaymentOrders.length > 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground uppercase">
              <CreditCard className="h-4 w-4 text-blue-500" />
              Awaiting UPI Payment Verification ({awaitingPaymentOrders.length})
            </h4>

            <div className="grid gap-3 md:grid-cols-2">
              {awaitingPaymentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col justify-between rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {order.order_number}
                      </span>
                      <Badge variant="outline" className="border-blue-500 text-blue-600 dark:text-blue-400">
                        Awaiting UPI Verification
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Fulfilment: <strong className="capitalize text-foreground">{order.fulfilment_type || 'Takeaway'}</strong> | Amount: <strong className="text-foreground">{formatInr(order.total_amount)}</strong>
                    </p>

                    <div className="rounded border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Verify customer UPI payment receipt before clicking confirm. Preparation timer will start upon verification.</span>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                    disabled={processingId === order.id}
                    onClick={() => handleConfirmPayment(order.id)}
                  >
                    <Check className="h-4 w-4" />
                    Confirm Payment
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 3: ITEM-WISE PREPARATION TIMERS */}
        {preparingOrders.length > 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-foreground uppercase">
              <UtensilsCrossed className="h-4 w-4 text-emerald-500" />
              Active Kitchen Preparation Timers ({preparingOrders.length})
            </h4>

            <div className="grid gap-3 md:grid-cols-2">
              {preparingOrders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-bold text-foreground">
                        {order.order_number}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground capitalize">
                        ({order.fulfilment_type || 'Takeaway'})
                      </span>
                    </div>
                    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Preparing
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground">Item Countdown Timers:</div>
                    <div className="space-y-1.5">
                      {(order.timers || []).map((timer) => (
                        <div
                          key={timer.id}
                          className="flex items-center justify-between rounded bg-muted/50 px-2.5 py-1.5 text-xs"
                        >
                          <span className="font-medium text-foreground">
                            {timer.quantity}x {timer.item_name}
                          </span>
                          <span className="font-mono text-xs text-amber-600 dark:text-amber-400 font-semibold">
                            {formatCountdown(timer.expires_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
