import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; featureId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { featureId } = await params;
    const body = await request.json();

    const allowed: Record<string, unknown> = {};
    if (typeof body.name === 'string') allowed.name = body.name;
    if (typeof body.slug === 'string') allowed.slug = body.slug;
    if (typeof body.description === 'string' || body.description === null)
      allowed.description = body.description;
    if (typeof body.weight === 'number') allowed.weight = body.weight;

    const { data, error } = await supabase
      .from('features')
      .update(allowed)
      .eq('id', featureId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; featureId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { featureId } = await params;
    const { error } = await supabase.from('features').delete().eq('id', featureId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
