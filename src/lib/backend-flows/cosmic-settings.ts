export interface CosmicWallpaperSettings {
  /** Whether the Sagittarius A* cosmic wallpaper is active */
  enabled: boolean
  /** Dark contrast overlay opacity (0.2 to 0.9, default 0.65 = 65%) */
  darkOverlayOpacity: number
  /** Video playback animation speed multiplier (0.5x, 1.0x, 1.5x) */
  animationSpeed: number
  /** Whether canvas grid dots are rendered on top of wallpaper */
  showDots: boolean
  /** Whether to use static poster only (no video animation, e.g. for reduced-motion) */
  useStaticOnly: boolean
}

export const COSMIC_SETTINGS_STORAGE_KEY = 'wacrm_cosmic_canvas_settings'

export const DEFAULT_COSMIC_SETTINGS: CosmicWallpaperSettings = {
  enabled: true,
  darkOverlayOpacity: 0.65,
  animationSpeed: 1.0,
  showDots: false,
  useStaticOnly: false,
}

/**
 * Loads wallpaper settings from browser localStorage, factoring in
 * browser reduced-motion preferences if set.
 */
export function loadCosmicSettings(): CosmicWallpaperSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_COSMIC_SETTINGS
  }

  // Detect user's OS / browser reduced-motion preference
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  try {
    const raw = localStorage.getItem(COSMIC_SETTINGS_STORAGE_KEY)
    if (!raw) {
      return {
        ...DEFAULT_COSMIC_SETTINGS,
        useStaticOnly: prefersReducedMotion,
      }
    }

    const parsed = JSON.parse(raw) as Partial<CosmicWallpaperSettings>

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_COSMIC_SETTINGS.enabled,
      darkOverlayOpacity:
        typeof parsed.darkOverlayOpacity === 'number' &&
        parsed.darkOverlayOpacity >= 0.1 &&
        parsed.darkOverlayOpacity <= 0.95
          ? parsed.darkOverlayOpacity
          : DEFAULT_COSMIC_SETTINGS.darkOverlayOpacity,
      animationSpeed:
        typeof parsed.animationSpeed === 'number' &&
        parsed.animationSpeed >= 0.25 &&
        parsed.animationSpeed <= 2.5
          ? parsed.animationSpeed
          : DEFAULT_COSMIC_SETTINGS.animationSpeed,
      showDots: typeof parsed.showDots === 'boolean' ? parsed.showDots : DEFAULT_COSMIC_SETTINGS.showDots,
      useStaticOnly:
        typeof parsed.useStaticOnly === 'boolean'
          ? parsed.useStaticOnly
          : prefersReducedMotion,
    }
  } catch {
    return {
      ...DEFAULT_COSMIC_SETTINGS,
      useStaticOnly: prefersReducedMotion,
    }
  }
}

/**
 * Persists visual preferences to localStorage safely without
 * touching any backend databases or flow definitions.
 */
export function saveCosmicSettings(settings: CosmicWallpaperSettings): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(COSMIC_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Gracefully ignore local storage quota / privacy mode errors
  }
}
