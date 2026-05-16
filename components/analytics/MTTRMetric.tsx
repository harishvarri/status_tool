import { Card, CardContent } from '@/components/ui/card';
import { Clock } from 'lucide-react';

interface MTTRMetricProps {
  seconds: number | null;
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function MTTRMetric({ seconds }: MTTRMetricProps) {
  return (
    <Card className="border-border">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-500/10">
          <Clock className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">
            {seconds !== null ? formatDuration(seconds) : '—'}
          </p>
          <p className="text-xs text-muted-foreground">Mean Time to Recovery (30d)</p>
        </div>
      </CardContent>
    </Card>
  );
}
