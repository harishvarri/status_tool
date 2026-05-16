import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { HealthScoreBadge } from '@/components/dashboard/HealthScoreBadge';
import { TestResultsList } from '@/components/projects/TestResultsList';
import { ErrorFeed } from '@/components/dashboard/ErrorFeed';
import { HealthTrendChart } from '@/components/charts/HealthTrendChart';
import { ErrorFrequencyChart } from '@/components/charts/ErrorFrequencyChart';
import { ResponseTimeChart } from '@/components/charts/ResponseTimeChart';
import { BugCategoryChart } from '@/components/analytics/BugCategoryChart';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';

export default async function FeatureDetailPage({
  params,
}: {
  params: Promise<{ id: string; featureId: string }>;
}) {
  const { id, featureId } = await params;
  const supabase = await createClient();

  const [{ data: feature }, { data: project }] = await Promise.all([
    supabase.from('features').select('*').eq('id', featureId).single(),
    supabase.from('projects').select('project_name').eq('id', id).single(),
  ]);

  if (!feature) notFound();

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [resultsRes, errorsRes, featureLogsRes, errorFreqRes, responseTimesRes] =
    await Promise.all([
      supabase
        .from('test_results')
        .select('*, monitoring_tests(test_name)')
        .eq('feature_id', featureId)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('runtime_errors')
        .select('*')
        .eq('feature_id', featureId)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('feature_health_logs')
        .select('*')
        .eq('feature_id', featureId)
        .gte('created_at', since)
        .order('created_at', { ascending: true }),
      supabase
        .from('runtime_errors')
        .select('created_at, category')
        .eq('feature_id', featureId)
        .gte('created_at', since),
      supabase
        .from('test_results')
        .select('created_at, duration_ms, monitoring_tests(test_name)')
        .eq('feature_id', featureId)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

  // Adapt feature_health_logs to HealthLog shape for the chart
  const healthLogsForChart = (featureLogsRes.data ?? []).map((l) => ({
    id: l.id,
    project_id: l.project_id,
    health_score: l.health_score,
    status: l.status,
    tests_run: l.checks_run,
    tests_passed: l.checks_passed,
    created_at: l.created_at,
  }));

  const errorFreqMap: Record<string, number> = {};
  const errorCategoryMap: Record<string, number> = {};
  let totalErrors = 0;
  for (const e of errorFreqRes.data ?? []) {
    const d = e.created_at.slice(0, 10);
    errorFreqMap[d] = (errorFreqMap[d] ?? 0) + 1;
    const cat = e.category ?? 'unknown';
    errorCategoryMap[cat] = (errorCategoryMap[cat] ?? 0) + 1;
    totalErrors++;
  }
  const errorFreqData = Object.entries(errorFreqMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const bugCategoryData = Object.entries(errorCategoryMap)
    .map(([category, count]) => ({
      category: category as Parameters<typeof BugCategoryChart>[0]['data'][number]['category'],
      count,
      percentage: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const responseTimes = (responseTimesRes.data ?? []).map((r) => ({
    created_at: r.created_at,
    duration_ms: r.duration_ms,
    test_name:
      (r.monitoring_tests as unknown as { test_name: string } | null)?.test_name ?? 'Check',
  }));

  return (
    <div>
      <PageHeader
        title={feature.name}
        description={feature.description ?? `${project?.project_name} feature`}
      >
        <Link href={`/projects/${id}/features`}>
          <Button variant="outline" size="sm">
            <ChevronLeft className="w-4 h-4 mr-1.5" />
            All features
          </Button>
        </Link>
      </PageHeader>

      {/* Health hero */}
      <div className="flex items-center gap-4 mb-6 p-4 rounded-xl border border-border bg-card">
        <div className="text-4xl font-bold text-foreground">{feature.health_score}%</div>
        <div>
          <HealthScoreBadge
            score={feature.health_score}
            status={feature.status}
            size="lg"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Based on {resultsRes.data?.length ?? 0} recent check results · weight {feature.weight}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <HealthTrendChart data={healthLogsForChart} />
        <ErrorFrequencyChart data={errorFreqData} />
        <ResponseTimeChart data={responseTimes} />
        <BugCategoryChart data={bugCategoryData} />
      </div>

      {/* Results + Errors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TestResultsList
          results={
            (resultsRes.data ?? []) as Parameters<typeof TestResultsList>[0]['results']
          }
        />
        <ErrorFeed errors={errorsRes.data ?? []} />
      </div>
    </div>
  );
}
