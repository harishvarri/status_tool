-- ============================================================
-- PulseOps v2 — Features, HTTP checks, Bug categorization
-- ============================================================

-- ─── New: features table ────────────────────────────────────
create table features (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  slug text not null,
  description text,
  weight integer not null default 1 check (weight > 0),
  health_score integer not null default 0 check (health_score >= 0 and health_score <= 100),
  status text not null default 'unknown' check (status in ('healthy','warning','critical','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create index idx_features_project on features(project_id);

create trigger features_updated_at
  before update on features
  for each row execute function update_updated_at();

alter table features enable row level security;
create policy "users_own_features" on features
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- ─── Extend monitoring_tests ────────────────────────────────
alter table monitoring_tests
  add column feature_id uuid references features(id) on delete set null,
  add column check_type text not null default 'browser'
    check (check_type in ('browser','http')),
  add column http_config jsonb;

create index idx_monitoring_tests_feature on monitoring_tests(feature_id);
create index idx_monitoring_tests_check_type on monitoring_tests(check_type);

-- ─── Extend test_results ────────────────────────────────────
alter table test_results
  add column feature_id uuid references features(id) on delete set null,
  add column http_status_code integer,
  add column response_size_bytes integer;

create index idx_test_results_feature_created
  on test_results(feature_id, created_at desc);

-- ─── Extend runtime_errors with categorization ──────────────
alter table runtime_errors
  add column feature_id uuid references features(id) on delete set null,
  add column category text
    check (category in ('auth','network','ui','js_runtime','api','timeout','db','unknown'));

create index idx_runtime_errors_category on runtime_errors(category, created_at desc);
create index idx_runtime_errors_feature on runtime_errors(feature_id, created_at desc);

-- ─── Extend alerts ──────────────────────────────────────────
alter table alerts
  add column feature_id uuid references features(id) on delete set null,
  add column severity text
    check (severity in ('low','medium','high','critical'));

create index idx_alerts_feature on alerts(feature_id);

-- ─── New: feature_health_logs ───────────────────────────────
create table feature_health_logs (
  id uuid primary key default uuid_generate_v4(),
  feature_id uuid references features(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade not null,
  health_score integer not null check (health_score >= 0 and health_score <= 100),
  status text not null check (status in ('healthy','warning','critical','unknown')),
  checks_run integer not null default 0,
  checks_passed integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_feature_health_logs_feature_created
  on feature_health_logs(feature_id, created_at desc);
create index idx_feature_health_logs_project_created
  on feature_health_logs(project_id, created_at desc);

alter table feature_health_logs enable row level security;
create policy "users_own_feature_health_logs" on feature_health_logs
  for all using (
    project_id in (select id from projects where user_id = auth.uid())
  );

-- ─── Scale optimization: composite index on projects ────────
create index if not exists idx_projects_user_created
  on projects(user_id, created_at desc);

-- ─── Realtime ───────────────────────────────────────────────
alter publication supabase_realtime add table features;
alter publication supabase_realtime add table feature_health_logs;

-- ─── Backfill: create "General" feature per existing project ──
insert into features (project_id, name, slug, description, weight)
select id, 'General', 'general',
       'Default feature group (auto-created during v2 migration)', 1
from projects
on conflict (project_id, slug) do nothing;

-- Backfill existing tests + results + errors with the General feature
update monitoring_tests mt
   set feature_id = f.id
  from features f
 where f.project_id = mt.project_id
   and f.slug = 'general'
   and mt.feature_id is null;

update test_results tr
   set feature_id = f.id
  from features f
 where f.project_id = tr.project_id
   and f.slug = 'general'
   and tr.feature_id is null;

update runtime_errors re
   set feature_id = f.id
  from features f
 where f.project_id = re.project_id
   and f.slug = 'general'
   and re.feature_id is null;
