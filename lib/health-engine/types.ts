import type { Severity, ProjectStatus } from '@/types';

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
}

export interface ErrorSeverityCount {
  severity: Severity;
  count: number;
}

export interface HealthCalculationInput {
  results: TestRunSummary;
  runtimeErrors: ErrorSeverityCount[];
  previousScore?: number;
}

export interface HealthCalculationResult {
  score: number;
  status: ProjectStatus;
  tests_run: number;
  tests_passed: number;
}
