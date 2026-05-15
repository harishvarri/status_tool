import type { Page } from '@playwright/test';
import type { Severity } from '@/types';

export interface CollectedError {
  type: 'console' | 'js_runtime' | 'network' | 'page_crash';
  message: string;
  url: string;
  severity: Severity;
  timestamp: number;
}

const CONSOLE_ERROR_KEYWORDS_CRITICAL = ['TypeError', 'ReferenceError', 'SyntaxError', 'Cannot read'];
const CONSOLE_ERROR_KEYWORDS_HIGH = ['Uncaught', 'Error:', 'Exception', 'failed to fetch'];

function classifyConsoleSeverity(message: string): Severity {
  const lower = message.toLowerCase();
  if (CONSOLE_ERROR_KEYWORDS_CRITICAL.some((k) => message.includes(k))) return 'critical';
  if (CONSOLE_ERROR_KEYWORDS_HIGH.some((k) => lower.includes(k.toLowerCase()))) return 'high';
  if (lower.includes('warning') || lower.includes('warn')) return 'low';
  return 'medium';
}

function classifyNetworkSeverity(status: number): Severity {
  if (status >= 500) return 'critical';
  if (status >= 400) return 'high';
  return 'medium';
}

export function attachErrorCollectors(page: Page, errors: CollectedError[]): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({
        type: 'console',
        message: msg.text(),
        url: page.url(),
        severity: classifyConsoleSeverity(msg.text()),
        timestamp: Date.now(),
      });
    }
  });

  page.on('pageerror', (error) => {
    errors.push({
      type: 'js_runtime',
      message: error.message,
      url: page.url(),
      severity: 'critical',
      timestamp: Date.now(),
    });
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    errors.push({
      type: 'network',
      message: `Network failure: ${failure?.errorText ?? 'Unknown'} — ${request.url()}`,
      url: page.url(),
      severity: 'high',
      timestamp: Date.now(),
    });
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.push({
        type: 'network',
        message: `HTTP ${response.status()} — ${response.url()}`,
        url: page.url(),
        severity: classifyNetworkSeverity(response.status()),
        timestamp: Date.now(),
      });
    }
  });

  page.on('crash', () => {
    errors.push({
      type: 'page_crash',
      message: 'Page crashed unexpectedly',
      url: page.url(),
      severity: 'critical',
      timestamp: Date.now(),
    });
  });
}
