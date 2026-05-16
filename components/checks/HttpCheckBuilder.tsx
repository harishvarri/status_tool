'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import type { MonitoringTest, Feature } from '@/types';

const schema = z.object({
  test_name: z.string().min(2, 'Name required'),
  feature_id: z.string().nullable().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().url('Enter a valid URL'),
  headers_json: z.string().optional(),
  body: z.string().optional(),
  expected_status: z.coerce.number().int().min(100).max(599).default(200),
  expected_body_contains: z.string().optional(),
  max_response_time_ms: z.coerce.number().int().min(100).max(60000).default(5000),
  expected_result: z.string().default('HTTP check passes'),
});
type FormData = z.infer<typeof schema>;

interface HttpCheckBuilderProps {
  projectId: string;
  features: Feature[];
  initialData?: MonitoringTest;
  onSave?: (test: MonitoringTest) => void;
  onCancel?: () => void;
}

export function HttpCheckBuilder({
  projectId,
  features,
  initialData,
  onSave,
  onCancel,
}: HttpCheckBuilderProps) {
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: initialData?.http_config
      ? {
          test_name: initialData.test_name,
          feature_id: initialData.feature_id ?? '',
          method: initialData.http_config.method,
          url: initialData.http_config.url,
          headers_json: initialData.http_config.headers
            ? JSON.stringify(initialData.http_config.headers, null, 2)
            : '',
          body: initialData.http_config.body ?? '',
          expected_status: initialData.http_config.expected_status ?? 200,
          expected_body_contains: initialData.http_config.expected_body_contains ?? '',
          max_response_time_ms: initialData.http_config.max_response_time_ms ?? 5000,
          expected_result: initialData.expected_result,
        }
      : {
          method: 'GET',
          expected_status: 200,
          max_response_time_ms: 5000,
          expected_result: 'HTTP check passes',
        },
  });

  const method = watch('method');
  const featureId = watch('feature_id');

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      // Parse headers JSON if provided
      let headers: Record<string, string> | undefined;
      if (data.headers_json?.trim()) {
        try {
          headers = JSON.parse(data.headers_json);
        } catch {
          toast.error('Headers must be valid JSON');
          setLoading(false);
          return;
        }
      }

      const payload = {
        test_name: data.test_name,
        feature_id: data.feature_id || null,
        check_type: 'http',
        expected_result: data.expected_result,
        steps: [],
        http_config: {
          method: data.method,
          url: data.url,
          headers,
          body: data.body || undefined,
          expected_status: data.expected_status,
          expected_body_contains: data.expected_body_contains || undefined,
          max_response_time_ms: data.max_response_time_ms,
        },
      };

      const url = initialData
        ? `/api/projects/${projectId}/tests/${initialData.id}`
        : `/api/projects/${projectId}/tests`;
      const method = initialData ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Request failed');
      }
      const saved = await res.json();
      toast.success(initialData ? 'HTTP check updated' : 'HTTP check created');
      onSave?.(saved);
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
          {initialData ? 'Edit HTTP Check' : 'New HTTP Check'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Check Name</Label>
              <Input placeholder="Login API health" {...register('test_name')} />
              {errors.test_name && (
                <p className="text-xs text-destructive">{errors.test_name.message}</p>
              )}
            </div>
            {features.length > 0 && (
              <div className="space-y-1.5">
                <Label>Feature</Label>
                <Select
                  value={featureId ?? ''}
                  onValueChange={(v) => setValue('feature_id', v || null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select feature" />
                  </SelectTrigger>
                  <SelectContent>
                    {features.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-[100px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setValue('method', v as FormData['method'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>URL</Label>
              <Input
                placeholder="https://api.example.com/health"
                {...register('url')}
              />
              {errors.url && (
                <p className="text-xs text-destructive">{errors.url.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Headers (JSON, optional)</Label>
            <Textarea
              rows={2}
              className="font-mono text-xs"
              placeholder='{"Authorization": "Bearer ..."}'
              {...register('headers_json')}
            />
          </div>

          {(method === 'POST' || method === 'PUT' || method === 'PATCH') && (
            <div className="space-y-1.5">
              <Label>Body (optional)</Label>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                placeholder='{"key": "value"}'
                {...register('body')}
              />
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Expected Status</Label>
              <Input type="number" min={100} max={599} {...register('expected_status')} />
            </div>
            <div className="space-y-1.5">
              <Label>Max Response (ms)</Label>
              <Input type="number" min={100} max={60000} step={100} {...register('max_response_time_ms')} />
            </div>
            <div className="space-y-1.5">
              <Label>Body Contains (optional)</Label>
              <Input placeholder='"ok"' {...register('expected_body_contains')} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : initialData ? (
                'Save changes'
              ) : (
                'Create HTTP check'
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
