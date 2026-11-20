
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  DEFAULT_ORDERING_TIMEOUT_HOURS,
  calculateSessionExpiry,
  isOrderingSessionExpired,
  startOrderingSession,
  expireInactiveOrderingSession,
} from './session-timeout'

const ACCOUNT_ID = 'account-test'
const CONTACT_ID = 'contact-test'
const CONVERSATION_ID = 'conversation-test'

describe('Ordering session timeout', () => {
  it('uses a 6-hour inactivity timeout', () => {
    expect(DEFAULT_ORDERING_TIMEOUT_HOURS).toBe(6)
  })

  it('calculates expiry from customer activity', () => {
    const activity = new Date('2026-11-20T06:00:00Z')

    expect(
      calculateSessionExpiry(activity).toISOString(),
    ).toBe('2026-11-20T12:00:00.000Z')
  })

  it('does not expire before the deadline', () => {
    const expiresAt = '2026-11-20T12:00:00Z'
    const now = new Date('2026-11-20T11:59:59Z')

    expect(
      isOrderingSessionExpired(expiresAt, now),
    ).toBe(false)
  })

  it('expires exactly at the deadline', () => {
    const expiresAt = '2026-11-20T12:00:00Z'
    const now = new Date('2026-11-20T12:00:00Z')

    expect(
      isOrderingSessionExpired(expiresAt, now),
    ).toBe(true)
  })

  it('expires after more than 6 hours', () => {
    const expiresAt = '2026-11-20T12:00:00Z'
    const now = new Date('2026-11-20T16:00:00Z')

    expect(
      isOrderingSessionExpired(expiresAt, now),
    ).toBe(true)
  })

  it('rejects an invalid expiry timestamp', () => {
    expect(() =>
      isOrderingSessionExpired('not-a-date'),
    ).toThrow('Invalid ordering session expiry')
  })
})

describe('Ordering session database operations', () => {
  it('uses the atomic begin_ordering_session RPC', async () => {
    const session = {
      id: 'session-1',
      account_id: ACCOUNT_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      status: 'active',
      started_at: '2026-11-20T06:00:00.000Z',
      last_customer_activity_at:
        '2026-11-20T06:00:00.000Z',
      expires_at: '2026-11-20T12:00:00.000Z',
      ended_at: null,
    }

    const rpc = vi.fn().mockResolvedValue({
      data: session,
      error: null,
    })

    const db = { rpc } as unknown as SupabaseClient

    const result = await startOrderingSession(
      db,
      {
        accountId: ACCOUNT_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
      },
      new Date('2026-11-20T06:00:00Z'),
    )

    expect(rpc).toHaveBeenCalledWith(
      'begin_ordering_session',
      {
        p_account_id: ACCOUNT_ID,
        p_contact_id: CONTACT_ID,
        p_conversation_id: CONVERSATION_ID,
        p_activity_at: '2026-11-20T06:00:00.000Z',
      },
    )

    expect(result.id).toBe('session-1')
    expect(result.status).toBe('active')
  })

  it('reports session creation errors', async () => {
    const error = new Error('Database unavailable')

    const db = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error,
      }),
    } as unknown as SupabaseClient

    const log = vi.spyOn(console, 'error')
      .mockImplementation(() => {})

    try {
      await expect(
        startOrderingSession(db, {
          accountId: ACCOUNT_ID,
          contactId: CONTACT_ID,
          conversationId: CONVERSATION_ID,
        }),
      ).rejects.toThrow('Database unavailable')
    } finally {
      log.mockRestore()
    }
  })

  it('returns true when expiry RPC succeeds', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: true,
      error: null,
    })

    const db = { rpc } as unknown as SupabaseClient

    const expired = await expireInactiveOrderingSession(
      db,
      ACCOUNT_ID,
      CONTACT_ID,
    )

    expect(expired).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'expire_inactive_ordering_session',
      {
        p_account_id: ACCOUNT_ID,
        p_contact_id: CONTACT_ID,
      },
    )
  })

  it('returns false when no session expired', async () => {
    const db = {
      rpc: vi.fn().mockResolvedValue({
        data: false,
        error: null,
      }),
    } as unknown as SupabaseClient

    expect(
      await expireInactiveOrderingSession(
        db,
        ACCOUNT_ID,
        CONTACT_ID,
      ),
    ).toBe(false)
  })
})
