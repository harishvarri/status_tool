import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { HealthAnalyticsDashboard } from '@/components/dashboard/HealthAnalyticsDashboard';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function ProjectHealthPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, project_name, description, health_score, status')
    .eq('id', id)
    .single();

  if (!project) notFound();

  return (
    <div>
      <PageHeader
        title={`${project.project_name} — Health Analytics`}
        description="Uptime, response times, and per-check breakdown from health endpoint snapshots"
      >
        <Link href={`/projects/${id}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        </Link>
      </PageHeader>

      <HealthAnalyticsDashboard projectId={id} />
    </div>
  );
}
