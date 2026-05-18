import { chromium } from '@playwright/test';
import { clearAuthCache } from '../playwright/helpers/auth';
import { createLogger } from '../playwright/helpers/logger';
import { calculateHealthScore } from '../health-engine/calculator';
import { autoCrawl, deduplicateErrors } from '../playwright/helpers/crawler';
import type {
  TestResult,
  Severity,
  BugCategory,
  Feature,
  ProjectStatus,
  Project,
} from '../../types';

export interface CheckRunnerOptions {
  project: Project;
  features: Feature[];
  timeout?: number;
  /**
   * Recent errors fetched from the DB (last 24 h) — used to compute a rolling
   * health score so that a single clean crawl does NOT instantly reset health
   * to 100 when the project had failures earlier in the day.
   */
  recentDbErrors?: RecentDbError[];
}

export interface RecentDbError {
  severity: Severity;
  created_at: string;
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
  featureHealth: Array<{
    feature_id: string;
    health_score: number;
    status: ProjectStatus;
    checks_run: number;
    checks_passed: number;
  }>;
  projectHealth: {
    health_score: number;
    status: ProjectStatus;
  };
}

// ─── Severity weights (must match lib/health-engine/calculator.ts) ────────────
const SEVERITY_WEIGHTS: Record<Severity, number> = {
  low: 1,
  medium: 3,
  high: 8,
  critical: 15,
};

/**
 * Compute a health score from a list of deduplicated errors.
 *
 * Formula:
 *   score = 100 − Σ(weight[severity] for each unique error)
 *   clamped to [0, 100].
 *
 * This uses the same weight table as `lib/health-engine/calculator.ts` so
 * scores are consistent across the platform.
 *
 * Examples:
 *   0 errors              → 100 (healthy)
 *   1 × medium            →  97
 *   1 × high              →  92
 *   2 × high              →  84
 *   1 × critical          →  85
 *   3 × critical          →  55
 *   3 critical + 5 high   →  10
 */
function computeHealthFromErrors(errors: PersistableError[]): {
  score: number;
  status: ProjectStatus;
} {
  const unique = deduplicateErrors(errors);
  const penalty = unique.reduce(
    (sum, e) => sum + (SEVERITY_WEIGHTS[e.severity] ?? SEVERITY_WEIGHTS.medium),
    0
  );

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  let status: ProjectStatus;
  if (score >= 90) status = 'healthy';
  else if (score >= 70) status = 'warning';
  else status = 'critical';

  return { score, status };
}

/**
 * Blend the current-crawl health with the rolling 24 h history so that a
 * single clean run does NOT immediately erase earlier failures.
 *
 * Weight:  current crawl  60 %  (what we just measured)
 *          recent history 40 %  (errors seen in the last 24 h from the DB)
 *
 * This means:
 *   - If the app was broken earlier and is now fine → score improves but
 *     stays below 100 until several clean runs accumulate.
 *   - If the current crawl finds new problems → they dominate (60 %).
 */
function blendWithRecentHistory(
  currentScore: number,
  recentDbErrors: RecentDbError[]
): { score: number; status: ProjectStatus } {
  if (recentDbErrors.length === 0) {
    // No history available — trust current crawl entirely
    return computeStatusFromScore(currentScore);
  }

  // Convert recent DB errors to PersistableError shape (only severity matters)
  const recentAsPersistable = recentDbErrors.map(
    (e): PersistableError => ({
      project_id: '',
      feature_id: null,
      error_message: 'recent',
      page_url: '',
      functionality: 'recent',
      severity: e.severity,
      category: 'unknown',
    })
  );

  const { score: historyScore } = computeHealthFromErrors(recentAsPersistable);

  const blended = Math.round(currentScore * 0.6 + historyScore * 0.4);
  const final = Math.max(0, Math.min(100, blended));
  return computeStatusFromScore(final);
}

function computeStatusFromScore(score: number): { score: number; status: ProjectStatus } {
  let status: ProjectStatus;
  if (score >= 90) status = 'healthy';
  else if (score >= 70) status = 'warning';
  else status = 'critical';
  return { score, status };
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export async function runChecks(opts: CheckRunnerOptions): Promise<CheckRunnerResult> {
  const { project, features, timeout = 15000, recentDbErrors = [] } = opts;
  const projectId = project.id;

  const log = createLogger(`runner:${projectId}`);
  clearAuthCache();

  const results: Omit<TestResult, 'id' | 'created_at'>[] = [];
  let errors: PersistableError[] = [];
  let pagesVisited = 0;
  let crawlFailed = false;

  log.info(`Starting auto-crawl for "${project.project_name}"`, {
    url: project.project_url,
    hasAuth: !!(project.auth_login_url && project.auth_username),
  });

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      // Accept all cookies so cookie banners don't block crawling
      bypassCSP: false,
    });

    const crawlerResult = await autoCrawl(context, project);
    errors = crawlerResult.errors;
    pagesVisited = crawlerResult.pagesVisited;

    // Log breakdown by severity
    const breakdown = {
      critical: errors.filter((e) => e.severity === 'critical').length,
      high: errors.filter((e) => e.severity === 'high').length,
      medium: errors.filter((e) => e.severity === 'medium').length,
      low: errors.filter((e) => e.severity === 'low').length,
    };
    log.info(`Crawl finished`, { pagesVisited, totalErrors: errors.length, breakdown });

    if (pagesVisited === 0) {
      // Crawl visited nothing — the app may be down entirely
      crawlFailed = true;
      log.warn('Crawl visited 0 pages — treating as critical failure');
      errors.push({
        project_id: projectId,
        feature_id: null,
        error_message: `Crawler could not visit any pages at ${project.project_url}`,
        page_url: project.project_url,
        functionality: 'navigation',
        severity: 'critical',
        category: 'network',
      });
    }
  } catch (err) {
    // Crawler itself threw — mark as critical failure
    crawlFailed = true;
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Crawler threw an exception`, { error: msg });
    errors.push({
      project_id: projectId,
      feature_id: null,
      error_message: `Crawler failed to run: ${msg}`,
      page_url: project.project_url,
      functionality: 'crawler',
      severity: 'critical',
      category: 'unknown',
    });
  } finally {
    await browser.close().catch(() => {});
  }

  // ── Synthesise a test result ──────────────────────────────────────────────
  const generalFeature = features.find((f) => f.slug === 'general');
  const passed = !crawlFailed && errors.length === 0;

  results.push({
    test_id: 'auto-crawler', // injected with real UUID by run-monitor.ts
    project_id: projectId,
    feature_id: generalFeature?.id ?? null,
    status: passed ? 'passed' : 'failed',
    error_message: passed
      ? null
      : `Crawl found ${errors.length} issue(s) across ${pagesVisited} page(s).`,
    screenshot_url: null,
    duration_ms: 0, // will be updated by run-monitor.ts with actual timing
    http_status_code: null,
    response_size_bytes: null,
  } as any);

  // ── Compute health (current crawl) ───────────────────────────────────────
  const { score: currentScore } = computeHealthFromErrors(errors);

  // ── Blend with rolling 24h history ──────────────────────────────────────
  const { score: projectHealthScore, status: projectStatus } = blendWithRecentHistory(
    currentScore,
    recentDbErrors
  );

  log.info(`Health computed`, {
    currentCrawlScore: currentScore,
    rollingBlendedScore: projectHealthScore,
    status: projectStatus,
    recentHistoryErrors: recentDbErrors.length,
  });

  // ── Per-feature health ────────────────────────────────────────────────────
  const featureHealth = features.map((f) => ({
    feature_id: f.id,
    health_score: f.slug === 'general' ? projectHealthScore : 100,
    status: (f.slug === 'general' ? projectStatus : 'healthy') as ProjectStatus,
    checks_run: 1,
    checks_passed: passed ? 1 : 0,
  }));

  return {
    projectId,
    results,
    errors,
    featureHealth,
    projectHealth: { health_score: projectHealthScore, status: projectStatus },
  };
}

export { calculateHealthScore };
