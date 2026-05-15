import { chromium } from '@playwright/test';
import { attachErrorCollectors, type CollectedError } from './error-collector';
import { captureAndStore } from './screenshot';
import { calculateHealthScore } from '@/lib/health-engine/calculator';
import type { MonitoringTest, TestStep, TestResult, Severity } from '@/types';
import type { HealthCalculationResult } from '@/lib/health-engine/types';

export interface RunnerOptions {
  projectId: string;
  projectUrl: string;
  tests: MonitoringTest[];
  timeout?: number;
}

export interface RunnerResult {
  projectId: string;
  results: Omit<TestResult, 'id' | 'created_at'>[];
  runtimeErrors: CollectedError[];
  health: HealthCalculationResult;
}

export async function runMonitoringCycle(options: RunnerOptions): Promise<RunnerResult> {
  const { projectId, projectUrl, tests, timeout = 30000 } = options;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const allErrors: CollectedError[] = [];
  const results: Omit<TestResult, 'id' | 'created_at'>[] = [];

  try {
    for (const test of tests) {
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

      try {
        for (const step of test.steps as TestStep[]) {
          await executeStep(page, step, timeout);
        }
      } catch (err: unknown) {
        testStatus = 'failed';
        errorMessage = err instanceof Error ? err.message : String(err);
        screenshotUrl = await captureAndStore(page, projectId);
      }

      const duration = Date.now() - startTime;

      // If critical JS errors collected, downgrade to failed
      const criticalErrors = testErrors.filter((e) => e.severity === 'critical');
      if (criticalErrors.length > 0 && testStatus === 'passed') {
        testStatus = 'failed';
        errorMessage = criticalErrors.map((e) => e.message).join('; ');
        if (!screenshotUrl) {
          screenshotUrl = await captureAndStore(page, projectId);
        }
      }

      results.push({
        test_id: test.id,
        project_id: projectId,
        status: testStatus,
        error_message: errorMessage,
        screenshot_url: screenshotUrl,
        duration_ms: duration,
      });

      allErrors.push(...testErrors);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // If no tests defined, navigate to the root URL and check for crashes
  if (tests.length === 0) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const pageErrors: CollectedError[] = [];
    attachErrorCollectors(page, pageErrors);
    try {
      await page.goto(projectUrl, { waitUntil: 'networkidle', timeout });
      results.push({
        test_id: 'default',
        project_id: projectId,
        status: pageErrors.filter((e) => e.severity === 'critical').length > 0 ? 'failed' : 'passed',
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
        screenshot_url: await captureAndStore(page, projectId),
        duration_ms: 0,
      });
    }
    allErrors.push(...pageErrors);
    await context.close();
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

async function executeStep(page: Parameters<typeof attachErrorCollectors>[0], step: TestStep, timeout: number): Promise<void> {
  switch (step.action) {
    case 'navigate':
      await page.goto(step.url!, { waitUntil: 'networkidle', timeout });
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
      // No-op — screenshots are taken automatically on failure
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
