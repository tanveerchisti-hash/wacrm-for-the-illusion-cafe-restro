'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Cpu,
  Plus,
  Search,
  RefreshCw,
  MoreVertical,
  Pencil,
  Trash2,
  Activity,
  Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import { useCan } from '@/hooks/use-can'
import { FlowStatusBadge } from '@/components/backend-flows/flow-status-badge'
import { FlowCreateDialog } from '@/components/backend-flows/flow-create-dialog'
import type { BackendFlow, BackendFlowCategory } from '@/lib/backend-flows/types'

const CATEGORY_LABELS: Record<BackendFlowCategory, string> = {
  general: 'General',
  order_processing: 'Order Processing',
  kitchen_sync: 'Kitchen Sync',
  payment_reconciliation: 'Payment Reconciliation',
  custom_integration: 'Custom Integration',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual / API',
  order_event: 'Order Event',
  webhook: 'Webhook',
  schedule: 'Schedule',
  system_event: 'System Event',
}

export default function BackendFlowsPage() {
  const router = useRouter()
  const { isOwner, isAdmin } = useAuth()
  const canCreate = useCan('send-messages')

  const [flows, setFlows] = useState<BackendFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const fetchFlows = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (categoryFilter !== 'all') params.set('category', categoryFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)

      const url = `/api/backend-flows?${params.toString()}`
      const res = await fetch(url)
      if (!res.ok) {
        const errorData = await res.json().catch(() => null)
        throw new Error(errorData?.error || 'Failed to load backend workflows')
      }
      const data = await res.json()
      setFlows(data.flows || [])
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to load backend workflows')
    } finally {
      setLoading(false)
    }
  }, [search, categoryFilter, statusFilter])

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchFlows()
    }, 200)
    return () => clearTimeout(handler)
  }, [fetchFlows])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete workflow "${name}"?`)) return
    try {
      const res = await fetch(`/api/backend-flows/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Delete failed')
      }
      toast.success(`Workflow "${name}" deleted.`)
      fetchFlows()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Cpu className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Backend Flows</h1>
            <Badge variant="outline" className="border-primary/40 bg-primary/5 text-primary text-xs">
              Module
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Orchestrate server-side business logic, order lifecycle hooks, kitchen updates, and event pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchFlows()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <GatedButton
            canAct={canCreate}
            gateReason="create backend workflows"
            onClick={() => setCreateDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Workflow
          </GatedButton>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-12 sm:items-center">
            <div className="relative sm:col-span-5">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search workflows by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="sm:col-span-4">
              <Select value={categoryFilter} onValueChange={(val) => setCategoryFilter(val ?? 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="order_processing">Order Processing</SelectItem>
                  <SelectItem value="kitchen_sync">Kitchen Sync</SelectItem>
                  <SelectItem value="payment_reconciliation">Payment Reconciliation</SelectItem>
                  <SelectItem value="custom_integration">Custom Integration</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-3">
              <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val ?? 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Workflow Table / List */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Configured Pipelines ({flows.length})
          </CardTitle>
          <CardDescription>
            Select a workflow to edit its configuration, view version history, or inspect execution runs.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {flows.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Cpu className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-base font-semibold">No backend workflows found</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                Get started by creating your first backend workflow to coordinate restaurant ordering and kitchen logic.
              </p>
              {canCreate && (
                <Button
                  onClick={() => setCreateDialogOpen(true)}
                  className="mt-4 flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create First Workflow
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Executions</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flows.map((flow) => (
                    <TableRow key={flow.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell onClick={() => router.push(`/backend-flows/${flow.id}`)}>
                        <div>
                          <div className="font-medium text-foreground hover:underline flex items-center gap-1.5">
                            {flow.name}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {flow.slug}
                          </div>
                        </div>
                      </TableCell>

                      <TableCell onClick={() => router.push(`/backend-flows/${flow.id}`)}>
                        <span className="text-xs font-medium text-muted-foreground">
                          {CATEGORY_LABELS[flow.category] || flow.category}
                        </span>
                      </TableCell>

                      <TableCell onClick={() => router.push(`/backend-flows/${flow.id}`)}>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {TRIGGER_LABELS[flow.trigger_type] || flow.trigger_type}
                        </Badge>
                      </TableCell>

                      <TableCell onClick={() => router.push(`/backend-flows/${flow.id}`)}>
                        <FlowStatusBadge
                          status={flow.status}
                          version={flow.published_version}
                        />
                      </TableCell>

                      <TableCell onClick={() => router.push(`/backend-flows/${flow.id}`)}>
                        <span className="text-xs font-mono text-muted-foreground">
                          v{flow.current_version}
                          {flow.published_version && flow.published_version !== flow.current_version && (
                            <span className="text-emerald-500 ml-1">
                              (pub v{flow.published_version})
                            </span>
                          )}
                        </span>
                      </TableCell>

                      <TableCell onClick={() => router.push(`/backend-flows/${flow.id}`)}>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Activity className="h-3 w-3" />
                          {flow.execution_count} runs
                        </span>
                      </TableCell>

                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => router.push(`/backend-flows/${flow.id}`)}
                              className="flex items-center gap-2"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit Workflow
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {(isAdmin || isOwner) && (
                              <DropdownMenuItem
                                onClick={() => handleDelete(flow.id, flow.name)}
                                className="text-destructive flex items-center gap-2"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Creation Modal */}
      <FlowCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={fetchFlows}
      />
    </div>
  )
}
