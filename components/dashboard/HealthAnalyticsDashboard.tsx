'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';
import {
  Activity, CheckCircle2, XCircle, AlertTriangle, Clock,
  Database, Shield, Globe, Zap, Server, TrendingUp, RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  uptime_percent: number | null;
  avg_response_ms: number | null;
  p95_response_ms: number | null;
  check_pass_rate: number | null;
  total_checks_run: number;
  total_snapshots: number;
  healthy: number;
  degraded: number;
  critical: number;
}

interface TrendPoint {
  created_at: string;
  response_time_ms: number | null;
  overall_status: string;
}

interface StatusDay {
  date: string;
  healthy: number;
  degraded: number;
  critical: number;
  unknown: number;
}

interface CheckStat {
  name: string;
  ok: number;
  warning: number;
  error: number;
  total: number;
  uptime_percent: number | null;
  avg_latency_ms: number | null;
  last_status: string;
}

interface AnalyticsData {
  summary: Summary;
  response_trend: TrendPoint[];
  status_history: StatusDay[];
  check_stats: CheckStat[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uptimeColor(pct: number | null) {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 99)   return 'text-emerald-400';
  if (pct >= 95)   return 'text-amber-400';
  return 'text-red-400';
}

function latencyColor(ms: number | null) {
  if (ms === null) return 'text-muted-foreground';
  if (ms < 300)    return 'text-emerald-400';
  if (ms < 1000)   return 'text-amber-400';
  return 'text-red-400';
}

function statusDot(s: string) {
  if (s === 'ok' || s === 'healthy')         return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />;
  if (s === 'warning' || s === 'degraded')   return <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />;
  if (s === 'error'   || s === 'critical')   return <span className="inline-block w-2 h-2 rounded-full bg-red-400" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />;
}

function CheckIcon({ s }: { s: string }) {
  if (s === 'ok')      return <CheckCircle2  className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (s === 'error')   return <XCircle       className="w-4 h-4 text-red-400 shrink-0" />;
  if (s === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
  return <Clock className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function categoryIcon(name: string) {
  const n = name.toLowerCase();
  const cls = 'w-3.5 h-3.5 shrink-0 text-muted-foreground';
  if (/db|database|postgres|mysql|mongo|redis|cache|supabase/.test(n)) return <Database className={cls} />;
  if (/auth|session|jwt|login|clerk/.test(n))                           return <Shield   className={cls} />;
  if (/network|dns|ping/.test(n))                                       return <Globe    className={cls} />;
  if (/external|api|gemini|openai|stripe|webhook/.test(n))              return <Zap      className={cls} />;
  return <Server className={cls} />;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-2xl font-bold ${valueClass ?? 'text-foreground'}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function ResponseTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as TrendPoint;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{format(new Date(d.created_at), 'MMM d HH:mm')}</p>
      <p className="text-foreground font-medium">{d.response_time_ms != null ? `${d.response_time_ms}ms` : '—'}</p>
      <p className={
        d.overall_status === 'healthy'  ? 'text-emerald-400' :
        d.overall_status === 'degraded' ? 'text-amber-400' : 'text-red-400'
      }>{d.overall_status}</p>
    </div>
  );
}

function StatusTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill }}>{p.name}: {p.value}</p>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function HealthAnalyticsDashboard({ projectId }: { projectId: string }) {
  const [data,      setData]      = useState<AnalyticsData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const load = useCallback(async (spinner = false) => {
    if (spinner) setRefreshing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/health-analytics`);
      if (res.ok) {
        setData(await res.json());
        setLastFetched(new Date());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-muted rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-64 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
        </div>
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  const s = data?.summary;
  const hasData = (s?.total_snapshots ?? 0) > 0;

  if (!hasData) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          <Activity className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="font-medium text-foreground mb-1">No health snapshots yet</p>
          <p>Add an HTTP check pointing to <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/health</code> and trigger a monitor run.</p>
        </CardContent>
      </Card>
    );
  }

  const checks = data!.check_stats;
  const trend  = data!.response_trend;
  const hist   = data!.status_history;

  // Dot colors for response time line based on status
  const trendWithColor = trend.map(t => ({
    ...t,
    color:
      t.overall_status === 'healthy'  ? '#34d399' :
      t.overall_status === 'degraded' ? '#fbbf24' : '#f87171',
  }));

  return (
    <div className="space-y-5">
      {/* Refresh row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {lastFetched ? `Updated ${formatDistanceToNow(lastFetched, { addSuffix: true })}` : ''}
          {s && ` · ${s.total_snapshots} snapshots analysed`}
        </p>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Uptime"
          value={s?.uptime_percent != null ? `${s.uptime_percent}%` : '—'}
          sub={`${s?.healthy ?? 0} healthy / ${s?.total_snapshots ?? 0} checks`}
          valueClass={uptimeColor(s?.uptime_percent ?? null)}
        />
        <KpiCard
          label="Avg Response Time"
          value={s?.avg_response_ms != null ? `${s.avg_response_ms}ms` : '—'}
          sub={s?.p95_response_ms != null ? `p95: ${s.p95_response_ms}ms` : undefined}
          valueClass={latencyColor(s?.avg_response_ms ?? null)}
        />
        <KpiCard
          label="Check Pass Rate"
          value={s?.check_pass_rate != null ? `${s.check_pass_rate}%` : '—'}
          sub={`${s?.total_checks_run ?? 0} total checks run`}
          valueClass={
            (s?.check_pass_rate ?? 0) >= 99 ? 'text-emerald-400' :
            (s?.check_pass_rate ?? 0) >= 90 ? 'text-amber-400' : 'text-red-400'
          }
        />
        <KpiCard
          label="Status Breakdown"
          value={`${s?.healthy ?? 0} / ${s?.degraded ?? 0} / ${s?.critical ?? 0}`}
          sub="healthy / degraded / critical"
        />
      </div>

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Response Time Trend */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Response Time Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendWithColor} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="created_at"
                    tickFormatter={v => format(new Date(v), 'HH:mm')}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={v => `${v}ms`}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <Tooltip content={<ResponseTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="response_time_ms"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      const c =
                        payload.overall_status === 'healthy'  ? '#34d399' :
                        payload.overall_status === 'degraded' ? '#fbbf24' : '#f87171';
                      return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={c} stroke="none" />;
                    }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status History */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Daily Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hist.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8 text-center">No data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={v => format(new Date(v + 'T00:00:00'), 'MMM d')}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    width={28}
                  />
                  <Tooltip content={<StatusTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                    formatter={(v) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{v}</span>}
                  />
                  <Bar dataKey="healthy"  stackId="a" fill="#34d399" radius={[0,0,0,0]} name="healthy" />
                  <Bar dataKey="degraded" stackId="a" fill="#fbbf24" name="degraded" />
                  <Bar dataKey="critical" stackId="a" fill="#f87171" name="critical" />
                  <Bar dataKey="unknown"  stackId="a" fill="hsl(var(--muted))" name="unknown" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Per-Check Breakdown Table ──────────────────────────────────────── */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            Per-Check Analytics
            <span className="text-xs font-normal text-muted-foreground ml-1">
              — {checks.length} service{checks.length !== 1 ? 's' : ''} tracked
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {checks.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No individual check data found in snapshots.
            </p>
          ) : (
            <div className="space-y-0 divide-y divide-border">
              {/* Header */}
              <div className="grid grid-cols-[1fr_80px_80px_80px_70px_70px] gap-3 pb-2 text-xs text-muted-foreground font-medium">
                <span>Service</span>
                <span className="text-right">Uptime</span>
                <span className="text-right">Avg Latency</span>
                <span className="text-right">Pass / Warn / Fail</span>
                <span className="text-right">Checks</span>
                <span className="text-right">Last Status</span>
              </div>
              {checks.map(c => {
                const uptimePct = c.uptime_percent;
                const uptimeCls =
                  uptimePct === null   ? 'text-muted-foreground' :
                  uptimePct >= 99      ? 'text-emerald-400' :
                  uptimePct >= 95      ? 'text-amber-400'   : 'text-red-400';

                // Mini bar proportional to uptime
                const barW = uptimePct ?? 0;
                const barCls =
                  barW >= 99 ? 'bg-emerald-500' :
                  barW >= 95 ? 'bg-amber-500'   : 'bg-red-500';

                return (
                  <div key={c.name} className="grid grid-cols-[1fr_80px_80px_80px_70px_70px] gap-3 py-3 items-center text-xs">
                    {/* Name + icon + mini uptime bar */}
                    <div className="flex items-center gap-2 min-w-0">
                      {categoryIcon(c.name)}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize truncate">
                          {c.name.replace(/_/g, ' ')}
                        </p>
                        {uptimePct !== null && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barCls}`} style={{ width: `${barW}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Uptime % */}
                    <span className={`text-right font-mono font-medium ${uptimeCls}`}>
                      {uptimePct != null ? `${uptimePct}%` : '—'}
                    </span>

                    {/* Avg latency */}
                    <span className={`text-right font-mono ${latencyColor(c.avg_latency_ms)}`}>
                      {c.avg_latency_ms != null ? `${c.avg_latency_ms}ms` : '—'}
                    </span>

                    {/* ok / warn / err counts */}
                    <span className="text-right font-mono text-muted-foreground">
                      <span className="text-emerald-400">{c.ok}</span>
                      <span className="mx-0.5">/</span>
                      <span className="text-amber-400">{c.warning}</span>
                      <span className="mx-0.5">/</span>
                      <span className="text-red-400">{c.error}</span>
                    </span>

                    {/* Total */}
                    <span className="text-right text-muted-foreground">{c.total}</span>

                    {/* Last status */}
                    <span className="flex items-center justify-end gap-1">
                      {statusDot(c.last_status)}
                      <span className="text-muted-foreground capitalize">{c.last_status}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Status Timeline Strip ──────────────────────────────────────────── */}
      {trend.length > 1 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Status Timeline
              <span className="text-xs font-normal text-muted-foreground ml-1">— last {trend.length} checks</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex gap-0.5 items-end h-10">
              {trend.map((t, i) => {
                const color =
                  t.overall_status === 'healthy'  ? 'bg-emerald-500' :
                  t.overall_status === 'degraded' ? 'bg-amber-500'   :
                  t.overall_status === 'critical' ? 'bg-red-500'     : 'bg-muted';
                const h =
                  t.overall_status === 'healthy'  ? 100 :
                  t.overall_status === 'degraded' ? 60  :
                  t.overall_status === 'critical' ? 30  : 20;
                return (
                  <div
                    key={i}
                    title={`${t.overall_status} · ${format(new Date(t.created_at), 'MMM d HH:mm')}${t.response_time_ms ? ` · ${t.response_time_ms}ms` : ''}`}
                    className={`flex-1 rounded-sm ${color} opacity-80 cursor-default transition-opacity hover:opacity-100`}
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>{format(new Date(trend[0].created_at), 'MMM d HH:mm')}</span>
              <span>{format(new Date(trend[trend.length - 1].created_at), 'MMM d HH:mm')}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
