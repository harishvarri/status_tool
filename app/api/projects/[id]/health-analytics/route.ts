import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Fetch last 96 snapshots (up to 4 days of hourly data)
    const { data: snapshots } = await supabase
      .from('health_snapshots')
      .select('id, overall_status, response_time_ms, checks_total, checks_passed, checks_failed, checks_warning, snapshot, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(96);

    const snaps = snapshots ?? [];
    const total = snaps.length;

    if (total === 0) {
      return NextResponse.json({
        summary: { uptime_percent: null, avg_response_ms: null, check_pass_rate: null, total_snapshots: 0, healthy: 0, degraded: 0, critical: 0 },
        response_trend: [],
        status_history: [],
        check_stats: [],
      });
    }

    // ── Summary stats ─────────────────────────────────────────────────────────
    const healthyCount  = snaps.filter(s => s.overall_status === 'healthy').length;
    const degradedCount = snaps.filter(s => s.overall_status === 'degraded').length;
    const criticalCount = snaps.filter(s => s.overall_status === 'critical').length;

    const uptime_percent = Math.round((healthyCount / total) * 1000) / 10;

    const responseTimes = snaps.filter(s => s.response_time_ms != null).map(s => s.response_time_ms as number);
    const avg_response_ms = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

    const p95_response_ms = responseTimes.length > 0
      ? (() => {
          const sorted = [...responseTimes].sort((a, b) => a - b);
          return sorted[Math.floor(sorted.length * 0.95)] ?? null;
        })()
      : null;

    const passRates = snaps
      .filter(s => s.checks_total > 0)
      .map(s => s.checks_passed / s.checks_total);
    const check_pass_rate = passRates.length > 0
      ? Math.round((passRates.reduce((a, b) => a + b, 0) / passRates.length) * 1000) / 10
      : null;

    const total_checks_run = snaps.reduce((sum, s) => sum + (s.checks_total ?? 0), 0);

    // ── Response time trend (reverse chronological → oldest first for chart) ──
    const response_trend = [...snaps]
      .reverse()
      .map(s => ({
        created_at:      s.created_at,
        response_time_ms: s.response_time_ms,
        overall_status:  s.overall_status,
      }));

    // ── Status history grouped by day ─────────────────────────────────────────
    const dayMap = new Map<string, { healthy: number; degraded: number; critical: number; unknown: number }>();
    for (const s of snaps) {
      const day = s.created_at.slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, { healthy: 0, degraded: 0, critical: 0, unknown: 0 });
      const entry = dayMap.get(day)!;
      if      (s.overall_status === 'healthy')  entry.healthy++;
      else if (s.overall_status === 'degraded') entry.degraded++;
      else if (s.overall_status === 'critical') entry.critical++;
      else                                      entry.unknown++;
    }
    const status_history = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));

    // ── Per-check stats (parse snapshot JSON) ─────────────────────────────────
    type CheckAgg = { ok: number; warning: number; error: number; skipped: number; last_status: string; latencies: number[] };
    const checkMap = new Map<string, CheckAgg>();

    const HEALTHY_SET  = new Set(['ok','up','pass','passing','operational','green','healthy','true','connected','available']);
    const DEGRADED_SET = new Set(['degraded','warning','warn','partial','yellow','slow']);
    const CRITICAL_SET = new Set(['error','down','fail','failing','unhealthy','red','false','disconnected']);

    function mapStatus(v: unknown): 'ok' | 'warning' | 'error' | 'skipped' {
      if (typeof v === 'boolean') return v ? 'ok' : 'error';
      const s = String(v ?? '').toLowerCase().trim();
      if (HEALTHY_SET.has(s))  return 'ok';
      if (DEGRADED_SET.has(s)) return 'warning';
      if (CRITICAL_SET.has(s)) return 'error';
      return 'skipped';
    }

    for (const snap of snaps) {
      const raw = (snap.snapshot as Record<string, unknown>)?.checks;
      if (!raw || typeof raw !== 'object') continue;

      for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
        if (!checkMap.has(key)) checkMap.set(key, { ok: 0, warning: 0, error: 0, skipped: 0, last_status: 'skipped', latencies: [] });
        const agg = checkMap.get(key)!;

        const obj = typeof val === 'object' && val ? val as Record<string, unknown> : {};
        const status = mapStatus(typeof val === 'object' ? (obj.status ?? obj.state) : val);
        agg[status]++;
        if (agg.last_status === 'skipped') agg.last_status = status;

        const lat = obj.latency_ms ?? obj.latency ?? obj.duration;
        if (typeof lat === 'number') agg.latencies.push(lat);
      }
    }

    const check_stats = [...checkMap.entries()].map(([name, agg]) => {
      const relevant = agg.ok + agg.warning + agg.error;
      const uptime = relevant > 0 ? Math.round((agg.ok / relevant) * 1000) / 10 : null;
      const avg_latency = agg.latencies.length > 0
        ? Math.round(agg.latencies.reduce((a, b) => a + b, 0) / agg.latencies.length)
        : null;
      return { name, ok: agg.ok, warning: agg.warning, error: agg.error, total: relevant, uptime_percent: uptime, avg_latency_ms: avg_latency, last_status: agg.last_status };
    }).sort((a, b) => (a.uptime_percent ?? 100) - (b.uptime_percent ?? 100));

    return NextResponse.json({
      summary: {
        uptime_percent,
        avg_response_ms,
        p95_response_ms,
        check_pass_rate,
        total_checks_run,
        total_snapshots: total,
        healthy: healthyCount,
        degraded: degradedCount,
        critical: criticalCount,
      },
      response_trend,
      status_history,
      check_stats,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
