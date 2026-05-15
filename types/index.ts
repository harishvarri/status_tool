export type ProjectStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type TestStatus = 'passed' | 'failed' | 'error' | 'pending';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'active' | 'resolved';

export interface Project {
  id: string;
  user_id: string;
  project_name: string;
  project_url: string;
  description: string | null;
  status: ProjectStatus;
  health_score: number;
  created_at: string;
  updated_at: string;
}

export interface TestStep {
  action: 'navigate' | 'click' | 'fill' | 'wait' | 'assert' | 'screenshot';
  selector?: string;
  value?: string;
  url?: string;
  timeout?: number;
}

export interface MonitoringTest {
  id: string;
  project_id: string;
  test_name: string;
  steps: TestStep[];
  expected_result: string;
  status: TestStatus;
  created_at: string;
}

export interface TestResult {
  id: string;
  test_id: string;
  project_id: string;
  status: 'passed' | 'failed' | 'error';
  error_message: string | null;
  screenshot_url: string | null;
  duration_ms: number;
  created_at: string;
}

export interface RuntimeError {
  id: string;
  project_id: string;
  error_message: string;
  page_url: string;
  functionality: string;
  severity: Severity;
  screenshot_url: string | null;
  created_at: string;
}

export interface Screenshot {
  id: string;
  project_id: string;
  test_result_id: string | null;
  storage_path: string;
  public_url: string;
  created_at: string;
}

export interface HealthLog {
  id: string;
  project_id: string;
  health_score: number;
  status: ProjectStatus;
  tests_run: number;
  tests_passed: number;
  created_at: string;
}

export interface Alert {
  id: string;
  project_id: string;
  alert_type: string;
  message: string;
  status: AlertStatus;
  created_at: string;
}

export interface CreateProjectInput {
  project_name: string;
  project_url: string;
  description?: string;
}

export interface CreateTestInput {
  project_id: string;
  test_name: string;
  steps: TestStep[];
  expected_result: string;
}

export interface UptimeSummary {
  uptime_percentage: number;
  total_checks: number;
  healthy_checks: number;
  last_checked: string | null;
}

export interface ErrorFrequencyData {
  date: string;
  count: number;
}

export interface ResponseTimeData {
  created_at: string;
  duration_ms: number;
  test_name: string;
}
