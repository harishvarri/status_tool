import { cn } from '@/lib/utils';
import type { ProjectStatus } from '@/types';

interface HealthScoreBadgeProps {
  score: number;
  status: ProjectStatus;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<ProjectStatus, { label: string; className: string }> = {
  healthy: { label: 'Healthy', className: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' },
  warning: { label: 'Warning', className: 'bg-amber-500/15 text-amber-400 ring-amber-500/30' },
  critical: { label: 'Critical', className: 'bg-red-500/15 text-red-400 ring-red-500/30' },
  unknown: { label: 'Unknown', className: 'bg-muted text-muted-foreground ring-border' },
};

export function HealthScoreBadge({ score, status, size = 'md' }: HealthScoreBadgeProps) {
  const config = statusConfig[status];
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : size === 'lg' ? 'text-sm px-3 py-1' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium ring-1',
        sizeClass,
        config.className
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full',
          size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2',
          status === 'healthy' && 'bg-emerald-400',
          status === 'warning' && 'bg-amber-400',
          status === 'critical' && 'bg-red-400 animate-pulse',
          status === 'unknown' && 'bg-muted-foreground'
        )}
      />
      {score > 0 ? `${score}%` : ''} {config.label}
    </span>
  );
}
