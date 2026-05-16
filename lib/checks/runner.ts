import { chromium, type Browser } from '@playwright/test';
import { clearAuthCache } from '../playwright/helpers/auth';
import { createLogger } from '../playwright/helpers/logger';
import { calculateHealthScore } from '../health-engine/calculator';
import { aggregateFeatureHealth } from '../health-engine/feature-aggregator';
import { executeBrowserCheck } from './browser-check';
import { executeHttpCheck } from './http-check';
import type {
  MonitoringTest,
  TestResult,
  Severity,
  BugCategory,
  Feature,
  ProjectStatus,
} from '../../types';

export interface CheckRunnerOptions {
  projectId: string;
  projectUrl: string;
  features: Feature[];
  tests: MonitoringTest[];
  timeout?: number;
  concurrency?: number;
  testTimeout?: number;
}

export interface PersistableError {
  project_id: string;
  feature_id: string | null;
  error_message: string;
  page_url: string;
  functionality: string;
  severity: Severity;
  category: BugCategory;
  screenshot_url?: string | null;
}

export interface CheckRunnerResult {
  projectId: string;
  results: Omit<TestResult, 'id' | 'created_at'>[];
  errors: PersistableError[];
  /** Per-feature health calculations */
  featureHealth: Array<{
    feature_id: string;
    health_score: number;
    status: ProjectStatus;
    checks_run: number;
    checks_passed: number;
  }>;
  /** Aggregate project health (weighted across features) */
  projectHealth: {
    health_score: number;
    status: ProjectStatus;
  };
}

/**
 * Unified check runner — handles both browser and HTTP checks.
 *
 * Flow:
 *   1. Reset auth cache (cookies must not persist across cycles)
 *   2. Group tests by feature
 *   3. Within each feature: run auth tests first, then features in parallel
 *   4. For each test: dispatch to browser or HTTP executor by check_type
 *   5. After all checks: compute per-feature health, then aggregate to project
 */
export async function runChecks(opts: CheckRunnerOptions): Promise<CheckRunnerResult> {
  const {
    projectId,
    projectUrl,
    features,
    tests,
    timeout = 15000,
    concurrency = 3,
    testTimeout = 90000,
  } = opts;

  const log = createLogger(`runner:${projectId}`);
  clearAuthCache();

  const results: Omit<TestResult, 'id' | 'created_at'>[] = [];
  const errors: PersistableError[] = [];

  // Split: browser tests need a shared browser instance; HTTP tests are pure fetch
  const browserTests = tests.filter((t) => t.check_type === 'browser');
  const httpTests = tests.filter((t) => t.check_type === 'http');

  log.info(`Starting cycle`, {
    features: features.length,
    browserTests: browserTests.length,
    httpTests: httpTests.length,
  });

  // ─── HTTP checks (parallel, no browser needed) ───────────────
  if (httpTests.length > 0) {
    const httpResults = await runWithConcurrency(
      httpTests,
      concurrency * 2, // HTTP checks can fan out more
      async (test) => executeHttpCheck(projectId, test)
    );
    for (const r of httpResults) {
      results.push(r.result);
      for (const e of r.errors) {
        errors.push({
          project_id: projectId,
          feature_id: r.result.feature_id,
          error_message: e.message,
          page_url: e.page_url,
          functionality: 'http-check',
          severity: e.severity,
          category: e.category,
        });
      }
    }
  }

  // ─── Browser checks (need launched Chromium) ────────────────
  if (browserTests.length > 0) {
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      // Run auth tests first (populates storage state cache), then features in parallel
      const { authTests, featureTests } = splitAuthFromFeature(browserTests);

      for (const test of authTests) {
        const r = await executeBrowserCheck(browser, projectId, test, {
          stepTimeout: timeout,
          testTimeout,
        });
        results.push(r.result);
        appendBrowserErrors(errors, r.errors, projectId, r.result.feature_id);
      }

      const featureResults = await runWithConcurrency(
        featureTests,
        concurrency,
        async (test) =>
          executeBrowserCheck(browser, projectId, test, {
            stepTimeout: timeout,
            testTimeout,
          })
      );
      for (const r of featureResults) {
        results.push(r.result);
        appendBrowserErrors(errors, r.errors, projectId, r.result.feature_id);
      }

      // If there are no tests at all (only HTTP, or none), ping the URL
      if (tests.length === 0) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
        });
        const page = await context.newPage();
        try {
          await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
          results.push(syntheticPingResult(projectId, 'passed'));
        } catch (err) {
          results.push(syntheticPingResult(projectId, 'failed', String(err)));
        } finally {
          await context.close().catch(() => {});
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  // ─── Health rollup ───────────────────────────────────────────
  const featureHealth = aggregateFeatureHealth(features, results, errors);
  const projectHealth = calculateProjectHealth(featureHealth, features);

  log.info(`Cycle complete`, {
    totalResults: results.length,
    totalErrors: errors.length,
    projectScore: projectHealth.health_score,
    projectStatus: projectHealth.status,
  });

  return { projectId, results, errors, featureHealth, projectHealth };
}

function splitAuthFromFeature(tests: MonitoringTest[]): {
  authTests: MonitoringTest[];
  featureTests: MonitoringTest[];
} {
  const authTests: MonitoringTest[] = [];
  const featureTests: MonitoringTest[] = [];
  for (const t of tests) {
    const name = t.test_name.toLowerCase();
    if (
      /^[\s\w]*\blogin\b[\s\w]*$/.test(name) &&
      !name.includes('dashboard') &&
      !name.includes('feature')
    ) {
      authTests.push(t);
    } else {
      featureTests.push(t);
    }
  }
  return { authTests, featureTests };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const queue = [...items];
  const results: R[] = [];
  const workers: Promise<void>[] = [];
  const limit = Math.min(concurrency, items.length || 1);

  for (let i = 0; i < limit; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (item === undefined) break;
          results.push(await fn(item));
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

function appendBrowserErrors(
  out: PersistableError[],
  errors: Array<{ message: string; page_url: string; severity: Severity; category: BugCategory }>,
  projectId: string,
  featureId: string | null
): void {
  for (const e of errors) {
    out.push({
      project_id: projectId,
      feature_id: featureId,
      error_message: e.message,
      page_url: e.page_url,
      functionality: 'browser-check',
      severity: e.severity,
      category: e.category,
    });
  }
}

function syntheticPingResult(
  projectId: string,
  status: 'passed' | 'failed',
  msg?: string
): Omit<TestResult, 'id' | 'created_at'> {
  return {
    test_id: 'default',
    project_id: projectId,
    feature_id: null,
    status,
    error_message: msg ?? null,
    screenshot_url: null,
    duration_ms: 0,
    http_status_code: null,
    response_size_bytes: null,
  };
}

function calculateProjectHealth(
  featureHealth: CheckRunnerResult['featureHealth'],
  features: Feature[]
): { health_score: number; status: ProjectStatus } {
  if (featureHealth.length === 0) {
    // No features = use a flat score from all results (legacy mode)
    return { health_score: 0, status: 'unknown' };
  }

  // Build weight map
  const weightMap = new Map(features.map((f) => [f.id, f.weight]));
  let weightedSum = 0;
  let totalWeight = 0;

  for (const fh of featureHealth) {
    const weight = weightMap.get(fh.feature_id) ?? 1;
    weightedSum += fh.health_score * weight;
    totalWeight += weight;
  }

  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  const status: ProjectStatus =
    score >= 90 ? 'healthy' : score >= 70 ? 'warning' : score > 0 ? 'critical' : 'unknown';

  return { health_score: score, status };
}

// Re-export for callers that just want the legacy calculateHealthScore
export { calculateHealthScore };
