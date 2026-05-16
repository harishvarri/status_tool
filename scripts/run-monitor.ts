import { createClient } from '@supabase/supabase-js';
import { runChecks } from '../lib/checks/runner';
import type { Feature, MonitoringTest } from '../types';

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
    const [{ data: tests }, { data: features }] = await Promise.all([
      supabase.from('monitoring_tests').select('*').eq('project_id', project.id),
      supabase.from('features').select('*').eq('project_id', project.id),
    ]);

    const projectTests: MonitoringTest[] = (tests ?? []) as MonitoringTest[];
    const projectFeatures: Feature[] = (features ?? []) as Feature[];

    console.log(
      `[${project.project_name}] Features: ${projectFeatures.length} | Tests: ${projectTests.length} → against ${project.project_url}`
    );

    try {
      const cycle = await runChecks({
        projectId: project.id,
        projectUrl: project.project_url,
        features: projectFeatures,
        tests: projectTests,
      });

      // 1. Persist test results
      if (cycle.results.length > 0) {
        const { error } = await supabase.from('test_results').insert(cycle.results);
        if (error) console.error('Failed to save test_results:', error.message);
      }

      // 2. Persist runtime errors
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
        await supabase.from('feature_health_logs').insert({
          feature_id: fh.feature_id,
          project_id: project.id,
          health_score: fh.health_score,
          status: fh.status,
          checks_run: fh.checks_run,
          checks_passed: fh.checks_passed,
        });
        await supabase
          .from('features')
          .update({
            health_score: fh.health_score,
            status: fh.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fh.feature_id);
      }

      // 4. Persist project-level health log + update project
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

      // 5. Create alert if critical
      if (cycle.projectHealth.status === 'critical') {
        await supabase.from('alerts').insert({
          project_id: project.id,
          alert_type: 'health_critical',
          severity: 'critical',
          message: `${project.project_name} health dropped to ${cycle.projectHealth.health_score}% — ${cycle.results.filter((r) => r.status === 'failed').length} check(s) failing`,
          status: 'active',
        });
      }

      console.log(
        `[${project.project_name}] Done — score ${cycle.projectHealth.health_score}%, status ${cycle.projectHealth.status}, ${cycle.featureHealth.length} feature(s) measured`
      );
    } catch (err) {
      console.error(`[${project.project_name}] Cycle failed:`, err);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
