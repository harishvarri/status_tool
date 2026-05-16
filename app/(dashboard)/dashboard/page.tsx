import { createClient } from '@/lib/supabase/server';
import { RealtimeDashboard } from '@/components/dashboard/RealtimeDashboard';
import { PageHeader } from '@/components/layout/PageHeader';
import { BugCategoryChart } from '@/components/analytics/BugCategoryChart';
import { TopFailingFeatures } from '@/components/analytics/TopFailingFeatures';
import { getBugCategoryBreakdown, getTopFailingFeatures } from '@/services/bug-analytics';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, BarChart3 } from 'lucide-react';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // First: get project IDs once to avoid N+1
  const { data: projectIdRows } = await supabase
    .from('projects')
    .select('id')
    .eq('user_id', user.id);
  const projectIds = (projectIdRows ?? []).map((p) => p.id);

  // Parallel fetches
  const [projectsRes, errorsRes, recentResultsRes, bugCategories, topFailing] =
    await Promise.all([
      supabase
        .from('projects')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false }),
      projectIds.length > 0
        ? supabase
            .from('runtime_errors')
            .select('*, projects(project_name)')
            .in('project_id', projectIds)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      projectIds.length > 0
        ? supabase
            .from('test_results')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'passed')
            .in('project_id', projectIds)
            .gte(
              'created_at',
              new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
            )
        : Promise.resolve({ count: 0 }),
      getBugCategoryBreakdown(null, 7),
      getTopFailingFeatures(null, 5),
    ]);

  const projects = projectsRes.data ?? [];
  const errors = errorsRes.data ?? [];

  const errorCountMap: Record<string, number> = {};
  for (const e of errors) {
    errorCountMap[e.project_id] = (errorCountMap[e.project_id] ?? 0) + 1;
  }

  const avgScore =
    projects.length > 0
      ? Math.round(projects.reduce((a, p) => a + p.health_score, 0) / projects.length)
      : 0;

  const stats = {
    totalProjects: projects.length,
    averageHealthScore: avgScore,
    activeErrors: errors.length,
    passingTests: 'count' in recentResultsRes ? recentResultsRes.count ?? 0 : 0,
  };

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Live health status of all your monitored applications"
      >
        <Link href="/analytics">
          <Button size="sm" variant="outline">
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Analytics
          </Button>
        </Link>
        <Link href="/projects/new">
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Project
          </Button>
        </Link>
      </PageHeader>

      <RealtimeDashboard
        initialProjects={projects}
        initialErrors={errors}
        stats={stats}
        userId={user.id}
        errorCountMap={errorCountMap}
      />

      {/* Bug analytics row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <BugCategoryChart data={bugCategories} />
        <TopFailingFeatures features={topFailing} />
      </div>
    </div>
  );
}
