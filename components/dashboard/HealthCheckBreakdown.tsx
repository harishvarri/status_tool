'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Cpu, Database, Shield,
  Globe, Zap, Server, RefreshCw, ChevronDown, ChevronUp, Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

// ─── Types (mirror DB + parser shapes) ───────────────────────────────────────

interface ParsedCheckRow {
  name: string;
  status: 'ok' | 'error' | 'warning' | 'skipped';
  latencyMs?: number;
  detail?: string;
  category: string;
  severity: string;
}

interface HealthSnapshot {
  id: string;
  project_id: string;
  overall_status: 'healthy' | 'degraded' | 'critical' | 'unknown';
  service_name: string | null;
  version: string | null;
  environment: string | null;
  response_time_ms: number | null;
  uptime_seconds: number | null;
  memory_percent: number | null;
  checks_total: number;
  checks_passed: number;
  checks_failed: number;
  checks_warning: number;
  snapshot: {
    checks?: Record<string, unknown>;
    metrics?: Record<string, unknown>;
    [key: string]: unknown;
  };
  created_at: string;
}

interface TrendPoint {
  overall_status: string;
  checks_passed: number;
  checks_total: number;
  checks_failed: number;
  response_time_ms: number | null;
  created_at: string;
}

interface HealthSnapshotData {
  latest: HealthSnapshot | null;
  trend: TrendPoint[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: string) {
  if (s === 'ok' || s === 'healthy')   return 'text-emerald-400';
  if (s === 'warning' || s === 'degraded') return 'text-amber-400';
  if (s === 'error' || s === 'critical')   return 'text-red-400';
  return 'text-muted-foreground';
}

function statusBg(s: string) {
  if (s === 'ok' || s === 'healthy')   return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
  if (s === 'warning' || s === 'degraded') return 'bg-amber-500/10 border-amber-500/20 text-amber-400';
  if (s === 'error' || s === 'critical')   return 'bg-red-500/10 border-red-500/20 text-red-400';
  return 'bg-muted/50 border-border text-muted-foreground';
}

function CheckIcon({ status }: { status: string }) {
  if (status === 'ok')      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === 'error')   return <XCircle      className="w-4 h-4 text-red-400 shrink-0" />;
  if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
  return <Clock className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function categoryIcon(category: string) {
  const cls = 'w-3.5 h-3.5 shrink-0 text-muted-foreground';
  if (category === 'db')       return <Database className={cls} />;
  if (category === 'auth')     return <Shield   className={cls} />;
  if (category === 'network')  return <Globe    className={cls} />;
  if (category === 'timeout')  return <Clock    className={cls} />;
  if (category === 'api')      return <Zap      className={cls} />;
  return                              <Server   className={cls} />;
}

function formatUptime(seconds: number): string {
  if (seconds < 60)   return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function latencyLabel(ms: number): { text: string; color: string } {
  if (ms < 300)  return { text: `${ms}ms`, color: 'text-emerald-400' };
  if (ms < 1000) return { text: `${ms}ms`, color: 'text-amber-400' };
  return              { text: `${ms}ms`, color: 'text-red-400' };
}

/** Parse check rows out of the raw snapshot JSON */
function extractChecks(snapshot: HealthSnapshot): ParsedCheckRow[] {
  const raw = snapshot.snapshot?.checks;
  if (!raw || typeof raw !== 'object') return [];

  const rows: ParsedCheckRow[] = [];
  const HEALTHY  = new Set(['ok','up','pass','passing','operational','green','healthy','true','connected','available']);
  const DEGRADED = new Set(['degraded','warning','warn','partial','yellow','slow']);
  const CRITICAL = new Set(['error','down','fail','failing','unhealthy','red','false','disconnected']);

  function mapStatus(v: unknown): 'ok' | 'error' | 'warning' | 'skipped' {
    if (typeof v === 'boolean') return v ? 'ok' : 'error';
    const s = String(v ?? '').toLowerCase().trim();
    if (HEALTHY.has(s))  return 'ok';
    if (DEGRADED.has(s)) return 'warning';
    if (CRITICAL.has(s)) return 'error';
    return 'skipped';
  }

  function checkCategory(name: string): string {
    const n = name.toLowerCase();
    if (/db|database|postgres|mysql|mongo|redis|cache|supabase/.test(n)) return 'db';
    if (/auth|session|jwt|login|clerk/.test(n)) return 'auth';
    if (/network|dns|ping/.test(n)) return 'network';
    if (/external|api|gemini|openai|stripe|webhook/.test(n)) return 'api';
    return 'unknown';
  }

  for (const [key, val] of Object.entries(raw)) {
    if ((key === 'external_apis' || key === 'externalApis') && typeof val === 'object' && val) {
      for (const [apiName, apiVal] of Object.entries(val as Record<string, unknown>)) {
        const obj  = typeof apiVal === 'object' && apiVal ? apiVal as Record<string, unknown> : {};
        const s    = mapStatus(obj.status ?? obj.state ?? apiVal);
        rows.push({
          name:      `${key}: ${apiName}`,
          status:    s,
          latencyMs: (obj.latency_ms ?? obj.latency ?? obj.duration) as number | undefined,
          detail:    (obj.detail ?? obj.message ?? obj.error) as string | undefined,
          category:  'api',
          severity:  s === 'error' ? 'medium' : 'low',
        });
      }
    } else {
      const obj  = typeof val === 'object' && val ? val as Record<string, unknown> : {};
      const s    = mapStatus(typeof val === 'object' ? (obj.status ?? obj.state) : val);
      rows.push({
        name:      key,
        status:    s,
        latencyMs: (obj.latency_ms ?? obj.latency ?? obj.duration) as number | undefined,
        detail:    (obj.detail ?? obj.message ?? obj.error) as string | undefined,
        category:  checkCategory(key),
        severity:  s === 'error' ? (checkCategory(key) === 'db' ? 'critical' : 'high') : 'low',
      });
    }
  }

  return rows;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MemoryBar({ percent }: { percent: number }) {
  const color = percent > 90 ? 'bg-red-500' : percent > 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <Cpu className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span className={percent > 90 ? 'text-red-400' : percent > 75 ? 'text-amber-400' : 'text-emerald-400'}>
        {percent}%
      </span>
    </div>
  );
}

function CheckRow({ check }: { check: ParsedCheckRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!check.detail;
  const latency   = check.latencyMs !== undefined ? latencyLabel(check.latencyMs) : null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => hasDetail && setOpen(!open)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left ${hasDetail ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'}`}
      >
        <CheckIcon status={check.status} />
        <span className="flex items-center gap-1.5 flex-1 min-w-0">
          {categoryIcon(check.category)}
          <span className="text-sm font-medium text-foreground truncate capitalize">
            {check.name.replace(/_/g, ' ')}
          </span>
        </span>
        {latency && (
          <span className={`text-xs font-mono ${latency.color} shrink-0`}>{latency.text}</span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${statusBg(check.status)}`}>
          {check.status}
        </span>
        {hasDetail && (
          open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
               : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
      {open && check.detail && (
        <div className="px-3 pb-2.5 text-xs text-muted-foreground bg-muted/20 border-t border-border">
          <code className="break-all">{check.detail}</code>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HealthCheckBreakdown({ projectId }: { projectId: string }) {
  const [data,     setData]     = useState<HealthSnapshotData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/health-snapshot`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const t = setInterval(() => load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <Card className="border-border bg-card animate-pulse">
        <CardHeader className="pb-3">
          <div className="h-5 w-40 bg-muted rounded" />
        </CardHeader>
        <CardContent className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-10 bg-muted rounded-lg" />)}
        </CardContent>
      </Card>
    );
  }

  const snap = data?.latest;

  if (!snap) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No health snapshot yet — add an HTTP check pointing to <code className="text-xs">/api/health</code> and trigger a monitoring run.
        </CardContent>
      </Card>
    );
  }

  const checks = extractChecks(snap);
  const passRate = snap.checks_total > 0
    ? Math.round((snap.checks_passed / snap.checks_total) * 100)
    : 100;

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-foreground text-sm">
              Health Endpoint
              {snap.service_name && (
                <span className="text-muted-foreground font-normal ml-1.5">— {snap.service_name}</span>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(true)}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${statusBg(snap.overall_status)}`}>
              {snap.overall_status}
            </span>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
          {snap.version && (
            <span>v{snap.version}</span>
          )}
          {snap.environment && (
            <span className="capitalize">{snap.environment}</span>
          )}
          {snap.uptime_seconds !== null && snap.uptime_seconds !== undefined && (
            <span>↑ {formatUptime(snap.uptime_seconds)}</span>
          )}
          {snap.response_time_ms !== null && snap.response_time_ms !== undefined && (
            <span className={latencyLabel(snap.response_time_ms).color}>
              {snap.response_time_ms}ms endpoint latency
            </span>
          )}
          <span className="text-muted-foreground/60">
            · {formatDistanceToNow(new Date(snap.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Pass-rate bar */}
        {snap.checks_total > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  passRate === 100 ? 'bg-emerald-500' : passRate >= 70 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${passRate}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              {snap.checks_passed}/{snap.checks_total} checks
            </span>
          </div>
        )}

        {/* Memory */}
        {snap.memory_percent !== null && snap.memory_percent !== undefined && (
          <div className="mt-2">
            <MemoryBar percent={snap.memory_percent} />
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-0 space-y-1.5">
        {checks.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No individual check data in this snapshot.
          </p>
        ) : (
          checks.map((c) => <CheckRow key={c.name} check={c} />)
        )}

        {/* Mini trend strip */}
        {(data?.trend?.length ?? 0) > 1 && (
          <div className="pt-3 border-t border-border mt-2">
            <p className="text-xs text-muted-foreground mb-2">24h history</p>
            <div className="flex gap-1 items-end h-8">
              {data!.trend.slice(-24).map((t, i) => {
                const h = t.checks_total > 0
                  ? Math.max(20, Math.round((t.checks_passed / t.checks_total) * 100))
                  : 100;
                const color =
                  t.overall_status === 'healthy'  ? 'bg-emerald-500' :
                  t.overall_status === 'degraded' ? 'bg-amber-500'   :
                  t.overall_status === 'critical' ? 'bg-red-500'     : 'bg-muted';
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm ${color} opacity-80`}
                    style={{ height: `${h}%` }}
                    title={`${t.overall_status} · ${new Date(t.created_at).toLocaleTimeString()}`}
                  />
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
