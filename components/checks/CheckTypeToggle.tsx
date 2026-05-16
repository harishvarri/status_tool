'use client';

import { cn } from '@/lib/utils';
import { Globe, Wifi } from 'lucide-react';
import type { CheckType } from '@/types';

interface CheckTypeToggleProps {
  value: CheckType;
  onChange: (value: CheckType) => void;
}

export function CheckTypeToggle({ value, onChange }: CheckTypeToggleProps) {
  const options: Array<{ value: CheckType; label: string; icon: typeof Globe; desc: string }> = [
    {
      value: 'browser',
      label: 'Browser',
      icon: Globe,
      desc: 'Playwright UI flow',
    },
    {
      value: 'http',
      label: 'HTTP API',
      icon: Wifi,
      desc: 'Backend endpoint',
    },
  ];

  return (
    <div className="flex gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex-1 px-3 py-2 rounded-lg border text-left transition-colors',
              active
                ? 'bg-primary/15 border-primary/40 text-foreground'
                : 'bg-background border-border text-muted-foreground hover:border-primary/20'
            )}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <opt.icon className="w-3.5 h-3.5" />
              <span className="text-sm font-medium">{opt.label}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
          </button>
        );
      })}
    </div>
  );
}
