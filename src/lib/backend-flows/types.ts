/**
 * Type definitions for the WACRM Backend Flows Module.
 *
 * Distinct from conversational WhatsApp chatbot flows (`src/lib/flows`),
 * Backend Flows orchestrate server-side business logic, order lifecycle events,
 * kitchen synchronization, and automated multi-step system pipelines.
 */

export type BackendFlowStatus = 'draft' | 'published' | 'archived'

export type BackendFlowCategory =
  | 'general'
  | 'order_processing'
  | 'kitchen_sync'
  | 'payment_reconciliation'
  | 'custom_integration'

export type BackendFlowTriggerType =
  | 'manual'
  | 'webhook'
  | 'schedule'
  | 'order_event'
  | 'system_event'

export interface BackendFlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface BackendFlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
}

export interface BackendFlowDefinition {
  nodes: BackendFlowNode[]
  edges: BackendFlowEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

export interface BackendFlowMetadata {
  timeout_seconds?: number
  max_retries?: number
  concurrency_limit?: number
  alert_on_failure?: boolean
  description_extended?: string
  tags?: string[]
  is_paused?: boolean
}

export interface BackendFlow {
  id: string
  account_id: string
  created_by: string | null
  name: string
  slug: string
  description: string | null
  category: BackendFlowCategory
  status: BackendFlowStatus
  current_version: number
  published_version: number | null
  published_at: string | null
  published_by: string | null
  trigger_type: BackendFlowTriggerType
  trigger_config: Record<string, unknown>
  definition: BackendFlowDefinition
  metadata: BackendFlowMetadata
  execution_count: number
  last_executed_at: string | null
  created_at: string
  updated_at: string
}

export interface BackendFlowVersion {
  id: string
  flow_id: string
  account_id: string
  version_number: number
  definition: BackendFlowDefinition
  trigger_config: Record<string, unknown>
  change_summary: string | null
  created_by: string | null
  created_at: string
}

export type BackendFlowRunStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'resuming'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

export interface BackendFlowRun {
  id: string
  flow_id: string
  account_id: string
  version_number: number
  triggered_by: string
  trigger_payload: Record<string, unknown>
  status: BackendFlowRunStatus
  state: Record<string, unknown>
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  created_at: string
  waiting_until?: string | null
  waiting_node_id?: string | null
  lease_expires_at?: string | null
}

export interface CreateBackendFlowInput {
  name: string
  slug?: string
  description?: string | null
  category?: BackendFlowCategory
  trigger_type?: BackendFlowTriggerType
  trigger_config?: Record<string, unknown>
  definition?: BackendFlowDefinition
  metadata?: BackendFlowMetadata
}

export interface UpdateBackendFlowInput {
  name?: string
  slug?: string
  description?: string | null
  category?: BackendFlowCategory
  trigger_type?: BackendFlowTriggerType
  trigger_config?: Record<string, unknown>
  definition?: BackendFlowDefinition
  metadata?: BackendFlowMetadata
}
