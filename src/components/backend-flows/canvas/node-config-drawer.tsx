'use client'

import React from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
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
import { Trash2 } from 'lucide-react'
import type { BackendFlowNode } from '@/lib/backend-flows/types'

interface NodeConfigDrawerProps {
  node: BackendFlowNode | null
  open: boolean
  onClose: () => void
  onUpdate: (updatedNode: BackendFlowNode) => void
  onDelete: (nodeId: string) => void
}

export function NodeConfigDrawer({
  node,
  open,
  onClose,
  onUpdate,
  onDelete,
}: NodeConfigDrawerProps) {
  if (!node) return null

  const data = node.data || {}
  const label = (data.label as string) || ''
  const description = (data.description as string) || ''
  const subType = (data.subType as string) || ''

  const handleFieldChange = (key: string, value: unknown) => {
    onUpdate({
      ...node,
      data: {
        ...node.data,
        [key]: value,
      },
    })
  }

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent side="right" className="w-[360px] sm:w-[450px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base flex items-center gap-2">
            Configure {node.type.toUpperCase()} Node
          </SheetTitle>
          <SheetDescription className="text-xs">
            Edit node properties, labels, and execution parameters.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4 text-sm">
          {/* General Node Label */}
          <div className="space-y-1.5">
            <Label>Node Label</Label>
            <Input
              value={label}
              onChange={(e) => handleFieldChange('label', e.target.value)}
              placeholder="e.g. Send Kitchen Order Alert"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description / Note</Label>
            <Textarea
              value={description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder="Optional summary of what this step does..."
              rows={2}
            />
          </div>

          {/* Node-Specific Config */}
          {node.type === 'trigger' && (
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label>Trigger Subtype</Label>
                <Select
                  value={subType || 'order_event'}
                  onValueChange={(val) => {
                    if (val) handleFieldChange('subType', val)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="order_event">Order Event</SelectItem>
                    <SelectItem value="webhook">Inbound Webhook</SelectItem>
                    <SelectItem value="schedule">Scheduled Cron</SelectItem>
                    <SelectItem value="manual">Manual / API</SelectItem>
                    <SelectItem value="system_event">System Event</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {subType === 'order_event' && (
                <div className="space-y-1.5">
                  <Label>Event Name</Label>
                  <Select
                    value={(data.event as string) || 'order.created'}
                    onValueChange={(val) => {
                      if (val) handleFieldChange('event', val)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="order.created">Order Created</SelectItem>
                      <SelectItem value="order.confirmed">Order Confirmed</SelectItem>
                      <SelectItem value="order.cancelled">Order Cancelled</SelectItem>
                      <SelectItem value="order.kitchen_ready">Kitchen Ready</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {subType === 'schedule' && (
                <div className="space-y-1.5">
                  <Label>Cron Expression</Label>
                  <Input
                    value={(data.cronExpression as string) || '*/15 * * * *'}
                    onChange={(e) => handleFieldChange('cronExpression', e.target.value)}
                    placeholder="e.g. 0 9 * * 1-5"
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {node.type === 'action' && (
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label>Action Subtype</Label>
                <Select
                  value={subType || 'whatsapp_message'}
                  onValueChange={(val) => {
                    if (val) handleFieldChange('subType', val)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
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
                <div className="space-y-1.5">
                  <Label>Message Template / Body</Label>
                  <Textarea
                    value={(data.messageTemplate as string) || ''}
                    onChange={(e) => handleFieldChange('messageTemplate', e.target.value)}
                    placeholder="Message to deliver or template name..."
                    rows={3}
                  />
                </div>
              )}

              {subType === 'kitchen_sync' && (
                <>
                  <div className="space-y-1.5">
                    <Label>Kitchen Target Status</Label>
                    <Select
                      value={(data.kitchenStatus as string) || 'preparing'}
                      onValueChange={(val) => {
                        if (val) handleFieldChange('kitchenStatus', val)
                      }}
                    >
                      <SelectTrigger>
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
                  <div className="space-y-1.5">
                    <Label>Estimated Prep Time (Minutes)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={180}
                      value={(data.prepTimeMinutes as number) || 20}
                      onChange={(e) => handleFieldChange('prepTimeMinutes', Number(e.target.value))}
                    />
                  </div>
                </>
              )}

              {subType === 'http_request' && (
                <>
                  <div className="space-y-1.5">
                    <Label>HTTP Method</Label>
                    <Select
                      value={(data.httpMethod as string) || 'POST'}
                      onValueChange={(val) => {
                        if (val) handleFieldChange('httpMethod', val)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Endpoint URL</Label>
                    <Input
                      value={(data.endpointUrl as string) || ''}
                      onChange={(e) => handleFieldChange('endpointUrl', e.target.value)}
                      placeholder="https://api.external.com/v1/webhook"
                      className="font-mono text-xs"
                    />
                  </div>
                </>
              )}

              {subType === 'delay' && (
                <div className="space-y-1.5">
                  <Label>Wait Duration (Minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={(data.delayMinutes as number) || 5}
                    onChange={(e) => handleFieldChange('delayMinutes', Number(e.target.value))}
                  />
                </div>
              )}
            </div>
          )}

          {node.type === 'condition' && (
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1.5">
                <Label>Evaluation Field</Label>
                <Input
                  value={(data.field as string) || 'order.subtotal'}
                  onChange={(e) => handleFieldChange('field', e.target.value)}
                  placeholder="e.g. order.subtotal or order.payment_method"
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Operator</Label>
                <Select
                  value={(data.operator as string) || 'greater_than'}
                  onValueChange={(val) => {
                    if (val) handleFieldChange('operator', val)
                  }}
                >
                  <SelectTrigger>
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

              <div className="space-y-1.5">
                <Label>Target Value</Label>
                <Input
                  value={(data.value as string) || '1000'}
                  onChange={(e) => handleFieldChange('value', e.target.value)}
                  placeholder="e.g. 1000 or upi"
                />
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex flex-col gap-2 border-t pt-4">
          <Button
            variant="destructive"
            size="sm"
            className="w-full flex items-center justify-center gap-1.5"
            onClick={() => {
              onDelete(node.id)
              onClose()
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete Node
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
