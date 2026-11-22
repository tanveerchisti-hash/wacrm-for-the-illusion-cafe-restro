import type { BackendFlowDefinition, BackendFlowNode } from '../types'
import type { FlowExecutionState, StepExecutionResult } from './types'
import { executeActionNode, evaluateConditionNode } from './actions'

export interface GraphRunnerOptions {
  runId: string
  flowId: string
  accountId: string
  versionNumber: number
  initialVariables: Record<string, unknown>
  maxRetries?: number
  timeoutMs?: number
  isDryRun?: boolean
  previousStepRuns?: StepExecutionResult[]
  idempotencyKey?: string
  resumeFromNodeIds?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
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

  // Find root triggers if starting fresh, or resume from provided frontier node IDs
  const triggerNodes = nodes.filter((n) => n.type === 'trigger')
  const startNodes = triggerNodes.length > 0 ? triggerNodes : [nodes[0]].filter(Boolean)

  const isResuming = Boolean(options.resumeFromNodeIds && options.resumeFromNodeIds.length > 0)

  const queue: string[] = isResuming
    ? [...options.resumeFromNodeIds!]
    : startNodes.map((n) => n.id)

  const variables: Record<string, unknown> = { ...options.initialVariables }

  // If resuming from a frontier, retain previously completed steps; otherwise start fresh to allow action-level reuse tracking
  const stepRuns: StepExecutionResult[] = isResuming && options.previousStepRuns
    ? [...options.previousStepRuns]
    : []

  const visited = new Set<string>()
  if (isResuming && options.previousStepRuns) {
    for (const step of options.previousStepRuns) {
      if (step.status === 'completed') {
        visited.add(step.nodeId)
      }
    }
    for (const resumeId of options.resumeFromNodeIds!) {
      visited.delete(resumeId)
    }
  }

  let overallStatus: FlowExecutionState['status'] = 'completed'
  let flowErrorMessage: string | undefined
  let waitingUntil: string | undefined
  let waitingNodeId: string | undefined
  let pendingNodeIds: string[] | undefined

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

    // 3. Action Node Execution (with Action-Level Idempotency & Retry capability)
    if (node.type === 'action') {
      // Action-level idempotency: Check if this node was already completed in a prior attempt
      const priorCompletedStep = options.previousStepRuns?.find(
        (s) => s.nodeId === node.id && s.status === 'completed'
      )

      if (priorCompletedStep) {
        // Reuse completed output without repeating side effects (e.g. duplicate WhatsApp message)
        if (priorCompletedStep.output) {
          variables[node.id] = priorCompletedStep.output
          Object.assign(variables, priorCompletedStep.output)
        }

        stepRuns.push({
          ...priorCompletedStep,
          reused: true,
          output: {
            ...priorCompletedStep.output,
            reused: true,
          },
        })

        // Enqueue next nodes
        const nextEdges = edges.filter((e) => e.source === node.id)
        for (const edge of nextEdges) {
          if (!visited.has(edge.target)) {
            queue.push(edge.target)
          }
        }
        continue
      }

      let attempts = 0
      const actionOpts = {
        isDryRun: options.isDryRun,
        accountId: options.accountId,
        supabase: options.supabase,
      }
      let actionOutput = await executeActionNode(node, variables, actionOpts)

      while (!actionOutput.success && attempts < maxRetries) {
        attempts++
        // Exponential backoff: 50ms, 100ms, 200ms
        await new Promise((resolve) => setTimeout(resolve, Math.min(50 * Math.pow(2, attempts), 500)))
        actionOutput = await executeActionNode(node, variables, actionOpts)
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

        // Production Durable Delay Handling:
        // In live execution, delay pauses traversal, persists the execution frontier, and returns 'waiting'.
        // In dry-run simulation mode (options.isDryRun), execution continues immediately across downstream nodes.
        if (subType === 'delay' && !options.isDryRun) {
          const nextEdges = edges.filter((e) => e.source === node.id)
          const frontierNodeIds: string[] = []
          for (const edge of nextEdges) {
            if (!visited.has(edge.target)) {
              frontierNodeIds.push(edge.target)
            }
          }

          overallStatus = 'waiting'
          waitingUntil = (actionOutput.data?.waitingUntil as string) || (actionOutput.data?.scheduledResumeAt as string)
          waitingNodeId = node.id
          pendingNodeIds = Array.from(new Set([...queue, ...frontierNodeIds]))
          break
        }

        // Enqueue next nodes (for non-delay actions, or for delay in dry-run simulation mode)
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

  const completedAt = overallStatus === 'waiting' ? undefined : new Date().toISOString()
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
    idempotencyKey: options.idempotencyKey,
    waitingUntil,
    waitingNodeId,
    pendingNodeIds,
  }
}
