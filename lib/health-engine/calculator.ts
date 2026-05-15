import type { ProjectStatus } from '../../types';
import type { HealthCalculationInput, HealthCalculationResult } from './types';

const SEVERITY_WEIGHTS: Record<string, number> = {
  low: 1,
  medium: 3,
  high: 8,
  critical: 15,
};

export function calculateHealthScore(input: HealthCalculationInput): HealthCalculationResult {
  const { results, runtimeErrors } = input;

  if (results.total === 0) {
    return { score: 0, status: 'unknown', tests_run: 0, tests_passed: 0 };
  }

  // Base score from test pass rate (70% weight)
  const passRate = results.passed / results.total;
  let score = passRate * 70;

  // Error penalty (30% weight)
  const errorPenalty = runtimeErrors.reduce((acc, e) => {
    const weight = SEVERITY_WEIGHTS[e.severity] ?? 3;
    return acc + weight * e.count;
  }, 0);
  const errorScore = Math.max(0, 30 - errorPenalty);
  score += errorScore;

  const finalScore = Math.round(Math.min(100, Math.max(0, score)));

  let status: ProjectStatus;
  if (finalScore >= 90) status = 'healthy';
  else if (finalScore >= 70) status = 'warning';
  else status = 'critical';

  return {
    score: finalScore,
    status,
    tests_run: results.total,
    tests_passed: results.passed,
  };
}

export function scoreToStatus(score: number): ProjectStatus {
  if (score >= 90) return 'healthy';
  if (score >= 70) return 'warning';
  if (score > 0) return 'critical';
  return 'unknown';
}
