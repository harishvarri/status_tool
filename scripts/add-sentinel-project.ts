/**
 * One-time setup script — registers the NCPL Sentinel app
 * as a monitored project in PulseOps with an HTTP health check
 * pointing to the /api/health endpoint built into the Vercel deployment.
 *
 * Usage:
 *   npx --no-install ts-node --project tsconfig.runner.json scripts/add-sentinel-project.ts
 *
 * Optional env overrides:
 *   SENTINEL_URL=https://your-custom-domain.com
 *
 * The script is idempotent: re-running it updates the existing project
 * rather than creating a duplicate.
 */

import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL =
  (process.env.SENTINEL_URL ?? '').replace(/\/$/, '') ||
  'https://ncpl-sentinel.vercel.app';

const HEALTH_URL    = `${BASE_URL}/api/health`;
const LIVE_URL      = `${BASE_URL}/api/health/live`;
const READY_URL     = `${BASE_URL}/api/health/ready`;

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Resolve user_id from an existing project (single-user system)
  const { data: users } = await supabase.from('projects').select('user_id').limit(1);
  const userId = users?.[0]?.user_id;
  if (!userId) {
    console.error('No existing projects found — add a project via the dashboard first.');
    process.exit(1);
  }

  console.log(`Using user_id: ${userId}`);
  console.log(`Base URL:      ${BASE_URL}`);
  console.log(`Health URL:    ${HEALTH_URL}`);

  // ── 1. Upsert project ───────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('project_url', BASE_URL)
    .single();

  let projectId: string;

  if (existing) {
    projectId = existing.id;
    console.log(`✓ Project already exists (id=${projectId})`);
    await supabase
      .from('projects')
      .update({ project_url: BASE_URL, updated_at: new Date().toISOString() })
      .eq('id', projectId);
  } else {
    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id:      userId,
        project_name: 'NCPL Sentinel',
        project_url:  BASE_URL,
        description:  'NCPL compliance and regulatory management platform — Vite + React + Supabase on Vercel',
        status:       'unknown',
        health_score: 0,
      })
      .select()
      .single();

    if (error || !project) {
      console.error('Failed to create project:', error?.message);
      process.exit(1);
    }
    projectId = project.id;
    console.log(`✓ Created project (id=${projectId})`);
  }

  // ── 2. Upsert features ──────────────────────────────────────────────────────
  const featureDefs = [
    {
      slug:        'general',
      name:        'General',
      description: 'Overall application health and availability',
      weight:      1,
    },
    {
      slug:        'database',
      name:        'Database',
      description: 'Supabase Postgres connectivity and query availability',
      weight:      4,
    },
    {
      slug:        'auth',
      name:        'Authentication',
      description: 'Supabase Auth / GoTrue — login and session management',
      weight:      3,
    },
    {
      slug:        'api',
      name:        'API & External Services',
      description: 'External API dependencies (storage, edge functions, third-party)',
      weight:      2,
    },
  ];

  const featureIds: Record<string, string> = {};

  for (const f of featureDefs) {
    const { data: existingF } = await supabase
      .from('features')
      .select('id')
      .eq('project_id', projectId)
      .eq('slug', f.slug)
      .single();

    if (existingF) {
      featureIds[f.slug] = existingF.id;
      console.log(`  ✓ Feature "${f.name}" already exists`);
    } else {
      const { data: newF, error } = await supabase
        .from('features')
        .insert({ project_id: projectId, ...f, status: 'unknown', health_score: 0 })
        .select()
        .single();
      if (error || !newF) {
        console.error(`  Failed to create feature "${f.name}":`, error?.message);
      } else {
        featureIds[f.slug] = newF.id;
        console.log(`  ✓ Created feature "${f.name}" (id=${newF.id})`);
      }
    }
  }

  // ── 3. HTTP checks ──────────────────────────────────────────────────────────
  type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  const checkDefs: Array<{
    test_name: string;
    feature_slug: string;
    url: string;
    expected_status: number;
    expected_body_contains?: string;
    max_response_time_ms: number;
    method: HttpMethod;
  }> = [
    {
      test_name:               'Health Endpoint',
      feature_slug:            'general',
      url:                     HEALTH_URL,
      method:                  'GET',
      expected_status:         200,
      expected_body_contains:  '"status"',
      max_response_time_ms:    8000,
    },
    {
      test_name:               'Liveness Probe',
      feature_slug:            'general',
      url:                     LIVE_URL,
      method:                  'GET',
      expected_status:         200,
      expected_body_contains:  '"alive"',
      max_response_time_ms:    5000,
    },
    {
      test_name:               'Readiness Probe',
      feature_slug:            'database',
      url:                     READY_URL,
      method:                  'GET',
      expected_status:         200,
      expected_body_contains:  '"ready"',
      max_response_time_ms:    6000,
    },
  ];

  for (const c of checkDefs) {
    const featureId = featureIds[c.feature_slug] ?? null;

    const testDef = {
      project_id:      projectId,
      feature_id:      featureId,
      test_name:       c.test_name,
      check_type:      'http' as const,
      steps:           [],
      expected_result: `HTTP ${c.expected_status} with valid JSON health response`,
      status:          'pending',
      http_config: {
        method:                  c.method,
        url:                     c.url,
        expected_status:         c.expected_status,
        expected_body_contains:  c.expected_body_contains,
        max_response_time_ms:    c.max_response_time_ms,
      },
    };

    const { data: existingTest } = await supabase
      .from('monitoring_tests')
      .select('id')
      .eq('project_id', projectId)
      .eq('test_name', c.test_name)
      .single();

    if (existingTest) {
      await supabase
        .from('monitoring_tests')
        .update({ http_config: testDef.http_config, feature_id: testDef.feature_id })
        .eq('id', existingTest.id);
      console.log(`✓ HTTP check "${c.test_name}" updated`);
    } else {
      const { data: newTest, error } = await supabase
        .from('monitoring_tests')
        .insert(testDef)
        .select()
        .single();
      if (error || !newTest) {
        console.error(`Failed to create HTTP check "${c.test_name}":`, error?.message);
        process.exit(1);
      }
      console.log(`✓ Created HTTP check "${c.test_name}" → ${c.url}`);
    }
  }

  console.log('\n────────────────────────────────────────────────────');
  console.log('Setup complete!');
  console.log('');
  console.log('Before triggering a monitor run:');
  console.log('  1. Apply migration 004 in Supabase SQL editor:');
  console.log('     supabase/migrations/004_health_snapshots.sql');
  console.log('');
  console.log('Then trigger monitoring:');
  console.log('  2. GitHub Actions → Run workflow (or npx ts-node scripts/run-monitor.ts)');
  console.log('');
  console.log('What you will see in PulseOps:');
  console.log('  • "NCPL Sentinel" project card with health score');
  console.log('  • Health Endpoint card → DB / Auth / external checks broken down');
  console.log(`  • Checks: ${HEALTH_URL}`);
  console.log(`           ${LIVE_URL}`);
  console.log(`           ${READY_URL}`);
  console.log('────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
