import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HealthScoreBadge } from '@/components/dashboard/HealthScoreBadge';
import { TrendingDown, AlertOctagon } from 'lucide-react';
import type { FailingFeatureSummary } from '@/types';

interface TopFailingFeaturesProps {
  features: FailingFeatureSummary[];
}

export function TopFailingFeatures({ features }: TopFailingFeaturesProps) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-red-400" />
          Top Failing Features
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {features.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
            <AlertOctagon className="w-8 h-8 opacity-30" />
            <p className="text-sm">No failing features</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {features.map((f) => (
              <Link
                key={f.feature_id}
                href={`/projects/${f.project_id}/features/${f.feature_id}`}
                className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {f.feature_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {f.project_name} · {f.failed_checks} / {f.total_checks} failing (24h)
                  </p>
                </div>
                <HealthScoreBadge score={f.health_score} status={f.status} size="sm" />
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
