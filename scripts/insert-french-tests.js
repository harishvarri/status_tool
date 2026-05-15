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

// Helper: build a login prefix (steps to log in as a given user)
const loginAs = (email, pass) => [
  { action: 'navigate', url: `${BASE}/login` },
  { action: 'wait', selector: 'input[type="email"]' },
  { action: 'fill', selector: 'input[type="email"]', value: email },
  { action: 'fill', selector: 'input[type="password"]', value: pass },
  { action: 'click', selector: 'button[type="submit"]' },
];

const tests = [
  {
    test_name: 'Admin Login',
    expected_result: 'Admin lands on /admin/overview',
    steps: [
      { action: 'navigate', url: `${BASE}/login` },
      { action: 'assert', selector: 'input[type="email"]' },
      { action: 'fill', selector: 'input[type="email"]', value: ADMIN_EMAIL },
      { action: 'fill', selector: 'input[type="password"]', value: ADMIN_PASS },
      { action: 'click', selector: 'button[type="submit"]' },
      { action: 'wait', selector: 'h1, nav' },
    ],
  },
  {
    test_name: 'Admin Overview Dashboard',
    expected_result: 'Overview page shows stats',
    steps: [
      ...loginAs(ADMIN_EMAIL, ADMIN_PASS),
      { action: 'navigate', url: `${BASE}/admin/overview` },
      { action: 'assert', selector: 'text=Overview' },
      { action: 'assert', selector: 'text=A1' },
    ],
  },
  {
    test_name: 'Admin Content Manager',
    expected_result: 'Content Manager loads all level tabs',
    steps: [
      ...loginAs(ADMIN_EMAIL, ADMIN_PASS),
      { action: 'navigate', url: `${BASE}/admin/resources` },
      { action: 'assert', selector: 'text=Content Manager' },
      { action: 'assert', selector: 'text=A1' },
      { action: 'click', selector: 'text=A1' },
      { action: 'assert', selector: 'text=Managing A1' },
      { action: 'click', selector: 'text=A2' },
      { action: 'assert', selector: 'text=Managing A2' },
    ],
  },
  {
    test_name: 'Admin Learner Roster',
    expected_result: 'Learner roster shows enrolled learners',
    steps: [
      ...loginAs(ADMIN_EMAIL, ADMIN_PASS),
      { action: 'navigate', url: `${BASE}/admin/learners` },
      { action: 'assert', selector: 'text=Learner Roster' },
      { action: 'assert', selector: 'table, [role="table"]' },
      { action: 'assert', selector: 'text=learner@gmail.com' },
    ],
  },
  {
    test_name: 'Admin Coverage Tracker',
    expected_result: 'Coverage Tracker shows session gaps',
    steps: [
      ...loginAs(ADMIN_EMAIL, ADMIN_PASS),
      { action: 'navigate', url: `${BASE}/admin/tracker` },
      { action: 'assert', selector: 'text=Coverage Tracker' },
      { action: 'assert', selector: 'text=A1' },
      { action: 'assert', selector: 'text=Class Recordings' },
      { action: 'click', selector: 'text=A2' },
      { action: 'assert', selector: 'text=A2' },
    ],
  },
  {
    test_name: 'Admin Notifications',
    expected_result: 'Admin notifications page loads',
    steps: [
      ...loginAs(ADMIN_EMAIL, ADMIN_PASS),
      { action: 'navigate', url: `${BASE}/admin/notifications` },
      { action: 'assert', selector: 'text=Notifications' },
    ],
  },
  {
    test_name: 'Admin Q&A',
    expected_result: 'Q&A management page loads',
    steps: [
      ...loginAs(ADMIN_EMAIL, ADMIN_PASS),
      { action: 'navigate', url: `${BASE}/admin/qa` },
      { action: 'assert', selector: 'text=/Q&A|Doubts/i' },
    ],
  },
  {
    test_name: 'Learner Login',
    expected_result: 'Learner lands on /dashboard',
    steps: [
      { action: 'navigate', url: `${BASE}/login` },
      { action: 'fill', selector: 'input[type="email"]', value: LEARNER_EMAIL },
      { action: 'fill', selector: 'input[type="password"]', value: LEARNER_PASS },
      { action: 'click', selector: 'button[type="submit"]' },
      { action: 'assert', selector: 'text=Welcome back' },
    ],
  },
  {
    test_name: 'Learner Dashboard',
    expected_result: 'Full dashboard renders all sections',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'assert', selector: 'text=Welcome back' },
      { action: 'assert', selector: 'text=Recordings' },
      { action: 'assert', selector: 'text=Assignments' },
      { action: 'assert', selector: 'text=Weekly Activity' },
      { action: 'assert', selector: 'text=Word of the Day' },
      { action: 'assert', selector: 'text=Learning Journey' },
      { action: 'assert', selector: 'text=Class Recordings' },
    ],
  },
  {
    test_name: 'Self-Learning Curriculum A1',
    expected_result: 'A1 curriculum sessions load',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum` },
      { action: 'assert', selector: 'text=Self-Learning' },
      { action: 'assert', selector: 'text=A1' },
      { action: 'assert', selector: 'text=Curriculum' },
      { action: 'assert', selector: 'text=Day' },
    ],
  },
  {
    test_name: 'Self-Learning Class Recordings',
    expected_result: 'Class recordings tab loads',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=videos` },
      { action: 'assert', selector: 'text=Class Recordings' },
      { action: 'assert', selector: 'a[target="_blank"]' },
    ],
  },
  {
    test_name: 'Self-Learning View Toggle',
    expected_result: 'All view modes render content',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum&view=two` },
      { action: 'assert', selector: '[title="4 columns"]' },
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum&view=four` },
      { action: 'navigate', url: `${BASE}/self-learning?level=A1&section=curriculum&view=list` },
      { action: 'assert', selector: 'text=Day' },
    ],
  },
  {
    test_name: 'Practice Page',
    expected_result: 'Practice page loads with all practice types',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/practice` },
      { action: 'assert', selector: 'text=Practice' },
      { action: 'assert', selector: 'text=/MCQ|Quiz/' },
      { action: 'assert', selector: 'text=Writing' },
      { action: 'assert', selector: 'text=Mock Test' },
    ],
  },
  {
    test_name: 'Progress Page',
    expected_result: 'Progress page shows level completion',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/progress` },
      { action: 'assert', selector: 'text=Progress' },
      { action: 'assert', selector: 'text=A1' },
    ],
  },
  {
    test_name: 'AI Tutor (Frenchie)',
    expected_result: 'AI tutor panel opens',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'wait', selector: 'text=Welcome back' },
      { action: 'click', selector: 'button[aria-label*="Frenchie" i], button:has-text("Frenchie")' },
      { action: 'assert', selector: 'text=Frenchie' },
    ],
  },
  {
    test_name: 'Notifications Page',
    expected_result: 'Learner notifications page loads',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/notifications` },
      { action: 'assert', selector: 'text=Notifications' },
    ],
  },
  {
    test_name: 'Learner Profile',
    expected_result: 'Profile page shows learner data',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/profile` },
      { action: 'assert', selector: 'text=Profile' },
      { action: 'assert', selector: 'text=learner@gmail.com' },
    ],
  },
  {
    test_name: 'Logout (Learner)',
    expected_result: 'Session cleared and redirected to /login',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'click', selector: 'text=Sign Out' },
      { action: 'assert', selector: 'input[type="email"]' },
    ],
  },
  {
    test_name: 'Auth Guard - Unauthenticated',
    expected_result: 'Protected routes redirect to /login',
    steps: [
      { action: 'navigate', url: `${BASE}/dashboard` },
      { action: 'assert', selector: 'input[type="email"]' },
      { action: 'navigate', url: `${BASE}/admin/overview` },
      { action: 'assert', selector: 'input[type="email"]' },
    ],
  },
  {
    test_name: 'Role Guard - Learner blocked from admin',
    expected_result: 'Learner cannot access admin routes',
    steps: [
      ...loginAs(LEARNER_EMAIL, LEARNER_PASS),
      { action: 'navigate', url: `${BASE}/admin/overview` },
      { action: 'assert', selector: 'text=/Welcome back|Dashboard|Forbidden|Unauthorized/i' },
    ],
  },
];

(async () => {
  // Add project_id to all tests
  const rows = tests.map((t) => ({ ...t, project_id: PROJECT_ID }));

  const { data, error } = await supabase.from('monitoring_tests').insert(rows).select('id, test_name');

  if (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }

  console.log(`Inserted ${data.length} tests:`);
  data.forEach((t, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${t.test_name}`));
})();
