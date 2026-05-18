/**
 * One-time setup script — registers the Galaxy Auto-Filler extension
 * as a monitored project in PulseOps with an HTTP health check.
 *
 * Usage:
 *   1. Deploy Auto-filler-extension-dev to Vercel (get your URL)
 *   2. Set GALAXY_VERCEL_URL env var (or edit the line below)
 *   3. Run:
 *        GALAXY_VERCEL_URL=https://your-app.vercel.app \
 *        npx --no-install ts-node --project tsconfig.runner.json scripts/add-galaxy-extension.ts
 *
 * The script is idempotent: re-running it updates the existing project
 * rather than creating a duplicate.
 */

import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

// ── Config ────────────────────────────────────────────────────────────────────

const VERCEL_URL =
  (process.env.GALAXY_VERCEL_URL ?? '').replace(/\/$/, '') ||
  'https://galaxy-auto-filler.vercel.app'; // ← change if different

const HEALTH_URL = `${VERCEL_URL}/api/health`;

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // We need a user_id to satisfy the FK. Use the first user in the DB.
  const { data: users } = await supabase.from('projects').select('user_id').limit(1);
  const userId = users?.[0]?.user_id;
  if (!userId) {
    console.error('No existing projects found — cannot determine user_id. Add a project first via the dashboard.');
    process.exit(1);
  }

  console.log(`Using user_id: ${userId}`);
  console.log(`Health URL:    ${HEALTH_URL}`);

  // ── 1. Upsert project ───────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('projects')
    .select('id')
    .eq('project_url', VERCEL_URL)
    .single();

  let projectId: string;

  if (existing) {
    projectId = existing.id;
    console.log(`✓ Project already exists (id=${projectId}) — updating URL`);
    await supabase
      .from('projects')
      .update({ project_url: VERCEL_URL, updated_at: new Date().toISOString() })
      .eq('id', projectId);
  } else {
    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id: userId,
        project_name: 'Galaxy Auto-Filler',
        project_url: VERCEL_URL,
        description: 'Chrome extension that auto-fills job application forms using Gemini AI',
        status: 'unknown',
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
      slug: 'general',
      name: 'General',
      description: 'Overall extension health',
      weight: 1,
    },
    {
      slug: 'ai-backend',
      name: 'AI Backend',
      description: 'Gemini API connectivity — required for field classification and resume parsing',
      weight: 3,
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
        console.error(`  Failed to create feature ${f.name}:`, error?.message);
      } else {
        featureIds[f.slug] = newF.id;
        console.log(`  ✓ Created feature "${f.name}" (id=${newF.id})`);
      }
    }
  }

  // ── 3. Upsert HTTP health check test ────────────────────────────────────────
  const testDef = {
    project_id: projectId,
    feature_id: featureIds['ai-backend'] ?? null,
    test_name: 'Health Endpoint',
    check_type: 'http' as const,
    steps: [],
    expected_result: 'Returns HTTP 200 with status: ok',
    status: 'pending',
    http_config: {
      method: 'GET',
      url: HEALTH_URL,
      expected_status: 200,
      expected_body_contains: '"status":"ok"',
      max_response_time_ms: 10000,
    },
  };

  const { data: existingTest } = await supabase
    .from('monitoring_tests')
    .select('id')
    .eq('project_id', projectId)
    .eq('test_name', 'Health Endpoint')
    .single();

  if (existingTest) {
    await supabase
      .from('monitoring_tests')
      .update({ http_config: testDef.http_config, feature_id: testDef.feature_id })
      .eq('id', existingTest.id);
    console.log(`✓ HTTP check updated (id=${existingTest.id})`);
  } else {
    const { data: newTest, error } = await supabase
      .from('monitoring_tests')
      .insert(testDef)
      .select()
      .single();
    if (error || !newTest) {
      console.error('Failed to create HTTP check:', error?.message);
      process.exit(1);
    }
    console.log(`✓ Created HTTP check (id=${newTest.id})`);
  }

  console.log('\n────────────────────────────────────────────────────');
  console.log('Setup complete! Next steps:');
  console.log(`  1. Open PulseOps dashboard → you should see "Galaxy Auto-Filler"`);
  console.log(`  2. Trigger a monitor run (GitHub Actions → Run workflow)`);
  console.log(`  3. PulseOps will hit ${HEALTH_URL}`);
  console.log(`     and update the health score based on Gemini API status.`);
  console.log('────────────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
