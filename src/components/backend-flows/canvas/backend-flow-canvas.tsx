'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node as RfNode,
  type Edge as RfEdge,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { TriggerNode } from './nodes/trigger-node'
import { ActionNode } from './nodes/action-node'
import { ConditionNode } from './nodes/condition-node'
import { CanvasToolbar } from './canvas-toolbar'
import { NodeConfigDrawer } from './node-config-drawer'
import { validateCanvasDefinition } from '@/lib/backend-flows/canvas-validation'
import { autoLayout } from '@/lib/flows/layout'
import type {
  BackendFlowDefinition,
  BackendFlowNode,
} from '@/lib/backend-flows/types'
import type { CanvasValidationResult } from '@/lib/backend-flows/canvas-types'

const NODE_TYPES = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
}

interface BackendFlowCanvasProps {
  initialDefinition?: BackendFlowDefinition
  onChange: (definition: BackendFlowDefinition) => void
  onSave?: (definition: BackendFlowDefinition) => Promise<void>
  onValidationChange?: (result: CanvasValidationResult) => void
  onOpenSimulator?: () => void
  disabled?: boolean
}

function BackendFlowCanvasInner({
  initialDefinition,
  onChange,
  onSave,
  onValidationChange,
  onOpenSimulator,
  disabled,
}: BackendFlowCanvasProps) {
  const { fitView } = useReactFlow()

  // Convert initial BackendFlowNode[] / BackendFlowEdge[] to ReactFlow nodes/edges
  const [nodes, setNodes] = useState<RfNode[]>(() => {
    return (initialDefinition?.nodes || []).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position || { x: 0, y: 0 },
      data: n.data || {},
    }))
  })

  const [edges, setEdges] = useState<RfEdge[]>(() => {
    return (initialDefinition?.edges || []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || null,
      targetHandle: e.targetHandle || null,
      label: e.label,
      animated: true,
      type: 'smoothstep',
    }))
  })

  // Selected node for config drawer
  const [selectedNode, setSelectedNode] = useState<BackendFlowNode | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Validation state
  const validation = useMemo(() => {
    const def: BackendFlowDefinition = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type || 'action',
        position: n.position,
        data: (n.data as Record<string, unknown>) || {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: typeof e.label === 'string' ? e.label : undefined,
      })),
    }
    return validateCanvasDefinition(def)
  }, [nodes, edges])

  // Inform parent when validation changes
  useEffect(() => {
    onValidationChange?.(validation)
  }, [validation, onValidationChange])

  // Propagate definition up to parent
  const syncToParent = useCallback(
    (currentNodes: RfNode[], currentEdges: RfEdge[]) => {
      const def: BackendFlowDefinition = {
        nodes: currentNodes.map((n) => ({
          id: n.id,
          type: n.type || 'action',
          position: n.position,
          data: (n.data as Record<string, unknown>) || {},
        })),
        edges: currentEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null,
          label: typeof e.label === 'string' ? e.label : undefined,
        })),
      }
      onChange(def)
    },
    [onChange]
  )

  // Node Change Handler
  const onNodesChange = useCallback(
    (changes: NodeChange<RfNode>[]) => {
      if (disabled) return
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds)
        syncToParent(next, edges)
        return next
      })
    },
    [disabled, edges, syncToParent]
  )

  // Edge Change Handler
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RfEdge>[]) => {
      if (disabled) return
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds)
        syncToParent(nodes, next)
        return next
      })
    },
    [disabled, nodes, syncToParent]
  )

  // Edge Connection Handler
  const onConnect = useCallback(
    (connection: Connection) => {
      if (disabled) return
      setEdges((eds) => {
        const edgeId = `e-${connection.source}-${connection.sourceHandle || 'def'}-${connection.target}`
        const edgeLabel =
          connection.sourceHandle === 'true'
            ? 'True'
            : connection.sourceHandle === 'false'
            ? 'False'
            : undefined

        const newEdge: RfEdge = {
          id: edgeId,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle || null,
          targetHandle: connection.targetHandle || null,
          animated: true,
          type: 'smoothstep',
          label: edgeLabel,
        }
        const next = addEdge(newEdge, eds)
        syncToParent(nodes, next)
        return next
      })
    },
    [disabled, nodes, syncToParent]
  )

  // Node Click -> Open Drawer
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: RfNode) => {
      setSelectedNode({
        id: node.id,
        type: node.type || 'action',
        position: node.position,
        data: (node.data as Record<string, unknown>) || {},
      })
      setDrawerOpen(true)
    },
    []
  )

  // Add Node from Toolbar Palette
  const handleAddNode = useCallback(
    (type: 'trigger' | 'action' | 'condition', subType: string, label: string) => {
      if (disabled) return

      // Position new node slightly offset from existing or at center
      const offsetX = 50 + (nodes.length % 5) * 40
      const offsetY = 50 + (nodes.length % 5) * 50

      const newNodeId = `${type}-${subType}-${Date.now().toString(36)}`
      const newNode: RfNode = {
        id: newNodeId,
        type,
        position: { x: offsetX, y: offsetY },
        data: {
          label,
          subType,
          description: '',
          ...(type === 'trigger' ? { event: 'order.created' } : {}),
          ...(type === 'action' && subType === 'kitchen_sync'
            ? { kitchenStatus: 'preparing', prepTimeMinutes: 20 }
            : {}),
          ...(type === 'condition'
            ? { field: 'order.subtotal', operator: 'greater_than', value: '1000' }
            : {}),
        },
      }

      setNodes((prev) => {
        const next = [...prev, newNode]
        syncToParent(next, edges)
        return next
      })
    },
    [disabled, nodes, edges, syncToParent]
  )

  // Auto Layout using Dagre
  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) return

    const layoutNodes = nodes.map((n) => ({ id: n.id, width: 250, height: 110 }))
    const layoutEdges = edges.map((e) => ({ source: e.source, target: e.target }))

    const positions = autoLayout(layoutNodes, layoutEdges, {
      direction: 'TB',
      rankSep: 80,
      nodeSep: 60,
    })

    setNodes((prev) => {
      const next = prev.map((n) => {
        const pos = positions.get(n.id)
        return pos ? { ...n, position: { x: pos.x, y: pos.y } } : n
      })
      syncToParent(next, edges)
      return next
    })

    setTimeout(() => {
      fitView({ padding: 0.2, duration: 400 })
    }, 50)
  }, [nodes, edges, syncToParent, fitView])

  // Update Node from Drawer
  const handleNodeUpdate = useCallback(
    (updated: BackendFlowNode) => {
      setNodes((prev) => {
        const next = prev.map((n) =>
          n.id === updated.id ? { ...n, data: updated.data } : n
        )
        syncToParent(next, edges)
        return next
      })
      setSelectedNode(updated)
    },
    [edges, syncToParent]
  )

  // Save Node Draft from Drawer and persist to backend
  const handleNodeSave = useCallback(
    async (updated: BackendFlowNode) => {
      const nextNodes = nodes.map((n) =>
        n.id === updated.id ? { ...n, data: updated.data } : n
      )
      setNodes(nextNodes)
      setSelectedNode(updated)
      syncToParent(nextNodes, edges)

      if (onSave) {
        const nextDef: BackendFlowDefinition = {
          nodes: nextNodes.map((n) => ({
            id: n.id,
            type: n.type as 'trigger' | 'action' | 'condition',
            position: n.position,
            data: n.data,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: (e.label as string) || undefined,
          })),
        }
        await onSave(nextDef)
      }
    },
    [nodes, edges, syncToParent, onSave]
  )

  // Delete Node from Drawer or Canvas
  const handleNodeDelete = useCallback(
    (nodeId: string) => {
      setNodes((prevNodes) => {
        const nextNodes = prevNodes.filter((n) => n.id !== nodeId)
        setEdges((prevEdges) => {
          const nextEdges = prevEdges.filter(
            (e) => e.source !== nodeId && e.target !== nodeId
          )
          syncToParent(nextNodes, nextEdges)
          return nextEdges
        })
        return nextNodes
      })
      setSelectedNode(null)
      setDrawerOpen(false)
    },
    [syncToParent]
  )

  return (
    <div className="flex flex-col h-[650px] w-full rounded-md border bg-background overflow-hidden relative">
      {/* Canvas Top Toolbar */}
      <CanvasToolbar
        onAddNode={handleAddNode}
        onAutoLayout={handleAutoLayout}
        onOpenSimulator={onOpenSimulator}
        validation={validation}
        disabled={disabled}
      />

      {/* Main ReactFlow Canvas */}
      <div className="flex-1 w-full h-full relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          className="bg-muted/10"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls className="!bg-card !border-border !text-foreground" />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="!bg-card !border-border"
          />
        </ReactFlow>
      </div>

      {/* Node Config Drawer */}
      <NodeConfigDrawer
        node={selectedNode}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onUpdate={handleNodeUpdate}
        onSave={handleNodeSave}
        onDelete={handleNodeDelete}
      />
    </div>
  )
}

export function BackendFlowCanvas(props: BackendFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <BackendFlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
