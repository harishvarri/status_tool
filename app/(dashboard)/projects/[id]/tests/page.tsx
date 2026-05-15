'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { TestScenarioBuilder } from '@/components/projects/TestScenarioBuilder';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, FlaskConical, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MonitoringTest } from '@/types';

export default function ProjectTestsPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [tests, setTests] = useState<MonitoringTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<MonitoringTest | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function fetchTests() {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tests`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setTests(data);
    } catch {
      toast.error('Failed to load tests');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTests(); }, [projectId]);

  async function handleDelete(testId: string) {
    setDeletingId(testId);
    try {
      const res = await fetch(`/api/projects/${projectId}/tests/${testId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Test deleted');
      setTests((prev) => prev.filter((t) => t.id !== testId));
    } catch {
      toast.error('Failed to delete test');
    } finally {
      setDeletingId(null);
    }
  }

  function handleSaved(test: MonitoringTest) {
    setTests((prev) => {
      const exists = prev.find((t) => t.id === test.id);
      return exists ? prev.map((t) => (t.id === test.id ? test : t)) : [test, ...prev];
    });
    setShowBuilder(false);
    setEditing(null);
  }

  return (
    <div>
      <PageHeader title="Test Scenarios" description="Define automated monitoring tests">
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowBuilder(true);
          }}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          New Test
        </Button>
      </PageHeader>

      {(showBuilder || editing) && (
        <div className="mb-6">
          <TestScenarioBuilder
            projectId={projectId}
            initialData={editing ?? undefined}
            onSave={handleSaved}
            onCancel={() => { setShowBuilder(false); setEditing(null); }}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : tests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground border border-dashed border-border rounded-xl">
          <FlaskConical className="w-10 h-10 opacity-30" />
          <div className="text-center">
            <p className="font-medium">No tests yet</p>
            <p className="text-sm mt-1">Create a test scenario to start monitoring user flows</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => (
            <Card key={test.id} className="border-border">
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground">{test.test_name}</span>
                    <Badge
                      variant="outline"
                      className={
                        test.status === 'passed'
                          ? 'border-emerald-500/30 text-emerald-400'
                          : test.status === 'failed'
                          ? 'border-red-500/30 text-red-400'
                          : 'border-border text-muted-foreground'
                      }
                    >
                      {test.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {test.steps.length} step{test.steps.length !== 1 ? 's' : ''} · Expected:{' '}
                    {test.expected_result}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { setEditing(test); setShowBuilder(false); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(test.id)}
                    disabled={deletingId === test.id}
                  >
                    {deletingId === test.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
