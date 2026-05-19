import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: projects } = await sb.from('projects').select('id,project_name,project_url,auth_login_url,auth_username,auth_password');
  const sentinel = (projects ?? []).find((p: any) => p.project_name.toLowerCase().includes('sentinel'));
  if (!sentinel) { console.log('No sentinel project found'); return; }

  console.log('PROJECT:', JSON.stringify({ id: sentinel.id, name: sentinel.project_name, url: sentinel.project_url, auth_login_url: sentinel.auth_login_url, auth_username: sentinel.auth_username }, null, 2));

  const { data: tests } = await sb.from('monitoring_tests').select('id,test_name,check_type,feature_id,steps').eq('project_id', sentinel.id);
  console.log('\nTESTS:', JSON.stringify(tests, null, 2));

  const { data: features } = await sb.from('features').select('id,name,slug').eq('project_id', sentinel.id);
  console.log('\nFEATURES:', JSON.stringify(features, null, 2));
}

main().catch(console.error);
