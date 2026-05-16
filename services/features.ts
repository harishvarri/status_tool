import { createClient } from '@/lib/supabase/server';
import type { Feature, CreateFeatureInput, FeatureHealthLog } from '@/types';

export async function getProjectFeatures(projectId: string): Promise<Feature[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('features')
    .select('*')
    .eq('project_id', projectId)
    .order('weight', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getFeature(featureId: string): Promise<Feature | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('features')
    .select('*')
    .eq('id', featureId)
    .single();
  if (error) return null;
  return data;
}

export async function createFeature(input: CreateFeatureInput): Promise<Feature> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('features')
    .insert({
      project_id: input.project_id,
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      weight: input.weight ?? 1,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateFeature(
  id: string,
  input: Partial<Pick<Feature, 'name' | 'slug' | 'description' | 'weight'>>
): Promise<Feature> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('features')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFeature(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('features').delete().eq('id', id);
  if (error) throw error;
}

export async function getFeatureHealthLogs(
  featureId: string,
  days = 7
): Promise<FeatureHealthLog[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('feature_health_logs')
    .select('*')
    .eq('feature_id', featureId)
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
