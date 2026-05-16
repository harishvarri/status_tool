'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HealthScoreBadge } from '@/components/dashboard/HealthScoreBadge';
import { ChevronRight, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Feature } from '@/types';

interface FeatureCardProps {
  feature: Feature;
  projectId: string;
  checksCount?: number;
  index?: number;
}

export function FeatureCard({ feature, projectId, checksCount, index = 0 }: FeatureCardProps) {
  const scoreColor =
    feature.status === 'healthy'
      ? 'text-emerald-400'
      : feature.status === 'warning'
      ? 'text-amber-400'
      : feature.status === 'critical'
      ? 'text-red-400'
      : 'text-muted-foreground';

  const ringColor =
    feature.status === 'healthy'
      ? '#34d399'
      : feature.status === 'warning'
      ? '#fbbf24'
      : feature.status === 'critical'
      ? '#f87171'
      : '#6b7280';

  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference * (1 - feature.health_score / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ scale: 1.01 }}
    >
      <Link href={`/projects/${projectId}/features/${feature.id}`}>
        <Card className="cursor-pointer border-border hover:border-primary/30 transition-colors bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground truncate">{feature.name}</h3>
                {feature.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {feature.description}
                  </p>
                )}
              </div>
              <div className="relative w-12 h-12 shrink-0">
                <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                  <circle
                    cx="22" cy="22" r="18"
                    stroke="currentColor"
                    strokeWidth="3"
                    fill="none"
                    className="text-muted"
                  />
                  <circle
                    cx="22" cy="22" r="18"
                    stroke={ringColor}
                    strokeWidth="3"
                    fill="none"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                  />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${scoreColor}`}>
                  {feature.health_score}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0 space-y-2">
            <HealthScoreBadge score={feature.health_score} status={feature.status} size="sm" />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {checksCount ?? 0} {checksCount === 1 ? 'check' : 'checks'}
              </span>
              <span>weight {feature.weight}</span>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
              <span>Updated {formatDistanceToNow(new Date(feature.updated_at), { addSuffix: true })}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
