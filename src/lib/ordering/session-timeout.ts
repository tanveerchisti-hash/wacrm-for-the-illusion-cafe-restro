
import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_ORDERING_TIMEOUT_HOURS = 6

const TIMEOUT_MS = DEFAULT_ORDERING_TIMEOUT_HOURS * 60 * 60 * 1000

export type OrderingSessionStatus =
  | 'active'
  | 'expired'
  | 'completed'
  | 'cancelled'

export interface OrderingSession {
  id: string
  account_id: string
  contact_id: string
  conversation_id: string | null
  status: OrderingSessionStatus
  started_at: string
  last_customer_activity_at: string
  expires_at: string
  ended_at: string | null
}

export interface OrderingSessionInput {
  accountId: string
  contactId: string
  conversationId: string
}

/**
 * Calculate session expiry from the latest customer activity.
 */
export function calculateSessionExpiry(lastActivity: Date): Date {
  if (!Number.isFinite(lastActivity.getTime())) {
    throw new Error('Invalid ordering session activity time')
  }

  return new Date(lastActivity.getTime() + TIMEOUT_MS)
}

/**
 * Check whether the ordering session has expired.
 */
export function isOrderingSessionExpired(
  expiresAt: string,
  now: Date = new Date(),
): boolean {
  const expiry = Date.parse(expiresAt)

  if (!Number.isFinite(expiry)) {
    throw new Error('Invalid ordering session expiry')
  }

  return now.getTime() >= expiry
}

/**
 * Find the currently active ordering session.
 */
export async function getActiveOrderingSession(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<OrderingSession | null> {
  const { data, error } = await db
    .from('ordering_sessions')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error

  return (data as OrderingSession | null) ?? null
}

/**
 * Start or refresh an ordering session.
 *
 * The begin_ordering_session RPC resets ai_reply_count
 * ONLY when a new session is created.
 *
 * Existing sessions keep their reply count.
 * Human assignment and AI pause flags remain unchanged.
 */
export async function startOrderingSession(
  db: SupabaseClient,
  input: OrderingSessionInput,
  now: Date = new Date(),
): Promise<OrderingSession> {
  if (!Number.isFinite(now.getTime())) {
    throw new Error('Invalid ordering session activity time')
  }

  const { data, error } = await db.rpc(
    'begin_ordering_session',
    {
      p_account_id: input.accountId,
      p_contact_id: input.contactId,
      p_conversation_id: input.conversationId,
      p_activity_at: now.toISOString(),
    },
  )

  if (error) {
    console.error(
      '[ordering-session] start failed:',
      error,
    )
    throw error
  }

  if (!data) {
    throw new Error('Ordering session was not returned')
  }

  return data as OrderingSession
}

/**
 * Mark an existing session expired.
 *
 * This only updates the session record.
 * Use expireInactiveOrderingSession when
 * the ordering_active tag must also be removed.
 */
export async function expireOrderingSession(
  db: SupabaseClient,
  session: OrderingSession,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isOrderingSessionExpired(session.expires_at, now)) {
    return false
  }

  const nowIso = now.toISOString()

  const { data, error } = await db
    .from('ordering_sessions')
    .update({
      status: 'expired',
      ended_at: nowIso,
    })
    .eq('id', session.id)
    .eq('account_id', session.account_id)
    .eq('contact_id', session.contact_id)
    .eq('status', 'active')
    .lte('expires_at', nowIso)
    .select('id')
    .maybeSingle()

  if (error) throw error

  return Boolean(data)
}

/**
 * Atomically expire an inactive ordering session
 * and remove its ordering_active contact tag.
 *
 * Requires the expire_inactive_ordering_session RPC.
 */
export async function expireInactiveOrderingSession(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc(
    'expire_inactive_ordering_session',
    {
      p_account_id: accountId,
      p_contact_id: contactId,
    },
  )

  if (error) {
    console.error(
      '[ordering-session] atomic expiry failed:',
      error,
    )
    throw error
  }

  return data === true
}

/**
 * Close the ordering session when the customer
 * manually resets through an automation.
 *
 * This does NOT cancel an accepted restaurant order.
 */
export async function closeOrderingSessionOnManualReset(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('ordering_sessions')
    .update({
      status: 'cancelled',
      ended_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(
      '[ordering-session] manual reset failed:',
      error,
    )
    throw error
  }

  return Boolean(data)
}
