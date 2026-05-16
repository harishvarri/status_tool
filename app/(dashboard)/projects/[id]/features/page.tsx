'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { FeatureCard } from '@/components/features/FeatureCard';
import { FeatureForm } from '@/components/features/FeatureForm';
import { Plus, Loader2, Layers } from 'lucide-react';
import { toast } from 'sonner';
import type { Feature } from '@/types';

export default function ProjectFeaturesPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [checksCountMap, setChecksCountMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [fRes, tRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/features`),
        fetch(`/api/projects/${projectId}/tests`),
      ]);
      if (!fRes.ok) throw new Error('Failed to load features');
      const fs: Feature[] = await fRes.json();
      const ts: Array<{ feature_id: string | null }> = tRes.ok ? await tRes.json() : [];

      const counts: Record<string, number> = {};
      for (const t of ts) {
        if (t.feature_id) counts[t.feature_id] = (counts[t.feature_id] ?? 0) + 1;
      }

      setFeatures(fs);
      setChecksCountMap(counts);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId]);

  function handleSaved(f: Feature) {
    setFeatures((prev) => [f, ...prev]);
    setShowForm(false);
  }

  return (
    <div>
      <PageHeader
        title="Features"
        description="Group your monitoring checks by functional area"
      >
        <Button size="sm" onClick={() => setShowForm(true)} disabled={showForm}>
          <Plus className="w-4 h-4 mr-1.5" />
          New Feature
        </Button>
      </PageHeader>

      {showForm && (
        <div className="mb-6 max-w-2xl">
          <FeatureForm
            projectId={projectId}
            onSave={handleSaved}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : features.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground border border-dashed border-border rounded-xl">
          <Layers className="w-10 h-10 opacity-30" />
          <div className="text-center">
            <p className="font-medium">No features yet</p>
            <p className="text-sm mt-1">
              Group your checks into features (Auth, Dashboard, Checkout…) for per-feature health
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            Create your first feature
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <FeatureCard
              key={f.id}
              feature={f}
              projectId={projectId}
              checksCount={checksCountMap[f.id] ?? 0}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
