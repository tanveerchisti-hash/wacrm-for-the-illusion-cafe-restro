/**
 * Server-enforced Feature Flag for Restaurant Order Trial.
 *
 * Defaults to DISABLED (false).
 * Must be explicitly enabled via environment variable:
 *   RESTAURANT_ORDER_TRIAL_ENABLED="true"
 *
 * Scoping to specific test accounts and Meta phone number IDs:
 *   RESTAURANT_TRIAL_ACCOUNT_IDS="uuid1,uuid2"
 *   RESTAURANT_TRIAL_PHONE_NUMBER_IDS="phone_id_1"
 */

export type FeatureFlagScope = 'inbound' | 'dashboard' | 'staff' | 'account'

export interface RestaurantTrialGateOptions {
  accountId?: string | null
  phoneNumberId?: string | null
  /**
   * Scope of the feature check:
   * - 'inbound': (default when in inbound messaging context or phoneNumberId is provided)
   *   Requires account authorization AND phone number authorization if configured.
   * - 'dashboard' | 'staff' | 'account':
   *   Account-scoped staff/dashboard operations. Enforces master flag and account authorization,
   *   without rejecting due to absence of customer phoneNumberId in browser HTTP requests.
   */
  scope?: FeatureFlagScope
}

/**
 * Determine whether the Restaurant Order Trial is active and authorized
 * for the given account and/or Meta phone number ID.
 */
export function isRestaurantTrialEnabled(options?: RestaurantTrialGateOptions): boolean {
  // 1. Master kill-switch: Must be explicitly string "true"
  if (process.env.RESTAURANT_ORDER_TRIAL_ENABLED !== 'true') {
    return false
  }

  // 2. Account authorization filter (if configured)
  const allowedAccountIds = (process.env.RESTAURANT_TRIAL_ACCOUNT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (allowedAccountIds.length > 0) {
    if (!options?.accountId || !allowedAccountIds.includes(options.accountId)) {
      return false
    }
  }

  // 3. Meta Phone Number ID authorization filter (if configured)
  const allowedPhoneIds = (process.env.RESTAURANT_TRIAL_PHONE_NUMBER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (allowedPhoneIds.length > 0) {
    const isStaffOrDashboard =
      options?.scope === 'dashboard' ||
      options?.scope === 'staff' ||
      options?.scope === 'account'

    if (!isStaffOrDashboard) {
      if (!options?.phoneNumberId || !allowedPhoneIds.includes(options.phoneNumberId)) {
        return false
      }
    }
  }

  return true
}
