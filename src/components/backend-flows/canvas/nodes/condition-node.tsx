'use client'

import React, { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranch, Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ConditionNodeData } from '@/lib/backend-flows/canvas-types'

function ConditionNodeComponent({ data, selected }: NodeProps) {
  const nodeData = (data || {}) as unknown as ConditionNodeData
  const label = nodeData.label || 'Condition'
  const field = nodeData.field || 'variable'
  const operator = nodeData.operator || 'equals'
  const value = nodeData.value || ''

  return (
    <div
      className={`min-w-[240px] max-w-[280px] rounded-lg border bg-card text-card-foreground shadow-sm transition-all ${
        selected ? 'ring-2 ring-amber-500 border-amber-500 shadow-amber-500/10' : 'border-border'
      }`}
    >
      {/* Target handle at the top */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background hover:!scale-125 transition-transform"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b bg-amber-500/10 text-amber-400 border-amber-500/30 px-3 py-2 rounded-t-lg">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wider">Branch Logic</span>
        </div>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-300">
          If / Else
        </Badge>
      </div>

      {/* Body Expression */}
      <div className="p-3 space-y-1.5">
        <div className="text-sm font-medium leading-tight line-clamp-1">{label}</div>
        <div className="rounded bg-muted/60 p-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="text-primary font-semibold">{field}</span>{' '}
          <span className="text-amber-400">{operator}</span>{' '}
          <span className="text-foreground">{value ? `"${value}"` : '...'}</span>
        </div>
      </div>

      {/* Dual Outbound Handles (True / False) */}
      <div className="flex items-center justify-between border-t px-4 py-1.5 bg-muted/20 text-[10px] font-semibold">
        <div className="flex items-center gap-1 text-emerald-400">
          <Check className="h-3 w-3" />
          <span>True</span>
        </div>
        <div className="flex items-center gap-1 text-rose-400">
          <span>False</span>
          <X className="h-3 w-3" />
        </div>
      </div>

      {/* Left Source Handle: True */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: '25%' }}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background hover:!scale-125 transition-transform"
      />

      {/* Right Source Handle: False */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '75%' }}
        className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background hover:!scale-125 transition-transform"
      />
    </div>
  )
}

export const ConditionNode = memo(ConditionNodeComponent)
