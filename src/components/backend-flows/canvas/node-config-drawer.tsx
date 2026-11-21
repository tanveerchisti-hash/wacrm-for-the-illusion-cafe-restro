'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
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
import {
  Trash2,
  X,
  Check,
  Loader2,
  AlertTriangle,
  Zap,
  PlayCircle,
  GitBranch,
} from 'lucide-react'
import { toast } from 'sonner'
import type { BackendFlowNode } from '@/lib/backend-flows/types'

interface NodeConfigDrawerProps {
  node: BackendFlowNode | null
  open: boolean
  onClose: () => void
  onUpdate: (updatedNode: BackendFlowNode) => void
  onSave?: (updatedNode: BackendFlowNode) => Promise<void> | void
  onDelete: (nodeId: string) => void
  saving?: boolean
}

export function NodeConfigDrawer({
  node,
  open,
  onClose,
  onUpdate,
  onSave,
  onDelete,
  saving = false,
}: NodeConfigDrawerProps) {
  // Local uncommitted draft state
  const [draftData, setDraftData] = useState<Record<string, unknown>>({})
  const [isDirty, setIsDirty] = useState(false)
  const [localSaving, setLocalSaving] = useState(false)

  // Confirmation dialog states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)

  // Initialize or reset draft when active node or open state changes
  useEffect(() => {
    if (node && open) {
      setDraftData({ ...(node.data || {}) })
      setIsDirty(false)
    }
  }, [node, open])

  // Field change handler in local draft
  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setDraftData((prev) => {
      const next = { ...prev, [key]: value }
      return next
    })
    setIsDirty(true)
  }, [])

  // Node type icon & badge
  const nodeTypeMeta = useMemo(() => {
    if (!node) return { icon: Zap, label: 'Node', color: 'text-primary' }
    switch (node.type) {
      case 'trigger':
        return {
          icon: Zap,
          label: 'TRIGGER',
          color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
        }
      case 'action':
        return {
          icon: PlayCircle,
          label: 'ACTION',
          color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
        }
      case 'condition':
        return {
          icon: GitBranch,
          label: 'CONDITION',
          color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        }
      default:
        return {
          icon: Zap,
          label: (node.type as string).toUpperCase(),
          color: 'text-primary bg-primary/10 border-primary/20',
        }
    }
  }, [node])

  if (!node) return null

  const label = (draftData.label as string) ?? (node.data?.label as string) ?? ''
  const description =
    (draftData.description as string) ??
    (node.data?.description as string) ??
    ''
  const subType =
    (draftData.subType as string) ??
    (node.data?.subType as string) ??
    ''

  const isSaving = saving || localSaving

  // Close attempt handler: warns if unsaved changes exist
  const handleAttemptClose = () => {
    if (isDirty) {
      setShowUnsavedDialog(true)
    } else {
      onClose()
    }
  }

  // Cancel handler: discards draft edits and closes
  const handleCancel = () => {
    setDraftData({ ...(node.data || {}) })
    setIsDirty(false)
    onClose()
  }

  // Save Draft handler: commits draft to parent and triggers persistence
  const handleSaveDraft = async () => {
    const updatedNode: BackendFlowNode = {
      ...node,
      data: { ...draftData },
    }

    // Update parent state
    onUpdate(updatedNode)
    setIsDirty(false)

    if (onSave) {
      setLocalSaving(true)
      try {
        await onSave(updatedNode)
      } catch (err) {
        console.error('Failed to persist node draft:', err)
        toast.error(err instanceof Error ? err.message : 'Save draft failed')
      } finally {
        setLocalSaving(false)
      }
    } else {
      toast.success('Node configuration draft saved')
    }
  }

  const NodeIcon = nodeTypeMeta.icon

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) handleAttemptClose()
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="p-0 gap-0 w-full sm:w-[480px] sm:max-w-[480px] h-full flex flex-col overflow-hidden border-l bg-popover shadow-2xl"
        >
          {/* SECTION 1: HEADER (Sticky / Fixed Top) */}
          <SheetHeader className="px-6 py-5 border-b shrink-0 flex flex-row items-start justify-between bg-popover/90 backdrop-blur-xs gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${nodeTypeMeta.color}`}
                >
                  <NodeIcon className="h-3 w-3" />
                  {nodeTypeMeta.label}
                </span>
                <SheetTitle className="text-base font-semibold tracking-tight text-foreground truncate">
                  Configure {nodeTypeMeta.label} Node
                </SheetTitle>
              </div>
              <SheetDescription className="text-xs text-muted-foreground leading-normal">
                Configure execution parameters, events, and data mappings for this workflow step.
              </SheetDescription>
            </div>

            {/* Custom Top-Right Close Button with Unsaved Changes Guard */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleAttemptClose}
              className="h-8 w-8 rounded-lg -mr-1 -mt-1 text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Close configuration panel"
            >
              <X className="h-4 w-4" />
            </Button>
          </SheetHeader>

          {/* SECTION 2: SCROLLABLE CONTENT */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-5 text-sm">
            {/* General Field 1: Node Label */}
            <div className="space-y-2">
              <Label htmlFor="node-label" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Node Label <span className="text-destructive">*</span>
              </Label>
              <Input
                id="node-label"
                value={label}
                onChange={(e) => handleFieldChange('label', e.target.value)}
                placeholder="e.g. Order Received Alert"
                className="h-10 rounded-lg text-sm bg-background border-border"
              />
              <p className="text-[11px] text-muted-foreground">
                Human-readable step name displayed directly on the visual canvas.
              </p>
            </div>

            {/* General Field 2: Description / Note */}
            <div className="space-y-2">
              <Label htmlFor="node-desc" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Description / Note
              </Label>
              <Textarea
                id="node-desc"
                value={description}
                onChange={(e) => handleFieldChange('description', e.target.value)}
                placeholder="Optional operational notes or explanation of what this node executes..."
                rows={3}
                className="min-h-[72px] rounded-lg text-sm bg-background border-border resize-y"
              />
            </div>

            {/* TRIGGER SPECIFIC CONFIG */}
            {node.type === 'trigger' && (
              <div className="space-y-5 pt-2 border-t border-border/60">
                <div className="space-y-2">
                  <Label htmlFor="trigger-subtype" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Trigger Subtype
                  </Label>
                  <Select
                    value={subType || 'order_event'}
                    onValueChange={(val) => {
                      if (val) handleFieldChange('subType', val)
                    }}
                  >
                    <SelectTrigger id="trigger-subtype" className="h-10 rounded-lg bg-background border-border text-sm">
                      <SelectValue placeholder="Select trigger mechanism" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order_event">Order Event</SelectItem>
                      <SelectItem value="webhook">Inbound Webhook</SelectItem>
                      <SelectItem value="schedule">Scheduled Cron</SelectItem>
                      <SelectItem value="manual">Manual / API</SelectItem>
                      <SelectItem value="system_event">System Event</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Determines what operational event starts this workflow pipeline.
                  </p>
                </div>

                {subType === 'order_event' && (
                  <div className="space-y-2">
                    <Label htmlFor="trigger-event" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Event Name
                    </Label>
                    <Select
                      value={(draftData.event as string) || 'order.created'}
                      onValueChange={(val) => {
                        if (val) handleFieldChange('event', val)
                      }}
                    >
                      <SelectTrigger id="trigger-event" className="h-10 rounded-lg bg-background border-border text-sm">
                        <SelectValue placeholder="Select order event" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="order.created">Order Created (order.created)</SelectItem>
                        <SelectItem value="order.confirmed">Order Confirmed (order.confirmed)</SelectItem>
                        <SelectItem value="order.cancelled">Order Cancelled (order.cancelled)</SelectItem>
                        <SelectItem value="order.kitchen_ready">Kitchen Ready (order.kitchen_ready)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {subType === 'schedule' && (
                  <div className="space-y-2">
                    <Label htmlFor="cron-expression" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Cron Expression
                    </Label>
                    <Input
                      id="cron-expression"
                      value={(draftData.cronExpression as string) || '*/15 * * * *'}
                      onChange={(e) => handleFieldChange('cronExpression', e.target.value)}
                      placeholder="e.g. 0 9 * * 1-5"
                      className="h-10 rounded-lg font-mono text-xs bg-background border-border"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Standard 5-part cron syntax (minute, hour, day, month, weekday).
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ACTION SPECIFIC CONFIG */}
            {node.type === 'action' && (
              <div className="space-y-5 pt-2 border-t border-border/60">
                <div className="space-y-2">
                  <Label htmlFor="action-subtype" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Action Subtype
                  </Label>
                  <Select
                    value={subType || 'whatsapp_message'}
                    onValueChange={(val) => {
                      if (val) handleFieldChange('subType', val)
                    }}
                  >
                    <SelectTrigger id="action-subtype" className="h-10 rounded-lg bg-background border-border text-sm">
                      <SelectValue placeholder="Select action type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whatsapp_message">WhatsApp Message</SelectItem>
                      <SelectItem value="kitchen_sync">Kitchen Sync</SelectItem>
                      <SelectItem value="payment_check">Payment Verification</SelectItem>
                      <SelectItem value="http_request">Outbound Webhook / HTTP</SelectItem>
                      <SelectItem value="delay">Delay / Timer</SelectItem>
                      <SelectItem value="tag_contact">Tag Contact</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {subType === 'whatsapp_message' && (
                  <div className="space-y-2">
                    <Label htmlFor="message-template" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Message Template / Body
                    </Label>
                    <Textarea
                      id="message-template"
                      value={(draftData.messageTemplate as string) || ''}
                      onChange={(e) => handleFieldChange('messageTemplate', e.target.value)}
                      placeholder="Enter WhatsApp template name or message text..."
                      rows={3}
                      className="min-h-[72px] rounded-lg text-sm bg-background border-border resize-y"
                    />
                  </div>
                )}

                {subType === 'kitchen_sync' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="kitchen-status" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Kitchen Target Status
                      </Label>
                      <Select
                        value={(draftData.kitchenStatus as string) || 'preparing'}
                        onValueChange={(val) => {
                          if (val) handleFieldChange('kitchenStatus', val)
                        }}
                      >
                        <SelectTrigger id="kitchen-status" className="h-10 rounded-lg bg-background border-border text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending Acceptance</SelectItem>
                          <SelectItem value="preparing">Preparing</SelectItem>
                          <SelectItem value="ready">Ready for Pickup / Delivery</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="prep-time" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Estimated Prep Time (Minutes)
                      </Label>
                      <Input
                        id="prep-time"
                        type="number"
                        min={1}
                        max={180}
                        value={(draftData.prepTimeMinutes as number) || 20}
                        onChange={(e) => handleFieldChange('prepTimeMinutes', Number(e.target.value))}
                        className="h-10 rounded-lg text-sm bg-background border-border"
                      />
                    </div>
                  </div>
                )}

                {subType === 'http_request' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="http-method" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        HTTP Method
                      </Label>
                      <Select
                        value={(draftData.httpMethod as string) || 'POST'}
                        onValueChange={(val) => {
                          if (val) handleFieldChange('httpMethod', val)
                        }}
                      >
                        <SelectTrigger id="http-method" className="h-10 rounded-lg bg-background border-border text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GET">GET</SelectItem>
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="PUT">PUT</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="endpoint-url" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                        Endpoint URL
                      </Label>
                      <Input
                        id="endpoint-url"
                        value={(draftData.endpointUrl as string) || ''}
                        onChange={(e) => handleFieldChange('endpointUrl', e.target.value)}
                        placeholder="https://api.external.com/v1/webhook"
                        className="h-10 rounded-lg font-mono text-xs bg-background border-border"
                      />
                    </div>
                  </div>
                )}

                {subType === 'delay' && (
                  <div className="space-y-2">
                    <Label htmlFor="delay-minutes" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      Wait Duration (Minutes)
                    </Label>
                    <Input
                      id="delay-minutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={(draftData.delayMinutes as number) || 5}
                      onChange={(e) => handleFieldChange('delayMinutes', Number(e.target.value))}
                      className="h-10 rounded-lg text-sm bg-background border-border"
                    />
                  </div>
                )}
              </div>
            )}

            {/* CONDITION SPECIFIC CONFIG */}
            {node.type === 'condition' && (
              <div className="space-y-5 pt-2 border-t border-border/60">
                <div className="space-y-2">
                  <Label htmlFor="eval-field" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Evaluation Field
                  </Label>
                  <Input
                    id="eval-field"
                    value={(draftData.field as string) || 'order.subtotal'}
                    onChange={(e) => handleFieldChange('field', e.target.value)}
                    placeholder="e.g. order.subtotal or order.payment_method"
                    className="h-10 rounded-lg font-mono text-xs bg-background border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="eval-operator" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Operator
                  </Label>
                  <Select
                    value={(draftData.operator as string) || 'greater_than'}
                    onValueChange={(val) => {
                      if (val) handleFieldChange('operator', val)
                    }}
                  >
                    <SelectTrigger id="eval-operator" className="h-10 rounded-lg bg-background border-border text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Equals (==)</SelectItem>
                      <SelectItem value="not_equals">Not Equals (!=)</SelectItem>
                      <SelectItem value="greater_than">Greater Than (&gt;)</SelectItem>
                      <SelectItem value="less_than">Less Than (&lt;)</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="eval-value" className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Target Value
                  </Label>
                  <Input
                    id="eval-value"
                    value={(draftData.value as string) || '1000'}
                    onChange={(e) => handleFieldChange('value', e.target.value)}
                    placeholder="e.g. 1000 or upi"
                    className="h-10 rounded-lg text-sm bg-background border-border"
                  />
                </div>
              </div>
            )}

            {/* SECTION: DANGER ZONE (Separated at bottom of scrollable content) */}
            <div className="mt-8 pt-5 border-t border-destructive/20 rounded-lg p-4 bg-destructive/5 space-y-3">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">Danger Zone</span>
              </div>
              <p className="text-xs text-muted-foreground leading-normal">
                Permanently removes this node from the workflow canvas along with any connecting edges.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive flex items-center justify-center gap-1.5 h-10 rounded-lg font-medium"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete Node
              </Button>
            </div>
          </div>

          {/* SECTION 3: STICKY FOOTER (Fixed Bottom) */}
          <div className="shrink-0 sticky bottom-0 px-6 py-4 border-t bg-popover/95 backdrop-blur-xs flex items-center justify-end gap-3 z-10 shadow-sm">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={handleCancel}
              className="h-10 px-4 rounded-lg text-sm border-border hover:bg-muted font-medium"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isSaving}
              onClick={handleSaveDraft}
              className="h-10 px-5 rounded-lg text-sm flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-medium shadow-xs"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  <span>Save Draft</span>
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* CONFIRMATION MODAL: DELETE NODE */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="sm:max-w-md bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Node?
            </DialogTitle>
            <DialogDescription className="text-sm pt-2 text-muted-foreground leading-normal">
              Are you sure you want to delete <span className="font-semibold text-foreground">&quot;{label || node.id}&quot;</span>? This will permanently remove this node and all its incoming and outgoing connections from the workflow.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowDeleteConfirm(false)}
              className="h-10 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setShowDeleteConfirm(false)
                onDelete(node.id)
                onClose()
              }}
              className="h-10 rounded-lg flex items-center gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              Delete Node
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONFIRMATION MODAL: UNSAVED CHANGES */}
      <Dialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <DialogContent className="sm:max-w-md bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              Discard Unsaved Changes?
            </DialogTitle>
            <DialogDescription className="text-sm pt-2 text-muted-foreground leading-normal">
              You have unsaved changes in this node configuration. Discarding will lose any edits made since the last save.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowUnsavedDialog(false)}
              className="h-10 rounded-lg"
            >
              Keep Editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setShowUnsavedDialog(false)
                if (node) setDraftData({ ...(node.data || {}) })
                setIsDirty(false)
                onClose()
              }}
              className="h-10 rounded-lg"
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
