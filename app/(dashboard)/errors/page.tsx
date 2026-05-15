import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorFeed } from '@/components/dashboard/ErrorFeed';

export default async function GlobalErrorsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const projectIds =
    (
      await supabase.from('projects').select('id').eq('user_id', user.id)
    ).data?.map((p) => p.id) ?? [];

  const { data: errors } =
    projectIds.length > 0
      ? await supabase
          .from('runtime_errors')
          .select('*, projects(project_name)')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })
          .limit(100)
      : { data: [] };

  return (
    <div>
      <PageHeader
        title="All Errors"
        description={`${errors?.length ?? 0} errors across all projects`}
      />
      <ErrorFeed errors={errors ?? []} showProject />
    </div>
  );
}
