'use client'

import React, { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  Layers,
  Sparkles,
  Zap,
} from 'lucide-react'
import { analyzeStepError } from '@/lib/backend-flows/diagnostics'
import type { BackendFlowRun } from '@/lib/backend-flows/types'
import type { StepExecutionResult, FlowExecutionState } from '@/lib/backend-flows/engine/types'

interface RunTraceDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: BackendFlowRun | null
}

export function RunTraceDrawer({ open, onOpenChange, run }: RunTraceDrawerProps) {
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({})

  if (!run) return null

  const isSuccess = run.status === 'completed'
  const isRunning = run.status === 'running' || run.status === 'resuming'
  const isWaiting = run.status === 'waiting'

  const state = (run.state || {}) as Partial<FlowExecutionState>
  const stepRuns: StepExecutionResult[] = state.stepRuns || []

  // Check if any step failed for diagnostics
  const failedStep = stepRuns.find((s) => s.status === 'failed')
  const rootError = run.error_message || failedStep?.error || state.errorMessage

  const diagnostic = rootError
    ? analyzeStepError(rootError, failedStep?.nodeType || 'flow', failedStep?.subType)
    : null

  const toggleStep = (nodeId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col p-0 gap-0 overflow-hidden bg-background border-l"
      >
        {/* Header */}
        <SheetHeader className="p-4 border-b bg-muted/30">
          <div className="flex items-center justify-between pr-8">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  isSuccess
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : isWaiting
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : isRunning
                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }
              >
                {run.status.toUpperCase()}
              </Badge>
              <span className="font-semibold text-sm">Release v{run.version_number}</span>
            </div>
            {run.duration_ms !== null && run.duration_ms !== undefined && (
              <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {run.duration_ms} ms
              </span>
            )}
          </div>
          <SheetTitle className="text-sm font-mono mt-1 text-muted-foreground">
            Run ID: {run.id}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Triggered via <span className="font-semibold text-foreground">{run.triggered_by}</span> at{' '}
            {new Date(run.created_at).toLocaleString()}
            {run.waiting_until && isWaiting && (
              <span className="block mt-1 text-amber-400 font-mono text-[11px]">
                Scheduled resumption at: {new Date(run.waiting_until).toLocaleString()}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Failed-Node Diagnostics (4.3) */}
          {diagnostic && (
            <div
              className={`rounded-lg border p-3.5 space-y-2 ${
                diagnostic.severity === 'critical'
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                  : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
              }`}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                {diagnostic.severity === 'critical' ? (
                  <ShieldAlert className="h-4 w-4 text-rose-400 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                )}
                <span>{diagnostic.title}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {diagnostic.explanation}
              </p>
              <div className="rounded bg-background/50 p-2 text-xs border">
                <span className="font-semibold text-foreground">Actionable Suggestion: </span>
                <span className="text-muted-foreground">{diagnostic.suggestion}</span>
              </div>
            </div>
          )}

          {/* Execution Trace Timeline (4.2) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Step Execution Trace ({stepRuns.length})
              </h3>
            </div>

            {stepRuns.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground border rounded-lg bg-card/40">
                No step runs recorded for this workflow execution.
              </div>
            ) : (
              <div className="space-y-2">
                {stepRuns.map((step, idx) => {
                  const isStepSuccess = step.status === 'completed'
                  const isStepFailed = step.status === 'failed'
                  const isExpanded = !!expandedSteps[step.nodeId]

                  return (
                    <div
                      key={`${step.nodeId}-${idx}`}
                      className={`border rounded-lg overflow-hidden transition-colors ${
                        isStepFailed
                          ? 'border-rose-500/40 bg-rose-500/5'
                          : 'border-border bg-card/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleStep(step.nodeId)}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          {isStepSuccess ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                          ) : isStepFailed ? (
                            <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div>
                            <div className="text-xs font-medium flex items-center gap-2">
                              <span>{step.subType || step.nodeType}</span>
                              <span className="text-[10px] font-mono text-muted-foreground">
                                ({step.nodeId})
                              </span>
                            </div>
                            {step.error && (
                              <p className="text-[11px] text-rose-400 font-mono mt-0.5 line-clamp-1">
                                {step.error}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {step.durationMs}ms
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-3 border-t bg-muted/20 text-xs space-y-2 font-mono">
                          {step.input && (
                            <div>
                              <div className="text-[10px] uppercase text-muted-foreground mb-1">
                                Inputs:
                              </div>
                              <pre className="p-2 bg-background/80 rounded border overflow-x-auto text-[11px]">
                                {JSON.stringify(step.input, null, 2)}
                              </pre>
                            </div>
                          )}

                          {step.output && (
                            <div>
                              <div className="text-[10px] uppercase text-muted-foreground mb-1">
                                Outputs:
                              </div>
                              <pre className="p-2 bg-background/80 rounded border overflow-x-auto text-[11px]">
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            </div>
                          )}

                          {step.error && (
                            <div>
                              <div className="text-[10px] uppercase text-rose-400 mb-1">
                                Error Details:
                              </div>
                              <div className="p-2 bg-rose-500/10 text-rose-300 rounded border border-rose-500/30 overflow-x-auto text-[11px]">
                                {step.error}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Trigger Payload Inspection */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Trigger Event Payload
            </h3>
            <pre className="p-3 bg-muted/40 rounded-lg border font-mono text-[11px] overflow-x-auto">
              {JSON.stringify(run.trigger_payload || {}, null, 2)}
            </pre>
          </div>

          {/* Final Variables & State */}
          {state.variables && Object.keys(state.variables).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Pipeline State & Variables
              </h3>
              <pre className="p-3 bg-muted/40 rounded-lg border font-mono text-[11px] overflow-x-auto">
                {JSON.stringify(state.variables, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
