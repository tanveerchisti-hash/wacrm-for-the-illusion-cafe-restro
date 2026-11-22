import type { BackendFlowTriggerType } from '../types'

export interface BackendFlowEvent {
  accountId: string
  type: BackendFlowTriggerType
  event?: string
  payload: Record<string, unknown>
  contactId?: string
  orderId?: string
  conversationId?: string
  eventId?: string
  idempotencyKey?: string
  isReplay?: boolean
}

export interface StepExecutionResult {
  nodeId: string
  nodeType: string
  subType?: string
  status: 'completed' | 'failed' | 'skipped'
  startedAt: string
  completedAt: string
  durationMs: number
  input: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
  reused?: boolean
}

export interface FlowExecutionState {
  runId: string
  flowId: string
  accountId: string
  versionNumber: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timed_out'
  variables: Record<string, unknown>
  stepRuns: StepExecutionResult[]
  errorMessage?: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  idempotencyKey?: string
  isDuplicate?: boolean
  originalRunId?: string
}
