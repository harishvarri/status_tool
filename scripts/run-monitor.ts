import { createClient } from '@supabase/supabase-js';
import { runMonitoringCycle } from '../lib/playwright/runner';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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
    const { data: tests, error: testsError } = await supabase
      .from('monitoring_tests')
      .select('*')
      .eq('project_id', project.id);

    if (testsError) {
      console.error(`Failed to fetch tests for ${project.project_name}:`, testsError.message);
      continue;
    }

    console.log(
      `[${project.project_name}] Running ${tests?.length ?? 0} test(s) against ${project.project_url}`
    );

    try {
      const runResult = await runMonitoringCycle({
        projectId: project.id,
        projectUrl: project.project_url,
        tests: tests ?? [],
      });

      // Persist test results
      if (runResult.results.length > 0) {
        const { error: resultError } = await supabase
          .from('test_results')
          .insert(runResult.results);
        if (resultError) console.error('Failed to save test results:', resultError.message);
      }

      // Persist runtime errors
      const errorInserts = runResult.runtimeErrors.map((e) => ({
        project_id: project.id,
        error_message: e.message,
        page_url: e.url,
        functionality: 'automated-check',
        severity: e.severity,
      }));
      if (errorInserts.length > 0) {
        const { error: errError } = await supabase
          .from('runtime_errors')
          .insert(errorInserts);
        if (errError) console.error('Failed to save runtime errors:', errError.message);
      }

      // Save health log
      const { error: logError } = await supabase.from('health_logs').insert({
        project_id: project.id,
        health_score: runResult.health.score,
        status: runResult.health.status,
        tests_run: runResult.health.tests_run,
        tests_passed: runResult.health.tests_passed,
      });
      if (logError) console.error('Failed to save health log:', logError.message);

      // Update project health
      const { error: updateError } = await supabase
        .from('projects')
        .update({
          health_score: runResult.health.score,
          status: runResult.health.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', project.id);
      if (updateError) console.error('Failed to update project health:', updateError.message);

      // Create alert if critical
      if (runResult.health.status === 'critical') {
        await supabase.from('alerts').insert({
          project_id: project.id,
          alert_type: 'health_critical',
          message: `${project.project_name} health dropped to ${runResult.health.score}% — ${runResult.results.filter((r) => r.status === 'failed').length} test(s) failing`,
          status: 'active',
        });
      }

      console.log(
        `[${project.project_name}] Done — score: ${runResult.health.score}%, status: ${runResult.health.status}, errors: ${runResult.runtimeErrors.length}`
      );
    } catch (err) {
      console.error(`[${project.project_name}] Monitor run failed:`, err);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
