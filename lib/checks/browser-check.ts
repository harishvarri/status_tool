import type { Browser } from '@playwright/test';
import type { MonitoringTest, TestResult, Severity, BugCategory } from '../../types';
import { executeTest } from '../playwright/test-executor';
import { categorizeCollectedError, categorizeMessage } from './bug-categorizer';
import type { CollectedError } from '../playwright/error-collector';

export interface BrowserCheckResult {
  result: Omit<TestResult, 'id' | 'created_at'>;
  errors: Array<{
    message: string;
    page_url: string;
    severity: Severity;
    category: BugCategory;
  }>;
}

/**
 * Browser check = wraps existing Playwright executor.
 * Adds feature_id propagation + bug categorization on errors.
 */
export async function executeBrowserCheck(
  browser: Browser,
  projectId: string,
  test: MonitoringTest,
  opts: { stepTimeout: number; testTimeout: number }
): Promise<BrowserCheckResult> {
  const { result, errors } = await executeTest(browser, projectId, test, opts);

  // Propagate feature_id, fill HTTP-specific fields with null
  const enrichedResult: Omit<TestResult, 'id' | 'created_at'> = {
    ...result,
    feature_id: test.feature_id,
    http_status_code: null,
    response_size_bytes: null,
  };

  // Convert collected errors to the unified shape with categorization
  const categorizedErrors = errors.map((err: CollectedError) => ({
    message: err.message,
    page_url: err.url,
    severity: err.severity,
    category: categorizeCollectedError(err),
  }));

  // If the test itself failed (not just collected errors), add a synthesized error
  if (result.status === 'failed' && result.error_message) {
    const { category, severity } = categorizeMessage(
      result.error_message,
      '',
      'browser'
    );
    categorizedErrors.push({
      message: result.error_message,
      page_url: '',
      severity,
      category,
    });
  }

  return { result: enrichedResult, errors: categorizedErrors };
}
