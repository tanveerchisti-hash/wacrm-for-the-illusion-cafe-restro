import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NodeConfigDrawer } from './node-config-drawer'
import type { BackendFlowNode } from '@/lib/backend-flows/types'

// Mock Sheet and Dialog to render synchronously in Vitest server-side environment
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? React.createElement('div', { 'data-slot': 'sheet' }, children) : null,
  SheetContent: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'sheet-content', className }, children),
  SheetHeader: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'sheet-header', className }, children),
  SheetTitle: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('h2', { 'data-slot': 'sheet-title', className }, children),
  SheetDescription: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('p', { 'data-slot': 'sheet-description', className }, children),
  SheetFooter: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'sheet-footer', className }, children),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? React.createElement('div', { 'data-slot': 'dialog' }, children) : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'dialog-content', className }, children),
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'dialog-header', className }, children),
  DialogTitle: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('h3', { 'data-slot': 'dialog-title', className }, children),
  DialogDescription: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('p', { 'data-slot': 'dialog-description', className }, children),
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'dialog-footer', className }, children),
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value }: { children: React.ReactNode; value?: string }) =>
    React.createElement('div', { 'data-slot': 'select', 'data-value': value }, children),
  SelectTrigger: ({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) =>
    React.createElement('button', { 'data-slot': 'select-trigger', id, className }, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement('span', { 'data-slot': 'select-value' }, placeholder),
  SelectContent: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement('div', { 'data-slot': 'select-content', className }, children),
  SelectItem: ({ children, value, className }: { children: React.ReactNode; value: string; className?: string }) =>
    React.createElement('div', { 'data-slot': 'select-item', 'data-value': value, className }, children),
}))

describe('NodeConfigDrawer UI/UX Component Tests', () => {
  const dummyTriggerNode: BackendFlowNode = {
    id: 'trigger-order-1',
    type: 'trigger',
    position: { x: 100, y: 150 },
    data: {
      label: 'Order Created Webhook',
      description: 'Triggered whenever customer confirms order cart',
      subType: 'order_event',
      event: 'order.created',
    },
  }

  const dummyActionNode: BackendFlowNode = {
    id: 'action-kitchen-1',
    type: 'action',
    position: { x: 200, y: 250 },
    data: {
      label: 'Send to Kitchen Screen',
      description: 'Dispatch items to KDS',
      subType: 'kitchen_sync',
      kitchenStatus: 'preparing',
      prepTimeMinutes: 25,
    },
  }

  const dummyConditionNode: BackendFlowNode = {
    id: 'condition-subtotal-1',
    type: 'condition',
    position: { x: 300, y: 350 },
    data: {
      label: 'Check High Value Order',
      description: 'Validate if total exceeds 1000',
      field: 'order.subtotal',
      operator: 'greater_than',
      value: '1000',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null when node is null', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: null,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )
    expect(markup).toBe('')
  })

  it('renders Configure TRIGGER Node header with correct badge, title and subtitle', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Configure TRIGGER Node')
    expect(markup).toContain('TRIGGER')
    expect(markup).toContain('Configure execution parameters, events, and data mappings')
  })

  it('renders General section with Node Label and Description inputs adhering to layout rules', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    // Header padding and layout
    expect(markup).toContain('px-6 py-5 border-b')
    // Node Label
    expect(markup).toContain('Node Label')
    expect(markup).toContain('Order Created Webhook')
    expect(markup).toContain('h-10 rounded-lg')
    // Description textarea min-height 72px
    expect(markup).toContain('Description / Note')
    expect(markup).toContain('min-h-[72px]')
    expect(markup).toContain('Triggered whenever customer confirms order cart')
  })

  it('renders Trigger specific options (order_event, event select, schedule)', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Trigger Subtype')
    expect(markup).toContain('Event Name')
    expect(markup).toContain('Order Created')
    expect(markup).toContain('Order Ready')
    expect(markup).toContain('Order Completed')
    expect(markup).toContain('order.ready')
    expect(markup).toContain('order.completed')
    expect(markup).toContain('Legacy: Kitchen Ready')
  })

  it('renders Order Ready canonical event value when selected', () => {
    const readyNode: BackendFlowNode = {
      ...dummyTriggerNode,
      data: {
        ...dummyTriggerNode.data,
        event: 'order.ready',
      },
    }
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: readyNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Event Name')
    expect(markup).toContain('data-value="order.ready"')
  })

  it('renders Order Completed canonical event value when selected', () => {
    const completedNode: BackendFlowNode = {
      ...dummyTriggerNode,
      data: {
        ...dummyTriggerNode.data,
        event: 'order.completed',
      },
    }
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: completedNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Event Name')
    expect(markup).toContain('data-value="order.completed"')
  })

  it('renders Sticky Footer with Cancel and Save Draft buttons', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    // Sticky footer layout with padding 24px/16px
    expect(markup).toContain('sticky bottom-0 px-6 py-4 border-t')
    expect(markup).toContain('Cancel')
    expect(markup).toContain('Save Draft')
  })

  it('renders Danger Zone with Delete Node action visually separated', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Danger Zone')
    expect(markup).toContain('Permanently removes this node')
    expect(markup).toContain('Delete Node')
  })

  it('renders Action node specific parameters when node type is action', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyActionNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Configure ACTION Node')
    expect(markup).toContain('Action Subtype')
    expect(markup).toContain('Kitchen Target Status')
    expect(markup).toContain('Estimated Prep Time (Minutes)')
  })

  it('renders Condition node specific parameters when node type is condition', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyConditionNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Configure CONDITION Node')
    expect(markup).toContain('Evaluation Field')
    expect(markup).toContain('order.subtotal')
    expect(markup).toContain('Operator')
    expect(markup).toContain('Target Value')
    expect(markup).toContain('1000')
  })

  it('shows saving spinner when saving prop is true', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        saving: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    expect(markup).toContain('Saving...')
    expect(markup).toContain('animate-spin')
  })

  it('renders delete confirmation dialog in closed state by default', () => {
    const markup = renderToStaticMarkup(
      React.createElement(NodeConfigDrawer, {
        node: dummyTriggerNode,
        open: true,
        onClose: vi.fn(),
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
      })
    )

    // Dialog is not open initially
    expect(markup).not.toContain('Delete Node?')
    expect(markup).not.toContain('Discard Unsaved Changes?')
  })
})
