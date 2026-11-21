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
import {
  canPublishBackendFlow,
  canEditBackendFlow,
} from '@/lib/backend-flows/permissions'
import type {
  BackendFlow,
  BackendFlowCategory,
  BackendFlowTriggerType,
  BackendFlowVersion,
} from '@/lib/backend-flows/types'

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
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
      setDefinitionStr(JSON.stringify(f.definition || { nodes: [], edges: [] }, null, 2))
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

  useEffect(() => {
    loadFlow()
    loadVersions()
  }, [loadFlow, loadVersions])

  const handleSave = async () => {
    let parsedTriggerConfig = {}
    let parsedDefinition = { nodes: [], edges: [] }

    try {
      parsedTriggerConfig = JSON.parse(triggerConfigStr)
    } catch {
      toast.error('Trigger Config must be valid JSON')
      return
    }

    try {
      parsedDefinition = JSON.parse(definitionStr)
    } catch {
      toast.error('Definition must be valid JSON')
      return
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

          <GatedButton
            canAct={canEdit}
            gateReason="edit workflows"
            onClick={handleSave}
            disabled={saving}
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
            onClick={() => setPublishDialogOpen(true)}
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

        {/* Tab 2: Pipeline Definition (@xyflow ready) */}
        <TabsContent value="definition">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Workflow Pipeline Schema
                  </CardTitle>
                  <CardDescription>
                    Structured graph definition (nodes & edges) aligned with the visual builder engine.
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="font-mono text-xs">
                  @xyflow/react Ready
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nodes & Edges Definition (JSON)</Label>
                <Textarea
                  value={definitionStr}
                  onChange={(e) => setDefinitionStr(e.target.value)}
                  disabled={!canEdit}
                  rows={16}
                  className="font-mono text-xs"
                />
              </div>
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

                      <div className="text-right text-xs text-muted-foreground">
                        <div>{new Date(v.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
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
    </div>
  )
}
