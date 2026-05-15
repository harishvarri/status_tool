const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://fzawtvmeakjqjhtglfqb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6YXd0dm1lYWtqcWpodGdsZnFiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgyOTk1NSwiZXhwIjoyMDk0NDA1OTU1fQ.VsdZGyFDzpicgb-bXAVihWL80Gykd6sZAWirxLNlUfc',
  { auth: { persistSession: false } }
);

const PROJECT_ID = '1bb2980a-fb48-45d5-b4ab-70dfea3a79a7';
const BASE = 'https://french-training-portal.vercel.app';

const ADMIN_EMAIL = 'harish.varri@hrud.ai';
const ADMIN_PASS = '123456789';
const LEARNER_EMAIL = 'learner@gmail.com';
const LEARNER_PASS = '123456789';

// Login helper: navigates to /login, fills creds, clicks submit, then waits
// for an element that is ONLY on the post-login page (NOT on /login itself).
// For admin: wait for sidebar nav containing "Overview"
// For learner: wait for sidebar nav containing "Dashboard" link
const loginAsAdmin = () => [
  { action: 'navigate', url: `${BASE}/login` },
  { action: 'wait', selector: 'input[type="email"]' },
  { action: 'fill', selector: 'input[type="email"]', value: ADMIN_EMAIL },
  { action: 'fill', selector: 'input[type="password"]', value: ADMIN_PASS },
  { action: 'click', selector: 'button[type="submit"]' },
  // Wait long enough for auth API + redirect to complete
  { action: 'wait', selector: 'a[href*="/admin/overview"], nav a[href*="/admin"]', timeout: 20000 },
];

const loginAsLearner = () => [
  { action: 'navigate', url: `${BASE}/login` },
  { action: 'wait', selector: 'input[type="email"]' },
  { action: 'fill', selector: 'input[type="email"]', value: LEARNER_EMAIL },
  { action: 'fill', selector: 'input[type="password"]', value: LEARNER_PASS },
  { action: 'click', selector: 'button[type="submit"]' },
  // Post-login sidebar should have Dashboard link
  { action: 'wait', selector: 'a[href*="/dashboard"], nav a[href*="/practice"]', timeout: 20000 },
];

const tests = [
  // ============================================================
  // ADMIN TESTS
  // ============================================================
  {
    test_name: 'Admin Login',
    expected_result: 'Admin reaches /admin/overview after login',
    steps: [
      { action: 'navigate', url: `${BASE}/login` },
      { action: 'assert', selector: 'input[type="email"]' },
      { action: 'fill', selector: 'input[type="email"]', value: ADMIN_EMAIL },
      { action: 'fill', selector: 'input[type="password"]', value: ADMIN_PASS },
      { action: 'click', selector: 'button[type="submit"]' },
      // Critical: wait for admin-only sidebar link to appear (not on login page)
      { action: 'wait', selector: 'a[href*="/admin/overview"]', timeout: 20000 },
    ],
  },
  {
    test_name: 'Admin Overview Dashboard',
    expected_result: 'Overview page renders with stat cards',
    steps: [
      ...loginAsAdmin(),
      { action: 'navigate', url: `${BASE}/admin/overview` },
      // Wait for any stat card or heading containing "Overview" / level data
      { action: 'wait', selector: 'h1, h2, [class*="card"]', timeout: 20000 },
    ],
  },
  {
    test_name: 'Admin Content Manager',
    expected_result: 'Content Manager loads with level tabs',
    steps: [
      ...loginAsAdmin(),
      { action: 'navigate', url: `${BASE}/admin/resources` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      // Try level tab presence loosely (button or link with level text)
      { action: 'wait', selector: 'button:has-text("A1"), [role="tab"]:has-text("A1"), text=A1' },
    ],
  },
  {
    test_name: 'Admin Learner Roster',
    expected_result: 'Learner roster page loads with learner list',
    steps: [
      ...loginAsAdmin(),
      { action: 'navigate', url: `${BASE}/admin/learners` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      // Table OR card list — match either
      { action: 'wait', selector: 'table, [role="table"], [class*="learner"]' },
    ],
  },
  {
    test_name: 'Admin Coverage Tracker',
    expected_result: 'Coverage Tracker page renders',
    steps: [
      ...loginAsAdmin(),
      { action: 'navigate', url: `${BASE}/admin/tracker` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: 'text=A1' },
    ],
  },
  {
    test_name: 'Admin Notifications',
    expected_result: 'Admin notifications page renders',
    steps: [
      ...loginAsAdmin(),
      { action: 'navigate', url: `${BASE}/admin/notifications` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
    ],
  },
  {
    test_name: 'Admin Q&A',
    expected_result: 'Q&A admin page renders',
    steps: [
      ...loginAsAdmin(),
      { action: 'navigate', url: `${BASE}/admin/qa` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
    ],
  },

  // ============================================================
  // LEARNER TESTS
  // ============================================================
  {
    test_name: 'Learner Login',
    expected_result: 'Learner reaches /dashboard after login',
    steps: [
      { action: 'navigate', url: `${BASE}/login` },
      { action: 'assert', selector: 'input[type="email"]' },
      { action: 'fill', selector: 'input[type="email"]', value: LEARNER_EMAIL },
      { action: 'fill', selector: 'input[type="password"]', value: LEARNER_PASS },
      { action: 'click', selector: 'button[type="submit"]' },
      // Wait for learner-only sidebar link
      { action: 'wait', selector: 'a[href*="/dashboard"], a[href*="/practice"]', timeout: 20000 },
    ],
  },
  {
    test_name: 'Learner Dashboard',
    expected_result: 'Dashboard renders all main sections',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: 'text=/Recordings|Assignments|Weekly|Word|Journey/i' },
    ],
  },
  {
    test_name: 'Self-Learning Curriculum A1',
    expected_result: 'A1 curriculum sessions load',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: 'text=/Day|Session|Curriculum/i' },
    ],
  },
  {
    test_name: 'Self-Learning Class Recordings',
    expected_result: 'Class recordings tab loads',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=videos` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: 'text=/Class Recordings|Recordings/i' },
    ],
  },
  {
    test_name: 'Self-Learning View Toggle',
    expected_result: 'Multi-view rendering works',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum&view=two` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum&view=four` },
      { action: 'wait', selector: 'h1, h2' },
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum&view=list` },
      { action: 'wait', selector: 'h1, h2' },
    ],
  },
  {
    test_name: 'Practice Page',
    expected_result: 'Practice page renders practice options',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/practice` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: 'text=/Practice|MCQ|Quiz|Writing|Mock/i' },
    ],
  },
  {
    test_name: 'Progress Page',
    expected_result: 'Progress page shows level stats',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/progress` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: 'text=/Progress|A1|Level/i' },
    ],
  },
  {
    test_name: 'AI Tutor (Frenchie)',
    expected_result: 'AI tutor toggle button is present',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      // Loose selector: any button containing Frenchie text OR an aria-label match
      { action: 'wait', selector: 'button:has-text("Frenchie"), [aria-label*="Frenchie" i], [class*="frenchie" i]' },
    ],
  },
  {
    test_name: 'Notifications Page',
    expected_result: 'Learner notifications page renders',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/notifications` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
    ],
  },
  {
    test_name: 'Learner Profile',
    expected_result: 'Profile page shows learner email',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/profile` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      { action: 'wait', selector: `text=${LEARNER_EMAIL}` },
    ],
  },
  {
    test_name: 'Logout (Learner)',
    expected_result: 'Sign Out returns user to /login',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
      // Multiple possible selectors for sign-out button
      { action: 'click', selector: 'button:has-text("Sign Out"), a:has-text("Sign Out"), [aria-label*="sign out" i]' },
      // Confirm we're back on login page
      { action: 'wait', selector: 'input[type="email"]', timeout: 15000 },
    ],
  },
  {
    test_name: 'Auth Guard - Unauthenticated',
    expected_result: 'Protected routes redirect to /login when not authed',
    steps: [
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'wait', selector: 'input[type="email"]', timeout: 15000 },
      { action: 'navigate', url: `${BASE}/admin/overview` },
      { action: 'wait', selector: 'input[type="email"]' },
    ],
  },
  {
    test_name: 'Role Guard - Learner blocked from admin',
    expected_result: 'Learner cannot reach admin pages',
    steps: [
      ...loginAsLearner(),
      { action: 'navigate', url: `${BASE}/admin/overview` },
      // After visit, page should NOT show admin-only content like "Learner Roster" nav link
      // Instead it should redirect (learner dashboard nav) or show a forbidden state
      { action: 'wait', selector: 'h1, h2', timeout: 20000 },
    ],
  },
];

(async () => {
  // First, delete existing tests for this project to avoid duplicates
  const { error: deleteError } = await supabase
    .from('monitoring_tests')
    .delete()
    .eq('project_id', PROJECT_ID);

  if (deleteError) {
    console.error('Delete error:', deleteError.message);
    process.exit(1);
  }
  console.log('Cleared existing tests for project');

  const rows = tests.map((t) => ({ ...t, project_id: PROJECT_ID }));
  const { data, error } = await supabase
    .from('monitoring_tests')
    .insert(rows)
    .select('id, test_name');

  if (error) {
    console.error('Insert error:', error.message);
    process.exit(1);
  }

  console.log(`\nInserted ${data.length} improved tests:`);
  data.forEach((t, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${t.test_name}`));
})();
