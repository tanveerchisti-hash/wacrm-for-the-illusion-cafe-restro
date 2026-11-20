import { describe, expect, it, beforeEach, afterEach } from 'vitest'
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

  it('1. Defaults to false when env var is missing or empty', () => {
    expect(isRestaurantTrialEnabled()).toBe(false)
    expect(isRestaurantTrialEnabled({ accountId: 'acc-1', phoneNumberId: 'phone-1' })).toBe(false)
  })

  it('2. Defaults to false when env var is set to false, 0, or anything other than "true"', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'false'
    expect(isRestaurantTrialEnabled()).toBe(false)

    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = '0'
    expect(isRestaurantTrialEnabled()).toBe(false)

    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'TRUE' // strict lowercase check
    expect(isRestaurantTrialEnabled()).toBe(false)
  })

  it('3. Returns true when RESTAURANT_ORDER_TRIAL_ENABLED="true" and no filters configured', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    expect(isRestaurantTrialEnabled()).toBe(true)
    expect(isRestaurantTrialEnabled({ accountId: 'any-acc' })).toBe(true)
  })

  it('4. Filters strictly by RESTAURANT_TRIAL_ACCOUNT_IDS when specified', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_ACCOUNT_IDS = 'acc-allowed-1, acc-allowed-2'

    // Allowed accounts pass
    expect(isRestaurantTrialEnabled({ accountId: 'acc-allowed-1' })).toBe(true)
    expect(isRestaurantTrialEnabled({ accountId: 'acc-allowed-2' })).toBe(true)

    // Non-allowed accounts fail
    expect(isRestaurantTrialEnabled({ accountId: 'acc-other' })).toBe(false)
    expect(isRestaurantTrialEnabled()).toBe(false)
    expect(isRestaurantTrialEnabled({ accountId: null })).toBe(false)
  })

  it('5. Filters strictly by RESTAURANT_TRIAL_PHONE_NUMBER_IDS when specified', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS = 'test-meta-phone-123'

    // Allowed phone passes
    expect(isRestaurantTrialEnabled({ phoneNumberId: 'test-meta-phone-123' })).toBe(true)

    // Different phone fails
    expect(isRestaurantTrialEnabled({ phoneNumberId: 'prod-meta-phone-999' })).toBe(false)
    expect(isRestaurantTrialEnabled()).toBe(false)
    expect(isRestaurantTrialEnabled({ phoneNumberId: null })).toBe(false)
  })

  it('6. Requires both account ID and phone number ID to match when both are configured', () => {
    process.env.RESTAURANT_ORDER_TRIAL_ENABLED = 'true'
    process.env.RESTAURANT_TRIAL_ACCOUNT_IDS = 'acc-trial-1'
    process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS = 'phone-test-1'

    // Both match -> true
    expect(
      isRestaurantTrialEnabled({ accountId: 'acc-trial-1', phoneNumberId: 'phone-test-1' }),
    ).toBe(true)

    // Only account matches -> false
    expect(
      isRestaurantTrialEnabled({ accountId: 'acc-trial-1', phoneNumberId: 'phone-prod' }),
    ).toBe(false)

    // Only phone matches -> false
    expect(
      isRestaurantTrialEnabled({ accountId: 'acc-prod', phoneNumberId: 'phone-test-1' }),
    ).toBe(false)

    // Neither matches -> false
    expect(
      isRestaurantTrialEnabled({ accountId: 'acc-prod', phoneNumberId: 'phone-prod' }),
    ).toBe(false)
  })
})
