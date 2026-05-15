'use client';

import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Reorder } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GripVertical, Plus, Trash2, Loader2 } from 'lucide-react';
import type { MonitoringTest } from '@/types';

const stepSchema = z.object({
  action: z.enum(['navigate', 'click', 'fill', 'wait', 'assert', 'screenshot']),
  selector: z.string().optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  timeout: z.number().optional(),
});

const schema = z.object({
  test_name: z.string().min(2, 'Name required'),
  expected_result: z.string().min(2, 'Expected result required'),
  steps: z.array(stepSchema).min(1, 'Add at least one step'),
});
type FormData = z.infer<typeof schema>;

interface TestScenarioBuilderProps {
  projectId: string;
  initialData?: MonitoringTest;
  onSave?: (test: MonitoringTest) => void;
  onCancel?: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  navigate: 'Navigate to URL',
  click: 'Click element',
  fill: 'Fill input',
  wait: 'Wait for element',
  assert: 'Assert visible',
  screenshot: 'Take screenshot',
};

export function TestScenarioBuilder({
  projectId,
  initialData,
  onSave,
  onCancel,
}: TestScenarioBuilderProps) {
  const [loading, setLoading] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: initialData
      ? {
          test_name: initialData.test_name,
          expected_result: initialData.expected_result,
          steps: initialData.steps,
        }
      : {
          steps: [{ action: 'navigate', url: '' }],
        },
  });

  const { fields, append, remove, move } = useFieldArray({ control, name: 'steps' });
  const steps = watch('steps');

  async function onSubmit(data: FormData) {
    setLoading(true);
    try {
      const url = initialData
        ? `/api/projects/${projectId}/tests/${initialData.id}`
        : `/api/projects/${projectId}/tests`;
      const method = initialData ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, project_id: projectId }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? 'Request failed');
      }
      const test = await res.json();
      toast.success(initialData ? 'Test updated' : 'Test created');
      onSave?.(test);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{initialData ? 'Edit Test' : 'New Test Scenario'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Test Name</Label>
              <Input placeholder="Login flow" {...register('test_name')} />
              {errors.test_name && (
                <p className="text-xs text-destructive">{errors.test_name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Expected Result</Label>
              <Input placeholder="Dashboard visible" {...register('expected_result')} />
              {errors.expected_result && (
                <p className="text-xs text-destructive">{errors.expected_result.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Steps</Label>
            <Reorder.Group
              axis="y"
              values={steps}
              onReorder={(newOrder) => {
                newOrder.forEach((step, i) => {
                  const oldIndex = steps.indexOf(step);
                  if (oldIndex !== i) move(oldIndex, i);
                });
              }}
              className="space-y-2"
            >
              {fields.map((field, index) => {
                const action = watch(`steps.${index}.action`);
                return (
                  <Reorder.Item key={field.id} value={steps[index]} className="flex items-start gap-2">
                    <div className="mt-2.5 cursor-grab text-muted-foreground">
                      <GripVertical className="w-4 h-4" />
                    </div>
                    <div className="flex-1 p-3 rounded-lg bg-muted/40 border border-border space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">
                          {index + 1}.
                        </span>
                        <Select
                          value={action}
                          onValueChange={(v) =>
                            setValue(
                              `steps.${index}.action`,
                              v as FormData['steps'][number]['action']
                            )
                          }
                        >
                          <SelectTrigger className="w-44 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ACTION_LABELS).map(([val, label]) => (
                              <SelectItem key={val} value={val} className="text-xs">
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {action === 'navigate' && (
                        <Input
                          className="h-8 text-xs"
                          placeholder="https://example.com/login"
                          {...register(`steps.${index}.url`)}
                        />
                      )}
                      {(action === 'click' || action === 'wait' || action === 'assert') && (
                        <Input
                          className="h-8 text-xs"
                          placeholder="CSS selector or text"
                          {...register(`steps.${index}.selector`)}
                        />
                      )}
                      {action === 'fill' && (
                        <div className="flex gap-2">
                          <Input
                            className="h-8 text-xs"
                            placeholder="Selector"
                            {...register(`steps.${index}.selector`)}
                          />
                          <Input
                            className="h-8 text-xs"
                            placeholder="Value"
                            {...register(`steps.${index}.value`)}
                          />
                        </div>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mt-1.5 h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>

            {errors.steps && (
              <p className="text-xs text-destructive">
                {typeof errors.steps === 'object' && 'message' in errors.steps
                  ? (errors.steps as { message?: string }).message
                  : 'Please fix step errors'}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full mt-1"
              onClick={() => append({ action: 'click', selector: '' })}
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add step
            </Button>
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
                'Create test'
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
