import { createClient } from '@/lib/supabase/server';
import type { Project, CreateProjectInput, ProjectStatus } from '@/types';

export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('projects')
    .insert({
      ...input,
      user_id: user.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  id: string,
  input: Partial<Pick<Project, 'project_name' | 'project_url' | 'description'>>
): Promise<Project> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function updateProjectHealth(
  id: string,
  health_score: number,
  status: ProjectStatus
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('projects')
    .update({ health_score, status })
    .eq('id', id);
  if (error) throw error;
}
