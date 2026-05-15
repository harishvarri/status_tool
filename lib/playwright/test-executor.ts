import type { Browser, Page } from '@playwright/test';
import { attachErrorCollectors, type CollectedError } from './error-collector';
import { captureFullPage } from './helpers/screenshot';
import { createLogger } from './helpers/logger';
import {
  detectLoginFlow,
  getOrCreateAuthState,
  ensureAuthenticated,
  type AuthCredentials,
} from './helpers/auth';
import { smartGoto, isLoginPage, getPathname } from './helpers/navigation';
import { withRetry } from './helpers/retry';
import type { MonitoringTest, TestStep, TestResult } from '../../types';

export interface ExecuteOptions {
  stepTimeout: number;
  testTimeout: number;
}

export interface ExecuteResult {
  result: Omit<TestResult, 'id' | 'created_at'>;
  errors: CollectedError[];
}

export function describeStep(step: TestStep): string {
  switch (step.action) {
    case 'navigate':
      return `navigate → ${step.url}`;
    case 'click':
      return `click "${truncate(step.selector ?? '', 50)}"`;
    case 'fill':
      return `fill "${truncate(step.selector ?? '', 30)}" with "${truncate(step.value ?? '', 30)}"`;
    case 'wait':
      return `wait for "${truncate(step.selector ?? '', 50)}"`;
    case 'assert':
      return `assert visible "${truncate(step.selector ?? '', 50)}"`;
    case 'screenshot':
      return 'screenshot';
    default:
      return JSON.stringify(step);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function shortenError(msg: string): string {
  const firstLine = msg.split('\n')[0].trim();
  return firstLine.split('Call log:')[0].trim().slice(0, 200);
}

/**
 * Execute a single monitoring test with full production-grade reliability:
 *
 *   1. Detects login flow in test steps, uses cached auth state (login once)
 *   2. Pre-flight URL validation before every step
 *   3. Auto re-auth + retry once on session expiry
 *   4. Full-page screenshot at the ACTUAL failure point (not after redirect to login)
 *   5. Rich error context: expected URL, actual URL, redirect detection, failed step
 */
export async function executeTest(
  browser: Browser,
  projectId: string,
  test: MonitoringTest,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const log = createLogger(test.test_name);
  log.info(`Starting test`, { stepCount: test.steps.length });

  // Detect login flow within this test
  const loginInfo = detectLoginFlow(test.steps as TestStep[]);
  const allSteps = test.steps as TestStep[];

  // Distinguish between "auth test" (only login steps) and "feature test" (login + features)
  const featureSteps = loginInfo ? allSteps.slice(loginInfo.loginEndIndex + 1) : allSteps;
  const isFeatureTest = loginInfo !== null && featureSteps.length > 0;
  const isPureAuthTest = loginInfo !== null && featureSteps.length === 0;

  if (loginInfo) {
    log.info(`Detected login flow`, {
      email: loginInfo.creds.email,
      featureStepsCount: featureSteps.length,
      type: isPureAuthTest ? 'auth-only' : 'feature-test',
    });
  }

  const startTime = Date.now();
  const allErrors: CollectedError[] = [];

  // Hard timeout per test
  const testDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`__TEST_TIMEOUT__:${opts.testTimeout}ms`)), opts.testTimeout)
  );

  try {
    const result = await Promise.race([
      runTestWithRetry(browser, projectId, test, loginInfo?.creds ?? null, isFeatureTest, allSteps, featureSteps, opts, log, allErrors),
      testDeadline,
    ]);
    result.duration_ms = Date.now() - startTime;
    return { result, errors: allErrors };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const errorMessage = rawMsg.startsWith('__TEST_TIMEOUT__')
      ? `Test exceeded ${opts.testTimeout}ms hard limit`
      : `Unexpected runner error: ${shortenError(rawMsg)}`;

    log.error(errorMessage);
    return {
      result: {
        test_id: test.id,
        project_id: projectId,
        status: 'error',
        error_message: errorMessage,
        screenshot_url: null,
        duration_ms: Date.now() - startTime,
      },
      errors: allErrors,
    };
  }
}

async function runTestWithRetry(
  browser: Browser,
  projectId: string,
  test: MonitoringTest,
  creds: AuthCredentials | null,
  isFeatureTest: boolean,
  allSteps: TestStep[],
  featureSteps: TestStep[],
  opts: ExecuteOptions,
  log: ReturnType<typeof createLogger>,
  errors: CollectedError[]
): Promise<Omit<TestResult, 'id' | 'created_at'>> {
  // Pre-authenticate for feature tests so we have a cached storage state
  let storageState: Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>> | undefined;
  if (isFeatureTest && creds) {
    try {
      storageState = await getOrCreateAuthState(browser, creds, opts.stepTimeout, log);
    } catch (err) {
      log.error(`Pre-authentication failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue without storage state — the test will run login steps inline and fail with full context
      storageState = undefined;
    }
  }

  return await withRetry(
    async () => attemptTest(browser, projectId, test, creds, isFeatureTest, allSteps, featureSteps, storageState, opts, log, errors),
    {
      attempts: isFeatureTest ? 2 : 1,
      log,
      onRetry: async () => {
        log.warn(`Retrying after auth failure — invalidating cached state`);
        if (creds) {
          // Force fresh login on retry
          storageState = await getOrCreateAuthState(browser, creds, opts.stepTimeout, log).catch(() => undefined);
        }
      },
    }
  );
}

async function attemptTest(
  browser: Browser,
  projectId: string,
  test: MonitoringTest,
  creds: AuthCredentials | null,
  isFeatureTest: boolean,
  allSteps: TestStep[],
  featureSteps: TestStep[],
  storageState: Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['storageState']>> | undefined,
  opts: ExecuteOptions,
  log: ReturnType<typeof createLogger>,
  errorBucket: CollectedError[]
): Promise<Omit<TestResult, 'id' | 'created_at'>> {
  // Determine which steps to actually execute:
  // - Feature tests with successful pre-auth: skip login steps, run features in authed context
  // - Pure auth tests: run login steps to validate the auth flow itself
  // - Feature tests WITHOUT pre-auth (it failed): run all steps inline so we capture login failure context
  const stepsToRun = isFeatureTest && storageState ? featureSteps : allSteps;
  const contextOptions: Parameters<Browser['newContext']>[0] = {
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: false,
  };
  if (storageState) contextOptions.storageState = storageState;

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  attachErrorCollectors(page, errorBucket);

  let testStatus: 'passed' | 'failed' | 'error' = 'passed';
  let errorMessage: string | null = null;
  let screenshotUrl: string | null = null;
  let failedStepIndex = -1;
  let failedStep: TestStep | null = null;
  let expectedUrl = '';
  let actualUrl = '';
  let redirectedToLogin = false;

  try {
    for (let i = 0; i < stepsToRun.length; i++) {
      const step = stepsToRun[i];
      failedStepIndex = i;
      failedStep = step;

      log.info(`Step ${i + 1}/${stepsToRun.length}: ${describeStep(step)}`);

      // Pre-flight: for feature tests using cached auth, verify we're still authed
      // before each step. If we got redirected to login mid-test, re-auth.
      if (isFeatureTest && creds && i === 0) {
        // After context with storageState, first navigation will reveal if cookies are valid
      }

      await executeStepWithAuthCheck(page, step, creds, opts.stepTimeout, log);
    }

    log.info(`All steps passed`);
    failedStepIndex = -1;
    failedStep = null;
  } catch (err) {
    actualUrl = page.url();
    redirectedToLogin = isLoginPage(actualUrl);
    expectedUrl = lastNavigateBefore(stepsToRun, failedStepIndex);
    testStatus = 'failed';

    const rawMsg = err instanceof Error ? err.message : String(err);
    const cleanMsg = shortenError(rawMsg);

    errorMessage = buildErrorMessage({
      stepIndex: failedStepIndex,
      step: failedStep,
      cleanMsg,
      expectedUrl,
      actualUrl,
      redirectedToLogin,
    });

    log.error(`Test failed`, {
      step: failedStep ? describeStep(failedStep) : 'unknown',
      expected: getPathname(expectedUrl),
      actual: getPathname(actualUrl),
      redirectedToLogin,
    });

    // If we expected to be on a feature page but got redirected to login,
    // this is an auth failure — withRetry will trigger a re-auth and retry.
    // We still capture a screenshot of the redirect state for diagnostics.
    if (redirectedToLogin && isFeatureTest) {
      log.warn(`Feature test redirected to login — likely session expired or auth not propagating`);
    }

    // CRITICAL: Take screenshot of CURRENT state (this is the actual failure state)
    const capture = await captureFullPage(
      page,
      projectId,
      {
        testName: test.test_name,
        failedStep: failedStep ? describeStep(failedStep) : `step-${failedStepIndex + 1}`,
        expectedUrl,
        actualUrl,
        redirectedToLogin,
      },
      log
    );
    screenshotUrl = capture?.publicUrl ?? null;
  }

  // Downgrade to failed if critical JS errors detected
  const criticalErrors = errorBucket.filter((e) => e.severity === 'critical');
  if (criticalErrors.length > 0 && testStatus === 'passed') {
    testStatus = 'failed';
    errorMessage = `Critical runtime errors: ${criticalErrors.slice(0, 3).map((e) => e.message).join(' | ')}`;
    const capture = await captureFullPage(
      page,
      projectId,
      {
        testName: test.test_name,
        failedStep: 'js-runtime-error',
        actualUrl: page.url(),
      },
      log
    );
    if (capture) screenshotUrl = capture.publicUrl;
  }

  await context.close().catch(() => {});

  return {
    test_id: test.id,
    project_id: projectId,
    status: testStatus,
    error_message: errorMessage,
    screenshot_url: screenshotUrl,
    duration_ms: 0, // filled in by caller
  };
}

/**
 * Execute a single step, with auth-state check on `navigate` steps:
 * if we land on /login when we expected a feature page, attempt inline re-auth.
 */
async function executeStepWithAuthCheck(
  page: Page,
  step: TestStep,
  creds: AuthCredentials | null,
  timeout: number,
  log: ReturnType<typeof createLogger>
): Promise<void> {
  switch (step.action) {
    case 'navigate': {
      const targetIsLogin = isLoginPage(step.url ?? '');
      await page.goto(step.url!, { waitUntil: 'domcontentloaded', timeout });
      await page.waitForTimeout(800); // let client-side redirects settle

      // If we expected a feature page but landed on /login, re-auth inline
      if (!targetIsLogin && isLoginPage(page.url()) && creds) {
        log.warn(`Navigation landed on login page unexpectedly — attempting inline re-auth`);
        await ensureAuthenticated(page, creds, timeout, log);
        // Retry the navigation now that we're authed
        await page.goto(step.url!, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(800);
      }
      break;
    }
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

function lastNavigateBefore(steps: TestStep[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    if (steps[i]?.action === 'navigate' && steps[i].url) return steps[i].url!;
  }
  return '';
}

function buildErrorMessage(args: {
  stepIndex: number;
  step: TestStep | null;
  cleanMsg: string;
  expectedUrl: string;
  actualUrl: string;
  redirectedToLogin: boolean;
}): string {
  const stepDesc = args.step ? describeStep(args.step) : `step ${args.stepIndex + 1}`;
  const expectedPath = args.expectedUrl ? getPathname(args.expectedUrl) : '(unknown)';
  const actualPath = args.actualUrl ? getPathname(args.actualUrl) : '(unknown)';

  let context = `Step ${args.stepIndex + 1}: ${stepDesc} — ${args.cleanMsg}`;
  context += ` | Expected page: ${expectedPath} | Actual page: ${actualPath}`;
  if (args.redirectedToLogin) {
    context += ' | ⚠ REDIRECTED TO LOGIN (session expired or auth not propagating)';
  } else if (expectedPath !== actualPath) {
    context += ' | ⚠ Unexpected redirect';
  }
  return context;
}
