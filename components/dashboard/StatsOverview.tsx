'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { FolderKanban, CheckCircle2, AlertTriangle, Activity } from 'lucide-react';

interface StatsOverviewProps {
  totalProjects: number;
  averageHealthScore: number;
  activeErrors: number;
  passingTests: number;
}

export function StatsOverview({
  totalProjects,
  averageHealthScore,
  activeErrors,
  passingTests,
}: StatsOverviewProps) {
  const stats = [
    {
      label: 'Total Projects',
      value: totalProjects,
      icon: FolderKanban,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Avg Health Score',
      value: `${averageHealthScore}%`,
      icon: Activity,
      color: averageHealthScore >= 90 ? 'text-emerald-400' : averageHealthScore >= 70 ? 'text-amber-400' : 'text-red-400',
      bg: averageHealthScore >= 90 ? 'bg-emerald-500/10' : averageHealthScore >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10',
    },
    {
      label: 'Active Errors',
      value: activeErrors,
      icon: AlertTriangle,
      color: activeErrors > 0 ? 'text-red-400' : 'text-emerald-400',
      bg: activeErrors > 0 ? 'bg-red-500/10' : 'bg-emerald-500/10',
    },
    {
      label: 'Tests Passed (24h)',
      value: passingTests,
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.07 }}
        >
          <Card className="border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
