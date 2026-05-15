import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, AlertCircle, Info, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { RuntimeError, Severity } from '@/types';

interface ErrorFeedProps {
  errors: (RuntimeError & { projects?: { project_name: string } | null })[];
  showProject?: boolean;
}

const severityConfig: Record<Severity, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { icon: Zap, color: 'text-red-400', bg: 'bg-red-500/10' },
  high: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  medium: { icon: AlertCircle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  low: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

const severityBadgeVariant: Record<Severity, string> = {
  critical: 'bg-red-500/15 text-red-400 ring-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 ring-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  low: 'bg-blue-500/15 text-blue-400 ring-blue-500/30',
};

export function ErrorFeed({ errors, showProject = false }: ErrorFeedProps) {
  if (errors.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Errors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
            <AlertCircle className="w-8 h-8 opacity-30" />
            <p className="text-sm">No errors detected</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Recent Errors</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {errors.map((error) => {
            const config = severityConfig[error.severity];
            const Icon = config.icon;
            return (
              <div key={error.id} className="flex items-start gap-3 px-4 py-3">
                <div className={`mt-0.5 p-1.5 rounded-md shrink-0 ${config.bg}`}>
                  <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground line-clamp-2 leading-snug">
                    {error.error_message}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span
                      className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded ring-1 font-medium ${severityBadgeVariant[error.severity]}`}
                    >
                      {error.severity}
                    </span>
                    {showProject && error.projects && (
                      <span className="text-xs text-muted-foreground">{error.projects.project_name}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(error.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
