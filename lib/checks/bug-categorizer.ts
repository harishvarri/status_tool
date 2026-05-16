import type { BugCategory, Severity } from '../../types';
import type { CollectedError } from '../playwright/error-collector';

interface CategorizedError {
  category: BugCategory;
  severity: Severity;
}

/**
 * Map a Playwright/HTTP error to a structured BugCategory + Severity.
 * Used by the runner to fill `runtime_errors.category` and to drive bug analytics.
 */
export function categorizeMessage(
  message: string,
  pageUrl: string = '',
  hint?: 'http' | 'browser'
): CategorizedError {
  const lower = message.toLowerCase();

  // 1. Timeout — anything that says "timeout", "timed out", "exceeded Nms"
  if (/timeout|timed out|exceeded \d+ms/.test(lower)) {
    return { category: 'timeout', severity: 'high' };
  }

  // 2. Auth — login/session/auth keywords or redirect to /login
  if (
    /\b(unauthorized|forbidden|401|403|auth|login|sign[\s-]?in|session expired|invalid token)\b/.test(
      lower
    ) ||
    /\/login/i.test(pageUrl)
  ) {
    return { category: 'auth', severity: 'high' };
  }

  // 3. Network — net::ERR_, connection refused, DNS, abort, fetch failed
  if (
    /net::err_|err_aborted|connection refused|enotfound|econnreset|dns|fetch failed|networkerror/.test(
      lower
    )
  ) {
    return { category: 'network', severity: 'high' };
  }

  // 4. API — 5xx, 4xx (not auth), HTTP status mentioned
  if (/\b5\d\d\b/.test(message)) {
    return { category: 'api', severity: 'critical' };
  }
  if (/\b4\d\d\b/.test(message) && !/(401|403|404)/.test(message)) {
    return { category: 'api', severity: 'high' };
  }
  if (/\b404\b/.test(message)) {
    return { category: 'api', severity: 'medium' };
  }

  // 5. Database — postgres, supabase rpc, sql, constraint
  if (/\b(postgres|database|sql|constraint|relation|table)\b/.test(lower)) {
    return { category: 'db', severity: 'high' };
  }

  // 6. JS runtime — TypeError, ReferenceError, Uncaught, hydration
  if (
    /typeerror|referenceerror|syntaxerror|uncaught|cannot read|undefined is not|hydration|null is not/.test(
      lower
    )
  ) {
    return { category: 'js_runtime', severity: 'critical' };
  }

  // 7. UI — selector not found, element not visible
  if (/locator|selector|waiting for|to be visible|element/.test(lower)) {
    return { category: 'ui', severity: 'medium' };
  }

  // Hint-based fallback
  if (hint === 'http') return { category: 'api', severity: 'medium' };
  if (hint === 'browser') return { category: 'ui', severity: 'medium' };

  return { category: 'unknown', severity: 'medium' };
}

/** Map a collected runtime error to a category for storage. */
export function categorizeCollectedError(err: CollectedError): BugCategory {
  // Use existing severity from collector, just add category
  if (err.type === 'network') return categorizeMessage(err.message, err.url, 'http').category;
  if (err.type === 'js_runtime') return 'js_runtime';
  if (err.type === 'page_crash') return 'js_runtime';
  return categorizeMessage(err.message, err.url, 'browser').category;
}
