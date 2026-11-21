'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Save,
  CheckCircle,
  History,
  Settings2,
  RotateCcw,
  Loader2,
  Layers,
  Sparkles,
  Play,
  Activity,
  FlaskConical,
  PauseCircle,
  Eye,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/use-auth'
import { FlowStatusBadge } from '@/components/backend-flows/flow-status-badge'
import { BackendFlowCanvas } from '@/components/backend-flows/canvas/backend-flow-canvas'
import { SimulatorModal } from '@/components/backend-flows/canvas/simulator-modal'
import { RunTraceDrawer } from '@/components/backend-flows/run-trace-drawer'
import {
  canPublishBackendFlow,
  canEditBackendFlow,
} from '@/lib/backend-flows/permissions'
import type {
  BackendFlow,
  BackendFlowCategory,
  BackendFlowTriggerType,
  BackendFlowVersion,
  BackendFlowDefinition,
  BackendFlowRun,
} from '@/lib/backend-flows/types'
import type { CanvasValidationResult } from '@/lib/backend-flows/canvas-types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default function BackendFlowDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const { accountRole } = useAuth()

  const canEdit = canEditBackendFlow(accountRole || 'viewer')
  const canPublish = canPublishBackendFlow(accountRole || 'viewer')

  const [flow, setFlow] = useState<BackendFlow | null>(null)
  const [versions, setVersions] = useState<BackendFlowVersion[]>([])
  const [runs, setRuns] = useState<BackendFlowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [runningTest, setRunningTest] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const [selectedRun, setSelectedRun] = useState<BackendFlowRun | null>(null)
  const [traceDrawerOpen, setTraceDrawerOpen] = useState(false)
  const [changeSummary, setChangeSummary] = useState('')

  // Form State
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<BackendFlowCategory>('general')
  const [triggerType, setTriggerType] = useState<BackendFlowTriggerType>('manual')
  const [triggerConfigStr, setTriggerConfigStr] = useState('{}')
  const [timeoutSeconds, setTimeoutSeconds] = useState(300)
  const [maxRetries, setMaxRetries] = useState(3)
  const [definitionStr, setDefinitionStr] = useState('{\n  "nodes": [],\n  "edges": []\n}')
  const [canvasDefinition, setCanvasDefinition] = useState<BackendFlowDefinition>({
    nodes: [],
    edges: [],
  })
  const [canvasValidation, setCanvasValidation] = useState<CanvasValidationResult | null>(null)
  const [viewMode, setViewMode] = useState<'canvas' | 'json'>('canvas')

  const loadFlow = useCallback(async () => {
    try {
      const res = await fetch(`/api/backend-flows/${id}`)
      if (!res.ok) throw new Error('Workflow not found')
      const data = await res.json()
      const f: BackendFlow = data.flow
      setFlow(f)
      setName(f.name)
      setSlug(f.slug)
      setDescription(f.description || '')
      setCategory(f.category)
      setTriggerType(f.trigger_type)
      setTriggerConfigStr(JSON.stringify(f.trigger_config || {}, null, 2))
      setTimeoutSeconds(f.metadata?.timeout_seconds ?? 300)
      setMaxRetries(f.metadata?.max_retries ?? 3)

      const def: BackendFlowDefinition = f.definition || { nodes: [], edges: [] }
      setCanvasDefinition(def)
      setDefinitionStr(JSON.stringify(def, null, 2))
    } catch (err) {
      console.error(err)
      toast.error('Failed to load workflow')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadVersions = useCallback(async () => {
    try {
      const res = await fetch(`/api/backend-flows/${id}/versions`)
      if (res.ok) {
        const data = await res.json()
        setVersions(data.versions || [])
      }
    } catch (err) {
      console.error(err)
    }
  }, [id])

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/backend-flows/${id}/runs`)
      if (res.ok) {
        const data = await res.json()
        setRuns(data.runs || [])
      }
    } catch (err) {
      console.error(err)
    }
  }, [id])

  useEffect(() => {
    loadFlow()
    loadVersions()
    loadRuns()
  }, [loadFlow, loadVersions, loadRuns])

  const handleTestRun = async () => {
    setRunningTest(true)
    try {
      const res = await fetch(`/api/backend-flows/${id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: {
            test_mode: true,
            timestamp: new Date().toISOString(),
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Test run failed')

      if (data.run?.status === 'completed') {
        toast.success(`Workflow test run completed in ${data.run.durationMs}ms!`)
      } else {
        toast.error(`Workflow test run ${data.run?.status}: ${data.run?.errorMessage || 'Check execution logs'}`)
      }
      loadRuns()
      loadFlow()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test run failed')
    } finally {
      setRunningTest(false)
    }
  }

  const handleSave = async () => {
    let parsedTriggerConfig = {}
    let parsedDefinition = canvasDefinition

    try {
      parsedTriggerConfig = JSON.parse(triggerConfigStr)
    } catch {
      toast.error('Trigger Config must be valid JSON')
      return
    }

    if (viewMode === 'json') {
      try {
        parsedDefinition = JSON.parse(definitionStr)
      } catch {
        toast.error('Definition must be valid JSON')
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/backend-flows/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
          category,
          trigger_type: triggerType,
          trigger_config: parsedTriggerConfig,
          definition: parsedDefinition,
          metadata: {
            ...flow?.metadata,
            timeout_seconds: timeoutSeconds,
            max_retries: maxRetries,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save workflow')

      setFlow(data.flow)
      toast.success('Workflow draft saved successfully!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const onOpenPublishDialog = () => {
    if (canvasValidation && !canvasValidation.valid) {
      toast.error(
        canvasValidation.errors[0]?.message ||
          'Workflow has validation errors. Fix them before publishing.'
      )
      return
    }
    setPublishDialogOpen(true)
  }

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const res = await fetch(`/api/backend-flows/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          change_summary: changeSummary.trim() || `Published v${flow?.current_version}`,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')

      setFlow(data.flow)
      setPublishDialogOpen(false)
      setChangeSummary('')
      toast.success(`Published version ${data.flow.published_version} successfully!`)
      loadVersions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  const handleUnpublish = async () => {
    if (!confirm('Revert workflow to draft status? It will not trigger in production while in draft.')) return
    try {
      const res = await fetch(`/api/backend-flows/${id}/unpublish`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unpublish failed')
      setFlow(data.flow)
      toast.success('Workflow reverted to draft.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unpublish failed')
    }
  }

  const handleTogglePause = async () => {
    if (!flow) return
    const currentlyPaused = flow.metadata?.is_paused === true
    setPausing(true)
    try {
      const res = await fetch(`/api/backend-flows/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata: {
            ...flow.metadata,
            is_paused: !currentlyPaused,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update activation status')
      setFlow(data.flow)
      toast.success(
        currentlyPaused
          ? 'Workflow resumed. Triggers are now active in production.'
          : 'Emergency pause active. All production triggers are now bypassed.'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setPausing(false)
    }
  }

  const handleRollback = async (versionNumber: number) => {
    if (
      !confirm(
        `Are you sure you want to rollback to release v${versionNumber}? This will restore its configuration as a new draft.`
      )
    ) {
      return
    }

    setRollingBack(true)
    try {
      const res = await fetch(`/api/backend-flows/${id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_number: versionNumber }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rollback failed')

      const updated: BackendFlow = data.flow
      setFlow(updated)
      setName(updated.name)
      setSlug(updated.slug)
      setDescription(updated.description || '')
      setCategory(updated.category)
      setTriggerType(updated.trigger_type)
      setTriggerConfigStr(JSON.stringify(updated.trigger_config || {}, null, 2))
      const def = updated.definition || { nodes: [], edges: [] }
      setCanvasDefinition(def)
      setDefinitionStr(JSON.stringify(def, null, 2))
      toast.success(`Successfully rolled back to v${versionNumber} as draft v${updated.current_version}!`)
      loadVersions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rollback failed')
    } finally {
      setRollingBack(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!flow) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-lg font-bold">Workflow not found</h2>
        <Link href="/backend-flows" className={buttonVariants({ className: 'mt-4' })}>
          Return to Backend Flows
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation & Status Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/backend-flows"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{flow.name}</h1>
              <FlowStatusBadge status={flow.status} version={flow.published_version} />
              {flow.metadata?.is_paused && (
                <Badge variant="destructive" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                  PAUSED
                </Badge>
              )}
              <Badge variant="outline" className="font-mono text-xs">
                Draft: v{flow.current_version}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              slug: {flow.slug} • id: {flow.id}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {flow.status === 'published' && canPublish && (
            <Button variant="outline" size="sm" onClick={handleUnpublish} className="text-amber-500">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Revert to Draft
            </Button>
          )}

          {/* Emergency Pause / Resume safety switch */}
          {flow.status === 'published' && (
            <GatedButton
              canAct={canPublish}
              gateReason="toggle emergency pause"
              onClick={handleTogglePause}
              disabled={pausing}
              variant="outline"
              size="sm"
              className={`flex items-center gap-1.5 ${
                flow.metadata?.is_paused
                  ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                  : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
              }`}
            >
              {pausing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : flow.metadata?.is_paused ? (
                <Play className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5 text-amber-400" />
              )}
              {flow.metadata?.is_paused ? 'Resume Flow' : 'Pause Flow'}
            </GatedButton>
          )}

          {/* Safe Dry-run Simulator */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSimulatorOpen(true)}
            className="flex items-center gap-1.5"
          >
            <FlaskConical className="h-3.5 w-3.5 text-primary" />
            Simulator
          </Button>

          <GatedButton
            canAct={canEdit}
            gateReason="test run workflows"
            onClick={handleTestRun}
            disabled={runningTest || saving}
            variant="outline"
            size="sm"
            className="flex items-center gap-1.5"
          >
            {runningTest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Test Run
          </GatedButton>

          <GatedButton
            canAct={canEdit}
            gateReason="edit workflows"
            onClick={handleSave}
            disabled={saving || runningTest}
            variant="outline"
            size="sm"
            className="flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Draft
          </GatedButton>

          <GatedButton
            canAct={canPublish}
            gateReason="publish workflow releases"
            onClick={onOpenPublishDialog}
            size="sm"
            className="flex items-center gap-1.5"
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Publish Release
          </GatedButton>
        </div>
      </div>

      {/* Main Tabbed Interface */}
      <Tabs defaultValue="config" className="space-y-4">
        <TabsList>
          <TabsTrigger value="config" className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configuration & Triggers
          </TabsTrigger>
          <TabsTrigger value="definition" className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Pipeline Definition
          </TabsTrigger>
          <TabsTrigger value="versions" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version History ({versions.length})
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Execution Runs ({runs.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Configuration & Triggers */}
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metadata & Trigger Rules</CardTitle>
              <CardDescription>
                Define the trigger conditions, category, and execution boundaries for this workflow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Workflow Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
                </div>

                <div className="space-y-2">
                  <Label>Slug Identifier</Label>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value)} disabled={!canEdit} />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={category}
                    onValueChange={(val) => {
                      if (val) setCategory(val as BackendFlowCategory)
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order_processing">Order Processing</SelectItem>
                      <SelectItem value="kitchen_sync">Kitchen Sync</SelectItem>
                      <SelectItem value="payment_reconciliation">Payment Reconciliation</SelectItem>
                      <SelectItem value="custom_integration">Custom Integration</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Trigger Type</Label>
                  <Select
                    value={triggerType}
                    onValueChange={(val) => {
                      if (val) setTriggerType(val as BackendFlowTriggerType)
                    }}
                    disabled={!canEdit}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual / API</SelectItem>
                      <SelectItem value="order_event">Order Event</SelectItem>
                      <SelectItem value="webhook">Inbound Webhook</SelectItem>
                      <SelectItem value="schedule">Scheduled Cron</SelectItem>
                      <SelectItem value="system_event">System Event</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canEdit}
                  rows={2}
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4 border-t pt-4">
                <div className="space-y-2">
                  <Label>Execution Timeout (Seconds)</Label>
                  <Input
                    type="number"
                    min={10}
                    max={3600}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                    disabled={!canEdit}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Maximum Retries on Error</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(Number(e.target.value))}
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label>Trigger Configuration (JSON)</Label>
                <Textarea
                  value={triggerConfigStr}
                  onChange={(e) => setTriggerConfigStr(e.target.value)}
                  disabled={!canEdit}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Visual Pipeline Canvas & Definition */}
        <TabsContent value="definition" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Interactive Workflow Builder
                  </CardTitle>
                  <CardDescription>
                    Drag-and-drop canvas to wire triggers, actions, and conditional decision trees.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border bg-muted/60 p-0.5 text-xs">
                    <Button
                      type="button"
                      variant={viewMode === 'canvas' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 px-3 text-xs"
                      onClick={() => setViewMode('canvas')}
                    >
                      Visual Canvas
                    </Button>
                    <Button
                      type="button"
                      variant={viewMode === 'json' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 px-3 text-xs"
                      onClick={() => setViewMode('json')}
                    >
                      Raw JSON
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === 'canvas' ? (
                <BackendFlowCanvas
                  initialDefinition={canvasDefinition}
                  onChange={(newDef) => {
                    setCanvasDefinition(newDef)
                    setDefinitionStr(JSON.stringify(newDef, null, 2))
                  }}
                  onValidationChange={setCanvasValidation}
                  onOpenSimulator={() => setSimulatorOpen(true)}
                  disabled={!canEdit}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Nodes & Edges Definition (JSON)</Label>
                    <span className="text-xs text-muted-foreground">
                      Edit JSON directly or switch back to Visual Canvas
                    </span>
                  </div>
                  <Textarea
                    value={definitionStr}
                    onChange={(e) => {
                      setDefinitionStr(e.target.value)
                      try {
                        const parsed = JSON.parse(e.target.value)
                        setCanvasDefinition(parsed)
                      } catch {
                        // ignore syntax errors until save
                      }
                    }}
                    disabled={!canEdit}
                    rows={18}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Version History */}
        <TabsContent value="versions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Immutable Version Snapshots</CardTitle>
              <CardDescription>
                Every published release is permanently recorded with its exact trigger and node configuration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No published versions recorded yet. Publish your first release to freeze a snapshot.
                </div>
              ) : (
                <div className="space-y-3">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-3.5 border rounded-lg bg-card/60"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">Release v{v.version_number}</span>
                          {flow.published_version === v.version_number && (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                              Live Production
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {v.change_summary || 'No change summary'}
                        </p>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right text-xs text-muted-foreground">
                          <div>{new Date(v.created_at).toLocaleString()}</div>
                        </div>
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRollback(v.version_number)}
                            disabled={rollingBack}
                            className="h-7 text-xs gap-1"
                          >
                            {rollingBack ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            Rollback
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Execution Runs */}
        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Execution Run Trace
                  </CardTitle>
                  <CardDescription>
                    Real-time execution log showing step duration, trigger source, and completion status.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={loadRuns} className="h-8 gap-1.5">
                  Refresh Runs
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No execution runs recorded yet. Click &quot;Test Run&quot; above to simulate a pipeline execution.
                </div>
              ) : (
                <div className="space-y-3">
                  {runs.map((r) => {
                    const isSuccess = r.status === 'completed'
                    const isRunning = r.status === 'running'
                    return (
                      <div
                        key={r.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 border rounded-lg bg-card/60"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                isSuccess
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs'
                                  : isRunning
                                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/30 text-xs'
                                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30 text-xs'
                              }
                            >
                              {r.status.toUpperCase()}
                            </Badge>
                            <span className="font-semibold text-sm">Run on v{r.version_number}</span>
                            <span className="text-xs text-muted-foreground">
                              via {r.triggered_by}
                            </span>
                          </div>
                          {r.error_message && (
                            <p className="text-xs text-rose-400 font-mono">
                              Error: {r.error_message}
                            </p>
                          )}
                        </div>

                        <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {r.duration_ms !== undefined && (
                              <span className="font-mono text-foreground">
                                {r.duration_ms} ms
                              </span>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs gap-1 text-primary hover:text-primary"
                              onClick={() => {
                                setSelectedRun(r)
                                setTraceDrawerOpen(true)
                              }}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View Trace
                            </Button>
                          </div>
                          <span>{new Date(r.created_at).toLocaleString()}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Publish Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
              Publish Release v{flow.current_version}
            </DialogTitle>
            <DialogDescription>
              This will freeze the current configuration into an immutable version snapshot and set this workflow live.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-3">
            <Label htmlFor="change-summary">Release Notes / Change Summary</Label>
            <Input
              id="change-summary"
              placeholder="e.g. Added kitchen timer webhooks"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              autoFocus
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)} disabled={publishing}>
              Cancel
            </Button>
            <Button onClick={handlePublish} disabled={publishing}>
              {publishing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publish Release
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safe Dry-run Simulator Modal (4.1) */}
      <SimulatorModal
        open={simulatorOpen}
        onOpenChange={setSimulatorOpen}
        flowId={flow.id}
        flowName={flow.name}
      />

      {/* Execution Run Trace Drawer (4.2 & 4.3) */}
      <RunTraceDrawer
        open={traceDrawerOpen}
        onOpenChange={setTraceDrawerOpen}
        run={selectedRun}
      />
    </div>
  )
}
