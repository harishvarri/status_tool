import { chromium, type Browser } from '@playwright/test';
import { attachErrorCollectors, type CollectedError } from './error-collector';
import { captureFullPage } from './helpers/screenshot';
import { createLogger } from './helpers/logger';
import { clearAuthCache } from './helpers/auth';
import { calculateHealthScore } from '../health-engine/calculator';
import { executeTest } from './test-executor';
import type { MonitoringTest, TestResult, Severity } from '../../types';
import type { HealthCalculationResult } from '../health-engine/types';

export interface RunnerOptions {
  projectId: string;
  projectUrl: string;
  tests: MonitoringTest[];
  /** Per-step timeout in ms */
  timeout?: number;
  /** Max concurrent tests */
  concurrency?: number;
  /** Per-test hard deadline in ms */
  testTimeout?: number;
}

export interface RunnerResult {
  projectId: string;
  results: Omit<TestResult, 'id' | 'created_at'>[];
  runtimeErrors: CollectedError[];
  health: HealthCalculationResult;
}

export async function runMonitoringCycle(options: RunnerOptions): Promise<RunnerResult> {
  const {
    projectId,
    projectUrl,
    tests,
    timeout = 15000,
    concurrency = 3, // lower default — auth caching means we don't need to parallelize as aggressively
    testTimeout = 90000,
  } = options;

  // Reset auth cache at the start of each cycle so cookies don't persist across cycles
  clearAuthCache();

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const allErrors: CollectedError[] = [];
  const results: Omit<TestResult, 'id' | 'created_at'>[] = [];

  try {
    if (tests.length === 0) {
      await pingProjectUrl(browser, projectId, projectUrl, timeout, results, allErrors);
    } else {
      // Sort: pure auth tests first, so their successful login caches storage state
      // for the feature tests that follow.
      const sorted = sortByAuthFirst(tests);

      // Run auth tests sequentially first (build storage state cache)
      const authTests = sorted.authTests;
      const featureTests = sorted.featureTests;

      for (const test of authTests) {
        const { result, errors } = await executeTest(browser, projectId, test, {
          stepTimeout: timeout,
          testTimeout,
        });
        results.push(result);
        allErrors.push(...errors);
      }

      // Run feature tests in parallel (they reuse cached storage state)
      const queue = [...featureTests];
      const workers: Promise<void>[] = [];
      const limit = Math.min(concurrency, featureTests.length || 1);

      for (let i = 0; i < limit; i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const test = queue.shift();
              if (!test) break;
              const { result, errors } = await executeTest(browser, projectId, test, {
                stepTimeout: timeout,
                testTimeout,
              });
              results.push(result);
              allErrors.push(...errors);
            }
          })()
        );
      }
      await Promise.all(workers);
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.status === 'passed').length;
  const errorSeverityCounts = aggregateErrorSeverities(allErrors);

  const health = calculateHealthScore({
    results: {
      total: results.length,
      passed,
      failed: results.filter((r) => r.status === 'failed').length,
      errors: results.filter((r) => r.status === 'error').length,
    },
    runtimeErrors: errorSeverityCounts,
  });

  return { projectId, results, runtimeErrors: allErrors, health };
}

/**
 * Split tests into pure auth tests (just login) and feature tests (login + features).
 * Pure auth tests run first sequentially to populate the auth storage state cache.
 */
function sortByAuthFirst(tests: MonitoringTest[]): {
  authTests: MonitoringTest[];
  featureTests: MonitoringTest[];
} {
  const authTests: MonitoringTest[] = [];
  const featureTests: MonitoringTest[] = [];

  for (const t of tests) {
    const name = t.test_name.toLowerCase();
    // Heuristic: test names containing "login" without other feature words are pure auth tests
    if (/^[\s\w]*\blogin\b[\s\w]*$/.test(name) && !name.includes('dashboard') && !name.includes('feature')) {
      authTests.push(t);
    } else {
      featureTests.push(t);
    }
  }

  return { authTests, featureTests };
}

async function pingProjectUrl(
  browser: Browser,
  projectId: string,
  projectUrl: string,
  timeout: number,
  results: Omit<TestResult, 'id' | 'created_at'>[],
  allErrors: CollectedError[]
): Promise<void> {
  const log = createLogger('ping');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const pageErrors: CollectedError[] = [];
  attachErrorCollectors(page, pageErrors);

  try {
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
    results.push({
      test_id: 'default',
      project_id: projectId,
      status: pageErrors.filter((e) => e.severity === 'critical').length > 0 ? 'failed' : 'passed',
      error_message: null,
      screenshot_url: null,
      duration_ms: 0,
    });
  } catch (err) {
    const capture = await captureFullPage(
      page,
      projectId,
      { testName: 'default-ping', failedStep: 'navigate-to-root', actualUrl: page.url() },
      log
    );
    results.push({
      test_id: 'default',
      project_id: projectId,
      status: 'failed',
      error_message: `Could not load application URL: ${err instanceof Error ? err.message : String(err)}`,
      screenshot_url: capture?.publicUrl ?? null,
      duration_ms: 0,
    });
  }
  allErrors.push(...pageErrors);
  await context.close().catch(() => {});
}

function aggregateErrorSeverities(errors: CollectedError[]) {
  const counts: Record<string, number> = {};
  for (const e of errors) {
    counts[e.severity] = (counts[e.severity] ?? 0) + 1;
  }
  return Object.entries(counts).map(([severity, count]) => ({
    severity: severity as Severity,
    count,
  }));
}
