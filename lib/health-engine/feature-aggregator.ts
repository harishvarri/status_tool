import { calculateHealthScore } from './calculator';
import type { Feature, TestResult, ProjectStatus, Severity } from '../../types';

export interface FeatureHealthEntry {
  feature_id: string;
  health_score: number;
  status: ProjectStatus;
  checks_run: number;
  checks_passed: number;
}

interface PersistableErrorLite {
  feature_id: string | null;
  severity: Severity;
}

/**
 * Compute per-feature health from a flat list of test results + errors.
 * Each feature gets its own health score using the existing formula
 * (70% pass rate + 30% error penalty by severity).
 *
 * Tests not assigned to a feature are silently ignored — they don't
 * contribute to any feature's score (but may still contribute to the
 * project-level legacy aggregate).
 */
export function aggregateFeatureHealth(
  features: Feature[],
  results: Array<Pick<TestResult, 'feature_id' | 'status'>>,
  errors: PersistableErrorLite[]
): FeatureHealthEntry[] {
  return features.map((feature) => {
    const featureResults = results.filter((r) => r.feature_id === feature.id);
    const featureErrors = errors.filter((e) => e.feature_id === feature.id);

    const total = featureResults.length;
    const passed = featureResults.filter((r) => r.status === 'passed').length;
    const failed = featureResults.filter((r) => r.status === 'failed').length;
    const errored = featureResults.filter((r) => r.status === 'error').length;

    // Group errors by severity for the calculator
    const severityCounts = new Map<Severity, number>();
    for (const e of featureErrors) {
      severityCounts.set(e.severity, (severityCounts.get(e.severity) ?? 0) + 1);
    }

    const calc = calculateHealthScore({
      results: { total, passed, failed, errors: errored },
      runtimeErrors: Array.from(severityCounts.entries()).map(([severity, count]) => ({
        severity,
        count,
      })),
    });

    return {
      feature_id: feature.id,
      health_score: calc.score,
      status: calc.status,
      checks_run: total,
      checks_passed: passed,
    };
  });
}
