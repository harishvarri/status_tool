import { PageHeader } from '@/components/layout/PageHeader';
import { ProjectForm } from '@/components/projects/ProjectForm';

export default function NewProjectPage() {
  return (
    <div>
      <PageHeader title="Add Project" description="Add a live application to monitor" />
      <ProjectForm />
    </div>
  );
}
