-- Migration: Health endpoint snapshots
-- Stores the parsed result of each /api/health poll so the dashboard can show
-- per-check breakdowns, latency trends, and version/uptime data.

create table if not exists health_snapshots (
  id                uuid        primary key default uuid_generate_v4(),
  project_id        uuid        references projects(id) on delete cascade not null,
  test_id           uuid        references monitoring_tests(id) on delete set null,

  -- Normalised overall status
  overall_status    text        not null
    check (overall_status in ('healthy','degraded','critical','unknown')),

  -- Metadata extracted from the response
  service_name      text,
  version           text,
  environment       text,

  -- Performance
  response_time_ms  integer,
  uptime_seconds    bigint,
  memory_percent    integer,

  -- Check aggregates (quick access without parsing JSON)
  checks_total      integer     not null default 0,
  checks_passed     integer     not null default 0,
  checks_failed     integer     not null default 0,
  checks_warning    integer     not null default 0,

  -- Full raw snapshot for drill-down
  snapshot          jsonb       not null,

  created_at        timestamptz not null default now()
);

-- Primary access pattern: latest N snapshots for a project
create index if not exists idx_health_snapshots_project_created
  on health_snapshots(project_id, created_at desc);

-- Status-based alerting queries
create index if not exists idx_health_snapshots_status_created
  on health_snapshots(overall_status, created_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table health_snapshots enable row level security;

create policy "Users can view their own health snapshots"
  on health_snapshots for select
  using (
    exists (
      select 1 from projects
      where projects.id = health_snapshots.project_id
        and projects.user_id = auth.uid()
    )
  );

create policy "Service role can manage health snapshots"
  on health_snapshots for all
  using (auth.role() = 'service_role');

-- ── Realtime ──────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table health_snapshots;

-- ── Auto-cleanup: keep only last 200 snapshots per project ───────────────────
-- Run this manually or as a Supabase cron to prevent unbounded growth.
-- create or replace function trim_health_snapshots() returns void language plpgsql as $$
-- begin
--   delete from health_snapshots
--   where id in (
--     select id from (
--       select id, row_number() over (partition by project_id order by created_at desc) as rn
--       from health_snapshots
--     ) ranked
--     where rn > 200
--   );
-- end;
-- $$;
