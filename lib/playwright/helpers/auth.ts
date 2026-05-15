import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { Logger } from './logger';
import type { TestStep } from '../../../types';
import { waitForAuthRedirect, isLoginPage } from './navigation';

export interface AuthCredentials {
  email: string;
  password: string;
  loginUrl: string;
  /** Steps that perform the login (kept for re-auth replay) */
  loginSteps: TestStep[];
}

/** Process-wide storage state cache, keyed by `${loginUrl}::${email}`. */
const STORAGE_STATE_CACHE = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();

function cacheKey(creds: AuthCredentials): string {
  return `${creds.loginUrl}::${creds.email}`;
}

/**
 * Detect a login flow inside a test's steps.
 *
 * Pattern recognized:
 *   1. navigate → /login (or similar)
 *   2. (optional) wait/assert input[type=email]
 *   3. fill input[type=email] with X
 *   4. fill input[type=password] with Y
 *   5. click button[type=submit]  (or similar submit selector)
 *   6. (optional) wait for post-login element
 *
 * Returns:
 *   { creds, loginEndIndex } — feature steps are test.steps.slice(loginEndIndex + 1)
 *   null if no login flow detected
 */
export function detectLoginFlow(
  steps: TestStep[]
): { creds: AuthCredentials; loginEndIndex: number } | null {
  let navIdx = -1;
  let emailFill: TestStep | null = null;
  let passwordFill: TestStep | null = null;
  let submitClickIdx = -1;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.action === 'navigate' && isLoginPage(s.url ?? '')) {
      navIdx = i;
    } else if (s.action === 'fill' && (s.selector ?? '').includes('email')) {
      emailFill = s;
    } else if (s.action === 'fill' && (s.selector ?? '').includes('password')) {
      passwordFill = s;
    } else if (
      s.action === 'click' &&
      (s.selector ?? '').match(/submit|sign[\s-]?in|log[\s-]?in/i) &&
      emailFill &&
      passwordFill
    ) {
      submitClickIdx = i;
      break;
    }
  }

  if (navIdx === -1 || !emailFill || !passwordFill || submitClickIdx === -1) return null;

  // Include the post-login wait/assert step (if any) as part of the login flow
  let loginEndIndex = submitClickIdx;
  if (
    steps[submitClickIdx + 1] &&
    (steps[submitClickIdx + 1].action === 'wait' || steps[submitClickIdx + 1].action === 'assert')
  ) {
    loginEndIndex = submitClickIdx + 1;
  }

  return {
    creds: {
      email: emailFill.value ?? '',
      password: passwordFill.value ?? '',
      loginUrl: steps[navIdx].url ?? '',
      loginSteps: steps.slice(navIdx, loginEndIndex + 1),
    },
    loginEndIndex,
  };
}

/**
 * Perform login by replaying the login steps + waiting for the auth redirect.
 * Throws if login does not succeed (still on login page after timeout).
 */
export async function performLogin(
  page: Page,
  creds: AuthCredentials,
  stepTimeout: number,
  log: Logger
): Promise<void> {
  log.info(`Performing login as ${creds.email}`);

  for (const step of creds.loginSteps) {
    switch (step.action) {
      case 'navigate':
        await page.goto(step.url!, { waitUntil: 'domcontentloaded', timeout: stepTimeout });
        break;
      case 'fill':
        await page.fill(step.selector!, step.value!, { timeout: stepTimeout });
        break;
      case 'click':
        await page.click(step.selector!, { timeout: stepTimeout });
        break;
      case 'wait':
      case 'assert':
        // Skip post-submit wait — we handle that with waitForAuthRedirect below
        break;
      default:
        break;
    }
  }

  const success = await waitForAuthRedirect(page, 20000, log);
  if (!success) {
    throw new Error(`Login failed — still on login page after submitting credentials for ${creds.email}`);
  }
  log.info(`Login succeeded for ${creds.email}`);
}

/**
 * Get authenticated storage state for these credentials.
 * If cached, returns the cached state. Otherwise performs login + caches the result.
 *
 * Storage state contains cookies + localStorage so it can be applied to new
 * browser contexts via `browser.newContext({ storageState })`.
 */
export async function getOrCreateAuthState(
  browser: Browser,
  creds: AuthCredentials,
  stepTimeout: number,
  log: Logger
): Promise<Awaited<ReturnType<BrowserContext['storageState']>>> {
  const key = cacheKey(creds);
  const cached = STORAGE_STATE_CACHE.get(key);
  if (cached) {
    log.info(`Reusing cached auth state for ${creds.email}`);
    return cached;
  }

  log.info(`No cached state — performing fresh login for ${creds.email}`);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await ctx.newPage();
  try {
    await performLogin(page, creds, stepTimeout, log);
    const state = await ctx.storageState();
    STORAGE_STATE_CACHE.set(key, state);
    log.info(`Cached fresh auth state for ${creds.email}`);
    return state;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * Verify we're authenticated. If we've been redirected to /login, attempt re-auth.
 * Returns true if authenticated (originally or after re-auth), false if auth failed.
 */
export async function ensureAuthenticated(
  page: Page,
  creds: AuthCredentials | null,
  stepTimeout: number,
  log: Logger
): Promise<boolean> {
  if (!creds) return true; // unauthenticated test by design
  if (!isLoginPage(page.url())) return true;

  log.warn(`Detected redirect to login page (${page.url()}) — attempting re-auth`);
  // Invalidate cache to force fresh login
  STORAGE_STATE_CACHE.delete(cacheKey(creds));
  try {
    await performLogin(page, creds, stepTimeout, log);
    // Update cache with the new session
    if (page.context) {
      const newState = await page.context().storageState();
      STORAGE_STATE_CACHE.set(cacheKey(creds), newState);
    }
    return true;
  } catch (err) {
    log.error(`Re-auth failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function clearAuthCache(): void {
  STORAGE_STATE_CACHE.clear();
}
