import { chromium, type Browser, type Page } from '@playwright/test';
import { attachErrorCollectors, type CollectedError } from './error-collector';
import { captureAndStore } from './screenshot';
import { calculateHealthScore } from '../health-engine/calculator';
import type { MonitoringTest, TestStep, TestResult, Severity } from '../../types';
import type { HealthCalculationResult } from '../health-engine/types';

export interface RunnerOptions {
  projectId: string;
  projectUrl: string;
  tests: MonitoringTest[];
  /** Per-step timeout in ms (default 15s) */
  timeout?: number;
  /** Max tests running concurrently (default 4) */
  concurrency?: number;
  /** Hard cap on per-test wall-clock time (default 60s) */
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
    concurrency = 4,
    testTimeout = 60000,
  } = options;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const allErrors: CollectedError[] = [];
  const results: Omit<TestResult, 'id' | 'created_at'>[] = [];

  try {
    if (tests.length === 0) {
      // No tests defined — just ping the project URL
      await pingUrl(browser, projectId, projectUrl, timeout, results, allErrors);
    } else {
      // Worker pool: run up to `concurrency` tests in parallel
      const queue = [...tests];
      const workers: Promise<void>[] = [];
      const limit = Math.min(concurrency, tests.length);

      for (let i = 0; i < limit; i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const test = queue.shift();
              if (!test) break;
              const { result, errors } = await runSingleTest(
                browser,
                projectId,
                test,
                timeout,
                testTimeout
              );
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

async function runSingleTest(
  browser: Browser,
  projectId: string,
  test: MonitoringTest,
  stepTimeout: number,
  testTimeout: number
): Promise<{
  result: Omit<TestResult, 'id' | 'created_at'>;
  errors: CollectedError[];
}> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: false,
  });
  const page = await context.newPage();
  const testErrors: CollectedError[] = [];
  attachErrorCollectors(page, testErrors);

  const startTime = Date.now();
  let testStatus: 'passed' | 'failed' | 'error' = 'passed';
  let errorMessage: string | null = null;
  let screenshotUrl: string | null = null;

  // Wrap entire test execution in a hard deadline so a single hung test
  // can't block the worker pool indefinitely.
  const testDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Test exceeded ${testTimeout}ms`)), testTimeout)
  );

  try {
    await Promise.race([
      (async () => {
        for (const step of test.steps as TestStep[]) {
          await executeStep(page, step, stepTimeout);
        }
      })(),
      testDeadline,
    ]);
  } catch (err: unknown) {
    testStatus = 'failed';
    errorMessage = err instanceof Error ? err.message : String(err);
    try {
      screenshotUrl = await captureAndStore(page, projectId);
    } catch {
      // Screenshot capture failure shouldn't crash the test
    }
  }

  const duration = Date.now() - startTime;

  // Downgrade to failed if critical JS errors were collected
  const criticalErrors = testErrors.filter((e) => e.severity === 'critical');
  if (criticalErrors.length > 0 && testStatus === 'passed') {
    testStatus = 'failed';
    errorMessage = criticalErrors.map((e) => e.message).join('; ');
    if (!screenshotUrl) {
      try {
        screenshotUrl = await captureAndStore(page, projectId);
      } catch {}
    }
  }

  await context.close().catch(() => {});

  return {
    result: {
      test_id: test.id,
      project_id: projectId,
      status: testStatus,
      error_message: errorMessage,
      screenshot_url: screenshotUrl,
      duration_ms: duration,
    },
    errors: testErrors,
  };
}

async function pingUrl(
  browser: Browser,
  projectId: string,
  projectUrl: string,
  timeout: number,
  results: Omit<TestResult, 'id' | 'created_at'>[],
  allErrors: CollectedError[]
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const pageErrors: CollectedError[] = [];
  attachErrorCollectors(page, pageErrors);

  try {
    await page.goto(projectUrl, { waitUntil: 'networkidle', timeout });
    results.push({
      test_id: 'default',
      project_id: projectId,
      status:
        pageErrors.filter((e) => e.severity === 'critical').length > 0 ? 'failed' : 'passed',
      error_message: null,
      screenshot_url: null,
      duration_ms: 0,
    });
  } catch {
    results.push({
      test_id: 'default',
      project_id: projectId,
      status: 'failed',
      error_message: 'Could not load application URL',
      screenshot_url: await captureAndStore(page, projectId).catch(() => null),
      duration_ms: 0,
    });
  }
  allErrors.push(...pageErrors);
  await context.close().catch(() => {});
}

async function executeStep(page: Page, step: TestStep, timeout: number): Promise<void> {
  switch (step.action) {
    case 'navigate':
      await page.goto(step.url!, { waitUntil: 'domcontentloaded', timeout });
      break;
    case 'click':
      await page.click(step.selector!, { timeout });
      break;
    case 'fill':
      await page.fill(step.selector!, step.value!, { timeout });
      break;
    case 'wait':
      await page.waitForSelector(step.selector!, { timeout: step.timeout ?? timeout });
      break;
    case 'assert':
      await page.waitForSelector(step.selector!, { state: 'visible', timeout });
      break;
    case 'screenshot':
      break;
    default:
      break;
  }
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
