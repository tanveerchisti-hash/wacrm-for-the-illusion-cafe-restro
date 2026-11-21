'use client'

import React from 'react'
import { Sparkles, RotateCcw, Orbit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { CosmicWallpaperSettings } from '@/lib/backend-flows/cosmic-settings'

interface CosmicSettingsPopoverProps {
  settings: CosmicWallpaperSettings
  onUpdate: (partial: Partial<CosmicWallpaperSettings>) => void
  onReset: () => void
  disabled?: boolean
}

export function CosmicSettingsPopover({
  settings,
  onUpdate,
  onReset,
  disabled,
}: CosmicSettingsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs hover:border-amber-500/50 hover:bg-amber-500/10"
          disabled={disabled}
          title="Sagittarius A* Cosmic Wallpaper Settings"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span className="hidden sm:inline">Cosmic Canvas</span>
          {settings.enabled && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-3.5 space-y-3.5 bg-popover/95 backdrop-blur-md">
        <PopoverHeader className="border-b pb-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Orbit className="h-4 w-4 text-amber-400" />
              <PopoverTitle className="text-sm font-semibold">
                Cosmic Canvas Wallpaper
              </PopoverTitle>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono border-amber-500/30 text-amber-400">
              Live Canvas
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Cinematic space visualizer for workflow canvas.
          </p>
        </PopoverHeader>

        {/* Setting 1: Enable / Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="cosmic-enable-toggle" className="text-xs font-medium cursor-pointer">
              Enable Wallpaper
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Renders live cosmic animation behind canvas nodes
            </p>
          </div>
          <Switch
            id="cosmic-enable-toggle"
            checked={settings.enabled}
            onCheckedChange={(checked) => onUpdate({ enabled: checked })}
          />
        </div>

        {settings.enabled && (
          <div className="space-y-3 pt-1 border-t">
            {/* Setting 2: Celestial Theme Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Celestial Wallpaper Theme</Label>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={settings.theme === 'sagittarius-a' ? 'secondary' : 'outline'}
                  className={`h-8 text-xs justify-start px-2 gap-1.5 ${
                    settings.theme === 'sagittarius-a'
                      ? 'border-amber-500/40 text-amber-400 font-semibold bg-amber-500/10'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => onUpdate({ theme: 'sagittarius-a' })}
                >
                  <Orbit className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="truncate">Sagittarius A*</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={settings.theme === 'milky-way' ? 'secondary' : 'outline'}
                  className={`h-8 text-xs justify-start px-2 gap-1.5 ${
                    settings.theme === 'milky-way'
                      ? 'border-purple-500/40 text-purple-400 font-semibold bg-purple-500/10'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => onUpdate({ theme: 'milky-way' })}
                >
                  <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                  <span className="truncate">Milky Way</span>
                </Button>
              </div>
            </div>

            {/* Setting 3: Dark Contrast Overlay (Brightness) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor="cosmic-opacity-slider" className="text-xs font-medium">
                  Dark Contrast Overlay
                </Label>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {Math.round(settings.darkOverlayOpacity * 100)}%
                </span>
              </div>
              <input
                id="cosmic-opacity-slider"
                type="range"
                min="0.2"
                max="0.85"
                step="0.05"
                value={settings.darkOverlayOpacity}
                onChange={(e) =>
                  onUpdate({ darkOverlayOpacity: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <button
                  type="button"
                  onClick={() => onUpdate({ darkOverlayOpacity: 0.5 })}
                  className={`hover:text-foreground underline-offset-2 ${settings.darkOverlayOpacity === 0.5 ? 'text-primary font-semibold' : ''}`}
                >
                  Luminous (50%)
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ darkOverlayOpacity: 0.65 })}
                  className={`hover:text-foreground underline-offset-2 ${settings.darkOverlayOpacity === 0.65 ? 'text-primary font-semibold' : ''}`}
                >
                  Balanced (65%)
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate({ darkOverlayOpacity: 0.8 })}
                  className={`hover:text-foreground underline-offset-2 ${settings.darkOverlayOpacity === 0.8 ? 'text-primary font-semibold' : ''}`}
                >
                  Deep Space (80%)
                </button>
              </div>
            </div>

            {/* Setting 3: Animation Speed */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <Label className="text-xs font-medium">Orbit Speed</Label>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {settings.animationSpeed}x
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { speed: 0.5, label: '0.5x Slow' },
                  { speed: 1.0, label: '1.0x Normal' },
                  { speed: 1.5, label: '1.5x Fast' },
                ].map((item) => (
                  <Button
                    key={item.speed}
                    type="button"
                    size="sm"
                    variant={settings.animationSpeed === item.speed ? 'secondary' : 'outline'}
                    className={`h-7 text-xs ${
                      settings.animationSpeed === item.speed
                        ? 'border-primary/40 text-primary font-semibold'
                        : 'text-muted-foreground'
                    }`}
                    onClick={() => onUpdate({ animationSpeed: item.speed })}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Setting 4: Canvas Dots Toggle */}
            <div className="flex items-center justify-between pt-1">
              <div className="space-y-0.5">
                <Label htmlFor="cosmic-dots-toggle" className="text-xs font-medium cursor-pointer">
                  Show Canvas Dots
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Superimposes subtle coordinate grid dots
                </p>
              </div>
              <Switch
                id="cosmic-dots-toggle"
                checked={settings.showDots}
                onCheckedChange={(checked) => onUpdate({ showDots: checked })}
              />
            </div>

            {/* Setting 5: Static Mode / Reduced Motion */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="cosmic-static-toggle" className="text-xs font-medium cursor-pointer">
                  Static Wallpaper Only
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  Disables motion for low power / reduced motion
                </p>
              </div>
              <Switch
                id="cosmic-static-toggle"
                checked={settings.useStaticOnly}
                onCheckedChange={(checked) => onUpdate({ useStaticOnly: checked })}
              />
            </div>
          </div>
        )}

        {/* Footer: Restore Defaults */}
        <div className="pt-2 border-t flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Restore Defaults
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
