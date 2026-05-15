import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // Validate caller — accepts both API secret (GitHub Actions / external) and session cookie (UI)
    const apiSecret = request.headers.get('x-api-secret');
    const isApiCall = apiSecret && apiSecret === process.env.PULSEOPS_API_SECRET;

    if (!isApiCall) {
      // Fallback: check Supabase session
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { projectId } = await request.json();

    const githubToken = process.env.GITHUB_TOKEN;
    const githubRepo = process.env.GITHUB_REPO;

    if (!githubToken || !githubRepo) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN and GITHUB_REPO must be set to trigger remote monitoring' },
        { status: 503 }
      );
    }

    const res = await fetch(
      `https://api.github.com/repos/${githubRepo}/actions/workflows/monitor.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { project_id: projectId ?? '' },
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `GitHub API error: ${text}` }, { status: 500 });
    }

    return NextResponse.json({ triggered: true, projectId: projectId ?? 'all' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
