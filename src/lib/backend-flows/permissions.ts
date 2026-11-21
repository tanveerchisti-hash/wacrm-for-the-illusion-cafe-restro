import { hasMinRole, type AccountRole } from '@/lib/auth/roles'

/**
 * Role-Based Access Control (RBAC) capability predicates for Backend Flows.
 *
 * Rules:
 * - Viewers: Read-only access to workflow lists, versions and run logs.
 * - Agents: Can create drafts, edit drafts, test run workflows.
 * - Admins & Owners: Can publish, unpublish, archive and delete workflows.
 */

export function canViewBackendFlows(role: AccountRole): boolean {
  return hasMinRole(role, 'viewer')
}

export function canCreateBackendFlow(role: AccountRole): boolean {
  return hasMinRole(role, 'agent')
}

export function canEditBackendFlow(role: AccountRole): boolean {
  return hasMinRole(role, 'agent')
}

export function canExecuteBackendFlow(role: AccountRole): boolean {
  return hasMinRole(role, 'agent')
}

export function canPublishBackendFlow(role: AccountRole): boolean {
  return hasMinRole(role, 'admin')
}

export function canUnpublishBackendFlow(role: AccountRole): boolean {
  return hasMinRole(role, 'admin')
}

export function canDeleteBackendFlow(role: AccountRole): boolean {
  return hasMinRole(role, 'admin')
}
