import { createClient } from '@/lib/supabase/server';
import type {
  BugCategory,
  BugCategoryBreakdown,
  FailingFeatureSummary,
  BugTrendPoint,
} from '@/types';

/** Counts of errors per category over `days` for one project (or all user projects). */
export async function getBugCategoryBreakdown(
  projectId: string | null,
  days = 7
): Promise<BugCategoryBreakdown[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('runtime_errors')
    .select('category')
    .gte('created_at', since);

  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) throw error;

  const counts = new Map<BugCategory, number>();
  let total = 0;
  for (const row of data ?? []) {
    const cat = (row.category ?? 'unknown') as BugCategory;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
    total++;
  }

  const breakdown: BugCategoryBreakdown[] = Array.from(counts.entries()).map(
    ([category, count]) => ({
      category,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    })
  );

  // Sort: descending by count
  return breakdown.sort((a, b) => b.count - a.count);
}

/** Daily error counts per category over `days`. Used for trend charts. */
export async function getBugTrends(
  projectId: string | null,
  days = 7
): Promise<BugTrendPoint[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('runtime_errors')
    .select('category, created_at')
    .gte('created_at', since);
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) throw error;

  const trends = new Map<string, BugTrendPoint>();
  for (const row of data ?? []) {
    const date = row.created_at.slice(0, 10);
    const cat = (row.category ?? 'unknown') as BugCategory;
    const key = `${date}::${cat}`;
    const existing = trends.get(key);
    if (existing) {
      existing.count++;
    } else {
      trends.set(key, { date, category: cat, count: 1 });
    }
  }

  return Array.from(trends.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Top failing features across all user projects (or just one). */
export async function getTopFailingFeatures(
  projectId: string | null,
  limit = 10
): Promise<FailingFeatureSummary[]> {
  const supabase = await createClient();

  let query = supabase
    .from('features')
    .select('id, name, project_id, health_score, status, projects(project_name)')
    .order('health_score', { ascending: true });
  if (projectId) query = query.eq('project_id', projectId);

  const { data: features, error } = await query.limit(limit);
  if (error) throw error;

  if (!features?.length) return [];

  // For each feature, count its checks/failures in the last 24h
  const featureIds = features.map((f) => f.id);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: results } = await supabase
    .from('test_results')
    .select('feature_id, status')
    .in('feature_id', featureIds)
    .gte('created_at', since);

  const stats = new Map<string, { failed: number; total: number }>();
  for (const r of results ?? []) {
    if (!r.feature_id) continue;
    const s = stats.get(r.feature_id) ?? { failed: 0, total: 0 };
    s.total++;
    if (r.status !== 'passed') s.failed++;
    stats.set(r.feature_id, s);
  }

  return features.map((f) => {
    const s = stats.get(f.id) ?? { failed: 0, total: 0 };
    const projectName = (f.projects as unknown as { project_name: string } | null)
      ?.project_name ?? 'Unknown';
    return {
      feature_id: f.id,
      feature_name: f.name,
      project_id: f.project_id,
      project_name: projectName,
      health_score: f.health_score,
      status: f.status,
      failed_checks: s.failed,
      total_checks: s.total,
    };
  });
}

/**
 * Mean Time To Recovery (MTTR) — average time between a failure and the next
 * successful check on the same test, in seconds.
 */
export async function getMTTR(projectId: string): Promise<number | null> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('test_results')
    .select('test_id, status, created_at')
    .eq('project_id', projectId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error || !data?.length) return null;

  const failures = new Map<string, string>(); // test_id -> failure time
  const recoveries: number[] = [];

  for (const row of data) {
    if (row.status !== 'passed') {
      // Track first failure for this test
      if (!failures.has(row.test_id)) failures.set(row.test_id, row.created_at);
    } else {
      const failureTime = failures.get(row.test_id);
      if (failureTime) {
        const delta = (new Date(row.created_at).getTime() - new Date(failureTime).getTime()) / 1000;
        recoveries.push(delta);
        failures.delete(row.test_id);
      }
    }
  }

  if (recoveries.length === 0) return null;
  const avg = recoveries.reduce((a, b) => a + b, 0) / recoveries.length;
  return Math.round(avg);
}
