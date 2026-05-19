/**
 * Finds the existing "sentinel-mine" project (or any project whose name contains
 * "sentinel") and adds HTTP health-check tests for the three Sentinel endpoints:
 *   /api/health, /api/health/live, /api/health/ready
 *
 * Usage:
 *   npx --no-install ts-node --project tsconfig.runner.json scripts/add-sentinel-http-checks.ts
 *
 * Optional overrides:
 *   SENTINEL_PROJECT_NAME=sentinel-mine   (substring match, case-insensitive)
 *   SENTINEL_HEALTH_BASE=https://ncpl-sentinel.vercel.app  (if different from project_url)
 *
 * The script is idempotent — safe to re-run.
 */

import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function main() {
  // ── 1. Find the sentinel project ─────────────────────────────────────────────
  const nameFilter = (process.env.SENTINEL_PROJECT_NAME ?? 'sentinel').toLowerCase();

  const { data: projects, error: pErr } = await supabase
    .from('projects')
    .select('id, project_name, project_url');

  if (pErr || !projects?.length) {
    console.error('Could not fetch projects:', pErr?.message);
    process.exit(1);
  }

  const project = projects.find((p) =>
    p.project_name.toLowerCase().includes(nameFilter)
  );

  if (!project) {
    console.error(
      `No project found with name containing "${nameFilter}".\n` +
      `Available projects:\n` +
      projects.map((p) => `  • ${p.project_name} (${p.project_url})`).join('\n')
    );
    process.exit(1);
  }

  const projectId = project.id;
  const baseUrl = (
    process.env.SENTINEL_HEALTH_BASE ?? project.project_url
  ).replace(/\/$/, '');

  console.log(`✓ Found project: "${project.project_name}" (id=${projectId})`);
  console.log(`  Base URL: ${baseUrl}`);

  // ── 2. Upsert features ────────────────────────────────────────────────────────
  const featureDefs = [
    { slug: 'general',  name: 'General',                 description: 'Overall app availability',                    weight: 1 },
    { slug: 'database', name: 'Database',                description: 'Supabase Postgres connectivity',               weight: 4 },
    { slug: 'auth',     name: 'Authentication',           description: 'Supabase Auth / GoTrue',                      weight: 3 },
    { slug: 'api',      name: 'API & External Services',  description: 'External API and edge function dependencies',  weight: 2 },
  ];

  const featureIds: Record<string, string> = {};

  for (const f of featureDefs) {
    const { data: existing } = await supabase
      .from('features')
      .select('id')
      .eq('project_id', projectId)
      .eq('slug', f.slug)
      .single();

    if (existing) {
      featureIds[f.slug] = existing.id;
      console.log(`  ✓ Feature "${f.name}" already exists`);
    } else {
      const { data: newF, error } = await supabase
        .from('features')
        .insert({ project_id: projectId, ...f, status: 'unknown', health_score: 0 })
        .select()
        .single();
      if (error || !newF) {
        console.error(`  ✗ Failed to create feature "${f.name}":`, error?.message);
      } else {
        featureIds[f.slug] = newF.id;
        console.log(`  ✓ Created feature "${f.name}"`);
      }
    }
  }

  // ── 3. Upsert HTTP checks ─────────────────────────────────────────────────────
  type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  const checks: Array<{
    test_name: string;
    feature_slug: string;
    url: string;
    method: HttpMethod;
    expected_status: number;
    expected_body_contains?: string;
    max_response_time_ms: number;
  }> = [
    {
      test_name:              'Health Endpoint',
      feature_slug:           'general',
      url:                    `${baseUrl}/api/health`,
      method:                 'GET',
      expected_status:        200,
      expected_body_contains: '"status"',
      max_response_time_ms:   8000,
    },
    {
      test_name:              'Liveness Probe',
      feature_slug:           'general',
      url:                    `${baseUrl}/api/health/live`,
      method:                 'GET',
      expected_status:        200,
      expected_body_contains: '"alive"',
      max_response_time_ms:   5000,
    },
    {
      test_name:              'Readiness Probe',
      feature_slug:           'database',
      url:                    `${baseUrl}/api/health/ready`,
      method:                 'GET',
      expected_status:        200,
      expected_body_contains: '"ready"',
      max_response_time_ms:   6000,
    },
  ];

  for (const c of checks) {
    const featureId = featureIds[c.feature_slug] ?? null;

    const httpConfig = {
      method:                 c.method,
      url:                    c.url,
      expected_status:        c.expected_status,
      expected_body_contains: c.expected_body_contains,
      max_response_time_ms:   c.max_response_time_ms,
    };

    const { data: existing } = await supabase
      .from('monitoring_tests')
      .select('id')
      .eq('project_id', projectId)
      .eq('test_name', c.test_name)
      .single();

    if (existing) {
      await supabase
        .from('monitoring_tests')
        .update({ http_config: httpConfig, feature_id: featureId, check_type: 'http' })
        .eq('id', existing.id);
      console.log(`✓ Updated HTTP check: "${c.test_name}" → ${c.url}`);
    } else {
      const { error } = await supabase
        .from('monitoring_tests')
        .insert({
          project_id:      projectId,
          feature_id:      featureId,
          test_name:       c.test_name,
          check_type:      'http',
          steps:           [],
          expected_result: `HTTP ${c.expected_status} with valid JSON health response`,
          status:          'pending',
          http_config:     httpConfig,
        });
      if (error) {
        console.error(`✗ Failed to create "${c.test_name}":`, error.message);
        process.exit(1);
      }
      console.log(`✓ Created HTTP check: "${c.test_name}" → ${c.url}`);
    }
  }

  console.log('\n────────────────────────────────────────────────────');
  console.log('Done. Next:');
  console.log('  1. Make sure migration 004_health_snapshots.sql is applied in Supabase');
  console.log('  2. Trigger a monitor run (GitHub Actions or run-monitor.ts locally)');
  console.log(`  3. Open "${project.project_name}" in PulseOps — you will see:`);
  console.log('       • Health Endpoint card with per-check breakdown (DB, Auth, memory)');
  console.log('       • Health Endpoint + Liveness Probe + Readiness Probe in Recent Test Results');
  console.log('────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
