import type { BackendFlowNode, BackendFlowEdge, BackendFlowDefinition } from './types'
import type { CanvasValidationResult, CanvasValidationIssue } from './canvas-types'

/**
 * Validates a visual backend flow canvas definition for structural soundness.
 */
export function validateCanvasDefinition(definition: BackendFlowDefinition): CanvasValidationResult {
  const errors: CanvasValidationIssue[] = []
  const warnings: CanvasValidationIssue[] = []

  const nodes = definition.nodes || []
  const edges = definition.edges || []

  // Rule 1: Empty Canvas
  if (nodes.length === 0) {
    errors.push({
      type: 'error',
      message: 'Workflow canvas is empty. Add at least one trigger node.',
    })
    return { valid: false, errors, warnings }
  }

  // Rule 2: Trigger Node Existence
  const triggerNodes = nodes.filter((n) => n.type === 'trigger')
  if (triggerNodes.length === 0) {
    errors.push({
      type: 'error',
      message: 'Workflow requires at least one trigger node to initiate execution.',
    })
  } else if (triggerNodes.length > 1) {
    warnings.push({
      type: 'warning',
      message: `Multiple triggers (${triggerNodes.length}) configured. Execution will begin on any matching trigger.`,
    })
  }

  // Index node IDs for fast existence checks
  const nodeMap = new Map<string, BackendFlowNode>()
  for (const n of nodes) {
    nodeMap.set(n.id, n)
  }

  // Rule 3: Valid Edges and References
  const validEdges: BackendFlowEdge[] = []
  for (const edge of edges) {
    if (!nodeMap.has(edge.source)) {
      errors.push({
        type: 'error',
        message: `Edge ${edge.id} references invalid source node "${edge.source}".`,
      })
      continue
    }
    if (!nodeMap.has(edge.target)) {
      errors.push({
        type: 'error',
        message: `Edge ${edge.id} references invalid target node "${edge.target}".`,
      })
      continue
    }
    validEdges.push(edge)
  }

  // Map connectivity for nodes
  const incomingCount = new Map<string, number>()
  const outgoingCount = new Map<string, number>()
  const conditionBranches = new Map<string, Set<string>>()

  for (const n of nodes) {
    incomingCount.set(n.id, 0)
    outgoingCount.set(n.id, 0)
    if (n.type === 'condition') {
      conditionBranches.set(n.id, new Set<string>())
    }
  }

  for (const edge of validEdges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) || 0) + 1)
    outgoingCount.set(edge.source, (outgoingCount.get(edge.source) || 0) + 1)

    if (conditionBranches.has(edge.source) && edge.sourceHandle) {
      conditionBranches.get(edge.source)!.add(edge.sourceHandle)
    }
  }

  // Rule 4: Isolated / Disconnected Nodes (when canvas has multiple nodes)
  if (nodes.length > 1) {
    for (const node of nodes) {
      const incoming = incomingCount.get(node.id) || 0
      const outgoing = outgoingCount.get(node.id) || 0
      const label = (node.data?.label as string) || node.id

      if (node.type === 'trigger') {
        if (outgoing === 0) {
          warnings.push({
            type: 'warning',
            nodeId: node.id,
            message: `Trigger node "${label}" is not connected to any subsequent action.`,
          })
        }
      } else {
        if (incoming === 0 && outgoing === 0) {
          warnings.push({
            type: 'warning',
            nodeId: node.id,
            message: `Node "${label}" is completely disconnected.`,
          })
        } else if (incoming === 0) {
          warnings.push({
            type: 'warning',
            nodeId: node.id,
            message: `Node "${label}" has no incoming connection and will not execute.`,
          })
        }
      }
    }
  }

  // Rule 5: Condition Nodes Branch Completeness
  for (const [nodeId, branches] of conditionBranches.entries()) {
    const node = nodeMap.get(nodeId)
    const label = (node?.data?.label as string) || nodeId
    const hasTrue = branches.has('true')
    const hasFalse = branches.has('false')

    if (!hasTrue && !hasFalse) {
      warnings.push({
        type: 'warning',
        nodeId,
        message: `Condition node "${label}" has no branches connected (neither True nor False).`,
      })
    } else if (!hasTrue) {
      warnings.push({
        type: 'warning',
        nodeId,
        message: `Condition node "${label}" is missing a "True" branch connection.`,
      })
    } else if (!hasFalse) {
      warnings.push({
        type: 'warning',
        nodeId,
        message: `Condition node "${label}" is missing a "False" branch connection.`,
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
