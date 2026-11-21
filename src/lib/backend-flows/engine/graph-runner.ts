import type { BackendFlowDefinition, BackendFlowNode } from '../types'
import type { FlowExecutionState, StepExecutionResult } from './types'
import { executeActionNode, evaluateConditionNode } from './actions'

interface GraphRunnerOptions {
  runId: string
  flowId: string
  accountId: string
  versionNumber: number
  initialVariables: Record<string, unknown>
  maxRetries?: number
  timeoutMs?: number
  isDryRun?: boolean
}

/**
 * Traverses a backend flow definition DAG, executing action nodes and branching conditions.
 */
export async function executeFlowGraph(
  definition: BackendFlowDefinition,
  options: GraphRunnerOptions
): Promise<FlowExecutionState> {
  const startedAt = new Date().toISOString()
  const startTime = Date.now()
  const maxRetries = options.maxRetries ?? 3
  const timeoutMs = options.timeoutMs ?? 300000 // 5 minutes default

  const nodes = definition.nodes || []
  const edges = definition.edges || []

  const nodeMap = new Map<string, BackendFlowNode>()
  for (const n of nodes) {
    nodeMap.set(n.id, n)
  }

  // Find root triggers
  const triggerNodes = nodes.filter((n) => n.type === 'trigger')
  const startNodes = triggerNodes.length > 0 ? triggerNodes : [nodes[0]].filter(Boolean)

  const variables: Record<string, unknown> = { ...options.initialVariables }
  const stepRuns: StepExecutionResult[] = []

  // Queue of node IDs to visit
  const queue: string[] = startNodes.map((n) => n.id)
  const visited = new Set<string>()

  let overallStatus: FlowExecutionState['status'] = 'completed'
  let flowErrorMessage: string | undefined

  while (queue.length > 0) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      overallStatus = 'timed_out'
      flowErrorMessage = `Workflow execution exceeded timeout of ${timeoutMs}ms`
      break
    }

    const currentNodeId = queue.shift()!
    if (visited.has(currentNodeId)) {
      continue // Prevent infinite loops in cyclic graphs
    }
    visited.add(currentNodeId)

    const node = nodeMap.get(currentNodeId)
    if (!node) continue

    const stepStart = Date.now()
    const stepStartedAt = new Date().toISOString()
    const subType = (node.data?.subType as string) || undefined

    // 1. Trigger Node Execution (Pass-through)
    if (node.type === 'trigger') {
      stepRuns.push({
        nodeId: node.id,
        nodeType: 'trigger',
        subType,
        status: 'completed',
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStart,
        input: { ...variables },
        output: { triggered: true },
      })

      // Enqueue all direct children
      const nextEdges = edges.filter((e) => e.source === node.id)
      for (const edge of nextEdges) {
        if (!visited.has(edge.target)) {
          queue.push(edge.target)
        }
      }
      continue
    }

    // 2. Condition Node Execution (Branching)
    if (node.type === 'condition') {
      const conditionResult = evaluateConditionNode(node, variables)
      stepRuns.push({
        nodeId: node.id,
        nodeType: 'condition',
        subType: 'if_else',
        status: 'completed',
        startedAt: stepStartedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStart,
        input: { ...variables },
        output: { conditionResult, branchTaken: conditionResult ? 'true' : 'false' },
      })

      // Select edges matching the branch handle ('true' vs 'false')
      const targetHandle = conditionResult ? 'true' : 'false'
      const branchEdges = edges.filter(
        (e) => e.source === node.id && (e.sourceHandle === targetHandle || !e.sourceHandle)
      )

      for (const edge of branchEdges) {
        if (!visited.has(edge.target)) {
          queue.push(edge.target)
        }
      }
      continue
    }

    // 3. Action Node Execution (with Retry capability)
    if (node.type === 'action') {
      let attempts = 0
      let actionOutput = await executeActionNode(node, variables, { isDryRun: options.isDryRun })

      while (!actionOutput.success && attempts < maxRetries) {
        attempts++
        // Exponential backoff: 50ms, 100ms, 200ms
        await new Promise((resolve) => setTimeout(resolve, Math.min(50 * Math.pow(2, attempts), 500)))
        actionOutput = await executeActionNode(node, variables, { isDryRun: options.isDryRun })
      }

      const stepDuration = Date.now() - stepStart
      if (actionOutput.success) {
        // Merge output variables
        if (actionOutput.data) {
          variables[node.id] = actionOutput.data
          Object.assign(variables, actionOutput.data)
        }

        stepRuns.push({
          nodeId: node.id,
          nodeType: 'action',
          subType,
          status: 'completed',
          startedAt: stepStartedAt,
          completedAt: new Date().toISOString(),
          durationMs: stepDuration,
          input: { ...variables },
          output: actionOutput.data,
        })

        // Enqueue next nodes
        const nextEdges = edges.filter((e) => e.source === node.id)
        for (const edge of nextEdges) {
          if (!visited.has(edge.target)) {
            queue.push(edge.target)
          }
        }
      } else {
        // Action failed after max retries
        overallStatus = 'failed'
        flowErrorMessage = actionOutput.error || `Action node "${node.id}" failed.`

        stepRuns.push({
          nodeId: node.id,
          nodeType: 'action',
          subType,
          status: 'failed',
          startedAt: stepStartedAt,
          completedAt: new Date().toISOString(),
          durationMs: stepDuration,
          input: { ...variables },
          error: actionOutput.error,
        })

        // Stop traversal on failure
        break
      }
    }
  }

  const completedAt = new Date().toISOString()
  const totalDurationMs = Date.now() - startTime

  return {
    runId: options.runId,
    flowId: options.flowId,
    accountId: options.accountId,
    versionNumber: options.versionNumber,
    status: overallStatus,
    variables,
    stepRuns,
    errorMessage: flowErrorMessage,
    startedAt,
    completedAt,
    durationMs: totalDurationMs,
  }
}
