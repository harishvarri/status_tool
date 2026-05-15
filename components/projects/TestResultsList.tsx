import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, XCircle, AlertCircle, Image } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TestResult } from '@/types';

interface EnrichedResult extends TestResult {
  monitoring_tests: { test_name: string } | null;
}

interface TestResultsListProps {
  results: EnrichedResult[];
}

const statusConfig = {
  passed: { icon: CheckCircle2, color: 'text-emerald-400', label: 'Passed' },
  failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
  error: { icon: AlertCircle, color: 'text-amber-400', label: 'Error' },
};

export function TestResultsList({ results }: TestResultsListProps) {
  if (results.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Test Results</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
            <AlertCircle className="w-8 h-8 opacity-30" />
            <p className="text-sm">No test results yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Recent Test Results</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {results.map((result) => {
            const config = statusConfig[result.status];
            const Icon = config.icon;
            return (
              <div key={result.id} className="flex items-start gap-3 px-4 py-3">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${config.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">
                      {result.monitoring_tests?.test_name ?? 'Unknown test'}
                    </span>
                    <span className={`text-xs ${config.color}`}>{config.label}</span>
                  </div>
                  {result.error_message && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {result.error_message}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{result.duration_ms}ms</span>
                    <span>
                      {formatDistanceToNow(new Date(result.created_at), { addSuffix: true })}
                    </span>
                    {result.screenshot_url && (
                      <a
                        href={result.screenshot_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <Image className="w-3 h-3" />
                        Screenshot
                      </a>
                    )}
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
