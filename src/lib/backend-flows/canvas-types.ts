export type NodeCategory = 'trigger' | 'action' | 'condition'

export type TriggerSubType =
  | 'order_event'
  | 'webhook'
  | 'schedule'
  | 'manual'
  | 'system_event'

export type ActionSubType =
  | 'whatsapp_message'
  | 'kitchen_sync'
  | 'payment_check'
  | 'http_request'
  | 'delay'
  | 'tag_contact'
  | 'restaurant_feedback_eligibility'
  | 'restaurant_feedback_revalidation'

export type ConditionSubType = 'if_else'

export interface TriggerNodeData extends Record<string, unknown> {
  label: string
  subType: TriggerSubType
  event?: string
  cronExpression?: string
  webhookPath?: string
  description?: string
}

export interface ActionNodeData extends Record<string, unknown> {
  label: string
  subType: ActionSubType
  messageTemplate?: string
  kitchenStatus?: string
  prepTimeMinutes?: number
  paymentCheckType?: string
  endpointUrl?: string
  httpMethod?: 'GET' | 'POST' | 'PUT'
  delayMinutes?: number
  tagName?: string
  description?: string
}

export interface ConditionNodeData extends Record<string, unknown> {
  label: string
  subType: ConditionSubType
  field: string
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains'
  value: string
  description?: string
}

export interface CanvasValidationIssue {
  type: 'error' | 'warning'
  nodeId?: string
  message: string
}

export interface CanvasValidationResult {
  valid: boolean
  errors: CanvasValidationIssue[]
  warnings: CanvasValidationIssue[]
}

export interface NodePaletteItem {
  type: 'trigger' | 'action' | 'condition'
  subType: string
  label: string
  description: string
  iconName: string
  defaultData: Record<string, unknown>
}
