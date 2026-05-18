import type { BrowserContext, Page } from '@playwright/test';
import { createLogger } from './logger';
import type { PersistableError } from '../../checks/runner';
import type { Project } from '../../../types';

export interface CrawlerResult {
  errors: PersistableError[];
  durationMs: number;
  pagesVisited: number;
}

// ─── Noise Filtering ──────────────────────────────────────────────────────────

/**
 * Third-party analytics/tracking/ads hostnames whose failures are meaningless
 * for application health. This list covers the most common offenders.
 */
const THIRD_PARTY_NOISE_HOSTS = new Set([
  'www.google-analytics.com',
  'analytics.google.com',
  'www.googletagmanager.com',
  'googletagmanager.com',
  'connect.facebook.net',
  'www.facebook.com',
  'static.hotjar.com',
  'script.hotjar.com',
  'vars.hotjar.com',
  'cdn.segment.com',
  'api.segment.io',
  'browser.sentry-cdn.com',
  'o0.ingest.sentry.io',
  'cdn.mixpanel.com',
  'api2.amplitude.com',
  'cdn.amplitude.com',
  'js.intercomcdn.com',
  'nexus-websockets.intercom.io',
  'api.intercom.io',
  'widget.intercom.io',
  'crisp.chat',
  'client.crisp.chat',
  'js.driftt.com',
  'js.drift.com',
  'cdn.heapanalytics.com',
  'heapanalytics.com',
  'bat.bing.com',
  'sc.omtrdc.net',
  'cdn.onetrust.com',
  'cdn.cookielaw.org',
  'cdn2.hubspot.net',
  'forms.hsforms.com',
]);

/**
 * URL patterns that indicate noise resources (fonts, tracking pixels, etc.)
 * Any URL matching these is considered non-essential.
 */
const NOISE_URL_PATTERNS = [
  /\/favicon\.ico(\?|$)/i,
  /\.(woff2?|ttf|eot|otf)(\?|$)/i,   // fonts
  /\/(recaptcha|captcha)\//i,
  /googleadservices|doubleclick|adnxs|googlesyndication/i,
];

function isNoisyUrl(url: string, baseHost: string): boolean {
  try {
    const u = new URL(url);
    // Cross-origin hosts that are known noise
    if (THIRD_PARTY_NOISE_HOSTS.has(u.hostname)) return true;
    // Pattern-based noise
    if (NOISE_URL_PATTERNS.some((p) => p.test(url))) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Determine if a URL is same-origin relative to the base host.
 */
function isSameOrigin(url: string, baseHost: string): boolean {
  try {
    return new URL(url).hostname === baseHost;
  } catch {
    return false;
  }
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Remove errors that represent the same problem.
 * Key: category + page_url + first 120 chars of message.
 * This prevents 20 "Request failed: font.woff2" entries inflating the error count.
 */
export function deduplicateErrors(errors: PersistableError[]): PersistableError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const key = `${e.category}::${e.page_url}::${e.error_message.slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Severity helpers ─────────────────────────────────────────────────────────

function httpStatusSeverity(status: number): 'critical' | 'high' | 'medium' | 'low' {
  if (status >= 500) return 'critical';
  if (status === 404) return 'medium'; // 404 is common on asset paths, keep medium
  if (status >= 400) return 'medium';
  return 'low';
}

// ─── Login helper ─────────────────────────────────────────────────────────────

async function attemptLogin(
  context: BrowserContext,
  project: Project,
  baseHost: string
): Promise<{ landingUrl: string; failed: boolean; error?: PersistableError }> {
  const loginUrl = project.auth_login_url!;
  const loginPage = await context.newPage();

  try {
    await loginPage.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Try to fill username / email field
    const userField = loginPage
      .locator('input[type="email"], input[name="email"], input[name="username"], input[name="user"], input[type="text"]')
      .first();
    if (await userField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await userField.fill(project.auth_username!);
    }

    // Fill password
    const passField = loginPage
      .locator('input[type="password"], input[name="password"]')
      .first();
    if (await passField.isVisible({ timeout: 5000 }).catch(() => false)) {
      await passField.fill(project.auth_password!);
    } else {
      throw new Error('Password field not found on login page');
    }

    // Submit — try button first, fall back to Enter
    const submitBtn = loginPage
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Sign In"), button:has-text("Log In"), button:has-text("Login"), button:has-text("Continue")'
      )
      .first();

    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await Promise.all([
        loginPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        submitBtn.click(),
      ]);
    } else {
      await Promise.all([
        loginPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        passField.press('Enter'),
      ]);
    }

    // Give SPA a moment to redirect
    await loginPage.waitForTimeout(1500);

    const landingUrl = loginPage.url();
    return { landingUrl, failed: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      landingUrl: project.project_url,
      failed: true,
      error: {
        project_id: project.id,
        feature_id: null,
        error_message: `Auto-login failed: ${msg}`,
        page_url: loginUrl,
        functionality: 'authentication',
        severity: 'high',
        category: 'auth',
      },
    };
  } finally {
    await loginPage.close().catch(() => {});
  }
}

// ─── Main crawler ─────────────────────────────────────────────────────────────

export async function autoCrawl(
  context: BrowserContext,
  project: Project,
  maxPages = 25,
  maxDurationMs = 120_000
): Promise<CrawlerResult> {
  const log = createLogger(`crawler:${project.id}`);
  const rawErrors: PersistableError[] = [];
  const startTime = Date.now();

  const visited = new Set<string>();
  const queue: string[] = [];

  const baseUrlObj = new URL(project.project_url);
  const baseHost = baseUrlObj.hostname;

  // ── 1. Login (if credentials configured) ─────────────────────────────────
  let pagesVisited = 0;

  if (project.auth_login_url && project.auth_username && project.auth_password) {
    log.info('Credentials provided — attempting auto-login', { loginUrl: project.auth_login_url });
    const loginResult = await attemptLogin(context, project, baseHost);

    if (loginResult.failed && loginResult.error) {
      rawErrors.push(loginResult.error);
      log.warn('Login failed, crawling as unauthenticated');
    } else {
      log.info('Login successful', { landingUrl: loginResult.landingUrl });
    }

    // Start BFS from post-login landing page + project root
    const landingNorm = normalizeUrl(loginResult.landingUrl);
    if (landingNorm) queue.push(landingNorm);
    const rootNorm = normalizeUrl(project.project_url);
    if (rootNorm && rootNorm !== landingNorm) queue.push(rootNorm);
  } else {
    const rootNorm = normalizeUrl(project.project_url);
    if (rootNorm) queue.push(rootNorm);
  }

  // ── 2. BFS crawl ──────────────────────────────────────────────────────────
  log.info('Starting BFS crawl', { maxPages, baseHost });

  while (queue.length > 0 && pagesVisited < maxPages) {
    if (Date.now() - startTime > maxDurationMs) {
      log.info('Max crawl duration reached — stopping early', {
        pagesVisited,
        remaining: queue.length,
      });
      break;
    }

    const currentUrl = queue.shift()!;
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    log.info(`Visiting [${pagesVisited + 1}/${maxPages}]: ${currentUrl}`);
    pagesVisited++;

    const pageErrors: PersistableError[] = [];
    let pageLoadFailed = false;

    const page = await context.newPage();

    // ── Attach listeners BEFORE navigation ──
    page.on('pageerror', (err) => {
      // Filter out browser extension / ad-injected errors
      const msg = err.message;
      if (msg.includes('chrome-extension://') || msg.includes('moz-extension://')) return;
      if (msg.includes('ResizeObserver loop')) return; // harmless browser quirk

      pageErrors.push({
        project_id: project.id,
        feature_id: null,
        error_message: `JS Error: ${msg}`,
        page_url: currentUrl,
        functionality: 'javascript',
        severity: 'high',
        category: 'js_runtime',
      });
    });

    page.on('console', (msg) => {
      // Only capture console.error messages — info/warn are too noisy
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Skip browser-generated noise
      if (
        text.includes('favicon') ||
        text.includes('ERR_BLOCKED') ||
        text.includes('net::') ||
        isNoisyUrl(text, baseHost)
      )
        return;

      pageErrors.push({
        project_id: project.id,
        feature_id: null,
        error_message: `Console error: ${text.slice(0, 300)}`,
        page_url: currentUrl,
        functionality: 'javascript',
        severity: 'medium',
        category: 'js_runtime',
      });
    });

    page.on('requestfailed', (request) => {
      const url = request.url();
      // Only track failures for same-origin requests — cross-origin failures
      // are mostly CDN / analytics noise we cannot control.
      if (!isSameOrigin(url, baseHost)) return;
      if (isNoisyUrl(url, baseHost)) return;

      const failure = request.failure();
      if (!failure) return;

      // Ignore browser-side abort (happens when navigating away mid-load)
      if (failure.errorText === 'net::ERR_ABORTED') return;

      pageErrors.push({
        project_id: project.id,
        feature_id: null,
        error_message: `Network failure: ${url} — ${failure.errorText}`,
        page_url: currentUrl,
        functionality: 'network',
        severity: 'medium',
        category: 'network',
      });
    });

    page.on('response', (response) => {
      const url = response.url();
      const status = response.status();

      // Only care about errors (>=400), skip auth-gating responses
      if (status < 400) return;
      if (status === 401 || status === 403) return; // expected on protected routes
      if (isNoisyUrl(url, baseHost)) return;

      // For cross-origin API calls (CDN, external services) only flag 5xx
      if (!isSameOrigin(url, baseHost) && status < 500) return;

      const sev = httpStatusSeverity(status);

      pageErrors.push({
        project_id: project.id,
        feature_id: null,
        error_message: `HTTP ${status}: ${url}`,
        page_url: currentUrl,
        functionality: status >= 500 ? 'server_error' : 'client_error',
        severity: sev,
        category: status >= 500 ? 'api' : 'network',
      });
    });

    // ── Navigate ──
    try {
      const response = await page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      if (response && response.status() >= 400) {
        const status = response.status();
        // Don't double-count — the `response` listener already captured this
        // But mark page as failed so we don't extract links from it
        if (status >= 500) pageLoadFailed = true;
      }

      // Allow the page to settle (SPA hydration / async data fetching)
      await page.waitForTimeout(1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.toLowerCase().includes('timeout');

      pageErrors.push({
        project_id: project.id,
        feature_id: null,
        error_message: `Page navigation failed: ${msg}`,
        page_url: currentUrl,
        functionality: 'navigation',
        severity: isTimeout ? 'high' : 'critical',
        category: isTimeout ? 'timeout' : 'network',
      });
      pageLoadFailed = true;
    }

    // Accumulate page errors into global list
    rawErrors.push(...pageErrors);

    // ── Extract internal links ──
    if (!pageLoadFailed) {
      try {
        const hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => href.startsWith('http'))
        );

        for (const href of hrefs) {
          const norm = normalizeUrl(href);
          if (!norm) continue;
          try {
            const hHost = new URL(norm).hostname;
            if (hHost === baseHost && !visited.has(norm)) {
              queue.push(norm);
            }
          } catch {
            /* skip invalid */
          }
        }
      } catch {
        /* link extraction failure is non-fatal */
      }
    }

    await page.close().catch(() => {});
  }

  // ── Deduplicate before returning ──
  const errors = deduplicateErrors(rawErrors);

  log.info('Crawl complete', {
    pagesVisited,
    rawErrors: rawErrors.length,
    uniqueErrors: errors.length,
    durationMs: Date.now() - startTime,
  });

  return {
    errors,
    durationMs: Date.now() - startTime,
    pagesVisited,
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hash = ''; // ignore fragments
    // Drop common auth callback params
    u.searchParams.delete('code');
    u.searchParams.delete('state');
    u.searchParams.delete('session_state');
    return u.toString();
  } catch {
    return null;
  }
}
