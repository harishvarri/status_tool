import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/projects/[id]/health-snapshot
 *
 * Returns the most recent health endpoint snapshot for the project,
 * plus a 24-hour trend (one data point per snapshot).
 * Used by the HealthCheckBreakdown component on the project detail page.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Verify project ownership
    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Latest snapshot (full details)
    const { data: latest } = await supabase
      .from('health_snapshots')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // 24h trend (lightweight — just status + score + time)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: trend } = await supabase
      .from('health_snapshots')
      .select('overall_status, checks_passed, checks_total, checks_failed, response_time_ms, created_at')
      .eq('project_id', id)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    return NextResponse.json({ latest: latest ?? null, trend: trend ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
