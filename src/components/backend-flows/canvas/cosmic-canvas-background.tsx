'use client'

import React, { memo, useEffect, useRef, useState } from 'react'
import type { CosmicWallpaperSettings } from '@/lib/backend-flows/cosmic-settings'

interface CosmicCanvasBackgroundProps {
  settings: CosmicWallpaperSettings
  className?: string
}

/**
 * CosmicCanvasBackground
 *
 * Renders a hardware-accelerated, cinematic animated wallpaper inspired by
 * Sagittarius A* (the supermassive black hole at the center of the Milky Way).
 *
 * Architecture:
 *   Layer 1: Optimized seamless WebM video with MP4 fallback and static JPEG poster
 *   Layer 2: Adjustable dark contrast overlay (deep space #020108 at configurable opacity)
 *   Layer 3: Subtle cosmic vignette focusing viewer attention towards the canvas center
 *
 * Performance features:
 *   - Strictly `pointer-events: none` and `user-select: none`
 *   - Automatically pauses on inactive browser tab (`visibilitychange`)
 *   - Automatically pauses when canvas container is scrolled out of view (`IntersectionObserver`)
 *   - Handles browser autoplay restrictions gracefully by showing the high-res poster
 *   - Completely isolated from ReactFlow node/edge state updates via `React.memo`
 */
export const CosmicCanvasBackground = memo(function CosmicCanvasBackground({
  settings,
  className = '',
}: CosmicCanvasBackgroundProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)

  // 1. Manage Playback Rate according to user speed setting
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = settings.animationSpeed || 1.0
    }
  }, [settings.animationSpeed])

  // 2. Manage Play / Pause based on settings & visibility
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!settings.enabled || settings.useStaticOnly) {
      video.pause()
      return
    }

    const tryPlay = () => {
      const playPromise = video.play()
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // Autoplay blocked by policy or hardware issue -> fallback gracefully
          console.warn('[cosmic-canvas] Video autoplay prevented:', err)
        })
      }
    }

    tryPlay()

    // 3. Pause video when browser tab is hidden to conserve CPU/GPU
    const handleVisibilityChange = () => {
      if (document.hidden) {
        video.pause()
      } else if (settings.enabled && !settings.useStaticOnly) {
        tryPlay()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    // 4. Pause video when canvas element is scrolled out of viewport
    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined' && containerRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              if (settings.enabled && !settings.useStaticOnly && !document.hidden) {
                tryPlay()
              }
            } else {
              video.pause()
            }
          })
        },
        { threshold: 0.1 }
      )
      observer.observe(containerRef.current)
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (observer) {
        observer.disconnect()
      }
    }
  }, [settings.enabled, settings.useStaticOnly])

  // If cosmic wallpaper is disabled by user, do not render decorative background
  if (!settings.enabled) {
    return null
  }

  return (
    <div
      ref={containerRef}
      data-testid="cosmic-canvas-background"
      aria-hidden="true"
      className={`absolute inset-0 pointer-events-none select-none overflow-hidden z-0 bg-[#020108] ${className}`}
    >
      {/* Layer 1: Hardware-accelerated Video / Static Poster */}
      {!settings.useStaticOnly && !videoFailed ? (
        <video
          ref={videoRef}
          data-testid="cosmic-canvas-video"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/wallpapers/sagittarius-a-poster.jpg"
          onError={() => {
            console.warn('[cosmic-canvas] Video source error, falling back to static poster.')
            setVideoFailed(true)
          }}
          className="w-full h-full object-cover object-center will-change-transform scale-[1.02] filter contrast-[1.05]"
        >
          <source src="/wallpapers/sagittarius-a.webm" type="video/webm" />
          <source src="/wallpapers/sagittarius-a.mp4" type="video/mp4" />
        </video>
      ) : (
        /* Static poster fallback for reduced-motion or video load failure */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/wallpapers/sagittarius-a-poster.jpg"
          alt="Sagittarius A* Cosmic Background"
          data-testid="cosmic-canvas-poster"
          className="w-full h-full object-cover object-center will-change-transform filter contrast-[1.05]"
        />
      )}

      {/* Layer 2: Adjustable Dark Contrast Overlay */}
      <div
        data-testid="cosmic-canvas-overlay"
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
          backgroundColor: '#020108',
          opacity: settings.darkOverlayOpacity,
        }}
      />

      {/* Layer 3: Cinematic Vignette (Soft edges & center depth) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(30, 10, 45, 0.15) 0%, rgba(2, 1, 8, 0.45) 70%, rgba(2, 1, 8, 0.85) 100%)',
        }}
      />
    </div>
  )
})
