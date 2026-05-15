import { createClient } from '@/lib/supabase/server';
import { ProjectCard } from '@/components/dashboard/ProjectCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus, FolderKanban } from 'lucide-react';

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Get error counts
  const projectIds = (projects ?? []).map((p) => p.id);
  const errorCountMap: Record<string, number> = {};
  if (projectIds.length > 0) {
    const { data: errors } = await supabase
      .from('runtime_errors')
      .select('project_id')
      .in('project_id', projectIds);
    for (const e of errors ?? []) {
      errorCountMap[e.project_id] = (errorCountMap[e.project_id] ?? 0) + 1;
    }
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        description="All monitored applications"
      >
        <Link href="/projects/new">
          <Button size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Project
          </Button>
        </Link>
      </PageHeader>

      {!projects?.length ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground border border-dashed border-border rounded-xl">
          <FolderKanban className="w-10 h-10 opacity-30" />
          <div className="text-center">
            <p className="font-medium">No projects yet</p>
            <p className="text-sm mt-1">Add your first application to start monitoring</p>
          </div>
          <Link href="/projects/new">
            <Button variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Project
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.id}
              project={project}
              errorCount={errorCountMap[project.id] ?? 0}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
