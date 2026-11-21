import { describe, it, expect } from 'vitest'
import { analyzeStepError } from './diagnostics'

describe('Backend Flow Failed-Node Diagnostics', () => {
  it('correctly diagnoses SSRF protection blocks', () => {
    const err = 'Blocked request to non-routable or private address: http://127.0.0.1:3000'
    const report = analyzeStepError(err, 'action', 'http_request')

    expect(report.category).toBe('ssrf_security_block')
    expect(report.severity).toBe('critical')
    expect(report.suggestion).toContain('publicly routable')
  })

  it('correctly diagnoses timeout errors', () => {
    const err = 'Workflow execution exceeded timeout of 300000ms'
    const report = analyzeStepError(err, 'action', 'http_request')

    expect(report.category).toBe('timeout_error')
    expect(report.suggestion).toContain('Execution Timeout')
  })

  it('correctly diagnoses HTTP 404/500 errors', () => {
    const err = 'HTTP 404: Not Found'
    const report = analyzeStepError(err, 'action', 'http_request')

    expect(report.category).toBe('http_status_error')
    expect(report.title).toContain('HTTP')
  })

  it('correctly diagnoses missing configuration parameters', () => {
    const err = 'Endpoint URL is empty'
    const report = analyzeStepError(err, 'action', 'http_request')

    expect(report.category).toBe('variable_missing')
    expect(report.title).toContain('Missing Required')
  })
})
