export interface DiagnosticReport {
  category:
    | 'ssrf_security_block'
    | 'http_status_error'
    | 'timeout_error'
    | 'variable_missing'
    | 'network_error'
    | 'general_error'
  title: string
  explanation: string
  suggestion: string
  severity: 'error' | 'critical'
}

/**
 * Analyzes step execution errors to provide intelligent root-cause diagnosis and actionable guidance.
 */
export function analyzeStepError(
  errorMessage: string,
  nodeType: string,
  subType?: string
): DiagnosticReport {
  const msg = (errorMessage || '').toLowerCase()

  // 1. SSRF / Private IP Block
  if (msg.includes('blocked request') || msg.includes('non-routable') || msg.includes('private address')) {
    return {
      category: 'ssrf_security_block',
      title: 'Security Guard: SSRF Protection Triggered',
      explanation:
        'The outbound request was blocked because the target URL resolves to a loopback, RFC1918 private network, or cloud metadata IP address.',
      suggestion:
        'Configure a publicly routable HTTPS endpoint (e.g. your live domain or webhook proxy) instead of localhost / 127.0.0.1.',
      severity: 'critical',
    }
  }

  // 2. Timeout
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
    return {
      category: 'timeout_error',
      title: 'Execution Timeout',
      explanation:
        'The step did not complete within the allotted time limit or maximum retry threshold.',
      suggestion:
        'Increase the Execution Timeout in Workflow Configuration or inspect downstream API latency.',
      severity: 'error',
    }
  }

  // 3. HTTP Error
  if (msg.includes('http 4') || msg.includes('http 5') || msg.includes('status 4') || msg.includes('status 5')) {
    return {
      category: 'http_status_error',
      title: 'Remote HTTP Service Error',
      explanation:
        'The destination web server returned an error status code to the action request.',
      suggestion:
        'Check the endpoint URL and ensure the receiving server is ready to accept the JSON payload.',
      severity: 'error',
    }
  }

  // 4. Network / Connection Error
  if (msg.includes('econnrefused') || msg.includes('failed to fetch') || msg.includes('network')) {
    return {
      category: 'network_error',
      title: 'Network Connection Refused',
      explanation:
        'The connection to the target server could not be established.',
      suggestion:
        'Verify that the target service is online, DNS resolves correctly, and firewall allows incoming connections.',
      severity: 'error',
    }
  }

  // 5. Empty URL or Configuration
  if (msg.includes('empty') || msg.includes('required')) {
    return {
      category: 'variable_missing',
      title: 'Missing Required Node Parameter',
      explanation: `Action node configuration is incomplete for ${subType || nodeType}.`,
      suggestion: 'Open this node in the canvas editor and populate all required fields.',
      severity: 'error',
    }
  }

  return {
    category: 'general_error',
    title: 'Execution Error',
    explanation: errorMessage || 'An unexpected failure occurred while processing this node.',
    suggestion: 'Inspect the step input variables and check application server logs for trace details.',
    severity: 'error',
  }
}
