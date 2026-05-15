import type { Page } from '@playwright/test';
import type { Logger } from './logger';

export interface NavigationResult {
  expectedUrl: string;
  actualUrl: string;
  redirected: boolean;
  redirectedToLogin: boolean;
  pathnameMatches: boolean;
}

/** Heuristic: any URL pathname containing "login", "signin", "sign-in" is the login page. */
export function isLoginPage(url: string): boolean {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    return /\/(login|signin|sign-in|auth)\b/.test(p);
  } catch {
    return false;
  }
}

export function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Navigate to URL and report what actually happened.
 * Uses `domcontentloaded` (most apps never hit `networkidle` due to analytics/WS).
 */
export async function smartGoto(
  page: Page,
  url: string,
  timeout: number,
  log: Logger
): Promise<NavigationResult> {
  log.info(`Navigating to ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (err) {
    log.warn(`page.goto threw, but still reading final URL`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Wait briefly for client-side redirects (SPAs use replaceState/pushState post-mount)
  await page.waitForTimeout(800);

  const actualUrl = page.url();
  const expectedPath = getPathname(url);
  const actualPath = getPathname(actualUrl);
  const redirected = expectedPath !== actualPath;
  const redirectedToLogin = isLoginPage(actualUrl);

  log.info(`Navigation result`, {
    expected: expectedPath,
    actual: actualPath,
    redirected,
    redirectedToLogin,
  });

  return {
    expectedUrl: url,
    actualUrl,
    redirected,
    redirectedToLogin,
    pathnameMatches: !redirected,
  };
}

/** Wait for the URL pathname to NOT be a login page (= auth succeeded). */
export async function waitForAuthRedirect(
  page: Page,
  timeout: number,
  log: Logger
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const url = page.url();
    if (!isLoginPage(url)) {
      log.info(`Auth redirect detected → ${getPathname(url)}`);
      return true;
    }
    await page.waitForTimeout(250);
  }
  log.warn(`Still on login page after ${timeout}ms — auth likely failed`);
  return false;
}
