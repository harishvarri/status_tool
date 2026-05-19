import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { project_name, project_url, description, auth_login_url, auth_username, auth_password } = body;

    if (!project_name || !project_url) {
      return NextResponse.json({ error: 'project_name and project_url are required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('projects')
      .insert({ project_name, project_url, description, auth_login_url, auth_username, auth_password, user_id: user.id })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
