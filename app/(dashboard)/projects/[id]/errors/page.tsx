import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorFeed } from '@/components/dashboard/ErrorFeed';

export default async function ProjectErrorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('project_name')
    .eq('id', id)
    .single();

  if (!project) notFound();

  const { data: errors } = await supabase
    .from('runtime_errors')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <PageHeader
        title={`${project.project_name} — Errors`}
        description={`${errors?.length ?? 0} total errors`}
      />
      <ErrorFeed errors={errors ?? []} />
    </div>
  );
}
