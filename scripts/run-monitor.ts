import { createClient } from '@supabase/supabase-js';
import { runChecks } from '../lib/checks/runner';
import { executeHttpCheck } from '../lib/checks/http-check';
import { scoreFromSnapshot } from '../lib/checks/health-endpoint-parser';
import type { Feature, Severity, MonitoringTest } from '../types';
import type { PersistableError } from '../lib/checks/runner';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 1 } },
  }
);

// ─── Severity weights (must match lib/health-engine/calculator.ts) ──────────
const SEVERITY_WEIGHTS: Record<string, number> = { low: 1, medium: 3, high: 8, critical: 15 };

function computeProjectHealth(
  allErrors: PersistableError[],
  recentDbErrors: Array<{ severity: string; created_at: string }>
): { health_score: number; status: 'healthy' | 'warning' | 'critical' } {
  // Deduplicate current errors
  const seen = new Set<string>();
  const unique = allErrors.filter((e) => {
    const key = `${e.category}::${e.page_url}::${e.error_message.slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Current crawl / checks score
  const currentPenalty = unique.reduce(
    (s, e) => s + (SEVERITY_WEIGHTS[e.severity] ?? SEVERITY_WEIGHTS.medium),
    0
  );
  const currentScore = Math.max(0, Math.min(100, Math.round(100 - currentPenalty)));

  // Rolling 24h history blend (60% current / 40% history)
  let finalScore = currentScore;
  if (recentDbErrors.length > 0) {
    const histPenalty = recentDbErrors.reduce(
      (s, e) => s + (SEVERITY_WEIGHTS[e.severity] ?? SEVERITY_WEIGHTS.medium),
      0
    );
    const histScore = Math.max(0, Math.min(100, Math.round(100 - histPenalty)));
    finalScore = Math.max(0, Math.min(100, Math.round(currentScore * 0.6 + histScore * 0.4)));
  }

  const status =
    finalScore >= 90 ? 'healthy' : finalScore >= 70 ? 'warning' : 'critical';

  return { health_score: finalScore, status };
}

async function main() {
  const targetProjectId = process.env.TARGET_PROJECT_ID;

  let query = supabase.from('projects').select('*');
  if (targetProjectId) {
    query = query.eq('id', targetProjectId);
  }

  const { data: projects, error: projectsError } = await query;
  if (projectsError) {
    console.error('Failed to fetch projects:', projectsError.message);
    process.exit(1);
  }

  if (!projects?.length) {
    console.log('No projects to monitor');
    return;
  }

  console.log(`Running monitoring for ${projects.length} project(s)`);

  for (const project of projects) {
    const monitorStart = Date.now();

    const [{ data: tests }, { data: features }, { data: recentErrors }] = await Promise.all([
      supabase.from('monitoring_tests').select('*').eq('project_id', project.id),
      supabase.from('features').select('*').eq('project_id', project.id),
      supabase
        .from('runtime_errors')
        .select('severity, created_at')
        .eq('project_id', project.id)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }),
    ]);

    const projectFeatures: Feature[] = (features ?? []) as Feature[];
    const dbErrors = (recentErrors ?? []) as Array<{ severity: string; created_at: string }>;
    const allTests: MonitoringTest[] = (tests ?? []) as MonitoringTest[];

    // Split tests by check_type
    const httpTests = allTests.filter((t) => t.check_type === 'http' && t.http_config);
    const browserTests = allTests.filter((t) => t.check_type !== 'http');

    // Projects with only HTTP checks skip the Playwright crawler entirely
    const httpOnly = httpTests.length > 0 && browserTests.length === 0;

    console.log(
      `[${project.project_name}] ` +
        `HTTP checks: ${httpTests.length}, ` +
        `Browser/crawler: ${httpOnly ? 'disabled (http-only project)' : 'enabled'}, ` +
        `24h errors in DB: ${dbErrors.length}`
    );

    try {
      // ── 1. Run HTTP checks ─────────────────────────────────────────────────
      type HttpResult = Awaited<ReturnType<typeof executeHttpCheck>>;
      const httpResults: HttpResult[] = [];
      for (const test of httpTests) {
        console.log(`  [HTTP] ${test.test_name} → ${test.http_config?.url}`);
        const result = await executeHttpCheck(project.id, test);
        httpResults.push(result);
      }

      // ── 1a. Persist health snapshots ───────────────────────────────────────
      for (let i = 0; i < httpResults.length; i++) {
        const r    = httpResults[i];
        const test = httpTests[i];
        if (!r.healthSnapshot?.isHealthEndpoint) continue;

        const snap = r.healthSnapshot;
        const { error: snapErr } = await supabase.from('health_snapshots').insert({
          project_id:       project.id,
          test_id:          test.id,
          overall_status:   snap.overallStatus,
          service_name:     snap.service ?? null,
          version:          snap.version ?? null,
          environment:      snap.environment ?? null,
          response_time_ms: snap.responseTimeMs ?? null,
          uptime_seconds:   snap.uptimeSeconds ?? null,
          memory_percent:   snap.memoryPercent ?? null,
          checks_total:     snap.checksTotal,
          checks_passed:    snap.checksPassed,
          checks_failed:    snap.checksFailed,
          checks_warning:   snap.checksWarning,
          snapshot:         snap.rawSnapshot,
        });
        if (snapErr) console.error(`  Failed to save health_snapshot for ${test.test_name}:`, snapErr.message);
        else console.log(`  [Health] snapshot saved — ${snap.overallStatus} (${snap.checksPassed}/${snap.checksTotal} checks ok, score=${scoreFromSnapshot(snap)})`);
      }

      const httpErrors: PersistableError[] = httpResults.flatMap((r) =>
        r.errors.map((e) => ({
          project_id: project.id,
          feature_id: null,
          error_message: e.message,
          page_url: e.page_url,
          functionality: 'api',
          severity: e.severity,
          category: e.category,
          screenshot_url: null,
        }))
      );

      // ── 2. Run auto-crawler (skipped for http-only projects) ──────────────
      let crawlerErrors: PersistableError[] = [];
      let crawlerResults: typeof httpResults[0]['result'][] = [];

      if (!httpOnly) {
        let crawlerTest = allTests.find((t) => t.test_name === 'Crawler Session');
        if (!crawlerTest) {
          const { data } = await supabase
            .from('monitoring_tests')
            .insert({
              project_id: project.id,
              test_name: 'Crawler Session',
              steps: [],
              expected_result: 'Crawl completes without errors',
              status: 'passed',
            })
            .select()
            .single();
          crawlerTest = data;
        }

        const cycle = await runChecks({
          project,
          features: projectFeatures,
          recentDbErrors: dbErrors.map((e) => ({
            severity: e.severity as Severity,
            created_at: e.created_at,
          })),
        });

        const elapsed = Date.now() - monitorStart;
        cycle.results.forEach((r) => {
          r.test_id = crawlerTest!.id;
          (r as any).duration_ms = elapsed;
        });

        crawlerErrors  = cycle.errors;
        crawlerResults = cycle.results;

        // Persist per-feature health logs from crawler
        for (const fh of cycle.featureHealth) {
          await supabase.from('feature_health_logs').insert({
            feature_id:   fh.feature_id,
            project_id:   project.id,
            health_score: fh.health_score,
            status:       fh.status,
            checks_run:   fh.checks_run,
            checks_passed: fh.checks_passed,
          });
          await supabase
            .from('features')
            .update({ health_score: fh.health_score, status: fh.status, updated_at: new Date().toISOString() })
            .eq('id', fh.feature_id);
        }
      }

      // ── 3. Combine errors ─────────────────────────────────────────────────
      const allErrors: PersistableError[] = [...httpErrors, ...crawlerErrors];

      // ── 4. Re-compute project health with all errors combined ──────────────
      const { health_score, status: projectStatus } = computeProjectHealth(allErrors, dbErrors);

      // ── 5. Persist test results ────────────────────────────────────────────
      const allResults = [
        ...httpResults.map((r) => r.result),
        ...crawlerResults,
      ];

      if (allResults.length > 0) {
        const { error } = await supabase.from('test_results').insert(allResults);
        if (error) console.error('Failed to save test_results:', error.message);
      }

      // ── 6. Persist runtime errors ─────────────────────────────────────────
      if (allErrors.length > 0) {
        const inserts = allErrors.map((e) => ({
          project_id: e.project_id,
          feature_id: e.feature_id,
          error_message: e.error_message,
          page_url: e.page_url,
          functionality: e.functionality,
          severity: e.severity,
          category: e.category,
          screenshot_url: e.screenshot_url ?? null,
        }));
        const { error } = await supabase.from('runtime_errors').insert(inserts);
        if (error) console.error('Failed to save runtime_errors:', error.message);
      }

      // ── 7. Persist project-level health log + update project ───────────────
      const passedCount = allResults.filter((r) => r.status === 'passed').length;
      await supabase.from('health_logs').insert({
        project_id: project.id,
        health_score,
        status: projectStatus,
        tests_run: allResults.length,
        tests_passed: passedCount,
      });

      await supabase
        .from('projects')
        .update({
          health_score,
          status: projectStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id);

      // ── 9. Create alert if critical ────────────────────────────────────────
      if (projectStatus === 'critical') {
        await supabase.from('alerts').insert({
          project_id: project.id,
          alert_type: 'health_critical',
          severity: 'critical',
          message:
            `${project.project_name} health dropped to ${health_score}% — ` +
            `${allErrors.length} issue(s) detected ` +
            `(${httpErrors.length} HTTP, ${crawlerErrors.length} crawler)`,
          status: 'active',
        });
      }

      console.log(
        `[${project.project_name}] ✓ Score: ${health_score}% (${projectStatus}) | ` +
          `Errors: ${allErrors.length} (HTTP: ${httpErrors.length}, Crawler: ${crawlerErrors.length}) | ` +
          `Tests: ${passedCount}/${allResults.length} passed | ` +
          `Duration: ${Date.now() - monitorStart}ms`
      );
    } catch (err) {
      console.error(`[${project.project_name}] Cycle failed:`, err);

      // Write critical health so the dashboard shows the failure
      try {
        await supabase.from('health_logs').insert({
          project_id: project.id,
          health_score: 0,
          status: 'critical',
          tests_run: 0,
          tests_passed: 0,
        });
        await supabase
          .from('projects')
          .update({ health_score: 0, status: 'critical', updated_at: new Date().toISOString() })
          .eq('id', project.id);
      } catch (dbErr) {
        console.error(`[${project.project_name}] Could not write failure health:`, dbErr);
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
