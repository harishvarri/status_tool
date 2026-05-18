import { createClient } from '@supabase/supabase-js';
import { runChecks } from '../lib/checks/runner';
import type { Feature, Severity } from '../types';

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
      // Fetch last 24 h of runtime errors for rolling health blend
      supabase
        .from('runtime_errors')
        .select('severity, created_at')
        .eq('project_id', project.id)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }),
    ]);

    // Ensure a synthetic "Crawler Session" test exists so FK constraints are met
    let crawlerTest = (tests ?? []).find((t) => t.test_name === 'Crawler Session');
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

    const projectFeatures: Feature[] = (features ?? []) as Feature[];
    const dbErrors = (recentErrors ?? []) as Array<{ severity: string; created_at: string }>;

    console.log(
      `[${project.project_name}] Features: ${projectFeatures.length}, ` +
        `Recent 24h errors in DB: ${dbErrors.length} → crawling ${project.project_url}`
    );

    try {
      const cycle = await runChecks({
        project,
        features: projectFeatures,
        recentDbErrors: dbErrors.map((e) => ({
          severity: e.severity as Severity,
          created_at: e.created_at,
        })),
      });

      // Inject real test_id (FK) and actual duration into the synthetic results
      const elapsed = Date.now() - monitorStart;
      cycle.results.forEach((r) => {
        r.test_id = crawlerTest!.id;
        (r as any).duration_ms = elapsed;
      });

      // 1. Persist test results
      if (cycle.results.length > 0) {
        const { error } = await supabase.from('test_results').insert(cycle.results);
        if (error) console.error('Failed to save test_results:', error.message);
      }

      // 2. Persist runtime errors (from current crawl only — don't re-insert history)
      if (cycle.errors.length > 0) {
        const errorInserts = cycle.errors.map((e) => ({
          project_id: e.project_id,
          feature_id: e.feature_id,
          error_message: e.error_message,
          page_url: e.page_url,
          functionality: e.functionality,
          severity: e.severity,
          category: e.category,
          screenshot_url: e.screenshot_url ?? null,
        }));
        const { error } = await supabase.from('runtime_errors').insert(errorInserts);
        if (error) console.error('Failed to save runtime_errors:', error.message);
      }

      // 3. Persist per-feature health logs + update feature scores
      for (const fh of cycle.featureHealth) {
        const { error: logError } = await supabase.from('feature_health_logs').insert({
          feature_id: fh.feature_id,
          project_id: project.id,
          health_score: fh.health_score,
          status: fh.status,
          checks_run: fh.checks_run,
          checks_passed: fh.checks_passed,
        });
        if (logError) console.error('Failed to save feature_health_log:', logError.message);

        await supabase
          .from('features')
          .update({
            health_score: fh.health_score,
            status: fh.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fh.feature_id);
      }

      // 4. Persist project-level health log + update project row
      const passedCount = cycle.results.filter((r) => r.status === 'passed').length;
      await supabase.from('health_logs').insert({
        project_id: project.id,
        health_score: cycle.projectHealth.health_score,
        status: cycle.projectHealth.status,
        tests_run: cycle.results.length,
        tests_passed: passedCount,
      });

      await supabase
        .from('projects')
        .update({
          health_score: cycle.projectHealth.health_score,
          status: cycle.projectHealth.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id);

      // 5. Create alert if status is critical
      if (cycle.projectHealth.status === 'critical') {
        await supabase.from('alerts').insert({
          project_id: project.id,
          alert_type: 'health_critical',
          severity: 'critical',
          message:
            `${project.project_name} health dropped to ${cycle.projectHealth.health_score}% — ` +
            `${cycle.errors.length} issue(s) detected across the crawl`,
          status: 'active',
        });
      }

      console.log(
        `[${project.project_name}] ✓ Score: ${cycle.projectHealth.health_score}% ` +
          `(${cycle.projectHealth.status}) | ` +
          `Errors: ${cycle.errors.length} | ` +
          `Features: ${cycle.featureHealth.length} | ` +
          `Duration: ${Date.now() - monitorStart}ms`
      );
    } catch (err) {
      console.error(`[${project.project_name}] Cycle failed:`, err);

      // Write a critical health log so the dashboard reflects the failure
      // instead of silently showing a stale "100% healthy" from the last run.
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
        console.log(`[${project.project_name}] Wrote critical health due to cycle failure`);
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
