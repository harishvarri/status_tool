import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { HealthScoreBadge } from '@/components/dashboard/HealthScoreBadge';
import { HealthCheckBreakdown } from '@/components/dashboard/HealthCheckBreakdown';
import { TestResultsList } from '@/components/projects/TestResultsList';
import { ErrorFeed } from '@/components/dashboard/ErrorFeed';
import { HealthTrendChart } from '@/components/charts/HealthTrendChart';
import { ErrorFrequencyChart } from '@/components/charts/ErrorFrequencyChart';
import { ResponseTimeChart } from '@/components/charts/ResponseTimeChart';
import { Button } from '@/components/ui/button';
import { FeatureCard } from '@/components/features/FeatureCard';
import { ProjectActions } from '@/components/projects/ProjectActions';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, Layers } from 'lucide-react';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single();

  if (!project) notFound();

  const [featuresRes, resultsRes, errorsRes, healthLogsRes, errorFreqRes, responseTimesRes, httpTestsRes] =
    await Promise.all([
      supabase
        .from('features')
        .select('*')
        .eq('project_id', id)
        .order('weight', { ascending: false })
        .order('created_at', { ascending: true }),
      supabase
        .from('test_results')
        .select('*, monitoring_tests(test_name)')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('runtime_errors')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('health_logs')
        .select('*')
        .eq('project_id', id)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true }),
      supabase
        .from('runtime_errors')
        .select('created_at')
        .eq('project_id', id)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from('test_results')
        .select('created_at, duration_ms, monitoring_tests(test_name)')
        .eq('project_id', id)
        .order('created_at', { ascending: false })
        .limit(30),
      // Check if this project has HTTP health checks configured
      supabase
        .from('monitoring_tests')
        .select('id')
        .eq('project_id', id)
        .eq('check_type', 'http')
        .limit(1),
    ]);

  // Does this project have any HTTP health checks?
  const hasHealthEndpoint = (httpTestsRes.data?.length ?? 0) > 0;

  // Build error frequency data
  const errorFreqMap: Record<string, number> = {};
  for (const e of errorFreqRes.data ?? []) {
    const d = e.created_at.slice(0, 10);
    errorFreqMap[d] = (errorFreqMap[d] ?? 0) + 1;
  }
  const errorFreqData = Object.entries(errorFreqMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const responseTimes = (responseTimesRes.data ?? []).map((r) => ({
    created_at: r.created_at,
    duration_ms: r.duration_ms,
    test_name:
      (r.monitoring_tests as unknown as { test_name: string } | null)?.test_name ?? 'Unknown',
  }));

  return (
    <div>
      <PageHeader title={project.project_name} description={project.description ?? undefined}>
        <div className="flex items-center gap-2">
          <a
            href={project.project_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Visit
          </a>
          <Link href={`/projects/${id}/features`}>
            <Button variant="outline" size="sm">
              <Layers className="w-4 h-4 mr-1.5" />
              Features
            </Button>
          </Link>
          <Link href={`/projects/${id}/errors`}>
            <Button variant="outline" size="sm">
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              Errors
            </Button>
          </Link>
          <ProjectActions projectId={id} projectName={project.project_name} />
        </div>
      </PageHeader>

      {/* Health score hero */}
      <div className="flex items-center gap-4 mb-6 p-4 rounded-xl border border-border bg-card">
        <div className="text-4xl font-bold text-foreground">{project.health_score}%</div>
        <div>
          <HealthScoreBadge score={project.health_score} status={project.status} size="lg" />
          <p className="text-xs text-muted-foreground mt-1">
            Based on {resultsRes.data?.length ?? 0} recent test results
          </p>
        </div>
      </div>

      {/* Health endpoint breakdown — shown when project has HTTP checks */}
      {hasHealthEndpoint && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-foreground mb-3">Health Endpoint</h2>
          <HealthCheckBreakdown projectId={id} />
        </div>
      )}

      {/* Features section */}
      {featuresRes.data && featuresRes.data.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-foreground">Features</h2>
            <Link
              href={`/projects/${id}/features`}
              className="text-xs text-primary hover:underline"
            >
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {featuresRes.data.slice(0, 6).map((f, i) => (
              <FeatureCard key={f.id} feature={f} projectId={id} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <HealthTrendChart data={healthLogsRes.data ?? []} />
        <ErrorFrequencyChart data={errorFreqData} />
        <ResponseTimeChart data={responseTimes} />
      </div>

      {/* Results + Errors */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TestResultsList results={(resultsRes.data ?? []) as Parameters<typeof TestResultsList>[0]['results']} />
        <ErrorFeed errors={errorsRes.data ?? []} />
      </div>
    </div>
  );
}
