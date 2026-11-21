import { describe, it, expect } from 'vitest'
import {
  canViewBackendFlows,
  canCreateBackendFlow,
  canEditBackendFlow,
  canExecuteBackendFlow,
  canPublishBackendFlow,
  canUnpublishBackendFlow,
  canDeleteBackendFlow,
} from './permissions'

describe('Backend Flows RBAC Permissions', () => {
  it('allows all roles including viewer to view backend flows', () => {
    expect(canViewBackendFlows('viewer')).toBe(true)
    expect(canViewBackendFlows('agent')).toBe(true)
    expect(canViewBackendFlows('admin')).toBe(true)
    expect(canViewBackendFlows('owner')).toBe(true)
  })

  it('restricts workflow creation and editing to agent and above', () => {
    expect(canCreateBackendFlow('viewer')).toBe(false)
    expect(canCreateBackendFlow('agent')).toBe(true)
    expect(canCreateBackendFlow('admin')).toBe(true)
    expect(canCreateBackendFlow('owner')).toBe(true)

    expect(canEditBackendFlow('viewer')).toBe(false)
    expect(canEditBackendFlow('agent')).toBe(true)
    expect(canEditBackendFlow('admin')).toBe(true)
    expect(canEditBackendFlow('owner')).toBe(true)

    expect(canExecuteBackendFlow('viewer')).toBe(false)
    expect(canExecuteBackendFlow('agent')).toBe(true)
    expect(canExecuteBackendFlow('admin')).toBe(true)
    expect(canExecuteBackendFlow('owner')).toBe(true)
  })

  it('restricts publishing, unpublishing and deletion to admin and owner', () => {
    expect(canPublishBackendFlow('viewer')).toBe(false)
    expect(canPublishBackendFlow('agent')).toBe(false)
    expect(canPublishBackendFlow('admin')).toBe(true)
    expect(canPublishBackendFlow('owner')).toBe(true)

    expect(canUnpublishBackendFlow('viewer')).toBe(false)
    expect(canUnpublishBackendFlow('agent')).toBe(false)
    expect(canUnpublishBackendFlow('admin')).toBe(true)
    expect(canUnpublishBackendFlow('owner')).toBe(true)

    expect(canDeleteBackendFlow('viewer')).toBe(false)
    expect(canDeleteBackendFlow('agent')).toBe(false)
    expect(canDeleteBackendFlow('admin')).toBe(true)
    expect(canDeleteBackendFlow('owner')).toBe(true)
  })
})
