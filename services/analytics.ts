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

  const [projectsRes, errorsRes, resultsRes] = await Promise.all([
    supabase.from('projects').select('health_score').eq('user_id', userId),
    supabase
      .from('runtime_errors')
      .select('id', { count: 'exact', head: true })
      .in(
        'project_id',
        (await supabase.from('projects').select('id').eq('user_id', userId)).data?.map(
          (p) => p.id
        ) ?? []
      ),
    supabase
      .from('test_results')
      .select('status')
      .eq('status', 'passed')
      .in(
        'project_id',
        (await supabase.from('projects').select('id').eq('user_id', userId)).data?.map(
          (p) => p.id
        ) ?? []
      )
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const projects = projectsRes.data ?? [];
  const avgScore =
    projects.length > 0
      ? Math.round(projects.reduce((a, p) => a + p.health_score, 0) / projects.length)
      : 0;

  return {
    totalProjects: projects.length,
    averageHealthScore: avgScore,
    activeErrors: errorsRes.count ?? 0,
    passingTests: resultsRes.data?.length ?? 0,
  };
}
