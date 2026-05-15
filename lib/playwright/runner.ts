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
  /** Hard cap on per-test wall-clock time (default 90s) */
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
    testTimeout = 90000,
  } = options;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const allErrors: CollectedError[] = [];
  const results: Omit<TestResult, 'id' | 'created_at'>[] = [];

  try {
    if (tests.length === 0) {
      await pingUrl(browser, projectId, projectUrl, timeout, results, allErrors);
    } else {
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

function describeStep(step: TestStep): string {
  switch (step.action) {
    case 'navigate':
      return `navigate → ${step.url}`;
    case 'click':
      return `click "${step.selector}"`;
    case 'fill':
      return `fill "${step.selector}" with "${step.value}"`;
    case 'wait':
      return `wait for "${step.selector}"`;
    case 'assert':
      return `assert visible "${step.selector}"`;
    case 'screenshot':
      return 'screenshot';
    default:
      return JSON.stringify(step);
  }
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
  let failedStepIndex = -1;
  let failedStepDescription = '';
  let failureUrl = '';

  const testDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`__TEST_TIMEOUT__:${testTimeout}ms`)), testTimeout)
  );

  try {
    await Promise.race([
      (async () => {
        const steps = test.steps as TestStep[];
        for (let i = 0; i < steps.length; i++) {
          failedStepIndex = i; // tracked so we know which step failed
          failedStepDescription = describeStep(steps[i]);
          await executeStep(page, steps[i], stepTimeout);
        }
        failedStepIndex = -1; // all steps passed
      })(),
      testDeadline,
    ]);
  } catch (err: unknown) {
    testStatus = 'failed';
    failureUrl = page.url();
    const rawMsg = err instanceof Error ? err.message : String(err);

    // Take screenshot of the actual failure state with unique filename
    try {
      screenshotUrl = await captureAndStore(
        page,
        projectId,
        undefined,
        sanitizeForFilename(`${test.test_name}_step${failedStepIndex + 1}`)
      );
    } catch {
      // Screenshot failures should not crash the test
    }

    if (rawMsg.startsWith('__TEST_TIMEOUT__')) {
      errorMessage = `Test exceeded ${testTimeout}ms hard limit while on step ${failedStepIndex + 1}: ${failedStepDescription} | Page: ${failureUrl}`;
    } else {
      // Shorten Playwright's verbose error messages
      const cleanMsg = shortenPlaywrightError(rawMsg);
      errorMessage = `Step ${failedStepIndex + 1} (${failedStepDescription}) failed: ${cleanMsg} | Page: ${failureUrl}`;
    }
  }

  const duration = Date.now() - startTime;

  // Downgrade if critical JS errors collected during the test
  const criticalErrors = testErrors.filter((e) => e.severity === 'critical');
  if (criticalErrors.length > 0 && testStatus === 'passed') {
    testStatus = 'failed';
    errorMessage = `Critical JS errors detected: ${criticalErrors
      .slice(0, 3)
      .map((e) => e.message)
      .join('; ')}`;
    failureUrl = page.url();
    if (!screenshotUrl) {
      try {
        screenshotUrl = await captureAndStore(
          page,
          projectId,
          undefined,
          sanitizeForFilename(`${test.test_name}_jserror`)
        );
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

function shortenPlaywrightError(msg: string): string {
  // Playwright errors are very verbose — extract the essential part
  const firstLine = msg.split('\n')[0].trim();
  // Strip Playwright's "Call log:" tail
  const beforeCallLog = firstLine.split('Call log:')[0].trim();
  return beforeCallLog.slice(0, 200);
}

function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
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
    await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
    results.push({
      test_id: 'default',
      project_id: projectId,
      status:
        pageErrors.filter((e) => e.severity === 'critical').length > 0 ? 'failed' : 'passed',
      error_message: null,
      screenshot_url: null,
      duration_ms: 0,
    });
  } catch (err) {
    results.push({
      test_id: 'default',
      project_id: projectId,
      status: 'failed',
      error_message: `Could not load application URL: ${err instanceof Error ? err.message : String(err)}`,
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
