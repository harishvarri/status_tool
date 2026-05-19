'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

const schema = z.object({
  project_name: z.string().min(2, 'Name must be at least 2 characters'),
  project_url: z.string().url('Enter a valid URL (https://...)'),
  description: z.string().optional(),
  auth_login_url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  auth_username: z.string().optional(),
  auth_password: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

interface ProjectFormProps {
  initialData?: Partial<FormData>;
  projectId?: string;
}

export function ProjectForm({ initialData, projectId }: ProjectFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isEditing = !!projectId;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: initialData,
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const url = isEditing ? `/api/projects/${projectId}` : '/api/projects';
      const method = isEditing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Request failed');
      }
      const project = await res.json();
      toast.success(isEditing ? 'Project updated' : 'Project created');
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-xl border-border">
      <CardHeader>
        <CardTitle>{isEditing ? 'Edit Project' : 'Add Project'}</CardTitle>
        <CardDescription>
          {isEditing
            ? 'Update your project configuration'
            : 'Add a live application to monitor'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project_name">Project Name</Label>
            <Input id="project_name" placeholder="My App" {...register('project_name')} />
            {errors.project_name && (
              <p className="text-xs text-destructive">{errors.project_name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project_url">Application URL</Label>
            <Input
              id="project_url"
              type="url"
              placeholder="https://myapp.vercel.app"
              {...register('project_url')}
            />
            {errors.project_url && (
              <p className="text-xs text-destructive">{errors.project_url.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Short description of this application"
              rows={2}
              {...register('description')}
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-border">
            <h4 className="text-sm font-medium">Auto-Crawler Credentials (Optional)</h4>
            <div className="space-y-1.5">
              <Label htmlFor="auth_login_url">Login URL</Label>
              <Input
                id="auth_login_url"
                type="url"
                placeholder="https://myapp.com/login"
                {...register('auth_login_url')}
              />
              {errors.auth_login_url && (
                <p className="text-xs text-destructive">{errors.auth_login_url.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="auth_username">Username / Email</Label>
                <Input
                  id="auth_username"
                  type="text"
                  placeholder="admin@example.com"
                  {...register('auth_username')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth_password">Password</Label>
                <Input
                  id="auth_password"
                  type="password"
                  placeholder="••••••••"
                  {...register('auth_password')}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEditing ? 'Saving…' : 'Creating…'}
                </>
              ) : isEditing ? (
                'Save changes'
              ) : (
                'Create project'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
