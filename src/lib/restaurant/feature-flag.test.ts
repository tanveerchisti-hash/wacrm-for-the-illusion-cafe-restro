import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isRestaurantTrialEnabled } from './feature-flag'

describe('isRestaurantTrialEnabled Feature Flag', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.RESTAURANT_ORDER_TRIAL_ENABLED
    delete process.env.RESTAURANT_TRIAL_ACCOUNT_IDS
    delete process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to false when environment variable is unset', () => {
    expect(isRestaurantTrialEnabled()).toBe(false)
    expect(isRestaurantTrialEnabled({ accountId: 'acc-1', phoneNumberId: 'phone-1' })).toBe(false)
  })

  it('returns false when set to values other than literal "true"', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'false'
    expect(isRestaurantTrialEnabled()).toBe(false)

    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = '1'
    expect(isRestaurantTrialEnabled()).toBe(false)

    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'yes'
    expect(isRestaurantTrialEnabled()).toBe(false)
  })

  it('returns true when enabled globally with no account or phone restrictions', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    expect(isRestaurantTrialEnabled()).toBe(true)
    expect(isRestaurantTrialEnabled({ accountId: 'any-acc' })).toBe(true)
  })

  it('enforces account restriction when configured', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_ACCOUNT_IDS = 'acc-allowed-1, acc-allowed-2'

    expect(isRestaurantTrialEnabled({ accountId: 'acc-allowed-1' })).toBe(true)
    expect(isRestaurantTrialEnabled({ accountId: 'acc-allowed-2' })).toBe(true)

    // Other or missing accounts are blocked
    expect(isRestaurantTrialEnabled({ accountId: 'acc-other' })).toBe(false)
    expect(isRestaurantTrialEnabled()).toBe(false)
    expect(isRestaurantTrialEnabled({ accountId: null })).toBe(false)
  })

  it('enforces phone number ID restriction for inbound messages', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS = 'test-meta-phone-123'

    expect(
      isRestaurantTrialEnabled({
        phoneNumberId: 'test-meta-phone-123',
        scope: 'inbound',
      }),
    ).toBe(true)

    expect(
      isRestaurantTrialEnabled({
        phoneNumberId: 'prod-meta-phone-999',
        scope: 'inbound',
      }),
    ).toBe(false)
    expect(isRestaurantTrialEnabled({ scope: 'inbound' })).toBe(false)
    expect(isRestaurantTrialEnabled({ phoneNumberId: null, scope: 'inbound' })).toBe(false)
  })

  it('correctly handles simultaneous account and phone number restrictions', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_ACCOUNT_IDS = 'acc-trial-1'
    process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS = 'phone-test-1'

    // Both match -> enabled for inbound
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-trial-1',
        phoneNumberId: 'phone-test-1',
        scope: 'inbound',
      }),
    ).toBe(true)

    // Wrong phone -> disabled for inbound
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-trial-1',
        phoneNumberId: 'phone-prod',
        scope: 'inbound',
      }),
    ).toBe(false)

    // Wrong account -> disabled
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-prod',
        phoneNumberId: 'phone-test-1',
        scope: 'inbound',
      }),
    ).toBe(false)

    // Both wrong -> disabled
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-prod',
        phoneNumberId: 'phone-prod',
        scope: 'inbound',
      }),
    ).toBe(false)
  })

  it('allows dashboard and staff operations for authorized account without customer phoneNumberId', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_ACCOUNT_IDS = 'acc-trial-1'
    process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS = 'phone-test-1'

    // Dashboard access with scope: 'dashboard'
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-trial-1',
        scope: 'dashboard',
      }),
    ).toBe(true)

    // Staff access with scope: 'staff'
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-trial-1',
        scope: 'staff',
      }),
    ).toBe(true)

    // Account check with scope: 'account'
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-trial-1',
        scope: 'account',
      }),
    ).toBe(true)

    // Unauthorized account dashboard access is rejected
    expect(
      isRestaurantTrialEnabled({
        accountId: 'acc-other',
        scope: 'dashboard',
      }),
    ).toBe(false)
  })
})
