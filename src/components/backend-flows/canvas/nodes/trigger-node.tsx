'use client'

import React, { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Zap, Clock, Globe, ShoppingBag, Radio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { TriggerNodeData, TriggerSubType } from '@/lib/backend-flows/canvas-types'

function getTriggerIcon(subType?: TriggerSubType) {
  switch (subType) {
    case 'order_event':
      return <ShoppingBag className="h-4 w-4 text-violet-400" />
    case 'schedule':
      return <Clock className="h-4 w-4 text-amber-400" />
    case 'webhook':
      return <Globe className="h-4 w-4 text-sky-400" />
    case 'system_event':
      return <Radio className="h-4 w-4 text-emerald-400" />
    default:
      return <Zap className="h-4 w-4 text-violet-400" />
  }
}

function TriggerNodeComponent({ data, selected }: NodeProps) {
  const nodeData = (data || {}) as unknown as TriggerNodeData
  const label = nodeData.label || 'Trigger'
  const subType = nodeData.subType || 'manual'

  return (
    <div
      className={`min-w-[220px] max-w-[260px] rounded-lg border bg-card text-card-foreground shadow-sm transition-all ${
        selected ? 'ring-2 ring-violet-500 border-violet-500 shadow-violet-500/10' : 'border-border'
      }`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b bg-violet-500/10 px-3 py-2 rounded-t-lg">
        <div className="flex items-center gap-2">
          {getTriggerIcon(subType)}
          <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
            Trigger
          </span>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/30 text-violet-300">
          {subType.replace('_', ' ')}
        </Badge>
      </div>

      {/* Body content */}
      <div className="p-3 space-y-1">
        <div className="text-sm font-medium leading-tight line-clamp-1">{label}</div>
        {nodeData.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
            {nodeData.description}
          </p>
        )}
      </div>

      {/* Outgoing connection handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background hover:!scale-125 transition-transform"
      />
    </div>
  )
}

export const TriggerNode = memo(TriggerNodeComponent)
