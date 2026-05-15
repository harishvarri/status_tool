-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Projects table
create table projects (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  project_name text not null,
  project_url text not null,
  description text,
  status text not null default 'unknown' check (status in ('healthy','warning','critical','unknown')),
  health_score integer not null default 0 check (health_score >= 0 and health_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Monitoring tests table
create table monitoring_tests (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  test_name text not null,
  steps jsonb not null default '[]',
  expected_result text not null,
  status text not null default 'pending' check (status in ('passed','failed','error','pending')),
  created_at timestamptz not null default now()
);

-- Test results table
create table test_results (
  id uuid primary key default uuid_generate_v4(),
  test_id uuid references monitoring_tests(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  status text not null check (status in ('passed','failed','error')),
  error_message text,
  screenshot_url text,
  duration_ms integer not null default 0,
  created_at timestamptz not null default now()
);

-- Runtime errors table
create table runtime_errors (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  error_message text not null,
  page_url text not null,
  functionality text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  screenshot_url text,
  created_at timestamptz not null default now()
);

-- Screenshots table
create table screenshots (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  test_result_id uuid references test_results(id) on delete set null,
  storage_path text not null,
  public_url text not null,
  created_at timestamptz not null default now()
);

-- Health logs table
create table health_logs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  health_score integer not null check (health_score >= 0 and health_score <= 100),
  status text not null check (status in ('healthy','warning','critical','unknown')),
  tests_run integer not null default 0,
  tests_passed integer not null default 0,
  created_at timestamptz not null default now()
);

-- Alerts table
create table alerts (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  alert_type text not null,
  message text not null,
  status text not null default 'active' check (status in ('active','resolved')),
  created_at timestamptz not null default now()
);

-- Row Level Security
alter table projects enable row level security;
alter table monitoring_tests enable row level security;
alter table test_results enable row level security;
alter table runtime_errors enable row level security;
alter table screenshots enable row level security;
alter table health_logs enable row level security;
alter table alerts enable row level security;

-- RLS Policies
create policy "users_own_projects" on projects
  for all using (auth.uid() = user_id);

create policy "users_own_tests" on monitoring_tests
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users_own_test_results" on test_results
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users_own_runtime_errors" on runtime_errors
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users_own_screenshots" on screenshots
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users_own_health_logs" on health_logs
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

create policy "users_own_alerts" on alerts
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- Performance indexes
create index idx_test_results_project_created on test_results(project_id, created_at desc);
create index idx_runtime_errors_project_created on runtime_errors(project_id, created_at desc);
create index idx_health_logs_project_created on health_logs(project_id, created_at desc);
create index idx_alerts_project_status on alerts(project_id, status);
create index idx_monitoring_tests_project on monitoring_tests(project_id);

-- Auto-update projects.updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- Screenshot cleanup (delete screenshots older than 30 days)
create or replace function cleanup_old_screenshots()
returns void as $$
begin
  delete from screenshots where created_at < now() - interval '30 days';
end;
$$ language plpgsql;

-- Enable Realtime for key tables
alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table test_results;
alter publication supabase_realtime add table runtime_errors;
alter publication supabase_realtime add table health_logs;
alter publication supabase_realtime add table alerts;
