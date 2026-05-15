import { createClient } from '@/lib/supabase/server';
import { RealtimeDashboard } from '@/components/dashboard/RealtimeDashboard';
import { PageHeader } from '@/components/layout/PageHeader';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch all data in parallel
  const [projectsRes, errorsRes] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('runtime_errors')
      .select('*, projects(project_name)')
      .in(
        'project_id',
        (await supabase.from('projects').select('id').eq('user_id', user.id)).data?.map(
          (p) => p.id
        ) ?? []
      )
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const projects = projectsRes.data ?? [];
  const errors = errorsRes.data ?? [];

  // Build error count map per project
  const errorCountMap: Record<string, number> = {};
  for (const e of errors) {
    errorCountMap[e.project_id] = (errorCountMap[e.project_id] ?? 0) + 1;
  }

  // Compute stats
  const avgScore =
    projects.length > 0
      ? Math.round(projects.reduce((a, p) => a + p.health_score, 0) / projects.length)
      : 0;

  // Count passing tests in last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentResults } = await supabase
    .from('test_results')
    .select('status')
    .in('project_id', projects.map((p) => p.id))
    .eq('status', 'passed')
    .gte('created_at', since);

  const stats = {
    totalProjects: projects.length,
    averageHealthScore: avgScore,
    activeErrors: errors.length,
    passingTests: recentResults?.length ?? 0,
  };

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Live health status of all your monitored applications"
      >
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
    </div>
  );
}
