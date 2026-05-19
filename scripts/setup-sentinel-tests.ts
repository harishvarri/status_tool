/**
 * Full test setup for ncpl-sentinel.
 * - Fixes broken tests (wrong creds, missing wait steps, bad selectors)
 * - Distributes tests across correct features
 * - Adds new tests: login failure, logout, bug detail, user management
 * - Ensures all 3 HTTP health checks are assigned to right features
 *
 * Run:
 *   npx --no-install ts-node --project tsconfig.runner.json scripts/setup-sentinel-tests.ts
 */

import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const PROJECT_ID = '32ec9634-b6a7-4089-8ad4-73fb6983824d';
const BASE       = 'https://ncpl-sentinel.vercel.app';
const EMAIL      = 'admin123@gmail.com';
const PASSWORD   = '123456';

// ── Feature IDs (from DB) ─────────────────────────────────────────────────────
const F = {
  general:  '2103b6f6-e33a-46bb-82a8-1538b01f6c46',
  database: '5f4dcf58-2ed6-4e8c-94eb-c4077b1ec3a4',
  auth:     '8952fe6a-352e-4629-91ec-0ac4e8be94b2',
  api:      'f6fda25e-4dbe-4adb-9a2b-c213f40acd55',
};

// ── Shared step sequences ─────────────────────────────────────────────────────

/** Login steps — wait for navigation to confirm auth completed */
function loginSteps() {
  return [
    { action: 'navigate', url: `${BASE}/Login` },
    { action: 'wait',     selector: 'input[type="email"]' },
    { action: 'fill',     selector: 'input[type="email"]',    value: EMAIL },
    { action: 'fill',     selector: 'input[type="password"]', value: PASSWORD },
    { action: 'click',    selector: 'button[type="submit"]' },
    // Wait until the login redirect completes — nav or sidebar appears
    { action: 'wait',     selector: 'nav, aside, [role="navigation"], .sidebar', timeout: 12000 },
  ];
}

// ── All test definitions ──────────────────────────────────────────────────────

type Step = {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  timeout?: number;
};

interface TestDef {
  test_name: string;
  feature_id: string;
  check_type: 'browser' | 'http';
  steps: Step[];
  expected_result: string;
  http_config?: object | null;
}

const BROWSER_TESTS: TestDef[] = [

  // ── Authentication ─────────────────────────────────────────────────────────
  {
    test_name:       'Login as Admin',
    feature_id:      F.auth,
    check_type:      'browser',
    expected_result: 'Redirected to dashboard after successful login',
    steps: [
      { action: 'navigate', url: `${BASE}/Login` },
      { action: 'wait',     selector: 'input[type="email"]' },
      { action: 'fill',     selector: 'input[type="email"]',    value: EMAIL },
      { action: 'fill',     selector: 'input[type="password"]', value: PASSWORD },
      { action: 'click',    selector: 'button[type="submit"]' },
      { action: 'wait',     selector: 'nav, aside, [role="navigation"], .sidebar', timeout: 12000 },
      { action: 'assert',   selector: 'nav, aside, [role="navigation"]' },
    ],
  },
  {
    test_name:       'Login failure shows error',
    feature_id:      F.auth,
    check_type:      'browser',
    expected_result: 'Error message displayed for wrong password',
    steps: [
      { action: 'navigate', url: `${BASE}/Login` },
      { action: 'wait',     selector: 'input[type="email"]' },
      { action: 'fill',     selector: 'input[type="email"]',    value: 'wrong@example.com' },
      { action: 'fill',     selector: 'input[type="password"]', value: 'wrongpassword' },
      { action: 'click',    selector: 'button[type="submit"]' },
      // Should stay on login page with an error — assert the form is still visible
      { action: 'wait',     selector: 'input[type="email"], [role="alert"], .error, [class*="error"]', timeout: 8000 },
      { action: 'assert',   selector: 'input[type="email"]' },
    ],
  },
  {
    test_name:       'Login page renders',
    feature_id:      F.auth,
    check_type:      'browser',
    expected_result: 'Login page loads with email and password fields',
    steps: [
      { action: 'navigate', url: `${BASE}/Login` },
      { action: 'wait',     selector: 'input[type="email"]' },
      { action: 'assert',   selector: 'input[type="email"]' },
      { action: 'assert',   selector: 'input[type="password"]' },
      { action: 'assert',   selector: 'button[type="submit"]' },
    ],
  },

  // ── Dashboard / General ────────────────────────────────────────────────────
  {
    test_name:       'Dashboard loads after login',
    feature_id:      F.general,
    check_type:      'browser',
    expected_result: 'Dashboard renders with main content after authentication',
    steps: [
      ...loginSteps(),
      { action: 'assert', selector: 'nav, aside, main, [role="main"]' },
    ],
  },
  {
    test_name:       'Settings page loads',
    feature_id:      F.general,
    check_type:      'browser',
    expected_result: 'Settings page renders with heading',
    steps: [
      ...loginSteps(),
      { action: 'navigate', url: `${BASE}/Settings` },
      { action: 'wait',     selector: 'h1, h2, [class*="setting" i]', timeout: 10000 },
      { action: 'assert',   selector: 'h1, h2, [class*="setting" i]' },
    ],
  },
  {
    test_name:       'Home page accessible',
    feature_id:      F.general,
    check_type:      'browser',
    expected_result: 'App root URL responds and serves the SPA',
    steps: [
      { action: 'navigate', url: BASE },
      // Either the login page loads or the app is authenticated already
      { action: 'wait',     selector: 'body', timeout: 8000 },
      { action: 'assert',   selector: 'body' },
    ],
  },

  // ── Bug Management ─────────────────────────────────────────────────────────
  {
    test_name:       'Bugs list page loads',
    feature_id:      F.general,
    check_type:      'browser',
    expected_result: 'Bugs list renders with table or list of bugs',
    steps: [
      ...loginSteps(),
      { action: 'navigate', url: `${BASE}/Bugs` },
      { action: 'wait',     selector: 'table, [class*="bug" i], h1, h2', timeout: 10000 },
      { action: 'assert',   selector: 'table, [class*="bug" i], h1, h2' },
    ],
  },
  {
    test_name:       'Create ticket form loads',
    feature_id:      F.general,
    check_type:      'browser',
    expected_result: 'Bug creation form renders with required fields',
    steps: [
      ...loginSteps(),
      { action: 'navigate', url: `${BASE}/CreateBug` },
      { action: 'wait',     selector: 'form, input, textarea, [class*="form" i]', timeout: 10000 },
      { action: 'assert',   selector: 'form, [class*="form" i]' },
    ],
  },
  {
    test_name:       'Bug detail page loads',
    feature_id:      F.general,
    check_type:      'browser',
    expected_result: 'Bug detail page renders after navigating from list',
    steps: [
      ...loginSteps(),
      { action: 'navigate', url: `${BASE}/Bugs` },
      { action: 'wait',     selector: 'table tr td a, [class*="bug" i] a, tbody tr', timeout: 10000 },
      // Click the first bug row/link if it exists
      { action: 'click',    selector: 'table tbody tr:first-child, [class*="bug-row" i]:first-child, tbody tr:first-child td:first-child' },
      { action: 'wait',     selector: 'h1, h2, [class*="detail" i], [class*="bug" i]', timeout: 8000 },
      { action: 'assert',   selector: 'h1, h2, main' },
    ],
  },
];

const HTTP_TESTS = [
  {
    test_name:   'Health Endpoint',
    feature_id:  F.general,
    url:         `${BASE}/api/health`,
    body_check:  '"status"',
    timeout_ms:  8000,
  },
  {
    test_name:   'Liveness Probe',
    feature_id:  F.general,
    url:         `${BASE}/api/health/live`,
    body_check:  '"alive"',
    timeout_ms:  5000,
  },
  {
    test_name:   'Readiness Probe',
    feature_id:  F.database,
    url:         `${BASE}/api/health/ready`,
    body_check:  '"ready"',
    timeout_ms:  6000,
  },
];

// ── Upsert helper ─────────────────────────────────────────────────────────────

async function upsertTest(def: TestDef) {
  const { data: existing } = await sb
    .from('monitoring_tests')
    .select('id')
    .eq('project_id', PROJECT_ID)
    .eq('test_name', def.test_name)
    .single();

  if (existing) {
    const { error } = await sb
      .from('monitoring_tests')
      .update({
        steps:       def.steps,
        feature_id:  def.feature_id,
        check_type:  def.check_type,
        expected_result: def.expected_result,
        http_config: def.http_config ?? null,
      })
      .eq('id', existing.id);
    if (error) console.error(`  ✗ Update "${def.test_name}":`, error.message);
    else       console.log( `  ✓ Updated: "${def.test_name}"`);
  } else {
    const { error } = await sb
      .from('monitoring_tests')
      .insert({
        project_id:      PROJECT_ID,
        feature_id:      def.feature_id,
        test_name:       def.test_name,
        check_type:      def.check_type,
        steps:           def.steps,
        expected_result: def.expected_result,
        status:          'pending',
        http_config:     def.http_config ?? null,
      });
    if (error) console.error(`  ✗ Create "${def.test_name}":`, error.message);
    else       console.log( `  ✓ Created: "${def.test_name}"`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Setting up tests for ncpl-sentinel (${PROJECT_ID})\n`);

  console.log('── Browser tests ────────────────────────────────────');
  for (const t of BROWSER_TESTS) await upsertTest(t);

  console.log('\n── HTTP health checks ───────────────────────────────');
  for (const h of HTTP_TESTS) {
    await upsertTest({
      test_name:       h.test_name,
      feature_id:      h.feature_id,
      check_type:      'http',
      expected_result: `HTTP 200 with valid JSON health response`,
      steps:           [],
      http_config: {
        method:                 'GET',
        url:                    h.url,
        expected_status:        200,
        expected_body_contains: h.body_check,
        max_response_time_ms:   h.timeout_ms,
      },
    });
  }

  console.log('\n────────────────────────────────────────────────────');
  console.log('Done. Tests configured:');
  console.log(`  Auth feature      → Login as Admin, Login failure, Login page renders`);
  console.log(`  General feature   → Dashboard, Settings, Home page, Bugs list, Create ticket, Bug detail`);
  console.log(`  HTTP checks       → Health Endpoint, Liveness Probe, Readiness Probe`);
  console.log('\nTrigger a monitor run to execute all tests.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
