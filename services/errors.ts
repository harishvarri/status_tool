import { createClient } from '@/lib/supabase/server';
import type { RuntimeError } from '@/types';

export async function getProjectErrors(
  projectId: string,
  limit = 50
): Promise<RuntimeError[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runtime_errors')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function saveRuntimeError(
  input: Omit<RuntimeError, 'id' | 'created_at'>
): Promise<RuntimeError> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runtime_errors')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getRecentErrorsAllProjects(limit = 50): Promise<
  (RuntimeError & { projects: { project_name: string } | null })[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runtime_errors')
    .select('*, projects(project_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getErrorStats(projectId: string): Promise<{
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runtime_errors')
    .select('severity')
    .eq('project_id', projectId);
  if (error) throw error;

  const counts = { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of data ?? []) {
    counts.total++;
    if (row.severity in counts) {
      counts[row.severity as keyof typeof counts]++;
    }
  }
  return counts;
}
