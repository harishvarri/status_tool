'use client';

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BugCategory } from '@/types';

interface BugCategoryChartProps {
  data: Array<{ category: BugCategory; count: number; percentage: number }>;
}

const COLOR_MAP: Record<BugCategory, string> = {
  auth: '#f87171',
  network: '#fb923c',
  ui: '#818cf8',
  js_runtime: '#a78bfa',
  api: '#facc15',
  timeout: '#34d399',
  db: '#06b6d4',
  unknown: '#6b7280',
};

const LABEL_MAP: Record<BugCategory, string> = {
  auth: 'Authentication',
  network: 'Network',
  ui: 'UI / Selector',
  js_runtime: 'JS Runtime',
  api: 'API / HTTP',
  timeout: 'Timeout',
  db: 'Database',
  unknown: 'Unknown',
};

export function BugCategoryChart({ data }: BugCategoryChartProps) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Bug Categories</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            No bugs detected
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="category"
                cx="40%"
                cy="50%"
                outerRadius={70}
                innerRadius={36}
                paddingAngle={2}
                stroke="rgba(255,255,255,0.05)"
              >
                {data.map((entry) => (
                  <Cell
                    key={entry.category}
                    fill={COLOR_MAP[entry.category] ?? '#6b7280'}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1c1f2e',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(value, name) => [`${value}`, LABEL_MAP[name as BugCategory] ?? name]}
              />
              <Legend
                verticalAlign="middle"
                align="right"
                layout="vertical"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, color: '#9ca3af' }}
                formatter={(value) => LABEL_MAP[value as BugCategory] ?? value}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
