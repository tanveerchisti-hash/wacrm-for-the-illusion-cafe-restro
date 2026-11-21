'use client'

import React, { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  MessageSquare,
  UtensilsCrossed,
  CreditCard,
  Globe,
  Clock,
  Tag,
  Play,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ActionNodeData, ActionSubType } from '@/lib/backend-flows/canvas-types'

function getActionIcon(subType?: ActionSubType) {
  switch (subType) {
    case 'whatsapp_message':
      return <MessageSquare className="h-4 w-4 text-emerald-400" />
    case 'kitchen_sync':
      return <UtensilsCrossed className="h-4 w-4 text-orange-400" />
    case 'payment_check':
      return <CreditCard className="h-4 w-4 text-blue-400" />
    case 'http_request':
      return <Globe className="h-4 w-4 text-purple-400" />
    case 'delay':
      return <Clock className="h-4 w-4 text-yellow-400" />
    case 'tag_contact':
      return <Tag className="h-4 w-4 text-pink-400" />
    default:
      return <Play className="h-4 w-4 text-primary" />
  }
}

function getHeaderColor(subType?: ActionSubType) {
  switch (subType) {
    case 'whatsapp_message':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    case 'kitchen_sync':
      return 'bg-orange-500/10 text-orange-400 border-orange-500/30'
    case 'payment_check':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/30'
    case 'http_request':
      return 'bg-purple-500/10 text-purple-400 border-purple-500/30'
    case 'delay':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
    case 'tag_contact':
      return 'bg-pink-500/10 text-pink-400 border-pink-500/30'
    default:
      return 'bg-primary/10 text-primary border-primary/30'
  }
}

function ActionNodeComponent({ data, selected }: NodeProps) {
  const nodeData = (data || {}) as unknown as ActionNodeData
  const label = nodeData.label || 'Action'
  const subType = nodeData.subType || 'whatsapp_message'

  return (
    <div
      className={`min-w-[220px] max-w-[260px] rounded-lg border bg-card text-card-foreground shadow-sm transition-all ${
        selected ? 'ring-2 ring-primary border-primary shadow-primary/10' : 'border-border'
      }`}
    >
      {/* Target handle at the top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background hover:!scale-125 transition-transform"
      />

      {/* Header */}
      <div className={`flex items-center justify-between border-b px-3 py-2 rounded-t-lg ${getHeaderColor(subType)}`}>
        <div className="flex items-center gap-2">
          {getActionIcon(subType)}
          <span className="text-xs font-semibold uppercase tracking-wider">Action</span>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-current">
          {subType.replace('_', ' ')}
        </Badge>
      </div>

      {/* Content */}
      <div className="p-3 space-y-1">
        <div className="text-sm font-medium leading-tight line-clamp-1">{label}</div>
        {nodeData.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 leading-snug">
            {nodeData.description}
          </p>
        )}
      </div>

      {/* Source handle at the bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-primary !border-2 !border-background hover:!scale-125 transition-transform"
      />
    </div>
  )
}

export const ActionNode = memo(ActionNodeComponent)
