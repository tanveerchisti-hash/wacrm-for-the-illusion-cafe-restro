import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CosmicCanvasBackground } from './cosmic-canvas-background'
import { CosmicSettingsPopover } from './cosmic-settings-popover'
import {
  loadCosmicSettings,
  saveCosmicSettings,
  DEFAULT_COSMIC_SETTINGS,
  COSMIC_SETTINGS_STORAGE_KEY,
  type CosmicWallpaperSettings,
} from '@/lib/backend-flows/cosmic-settings'

describe('Cosmic Canvas (Sagittarius A* Live Wallpaper) Suite', () => {
  const store: Record<string, string> = {}
  const mockLocalStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k])
    },
  }

  beforeEach(() => {
    const mockWindow = {
      localStorage: mockLocalStorage,
      matchMedia: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    }

    Object.defineProperty(globalThis, 'window', {
      value: mockWindow,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    })

    mockLocalStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    mockLocalStorage.clear()
    // @ts-expect-error clean up mock window in node environment
    delete globalThis.window
  })

  describe('1. Settings Persistence & Fallbacks', () => {
    it('returns default settings when localStorage is empty', () => {
      const settings = loadCosmicSettings()
      expect(settings.enabled).toBe(true)
      expect(settings.darkOverlayOpacity).toBe(0.65)
      expect(settings.animationSpeed).toBe(1.0)
      expect(settings.showDots).toBe(false)
      expect(settings.useStaticOnly).toBe(false)
    })

    it('persists and retrieves custom settings safely from localStorage', () => {
      const custom: CosmicWallpaperSettings = {
        enabled: true,
        darkOverlayOpacity: 0.8,
        animationSpeed: 1.5,
        showDots: true,
        useStaticOnly: false,
      }

      saveCosmicSettings(custom)
      const loaded = loadCosmicSettings()

      expect(loaded.darkOverlayOpacity).toBe(0.8)
      expect(loaded.animationSpeed).toBe(1.5)
      expect(loaded.showDots).toBe(true)
    })

    it('sanitizes corrupt or out-of-range values from localStorage', () => {
      localStorage.setItem(
        COSMIC_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          enabled: 'invalid',
          darkOverlayOpacity: 5.0, // out of range
          animationSpeed: -2.0,    // out of range
        })
      )

      const loaded = loadCosmicSettings()
      expect(loaded.enabled).toBe(DEFAULT_COSMIC_SETTINGS.enabled)
      expect(loaded.darkOverlayOpacity).toBe(DEFAULT_COSMIC_SETTINGS.darkOverlayOpacity)
      expect(loaded.animationSpeed).toBe(DEFAULT_COSMIC_SETTINGS.animationSpeed)
    })

    it('respects prefers-reduced-motion media query by defaulting to static poster', () => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      const loaded = loadCosmicSettings()
      expect(loaded.useStaticOnly).toBe(true)
    })
  })

  describe('2. CosmicCanvasBackground Component Rendering', () => {
    it('returns null when wallpaper is disabled by user', () => {
      const markup = renderToStaticMarkup(
        React.createElement(CosmicCanvasBackground, {
          settings: { ...DEFAULT_COSMIC_SETTINGS, enabled: false },
        })
      )
      expect(markup).toBe('')
    })

    it('renders video element with WebM, MP4, and poster when enabled with motion', () => {
      const markup = renderToStaticMarkup(
        React.createElement(CosmicCanvasBackground, {
          settings: { ...DEFAULT_COSMIC_SETTINGS, enabled: true, useStaticOnly: false },
        })
      )

      expect(markup).toContain('data-testid="cosmic-canvas-background"')
      expect(markup).toContain('pointer-events-none')
      expect(markup).toContain('data-testid="cosmic-canvas-video"')
      expect(markup).toContain('/wallpapers/sagittarius-a.webm')
      expect(markup).toContain('/wallpapers/sagittarius-a.mp4')
      expect(markup).toContain('poster="/wallpapers/sagittarius-a-poster.jpg"')
    })

    it('renders static poster image when useStaticOnly is true', () => {
      const markup = renderToStaticMarkup(
        React.createElement(CosmicCanvasBackground, {
          settings: { ...DEFAULT_COSMIC_SETTINGS, enabled: true, useStaticOnly: true },
        })
      )

      expect(markup).toContain('data-testid="cosmic-canvas-poster"')
      expect(markup).toContain('src="/wallpapers/sagittarius-a-poster.jpg"')
      expect(markup).not.toContain('<video')
    })

    it('applies the configured dark contrast overlay opacity', () => {
      const markup = renderToStaticMarkup(
        React.createElement(CosmicCanvasBackground, {
          settings: { ...DEFAULT_COSMIC_SETTINGS, darkOverlayOpacity: 0.75 },
        })
      )

      expect(markup).toContain('opacity:0.75')
    })
  })

  describe('3. CosmicSettingsPopover Component Rendering', () => {
    it('renders popover trigger button with Sparkles icon and title', () => {
      const onUpdate = vi.fn()
      const onReset = vi.fn()

      const markup = renderToStaticMarkup(
        React.createElement(CosmicSettingsPopover, {
          settings: DEFAULT_COSMIC_SETTINGS,
          onUpdate,
          onReset,
        })
      )

      expect(markup).toContain('Cosmic Canvas')
    })
  })
})
