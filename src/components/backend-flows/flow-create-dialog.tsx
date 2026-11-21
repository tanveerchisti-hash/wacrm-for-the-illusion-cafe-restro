'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { generateSlug } from '@/lib/backend-flows/validation'
import type { BackendFlowCategory, BackendFlowTriggerType } from '@/lib/backend-flows/types'

interface FlowCreateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function FlowCreateDialog({ open, onOpenChange, onSuccess }: FlowCreateDialogProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [isSlugManual, setIsSlugManual] = useState(false)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<BackendFlowCategory>('general')
  const [triggerType, setTriggerType] = useState<BackendFlowTriggerType>('manual')
  const [loading, setLoading] = useState(false)

  const handleNameChange = (val: string) => {
    setName(val)
    if (!isSlugManual) {
      setSlug(generateSlug(val))
    }
  }

  const handleSlugChange = (val: string) => {
    setIsSlugManual(true)
    setSlug(val.toLowerCase().replace(/\s+/g, '-'))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Workflow name is required')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/backend-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || generateSlug(name),
          description: description.trim() || null,
          category,
          trigger_type: triggerType,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create backend workflow')
      }

      toast.success('Backend workflow created successfully!')
      onOpenChange(false)
      setName('')
      setSlug('')
      setIsSlugManual(false)
      setDescription('')
      onSuccess?.()
      router.push(`/backend-flows/${data.flow.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Creation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Create Backend Workflow
            </DialogTitle>
            <DialogDescription>
              Configure the foundation for your new backend pipeline. Workflows start as drafts.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="flow-name">Workflow Name *</Label>
              <Input
                id="flow-name"
                placeholder="e.g. Order Lifecycle Sync"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="flow-slug">Slug Identifier</Label>
              <Input
                id="flow-slug"
                placeholder="order-lifecycle-sync"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                Unique identifier used in API and webhook triggers.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(val) => {
                    if (val) setCategory(val as BackendFlowCategory)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="order_processing">Order Processing</SelectItem>
                    <SelectItem value="kitchen_sync">Kitchen Sync</SelectItem>
                    <SelectItem value="payment_reconciliation">Payment Reconciliation</SelectItem>
                    <SelectItem value="custom_integration">Custom Integration</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label>Initial Trigger</Label>
                <Select
                  value={triggerType}
                  onValueChange={(val) => {
                    if (val) setTriggerType(val as BackendFlowTriggerType)
                  }}
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

            <div className="grid gap-2">
              <Label htmlFor="flow-desc">Description (Optional)</Label>
              <Textarea
                id="flow-desc"
                placeholder="Brief summary of what this backend flow manages..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
