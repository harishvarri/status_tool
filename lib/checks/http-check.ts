import type { HttpCheckConfig, TestResult, MonitoringTest, Severity, BugCategory } from '../../types';
import { categorizeMessage } from './bug-categorizer';
import { createLogger } from '../playwright/helpers/logger';
import {
  parseHealthEndpoint,
  snapshotToErrors,
  scoreFromSnapshot,
  type HealthEndpointSnapshot,
} from './health-endpoint-parser';

export interface HttpCheckResult {
  result: Omit<TestResult, 'id' | 'created_at'>;
  errors: Array<{
    message: string;
    page_url: string;
    severity: Severity;
    category: BugCategory;
  }>;
  /**
   * Only populated when the response is detected as a structured health endpoint.
   * Callers (run-monitor.ts) persist this to health_snapshots for dashboard drill-down.
   */
  healthSnapshot?: HealthEndpointSnapshot;
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Execute an HTTP check.
 *
 * Enhanced behaviour:
 *  1. Runs the standard validation (status code, body contains, response time).
 *  2. After a successful HTTP response, attempts to parse the body as a health
 *     endpoint.  If the shape matches, individual check failures (DB down, auth
 *     broken, etc.) are extracted as granular PersistableErrors with the right
 *     category + severity instead of a single opaque "body mismatch" error.
 *  3. Returns the HealthEndpointSnapshot so the caller can persist it for
 *     trend charts and dashboard drill-down.
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

  const startTime  = Date.now();
  const timeoutMs  = (config.max_response_time_ms ?? DEFAULT_TIMEOUT_MS) + 5000; // grace above threshold
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  log.info(`HTTP check`, {
    method:          config.method,
    url:             config.url,
    timeout:         timeoutMs,
    expected_status: config.expected_status,
  });

  try {
    const init: RequestInit = {
      method:  config.method,
      headers: config.headers,
      signal:  controller.signal,
    };
    if (config.body && config.method !== 'GET' && config.method !== 'DELETE') {
      init.body = config.body;
    }

    const response = await fetch(config.url, init);
    clearTimeout(timer);

    const duration      = Date.now() - startTime;
    const responseText  = await response.text();
    const responseSize  = new Blob([responseText]).size;

    log.info(`HTTP response`, { status: response.status, duration_ms: duration, size: responseSize });

    // ── Try to parse as health endpoint ────────────────────────────────────────
    // Do this before standard validations so we can surface granular check errors
    // even when the overall HTTP status is non-200.
    const snapshot = parseHealthEndpoint(responseText, duration);

    // ── Standard status-code validation ───────────────────────────────────────
    const expectedStatus = config.expected_status ?? 200;
    if (response.status !== expectedStatus) {
      // If this IS a health endpoint that returned 503, map check failures to errors
      if (snapshot.isHealthEndpoint) {
        const parsedErrors = snapshotToErrors(snapshot, projectId, config.url);
        const overallMsg   =
          `Health endpoint ${snapshot.overallStatus} (HTTP ${response.status}) — ` +
          `${snapshot.checksFailed} check(s) failing`;

        log.warn(overallMsg, { checksFailed: snapshot.checksFailed });

        return {
          result: {
            test_id:             test.id,
            project_id:          projectId,
            feature_id:          test.feature_id,
            status:              'failed',
            error_message:       overallMsg,
            screenshot_url:      null,
            duration_ms:         duration,
            http_status_code:    response.status,
            response_size_bytes: responseSize,
          },
          errors: parsedErrors.map((e) => ({
            message:  e.error_message,
            page_url: e.page_url,
            severity: e.severity,
            category: e.category,
          })),
          healthSnapshot: snapshot,
        };
      }

      // Non-health endpoint — generic error
      const message = `HTTP ${response.status} — expected ${expectedStatus} (${config.method} ${config.url})`;
      const { category, severity } = categorizeMessage(message, config.url, 'http');
      return {
        result: {
          test_id: test.id, project_id: projectId, feature_id: test.feature_id,
          status: 'failed', error_message: message, screenshot_url: null,
          duration_ms: duration, http_status_code: response.status, response_size_bytes: responseSize,
        },
        errors: [{ message, page_url: config.url, severity, category }],
      };
    }

    // ── Health endpoint: check passed at HTTP level → inspect JSON checks ─────
    if (snapshot.isHealthEndpoint) {
      const parsedErrors = snapshotToErrors(snapshot, projectId, config.url);
      const hasCritical  = parsedErrors.some((e) => e.severity === 'critical');
      const hasErrors    = parsedErrors.length > 0;

      const testPassed =
        snapshot.overallStatus === 'healthy' ||
        (snapshot.overallStatus === 'degraded' && !hasCritical);

      log.info(`Health endpoint parsed`, {
        overallStatus:  snapshot.overallStatus,
        checksTotal:    snapshot.checksTotal,
        checksFailed:   snapshot.checksFailed,
        checksWarning:  snapshot.checksWarning,
        score:          scoreFromSnapshot(snapshot),
      });

      return {
        result: {
          test_id: test.id,
          project_id: projectId,
          feature_id: test.feature_id,
          status: testPassed ? 'passed' : 'failed',
          error_message: testPassed
            ? null
            : `Health status: ${snapshot.overallStatus} — ${snapshot.checksFailed} check(s) failing` +
              (snapshot.service ? ` (${snapshot.service})` : ''),
          screenshot_url:      null,
          duration_ms:         duration,
          http_status_code:    response.status,
          response_size_bytes: responseSize,
        },
        errors: parsedErrors.map((e) => ({
          message:  e.error_message,
          page_url: e.page_url,
          severity: e.severity,
          category: e.category,
        })),
        healthSnapshot: snapshot,
      };
    }

    // ── Non-health endpoint: standard body + timing checks ────────────────────
    if (config.expected_body_contains && !responseText.includes(config.expected_body_contains)) {
      const message = `Response body missing "${config.expected_body_contains}" (got: ${responseText.slice(0, 100)}…)`;
      return {
        result: {
          test_id: test.id, project_id: projectId, feature_id: test.feature_id,
          status: 'failed', error_message: message, screenshot_url: null,
          duration_ms: duration, http_status_code: response.status, response_size_bytes: responseSize,
        },
        errors: [{ message, page_url: config.url, severity: 'medium', category: 'api' }],
      };
    }

    const threshold = config.max_response_time_ms;
    if (threshold && duration > threshold) {
      const message = `Response time ${duration}ms exceeded threshold ${threshold}ms`;
      return {
        result: {
          test_id: test.id, project_id: projectId, feature_id: test.feature_id,
          status: 'failed', error_message: message, screenshot_url: null,
          duration_ms: duration, http_status_code: response.status, response_size_bytes: responseSize,
        },
        errors: [{ message, page_url: config.url, severity: 'medium', category: 'timeout' }],
      };
    }

    // ── All validations passed ─────────────────────────────────────────────────
    return {
      result: {
        test_id: test.id, project_id: projectId, feature_id: test.feature_id,
        status: 'passed', error_message: null, screenshot_url: null,
        duration_ms: duration, http_status_code: response.status, response_size_bytes: responseSize,
      },
      errors: [],
    };

  } catch (err) {
    clearTimeout(timer);
    const duration   = Date.now() - startTime;
    const rawMsg     = err instanceof Error ? err.message : String(err);
    const isAbort    = controller.signal.aborted;
    const message    = isAbort
      ? `Request timed out after ${timeoutMs}ms (${config.method} ${config.url})`
      : `Request failed: ${rawMsg} (${config.method} ${config.url})`;

    const { category, severity } = categorizeMessage(message, config.url, 'http');
    log.error(`HTTP check failed`, { message, duration });

    return {
      result: {
        test_id: test.id, project_id: projectId, feature_id: test.feature_id,
        status: 'failed', error_message: message, screenshot_url: null,
        duration_ms: duration, http_status_code: null, response_size_bytes: null,
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
      test_id: test.id, project_id: projectId, feature_id: test.feature_id,
      status: 'error', error_message: message, screenshot_url: null,
      duration_ms: 0, http_status_code: null, response_size_bytes: null,
    },
    errors: [{ message, page_url: '', severity, category }],
  };
}
