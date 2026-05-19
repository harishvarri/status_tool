'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, AlertTriangle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { HealthScoreBadge } from './HealthScoreBadge';
import type { Project } from '@/types';

interface ProjectCardProps {
  project: Project;
  errorCount?: number;
  index?: number;
}

export function ProjectCard({ project, errorCount = 0, index = 0 }: ProjectCardProps) {
  const scoreColor =
    project.status === 'healthy'
      ? 'text-emerald-400'
      : project.status === 'warning'
      ? 'text-amber-400'
      : project.status === 'critical'
      ? 'text-red-400'
      : 'text-muted-foreground';

  const ringColor =
    project.status === 'healthy'
      ? '#34d399'
      : project.status === 'warning'
      ? '#fbbf24'
      : project.status === 'critical'
      ? '#f87171'
      : '#6b7280';

  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference * (1 - project.health_score / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ scale: 1.01 }}
    >
      <Link href={`/projects/${project.id}`}>
        <Card className="cursor-pointer border-border hover:border-primary/30 transition-colors bg-card">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-foreground truncate">{project.project_name}</h3>
                {project.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {project.description}
                  </p>
                )}
              </div>
              {/* Health score ring */}
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
                  {project.health_score}
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <HealthScoreBadge score={project.health_score} status={project.status} size="sm" />

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(project.project_url, '_blank', 'noopener,noreferrer');
                }}
                className="flex items-center gap-1 hover:text-primary transition-colors truncate max-w-[60%]"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span className="truncate">{project.project_url.replace(/^https?:\/\//, '')}</span>
              </button>

              {errorCount > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertTriangle className="w-3 h-3" />
                  {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>
                Updated{' '}
                {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}
