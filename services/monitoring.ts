import { createClient } from '@/lib/supabase/server';
import type { MonitoringTest, TestResult, CreateTestInput } from '@/types';

export async function getTestsForProject(projectId: string): Promise<MonitoringTest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monitoring_tests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createTest(input: CreateTestInput): Promise<MonitoringTest> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monitoring_tests')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTest(
  id: string,
  input: Partial<Pick<MonitoringTest, 'test_name' | 'steps' | 'expected_result'>>
): Promise<MonitoringTest> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('monitoring_tests')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTest(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('monitoring_tests').delete().eq('id', id);
  if (error) throw error;
}

export async function getRecentResults(
  projectId: string,
  limit = 20
): Promise<(TestResult & { monitoring_tests: { test_name: string } | null })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('test_results')
    .select('*, monitoring_tests(test_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function saveTestResult(
  result: Omit<TestResult, 'id' | 'created_at'>
): Promise<TestResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('test_results')
    .insert(result)
    .select()
    .single();
  if (error) throw error;
  return data;
}
