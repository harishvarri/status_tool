'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ProjectCard } from './ProjectCard';
import { StatsOverview } from './StatsOverview';
import { ErrorFeed } from './ErrorFeed';
import type { Project, RuntimeError } from '@/types';

interface RealtimeDashboardProps {
  initialProjects: Project[];
  initialErrors: (RuntimeError & { projects?: { project_name: string } | null })[];
  stats: {
    totalProjects: number;
    averageHealthScore: number;
    activeErrors: number;
    passingTests: number;
  };
  userId: string;
  errorCountMap: Record<string, number>;
}

export function RealtimeDashboard({
  initialProjects,
  initialErrors,
  stats,
  userId,
  errorCountMap,
}: RealtimeDashboardProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [errors, setErrors] = useState(initialErrors);
  const [liveStats, setLiveStats] = useState(stats);

  useEffect(() => {
    const supabase = createClient();

    const projectChannel = supabase
      .channel('projects-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'projects',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setProjects((prev) =>
            prev.map((p) => (p.id === payload.new.id ? { ...p, ...(payload.new as Project) } : p))
          );
          // Recalculate average health
          setProjects((current) => {
            const avg =
              current.length > 0
                ? Math.round(current.reduce((a, p) => a + p.health_score, 0) / current.length)
                : 0;
            setLiveStats((s) => ({ ...s, averageHealthScore: avg }));
            return current;
          });
        }
      )
      .subscribe();

    const errorChannel = supabase
      .channel('errors-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'runtime_errors',
        },
        (payload) => {
          // Only add if it belongs to one of the user's projects
          const newError = payload.new as RuntimeError & { projects?: { project_name: string } | null };
          if (projects.some((p) => p.id === newError.project_id)) {
            setErrors((prev) => [newError, ...prev.slice(0, 49)]);
            setLiveStats((s) => ({ ...s, activeErrors: s.activeErrors + 1 }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(projectChannel);
      supabase.removeChannel(errorChannel);
    };
  }, [userId]);

  return (
    <div className="space-y-6">
      <StatsOverview
        totalProjects={liveStats.totalProjects}
        averageHealthScore={liveStats.averageHealthScore}
        activeErrors={liveStats.activeErrors}
        passingTests={liveStats.passingTests}
      />

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground border border-dashed border-border rounded-xl">
          <p className="text-base font-medium">No projects yet</p>
          <p className="text-sm">Add your first project to start monitoring</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project, i) => (
            <ProjectCard
              key={project.id}
              project={project}
              errorCount={errorCountMap[project.id] ?? 0}
              index={i}
            />
          ))}
        </div>
      )}

      <ErrorFeed errors={errors} showProject />
    </div>
  );
}
