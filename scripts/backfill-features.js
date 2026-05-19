/**
 * Post-migration backfill for French Training Portal:
 *  1. Create proper feature groups (replacing the default "General" feature)
 *  2. Reassign existing tests to the right features
 *  3. Verify counts
 *
 * Run AFTER applying supabase/migrations/002_features_and_http_checks.sql.
 */
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://fzawtvmeakjqjhtglfqb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6YXd0dm1lYWtqcWpodGdsZnFiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgyOTk1NSwiZXhwIjoyMDk0NDA1OTU1fQ.VsdZGyFDzpicgb-bXAVihWL80Gykd6sZAWirxLNlUfc',
  { auth: { persistSession: false } }
);

const FRENCH_PROJECT_ID = '1bb2980a-fb48-45d5-b4ab-70dfea3a79a7';
const NCPL_PROJECT_ID = '32ec9634-b6a7-4089-8ad4-73fb6983824d';

// French Training Portal — feature definitions
const FRENCH_FEATURES = [
  { name: 'Authentication', slug: 'auth', description: 'Login, signup, session', weight: 5 },
  { name: 'Admin', slug: 'admin', description: 'Admin pages: overview, content, learners, tracker, notifications, QA', weight: 4 },
  { name: 'Learner Dashboard', slug: 'learner-dashboard', description: 'Main learner dashboard + AI tutor', weight: 4 },
  { name: 'Self-Learning', slug: 'self-learning', description: 'Curriculum, recordings, view toggles', weight: 3 },
  { name: 'Practice & Progress', slug: 'practice-progress', description: 'Practice tools and progress tracking', weight: 3 },
  { name: 'Profile & Notifications', slug: 'profile-notifications', description: 'Learner profile and notifications', weight: 2 },
  { name: 'Authorization', slug: 'authorization', description: 'Auth guards, role guards, logout', weight: 5 },
];

// Mapping: test_name pattern → feature slug
const FRENCH_TEST_TO_FEATURE = (testName) => {
  const n = testName.toLowerCase();
  if (n === 'admin login' || n === 'learner login') return 'auth';
  if (n.startsWith('admin ')) return 'admin';
  if (n === 'learner dashboard' || n === 'ai tutor (frenchie)') return 'learner-dashboard';
  if (n.startsWith('self-learning')) return 'self-learning';
  if (n === 'practice page' || n === 'progress page') return 'practice-progress';
  if (n === 'notifications page' || n === 'learner profile') return 'profile-notifications';
  if (n.includes('logout') || n.includes('auth guard') || n.includes('role guard')) return 'authorization';
  return 'auth';
};

async function backfillProjectFeatures(projectId, featureDefs, mapTestToFeatureSlug, label) {
  console.log(`\n=== Backfilling ${label} (${projectId}) ===`);

  // 1. Delete the auto-created "General" feature if it has no tests yet OR keep it empty
  //    Strategy: don't delete — we'll just leave it as a fallback. New features take precedence.

  // 2. Create the real features (upsert by slug)
  const featuresToInsert = featureDefs.map((f) => ({
    project_id: projectId,
    name: f.name,
    slug: f.slug,
    description: f.description,
    weight: f.weight,
  }));

  const { data: createdFeatures, error: insertErr } = await supabase
    .from('features')
    .upsert(featuresToInsert, { onConflict: 'project_id,slug', ignoreDuplicates: false })
    .select('id, slug');

  if (insertErr) {
    console.error(`  ERROR creating features:`, insertErr.message);
    return;
  }

  const slugToId = new Map(createdFeatures.map((f) => [f.slug, f.id]));
  console.log(`  Created/updated ${createdFeatures.length} features`);

  // 3. Fetch all tests for this project
  const { data: tests, error: testsErr } = await supabase
    .from('monitoring_tests')
    .select('id, test_name')
    .eq('project_id', projectId);

  if (testsErr) {
    console.error(`  ERROR fetching tests:`, testsErr.message);
    return;
  }

  if (!tests?.length) {
    console.log(`  No tests to reassign`);
    return;
  }

  // 4. Reassign each test to its proper feature
  const updates = tests.map((t) => {
    const slug = mapTestToFeatureSlug(t.test_name);
    const featureId = slugToId.get(slug);
    return { id: t.id, name: t.test_name, target_feature: slug, feature_id: featureId };
  });

  let updated = 0;
  for (const u of updates) {
    if (!u.feature_id) {
      console.warn(`    No feature for "${u.name}" (slug "${u.target_feature}")`);
      continue;
    }
    const { error } = await supabase
      .from('monitoring_tests')
      .update({ feature_id: u.feature_id })
      .eq('id', u.id);
    if (error) {
      console.error(`    Failed to update "${u.name}":`, error.message);
    } else {
      updated++;
    }
  }
  console.log(`  Reassigned ${updated} of ${tests.length} tests`);

  // 5. Show breakdown
  const breakdown = new Map();
  for (const u of updates) {
    breakdown.set(u.target_feature, (breakdown.get(u.target_feature) ?? 0) + 1);
  }
  console.log(`  Distribution:`);
  for (const [slug, count] of breakdown) {
    console.log(`    ${slug.padEnd(24)} ${count} test(s)`);
  }
}

// NCPL Sentinel — feature definitions
const NCPL_FEATURES = [
  { name: 'Authentication', slug: 'auth', description: 'Login flow', weight: 5 },
  { name: 'Dashboard', slug: 'dashboard', description: 'Main metrics dashboard', weight: 4 },
  { name: 'Tickets', slug: 'tickets', description: 'Bug list, create, detail', weight: 4 },
  { name: 'Settings', slug: 'settings', description: 'User settings page', weight: 2 },
];

const NCPL_TEST_TO_FEATURE = (testName) => {
  const n = testName.toLowerCase();
  if (n.includes('login')) return 'auth';
  if (n.includes('dashboard') || n.includes('metric')) return 'dashboard';
  if (n.includes('bug') || n.includes('ticket') || n.includes('create')) return 'tickets';
  if (n.includes('setting')) return 'settings';
  return 'dashboard';
};

(async () => {
  await backfillProjectFeatures(
    FRENCH_PROJECT_ID,
    FRENCH_FEATURES,
    FRENCH_TEST_TO_FEATURE,
    'French Training Portal'
  );

  await backfillProjectFeatures(
    NCPL_PROJECT_ID,
    NCPL_FEATURES,
    NCPL_TEST_TO_FEATURE,
    'NCPL Sentinel'
  );

  // Also backfill test_results.feature_id from monitoring_tests.feature_id
  console.log(`\n=== Backfilling test_results.feature_id ===`);
  const { data: tests } = await supabase
    .from('monitoring_tests')
    .select('id, feature_id')
    .not('feature_id', 'is', null);

  if (tests?.length) {
    for (const t of tests) {
      const { error, count } = await supabase
        .from('test_results')
        .update({ feature_id: t.feature_id })
        .eq('test_id', t.id)
        .is('feature_id', null);
      if (!error) console.log(`  test ${t.id.slice(0, 8)} → ${count ?? 0} results updated`);
    }
  }

  console.log(`\nDone.`);
})();
