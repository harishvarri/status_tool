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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import type { Feature } from '@/types';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, and hyphens only'),
  description: z.string().optional(),
  weight: z.coerce.number().int().min(1).max(10).default(1),
});
type FormData = z.infer<typeof schema>;

interface FeatureFormProps {
  projectId: string;
  initialData?: Feature;
  onSave?: (feature: Feature) => void;
  onCancel?: () => void;
}

export function FeatureForm({ projectId, initialData, onSave, onCancel }: FeatureFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isEditing = !!initialData;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: initialData
      ? {
          name: initialData.name,
          slug: initialData.slug,
          description: initialData.description ?? '',
          weight: initialData.weight,
        }
      : { weight: 1 },
  });

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const url = isEditing
        ? `/api/projects/${projectId}/features/${initialData!.id}`
        : `/api/projects/${projectId}/features`;
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
      const feature = await res.json();
      toast.success(isEditing ? 'Feature updated' : 'Feature created');
      if (onSave) onSave(feature);
      else {
        router.push(`/projects/${projectId}/features/${feature.id}`);
        router.refresh();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {isEditing ? 'Edit Feature' : 'New Feature'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Authentication" {...register('name')} />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" placeholder="auth" {...register('slug')} />
              {errors.slug && (
                <p className="text-xs text-destructive">{errors.slug.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              rows={2}
              placeholder="Login, signup, password reset…"
              {...register('description')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="weight">Weight (1-10)</Label>
            <Input
              id="weight"
              type="number"
              min={1}
              max={10}
              {...register('weight')}
            />
            <p className="text-xs text-muted-foreground">
              Higher weight = more impact on overall project health
            </p>
            {errors.weight && (
              <p className="text-xs text-destructive">{errors.weight.message}</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : isEditing ? (
                'Save changes'
              ) : (
                'Create feature'
              )}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
