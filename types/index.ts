export type ProjectStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type TestStatus = 'passed' | 'failed' | 'error' | 'pending';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'active' | 'resolved';
export type CheckType = 'browser' | 'http';
export type BugCategory =
  | 'auth'
  | 'network'
  | 'ui'
  | 'js_runtime'
  | 'api'
  | 'timeout'
  | 'db'
  | 'unknown';

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

export interface HttpCheckConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  expected_status?: number;
  expected_body_contains?: string;
  max_response_time_ms?: number;
}

export interface MonitoringTest {
  id: string;
  project_id: string;
  feature_id: string | null;
  test_name: string;
  steps: TestStep[];
  expected_result: string;
  status: TestStatus;
  check_type: CheckType;
  http_config: HttpCheckConfig | null;
  created_at: string;
}

export interface Feature {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description: string | null;
  weight: number;
  health_score: number;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface FeatureHealthLog {
  id: string;
  feature_id: string;
  project_id: string;
  health_score: number;
  status: ProjectStatus;
  checks_run: number;
  checks_passed: number;
  created_at: string;
}

export interface TestResult {
  id: string;
  test_id: string;
  project_id: string;
  feature_id: string | null;
  status: 'passed' | 'failed' | 'error';
  error_message: string | null;
  screenshot_url: string | null;
  duration_ms: number;
  http_status_code: number | null;
  response_size_bytes: number | null;
  created_at: string;
}

export interface RuntimeError {
  id: string;
  project_id: string;
  feature_id: string | null;
  error_message: string;
  page_url: string;
  functionality: string;
  severity: Severity;
  category: BugCategory | null;
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
  feature_id: string | null;
  alert_type: string;
  message: string;
  status: AlertStatus;
  severity: Severity | null;
  created_at: string;
}

export interface CreateProjectInput {
  project_name: string;
  project_url: string;
  description?: string;
}

export interface CreateTestInput {
  project_id: string;
  feature_id?: string | null;
  test_name: string;
  steps: TestStep[];
  expected_result: string;
  check_type?: CheckType;
  http_config?: HttpCheckConfig | null;
}

export interface CreateFeatureInput {
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  weight?: number;
}

export interface BugCategoryBreakdown {
  category: BugCategory;
  count: number;
  percentage: number;
}

export interface FailingFeatureSummary {
  feature_id: string;
  feature_name: string;
  project_id: string;
  project_name: string;
  health_score: number;
  status: ProjectStatus;
  failed_checks: number;
  total_checks: number;
}

export interface BugTrendPoint {
  date: string;
  category: BugCategory;
  count: number;
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
