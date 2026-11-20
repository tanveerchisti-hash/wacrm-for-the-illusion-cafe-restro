import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { confirmUpiPayment } from '@/lib/restaurant/order-trial'
import { isRestaurantTrialEnabled } from '@/lib/restaurant/feature-flag'

/**
 * POST /api/restaurant/orders/[id]/confirm-payment
 * Staff confirmation of UPI / Online payment.
 * Starts item-wise preparation timer upon confirmation.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id: orderId } = await params

    if (!isRestaurantTrialEnabled({ accountId: ctx.accountId })) {
      return NextResponse.json(
        { error: 'Restaurant order trial feature is disabled' },
        { status: 403 },
      )
    }

    const order = await confirmUpiPayment(ctx.supabase, {
      orderId,
      accountId: ctx.accountId,
      userId: ctx.userId,
    })

    return NextResponse.json({ success: true, order })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (errorMsg.includes('not awaiting UPI payment verification')) {
      return NextResponse.json({ error: errorMsg }, { status: 409 })
    }
    return toErrorResponse(err)
  }
}
