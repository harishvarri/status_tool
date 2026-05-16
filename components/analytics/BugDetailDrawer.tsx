'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, AlertTriangle, AlertCircle, Info, Zap, Image as ImageIcon } from 'lucide-react';
import type { RuntimeError, BugCategory, Severity } from '@/types';

interface BugDetailDrawerProps {
  errors: RuntimeError[];
}

const severityConfig: Record<Severity, { icon: typeof AlertTriangle; color: string; bg: string }> = {
  critical: { icon: Zap, color: 'text-red-400', bg: 'bg-red-500/10' },
  high: { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  medium: { icon: AlertCircle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  low: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

const categoryLabel: Record<BugCategory, string> = {
  auth: 'Auth',
  network: 'Network',
  ui: 'UI',
  js_runtime: 'JS Runtime',
  api: 'API',
  timeout: 'Timeout',
  db: 'Database',
  unknown: 'Unknown',
};

export function BugDetailDrawer({ errors }: BugDetailDrawerProps) {
  const [selected, setSelected] = useState<RuntimeError | null>(null);

  return (
    <>
      <Card className="border-border">
        <CardContent className="p-0">
          {errors.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-muted-foreground">
              <AlertCircle className="w-8 h-8 opacity-30" />
              <p className="text-sm">No bug details to inspect</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
              {errors.map((err) => {
                const config = severityConfig[err.severity];
                const Icon = config.icon;
                return (
                  <button
                    key={err.id}
                    onClick={() => setSelected(err)}
                    className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className={`mt-0.5 p-1.5 rounded-md shrink-0 ${config.bg}`}>
                      <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground line-clamp-2">{err.error_message}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {err.category && (
                          <Badge variant="outline" className="text-[10px] py-0">
                            {categoryLabel[err.category]}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(err.created_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Bug Details
                  {selected.category && (
                    <Badge variant="outline">{categoryLabel[selected.category]}</Badge>
                  )}
                  <Badge variant="outline" className={severityConfig[selected.severity].color}>
                    {selected.severity}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Captured {formatDistanceToNow(new Date(selected.created_at), { addSuffix: true })}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Error message</p>
                  <pre className="bg-muted p-3 rounded text-xs whitespace-pre-wrap break-words font-mono">
                    {selected.error_message}
                  </pre>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Page URL</p>
                    <a
                      href={selected.page_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1 break-all"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      {selected.page_url || '(no URL)'}
                    </a>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Functionality</p>
                    <p className="text-xs">{selected.functionality}</p>
                  </div>
                </div>
                {selected.screenshot_url && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" />
                      Screenshot at failure
                    </p>
                    <a
                      href={selected.screenshot_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block border border-border rounded-lg overflow-hidden hover:border-primary/30 transition-colors"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selected.screenshot_url}
                        alt="Failure screenshot"
                        className="w-full max-h-96 object-contain bg-muted"
                      />
                    </a>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
