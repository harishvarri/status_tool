import { createClient } from '@/lib/supabase/server';
import type { HealthLog, UptimeSummary, ErrorFrequencyData, ResponseTimeData } from '@/types';

export async function getHealthLogs(projectId: string, days = 7): Promise<HealthLog[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('health_logs')
    .select('*')
    .eq('project_id', projectId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getUptimeSummary(projectId: string): Promise<UptimeSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('health_logs')
    .select('status, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  const logs = data ?? [];
  const total = logs.length;
  const healthy = logs.filter((l) => l.status === 'healthy').length;
  const last = logs[0]?.created_at ?? null;

  return {
    uptime_percentage: total > 0 ? Math.round((healthy / total) * 100) : 0,
    total_checks: total,
    healthy_checks: healthy,
    last_checked: last,
  };
}

export async function getErrorFrequency(
  projectId: string,
  days = 7
): Promise<ErrorFrequencyData[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('runtime_errors')
    .select('created_at')
    .eq('project_id', projectId)
    .gte('created_at', since);
  if (error) throw error;

  const countByDate: Record<string, number> = {};
  for (const row of data ?? []) {
    const date = row.created_at.slice(0, 10);
    countByDate[date] = (countByDate[date] ?? 0) + 1;
  }

  return Object.entries(countByDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getResponseTimes(
  projectId: string,
  limit = 50
): Promise<ResponseTimeData[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('test_results')
    .select('created_at, duration_ms, monitoring_tests(test_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    created_at: row.created_at,
    duration_ms: row.duration_ms,
    test_name: (row.monitoring_tests as unknown as { test_name: string } | null)?.test_name ?? 'Unknown',
  }));
}

export async function getDashboardStats(userId: string): Promise<{
  totalProjects: number;
  averageHealthScore: number;
  activeErrors: number;
  passingTests: number;
}> {
  const supabase = await createClient();

  // Step 1: One query to get all user project IDs + health scores
  const { data: projects } = await supabase
    .from('projects')
    .select('id, health_score')
    .eq('user_id', userId);

  const projectIds = (projects ?? []).map((p) => p.id);

  if (projectIds.length === 0) {
    return { totalProjects: 0, averageHealthScore: 0, activeErrors: 0, passingTests: 0 };
  }

  // Step 2: Two parallel queries using cached project IDs (no N+1)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [errorsRes, resultsRes] = await Promise.all([
    supabase
      .from('runtime_errors')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds),
    supabase
      .from('test_results')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'passed')
      .in('project_id', projectIds)
      .gte('created_at', since24h),
  ]);

  const avgScore =
    projects && projects.length > 0
      ? Math.round(
          projects.reduce((a, p) => a + (p.health_score ?? 0), 0) / projects.length
        )
      : 0;

  return {
    totalProjects: projects?.length ?? 0,
    averageHealthScore: avgScore,
    activeErrors: errorsRes.count ?? 0,
    passingTests: resultsRes.count ?? 0,
  };
}

/** Paginated project list — for dashboards with 50+ projects. */
export async function getProjectsPaginated(
  userId: string,
  page = 0,
  pageSize = 12
): Promise<{
  projects: Array<{
    id: string;
    project_name: string;
    project_url: string;
    description: string | null;
    status: string;
    health_score: number;
    updated_at: string;
  }>;
  total: number;
}> {
  const supabase = await createClient();
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const [pageRes, countRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, project_name, project_url, description, status, health_score, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(from, to),
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  return {
    projects: (pageRes.data ?? []) as Array<{
      id: string;
      project_name: string;
      project_url: string;
      description: string | null;
      status: string;
      health_score: number;
      updated_at: string;
    }>,
    total: countRes.count ?? 0,
  };
}
