'use client'

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FlaskConical,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Layers,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { analyzeStepError } from '@/lib/backend-flows/diagnostics'
import type { FlowExecutionState, StepExecutionResult } from '@/lib/backend-flows/engine/types'

interface SimulatorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  flowId: string
  flowName: string
}

const PRESET_PAYLOADS: Record<string, { label: string; payload: Record<string, unknown> }> = {
  restaurant_order: {
    label: 'Dine-in Order Created (₹1330 - Table 4)',
    payload: {
      orderId: 'ord_trial_101',
      orderNumber: 101,
      tableNumber: 'Table 4',
      totalAmount: 1330,
      currency: 'INR',
      items: [
        { name: 'Butter Chicken', qty: 2, price: 450 },
        { name: 'Garlic Naan', qty: 4, price: 80 },
        { name: 'Cold Coffee with Ice Cream', qty: 1, price: 110 },
      ],
      customer: {
        name: 'Tanveer Ahmed',
        phone: '+919876543210',
      },
      status: 'pending',
    },
  },
  phonepe_payment: {
    label: 'PhonePe UPI Payment Verified (₹1330)',
    payload: {
      orderId: 'ord_trial_101',
      transactionId: 'TXN_UPI_998877',
      amount: 1330,
      paymentStatus: 'SUCCESS',
      provider: 'PhonePe',
      method: 'UPI_QR',
      upiPayer: 'tanveer@upi',
      verifiedAt: new Date().toISOString(),
    },
  },
  kitchen_kot: {
    label: 'Kitchen KOT Ready (Prep Time 18m)',
    payload: {
      orderId: 'ord_trial_101',
      kotId: 'KOT-12',
      status: 'ready_for_serving',
      prepTimeMinutes: 18,
      station: 'Main Kitchen',
    },
  },
  custom: {
    label: 'Custom JSON Payload',
    payload: {
      customKey: 'customValue',
    },
  },
}

export function SimulatorModal({
  open,
  onOpenChange,
  flowId,
  flowName,
}: SimulatorModalProps) {
  const [selectedPreset, setSelectedPreset] = useState('restaurant_order')
  const [payloadStr, setPayloadStr] = useState(
    JSON.stringify(PRESET_PAYLOADS.restaurant_order.payload, null, 2)
  )
  const [simulating, setSimulating] = useState(false)
  const [simulationResult, setSimulationResult] = useState<FlowExecutionState | null>(null)
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({})

  const handlePresetChange = (presetKey: string | null) => {
    if (!presetKey) return
    setSelectedPreset(presetKey)
    const preset = PRESET_PAYLOADS[presetKey]
    if (preset) {
      setPayloadStr(JSON.stringify(preset.payload, null, 2))
    }
  }

  const handleRunSimulation = async () => {
    let parsedPayload = {}
    try {
      parsedPayload = JSON.parse(payloadStr)
    } catch {
      toast.error('Simulation payload must be valid JSON')
      return
    }

    setSimulating(true)
    setSimulationResult(null)

    try {
      const res = await fetch(`/api/backend-flows/${flowId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: parsedPayload }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Simulation failed')

      setSimulationResult(data.simulation)
      if (data.simulation?.status === 'completed') {
        toast.success(`Simulation completed safely in ${data.simulation.durationMs}ms!`)
      } else {
        toast.error(`Simulation completed with error: ${data.simulation?.errorMessage}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setSimulating(false)
    }
  }

  const toggleStep = (nodeId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }))
  }

  const failedStep = simulationResult?.stepRuns?.find((s) => s.status === 'failed')
  const rootError = simulationResult?.errorMessage || failedStep?.error
  const diagnostic = rootError
    ? analyzeStepError(rootError, failedStep?.nodeType || 'flow', failedStep?.subType)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 border-b bg-muted/20">
          <div className="flex items-center justify-between pr-6">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-primary" />
              <DialogTitle className="text-base">Safe Dry-Run Simulator</DialogTitle>
            </div>
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 gap-1 text-[11px]">
              <ShieldCheck className="h-3 w-3" />
              Sandbox Safe Mode
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            Test <span className="font-semibold text-foreground">{flowName}</span> execution logic
            without dispatching real WhatsApp messages or live HTTP requests.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Preset Selector */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Mock Event Preset</Label>
              <Select value={selectedPreset} onValueChange={handlePresetChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRESET_PAYLOADS).map(([k, p]) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Payload JSON Editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Simulated Trigger Event Payload (JSON)</Label>
              <span className="text-[11px] text-muted-foreground">Editable mock payload</span>
            </div>
            <Textarea
              value={payloadStr}
              onChange={(e) => setPayloadStr(e.target.value)}
              rows={7}
              className="font-mono text-xs"
            />
          </div>

          {/* Simulation Results Display */}
          {simulationResult && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      simulationResult.status === 'completed'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    }
                  >
                    {simulationResult.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                    <Clock className="h-3 w-3" />
                    {simulationResult.durationMs}ms
                  </span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  Simulated Run: {simulationResult.runId}
                </span>
              </div>

              {/* Diagnostic Card if error */}
              {diagnostic && (
                <div
                  className={`rounded-lg border p-3 space-y-1.5 ${
                    diagnostic.severity === 'critical'
                      ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
                      : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>{diagnostic.title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {diagnostic.explanation}
                  </p>
                  <div className="rounded bg-background/60 p-2 text-[11px] border">
                    <span className="font-semibold text-foreground">Recommendation: </span>
                    <span className="text-muted-foreground">{diagnostic.suggestion}</span>
                  </div>
                </div>
              )}

              {/* Simulated Step Trace */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  Simulated Step Traversal ({simulationResult.stepRuns?.length || 0})
                </h4>

                <div className="space-y-1.5">
                  {simulationResult.stepRuns?.map((step: StepExecutionResult, idx: number) => {
                    const isStepSuccess = step.status === 'completed'
                    const isStepFailed = step.status === 'failed'
                    const isExpanded = !!expandedSteps[step.nodeId]

                    return (
                      <div
                        key={`${step.nodeId}-${idx}`}
                        className={`border rounded-md overflow-hidden text-xs ${
                          isStepFailed
                            ? 'border-rose-500/40 bg-rose-500/5'
                            : 'border-border bg-card/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleStep(step.nodeId)}
                          className="w-full flex items-center justify-between p-2.5 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {isStepSuccess ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            ) : isStepFailed ? (
                              <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <span className="font-medium">{step.subType || step.nodeType}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              ({step.nodeId})
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {step.durationMs}ms
                            </span>
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="p-2.5 border-t bg-muted/20 text-[11px] font-mono space-y-2">
                            {step.output && (
                              <div>
                                <div className="text-[9px] uppercase text-muted-foreground mb-0.5">
                                  Output / Evaluation:
                                </div>
                                <pre className="p-1.5 bg-background/80 rounded border overflow-x-auto">
                                  {JSON.stringify(step.output, null, 2)}
                                </pre>
                              </div>
                            )}
                            {step.error && (
                              <div className="text-rose-400">Error: {step.error}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleRunSimulation}
            disabled={simulating}
            className="gap-1.5"
          >
            {simulating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run Safe Simulation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
