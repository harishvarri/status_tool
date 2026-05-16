import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { BugCategoryChart } from '@/components/analytics/BugCategoryChart';
import { TopFailingFeatures } from '@/components/analytics/TopFailingFeatures';
import { MTTRMetric } from '@/components/analytics/MTTRMetric';
import { BugDetailDrawer } from '@/components/analytics/BugDetailDrawer';
import {
  getBugCategoryBreakdown,
  getTopFailingFeatures,
  getMTTR,
} from '@/services/bug-analytics';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Bug, Layers, ServerCrash } from 'lucide-react';

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Cross-project breakdowns
  const [bugCategories, topFailing, projectsRes, errorsRes] = await Promise.all([
    getBugCategoryBreakdown(null, 7),
    getTopFailingFeatures(null, 10),
    supabase.from('projects').select('id, health_score, status').eq('user_id', user.id),
    supabase
      .from('runtime_errors')
      .select('*, projects(project_name)')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const projects = projectsRes.data ?? [];
  const errors = errorsRes.data ?? [];
  const criticalCount = projects.filter((p) => p.status === 'critical').length;
  const warningCount = projects.filter((p) => p.status === 'warning').length;

  // Compute org-wide MTTR by averaging per-project MTTR
  const projectMTTRs = await Promise.all(projects.map((p) => getMTTR(p.id)));
  const validMTTRs = projectMTTRs.filter((m): m is number => m !== null);
  const avgMTTR =
    validMTTRs.length > 0
      ? Math.round(validMTTRs.reduce((a, b) => a + b, 0) / validMTTRs.length)
      : null;

  const totalBugs = bugCategories.reduce((sum, c) => sum + c.count, 0);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Cross-project bug analytics, trends, and reliability metrics"
      />

      {/* Top metrics row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Layers className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{projects.length}</p>
              <p className="text-xs text-muted-foreground">Total Projects</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <ServerCrash className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{criticalCount}</p>
              <p className="text-xs text-muted-foreground">Critical Projects</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Bug className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{totalBugs}</p>
              <p className="text-xs text-muted-foreground">Bugs (7 days)</p>
            </div>
          </CardContent>
        </Card>

        <MTTRMetric seconds={avgMTTR} />
      </div>

      {/* Health distribution + Bug categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card className="border-border">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-medium mb-3">Project Health Distribution</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-400">
                  {projects.filter((p) => p.status === 'healthy').length}
                </p>
                <p className="text-xs text-muted-foreground">Healthy</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-400">{warningCount}</p>
                <p className="text-xs text-muted-foreground">Warning</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
                <p className="text-xs text-muted-foreground">Critical</p>
              </div>
            </div>
            <div className="pt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Activity className="w-3 h-3" />
              Avg health score:{' '}
              {projects.length > 0
                ? Math.round(
                    projects.reduce((a, p) => a + p.health_score, 0) / projects.length
                  )
                : 0}
              %
            </div>
          </CardContent>
        </Card>

        <BugCategoryChart data={bugCategories} />
      </div>

      {/* Top failing features + Bug details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopFailingFeatures features={topFailing} />
        <BugDetailDrawer errors={errors} />
      </div>
    </div>
  );
}
