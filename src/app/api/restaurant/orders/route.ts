import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getTrialOrderTimers } from '@/lib/restaurant/order-trial'
import { isRestaurantTrialEnabled } from '@/lib/restaurant/feature-flag'

/**
 * GET /api/restaurant/orders
 * Returns recent restaurant trial orders and their active item countdown timers
 * for the authenticated user's account.
 */
export async function GET() {
  try {
    const ctx = await requireRole('viewer')
    const { supabase, accountId } = ctx

    if (!isRestaurantTrialEnabled({ accountId })) {
      return NextResponse.json({ orders: [], enabled: false })
    }

    const { data: orders, error } = await supabase
      .from('restaurant_trial_orders')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Attach item timers for active / preparing orders
    const enriched = await Promise.all(
      (orders ?? []).map(async (order) => {
        const timers = await getTrialOrderTimers(supabase, order.id, accountId)
        return {
          ...order,
          timers,
        }
      }),
    )

    return NextResponse.json({ orders: enriched, enabled: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
