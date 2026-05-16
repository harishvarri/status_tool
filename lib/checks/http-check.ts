import type { HttpCheckConfig, TestResult, MonitoringTest, Severity, BugCategory } from '../../types';
import { categorizeMessage } from './bug-categorizer';
import { createLogger } from '../playwright/helpers/logger';

export interface HttpCheckResult {
  result: Omit<TestResult, 'id' | 'created_at'>;
  errors: Array<{
    message: string;
    page_url: string;
    severity: Severity;
    category: BugCategory;
  }>;
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Execute an HTTP API check.
 * Validates: status code, response body substring, response time threshold.
 * Captures: full response time, HTTP status, response size, error category.
 */
export async function executeHttpCheck(
  projectId: string,
  test: MonitoringTest
): Promise<HttpCheckResult> {
  const log = createLogger(`http:${test.test_name}`);
  const config = test.http_config;

  if (!config) {
    return failedResult(projectId, test, 'HTTP check has no http_config', 'unknown', 'high');
  }

  const startTime = Date.now();
  const timeoutMs = config.max_response_time_ms ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  log.info(`Executing HTTP check`, {
    method: config.method,
    url: config.url,
    timeout: timeoutMs,
    expected_status: config.expected_status,
  });

  try {
    const init: RequestInit = {
      method: config.method,
      headers: config.headers,
      signal: controller.signal,
    };
    if (config.body && config.method !== 'GET' && config.method !== 'DELETE') {
      init.body = config.body;
    }

    const response = await fetch(config.url, init);
    clearTimeout(timer);

    const duration = Date.now() - startTime;
    const responseText = await response.text();
    const responseSize = new Blob([responseText]).size;

    log.info(`HTTP response`, {
      status: response.status,
      duration_ms: duration,
      size: responseSize,
    });

    // Validation
    const expectedStatus = config.expected_status ?? 200;
    if (response.status !== expectedStatus) {
      const message = `HTTP ${response.status} — expected ${expectedStatus} (${config.method} ${config.url})`;
      const { category, severity } = categorizeMessage(message, config.url, 'http');
      return {
        result: {
          test_id: test.id,
          project_id: projectId,
          feature_id: test.feature_id,
          status: 'failed',
          error_message: message,
          screenshot_url: null,
          duration_ms: duration,
          http_status_code: response.status,
          response_size_bytes: responseSize,
        },
        errors: [{ message, page_url: config.url, severity, category }],
      };
    }

    if (
      config.expected_body_contains &&
      !responseText.includes(config.expected_body_contains)
    ) {
      const message = `Response body missing expected text "${config.expected_body_contains}" (got ${responseText.slice(0, 100)}…)`;
      return {
        result: {
          test_id: test.id,
          project_id: projectId,
          feature_id: test.feature_id,
          status: 'failed',
          error_message: message,
          screenshot_url: null,
          duration_ms: duration,
          http_status_code: response.status,
          response_size_bytes: responseSize,
        },
        errors: [{ message, page_url: config.url, severity: 'medium', category: 'api' }],
      };
    }

    if (config.max_response_time_ms && duration > config.max_response_time_ms) {
      const message = `Response time ${duration}ms exceeded threshold ${config.max_response_time_ms}ms`;
      return {
        result: {
          test_id: test.id,
          project_id: projectId,
          feature_id: test.feature_id,
          status: 'failed',
          error_message: message,
          screenshot_url: null,
          duration_ms: duration,
          http_status_code: response.status,
          response_size_bytes: responseSize,
        },
        errors: [{ message, page_url: config.url, severity: 'medium', category: 'timeout' }],
      };
    }

    return {
      result: {
        test_id: test.id,
        project_id: projectId,
        feature_id: test.feature_id,
        status: 'passed',
        error_message: null,
        screenshot_url: null,
        duration_ms: duration,
        http_status_code: response.status,
        response_size_bytes: responseSize,
      },
      errors: [],
    };
  } catch (err) {
    clearTimeout(timer);
    const duration = Date.now() - startTime;
    const rawMsg = err instanceof Error ? err.message : String(err);
    const isAbort = controller.signal.aborted;
    const message = isAbort
      ? `Request timed out after ${timeoutMs}ms (${config.method} ${config.url})`
      : `Request failed: ${rawMsg} (${config.method} ${config.url})`;

    const { category, severity } = categorizeMessage(message, config.url, 'http');
    log.error(`HTTP check failed`, { message, duration });

    return {
      result: {
        test_id: test.id,
        project_id: projectId,
        feature_id: test.feature_id,
        status: 'failed',
        error_message: message,
        screenshot_url: null,
        duration_ms: duration,
        http_status_code: null,
        response_size_bytes: null,
      },
      errors: [{ message, page_url: config.url, severity, category }],
    };
  }
}

function failedResult(
  projectId: string,
  test: MonitoringTest,
  message: string,
  category: BugCategory,
  severity: Severity
): HttpCheckResult {
  return {
    result: {
      test_id: test.id,
      project_id: projectId,
      feature_id: test.feature_id,
      status: 'error',
      error_message: message,
      screenshot_url: null,
      duration_ms: 0,
      http_status_code: null,
      response_size_bytes: null,
    },
    errors: [{ message, page_url: '', severity, category }],
  };
}
