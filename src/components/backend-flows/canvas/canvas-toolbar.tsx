'use client'

import React from 'react'
import {
  Plus,
  Zap,
  ShoppingBag,
  Globe,
  Clock,
  MessageSquare,
  UtensilsCrossed,
  CreditCard,
  GitBranch,
  LayoutGrid,
  FlaskConical,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { CanvasValidationResult } from '@/lib/backend-flows/canvas-types'

interface CanvasToolbarProps {
  onAddNode: (type: 'trigger' | 'action' | 'condition', subType: string, label: string) => void
  onAutoLayout: () => void
  onOpenSimulator?: () => void
  validation: CanvasValidationResult
  disabled?: boolean
}

export function CanvasToolbar({
  onAddNode,
  onAutoLayout,
  onOpenSimulator,
  validation,
  disabled,
}: CanvasToolbarProps) {
  const hasErrors = validation.errors.length > 0
  const hasWarnings = validation.warnings.length > 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 p-2.5">
      {/* Left side: Node Creator & Layout */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button size="sm" className="h-8 gap-1.5" disabled={disabled}>
              <Plus className="h-4 w-4" />
              <span>Add Node</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                Triggers
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onAddNode('trigger', 'order_event', 'Order Created')}
                className="gap-2 cursor-pointer"
              >
                <ShoppingBag className="h-4 w-4 text-violet-400" />
                <span>Order Event</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('trigger', 'webhook', 'Inbound Webhook')}
                className="gap-2 cursor-pointer"
              >
                <Globe className="h-4 w-4 text-sky-400" />
                <span>Inbound Webhook</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('trigger', 'schedule', 'Scheduled Cron')}
                className="gap-2 cursor-pointer"
              >
                <Clock className="h-4 w-4 text-amber-400" />
                <span>Scheduled Cron</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('trigger', 'manual', 'Manual Execution')}
                className="gap-2 cursor-pointer"
              >
                <Zap className="h-4 w-4 text-violet-400" />
                <span>Manual / API</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                Actions
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onAddNode('action', 'whatsapp_message', 'Send WhatsApp Message')}
                className="gap-2 cursor-pointer"
              >
                <MessageSquare className="h-4 w-4 text-emerald-400" />
                <span>WhatsApp Message</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('action', 'kitchen_sync', 'Kitchen Sync')}
                className="gap-2 cursor-pointer"
              >
                <UtensilsCrossed className="h-4 w-4 text-orange-400" />
                <span>Kitchen Sync</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('action', 'payment_check', 'Verify PhonePe UPI')}
                className="gap-2 cursor-pointer"
              >
                <CreditCard className="h-4 w-4 text-blue-400" />
                <span>Payment Verification</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('action', 'http_request', 'Outbound HTTP')}
                className="gap-2 cursor-pointer"
              >
                <Globe className="h-4 w-4 text-purple-400" />
                <span>Outbound HTTP Call</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAddNode('action', 'delay', 'Delay Timer')}
                className="gap-2 cursor-pointer"
              >
                <Clock className="h-4 w-4 text-yellow-400" />
                <span>Delay Execution</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                Logic & Branching
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onAddNode('condition', 'if_else', 'Check Condition')}
                className="gap-2 cursor-pointer"
              >
                <GitBranch className="h-4 w-4 text-amber-400" />
                <span>Condition Branch (If/Else)</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={onAutoLayout}
          disabled={disabled}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>Auto Layout</span>
        </Button>

        {onOpenSimulator && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-primary hover:text-primary"
            onClick={onOpenSimulator}
          >
            <FlaskConical className="h-3.5 w-3.5 text-primary" />
            <span>Simulator</span>
          </Button>
        )}
      </div>

      {/* Right side: Real-time Canvas Validation Status */}
      <div className="flex items-center gap-2">
        {hasErrors ? (
          <Badge variant="destructive" className="h-7 gap-1 px-2.5 text-xs font-normal">
            <XCircle className="h-3.5 w-3.5" />
            <span>{validation.errors.length} Issue{validation.errors.length > 1 ? 's' : ''} Detected</span>
          </Badge>
        ) : hasWarnings ? (
          <Badge variant="secondary" className="h-7 gap-1 px-2.5 text-xs font-normal border-amber-500/40 bg-amber-500/10 text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{validation.warnings.length} Warning{validation.warnings.length > 1 ? 's' : ''}</span>
          </Badge>
        ) : (
          <Badge variant="secondary" className="h-7 gap-1 px-2.5 text-xs font-normal border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Pipeline Valid</span>
          </Badge>
        )}
      </div>
    </div>
  )
}
