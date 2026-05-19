/**
 * Health Endpoint Parser
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects when an HTTP response is a structured health endpoint (as opposed to
 * a regular web page), parses every check result out of it, and converts
 * failures into PersistableErrors with proper severity + BugCategory.
 *
 * Supports common health endpoint shapes:
 *   • Our standard format (from the prompt we issue)
 *   • Express/Fastify healthcheck libraries
 *   • Spring Boot Actuator /actuator/health
 *   • Custom JSON with status/health/state fields
 */

import type { Severity, BugCategory } from '../../types';

// ─── Raw shapes (permissive — different frameworks use different field names) ──

interface RawCheckResult {
  status?: string;
  state?: string;
  health?: string;
  latency_ms?: number;
  latency?: number;
  duration?: number;
  responseTime?: number;
  detail?: string;
  message?: string;
  error?: string;
  description?: string;
}

interface RawHealthResponse {
  // Overall status — any of these field names
  status?: string;
  health?: string;
  state?: string;
  // Metadata
  service?: string;
  name?: string;
  appName?: string;
  version?: string;
  environment?: string;
  env?: string;
  uptime?: number;
  uptime_seconds?: number;
  uptimeSeconds?: number;
  response_time_ms?: number;
  responseTime?: number;
  timestamp?: string;
  // Checks under different namespaces
  checks?: Record<string, unknown>;
  services?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  components?: Record<string, unknown>;     // Spring Boot Actuator
  details?: Record<string, unknown>;        // some custom formats
  // System metrics
  metrics?: {
    memory_used_mb?: number;
    memory_total_mb?: number;
    memory_percent?: number;
    heap_used?: number;
    heap_total?: number;
    node_version?: string;
    [key: string]: unknown;
  };
  memory?: {
    used?: number;
    total?: number;
    percent?: number;
  };
  system?: {
    memoryUsage?: number;
    freeMemory?: number;
    totalMemory?: number;
  };
}

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ParsedCheck {
  name: string;
  status: 'ok' | 'error' | 'warning' | 'skipped';
  latencyMs?: number;
  detail?: string;
  category: BugCategory;
  severity: Severity;
}

export interface HealthEndpointSnapshot {
  /** true when we're confident this is a health endpoint response */
  isHealthEndpoint: boolean;
  overallStatus: 'healthy' | 'degraded' | 'critical' | 'unknown';
  // Metadata
  service?: string;
  version?: string;
  environment?: string;
  uptimeSeconds?: number;
  responseTimeMs?: number;
  // System resources
  memoryPercent?: number;
  memoryUsedMb?: number;
  nodeVersion?: string;
  // Check aggregates
  checksTotal: number;
  checksPassed: number;
  checksFailed: number;
  checksWarning: number;
  checks: ParsedCheck[];
  /** The raw parsed JSON — stored as-is in health_snapshots.snapshot */
  rawSnapshot: unknown;
}

// ─── Status normalisation ─────────────────────────────────────────────────────

const HEALTHY  = new Set(['healthy', 'ok', 'up', 'pass', 'passing', 'operational', 'green', 'alive', 'available', 'reachable', 'connected', 'success', 'true']);
const DEGRADED = new Set(['degraded', 'warning', 'warn', 'partial', 'yellow', 'orange', 'slow', 'impaired']);
const CRITICAL = new Set(['critical', 'error', 'down', 'fail', 'failing', 'unhealthy', 'red', 'unavailable', 'disconnected', 'unreachable', 'false', 'off']);

function normalizeCheckStatus(raw?: unknown): 'ok' | 'error' | 'warning' | 'skipped' {
  if (raw === undefined || raw === null) return 'skipped';
  if (typeof raw === 'boolean') return raw ? 'ok' : 'error';
  const s = String(raw).toLowerCase().trim();
  if (HEALTHY.has(s))  return 'ok';
  if (DEGRADED.has(s)) return 'warning';
  if (CRITICAL.has(s)) return 'error';
  return 'skipped';
}

function normalizeOverallStatus(raw?: string): 'healthy' | 'degraded' | 'critical' | 'unknown' {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase().trim();
  if (HEALTHY.has(s))  return 'healthy';
  if (DEGRADED.has(s)) return 'degraded';
  if (CRITICAL.has(s)) return 'critical';
  return 'unknown';
}

// ─── Check classification ──────────────────────────────────────────────────────

const CATEGORY_RULES: Array<{ patterns: RegExp[]; category: BugCategory; criticalByDefault: boolean }> = [
  {
    patterns: [/^db$/i, /^database$/i, /postgres/i, /mysql/i, /mongo/i, /prisma/i, /supabase/i, /sqlite/i, /redis/i, /^cache$/i],
    category: 'db',
    criticalByDefault: true,
  },
  {
    patterns: [/^auth/i, /authentication/i, /^session/i, /^jwt/i, /^token/i, /^login/i, /clerk/i, /nextauth/i],
    category: 'auth',
    criticalByDefault: false,
  },
  {
    patterns: [/^queue/i, /^jobs?$/i, /bullmq/i, /worker/i, /^task/i],
    category: 'api',
    criticalByDefault: false,
  },
  {
    patterns: [/external/i, /third.?party/i, /gemini/i, /openai/i, /stripe/i, /sendgrid/i, /twilio/i, /webhook/i, /smtp/i, /email/i],
    category: 'api',
    criticalByDefault: false,
  },
  {
    patterns: [/network/i, /dns/i, /connectivity/i, /ping/i],
    category: 'network',
    criticalByDefault: false,
  },
];

function classifyCheck(name: string): { category: BugCategory; criticalByDefault: boolean } {
  const lower = name.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(lower))) {
      return { category: rule.category, criticalByDefault: rule.criticalByDefault };
    }
  }
  return { category: 'unknown', criticalByDefault: false };
}

function failureSeverity(
  name: string,
  category: BugCategory,
  criticalByDefault: boolean,
  isWarning: boolean
): Severity {
  if (isWarning) return 'medium';
  if (criticalByDefault || category === 'db') return 'critical';
  if (category === 'auth') return 'high';
  return 'medium';
}

// ─── Latency extraction ────────────────────────────────────────────────────────

function extractLatency(raw: RawCheckResult): number | undefined {
  return raw.latency_ms ?? raw.latency ?? raw.duration ?? raw.responseTime;
}

// ─── Parse a single check value ───────────────────────────────────────────────

function parseCheckEntry(name: string, raw: unknown): ParsedCheck {
  const { category, criticalByDefault } = classifyCheck(name);

  // Simple scalar value (just a boolean or status string)
  if (typeof raw !== 'object' || raw === null) {
    const status = normalizeCheckStatus(raw);
    const isError   = status === 'error';
    const isWarning = status === 'warning';
    return {
      name,
      status: isError ? 'error' : isWarning ? 'warning' : status === 'ok' ? 'ok' : 'skipped',
      category,
      severity: failureSeverity(name, category, criticalByDefault, isWarning),
    };
  }

  const r = raw as RawCheckResult;

  // Extract status from the check object
  const rawStatus = r.status ?? r.state ?? r.health;
  let status = normalizeCheckStatus(rawStatus ?? (r.error ? 'error' : undefined));

  const latencyMs = extractLatency(r);
  const detail    = r.detail ?? r.message ?? r.error ?? r.description;

  // High latency penalty: even if status is ok, flag as warning
  if (status === 'ok' && latencyMs !== undefined) {
    if (latencyMs > 5000) status = 'error';
    else if (latencyMs > 2000) status = 'warning';
  }

  const isError   = status === 'error';
  const isWarning = status === 'warning';

  return {
    name,
    status: isError ? 'error' : isWarning ? 'warning' : status === 'ok' ? 'ok' : 'skipped',
    latencyMs,
    detail: detail ? String(detail).slice(0, 300) : undefined,
    category,
    severity: failureSeverity(name, category, criticalByDefault, isWarning),
  };
}

// ─── Memory metric extraction ──────────────────────────────────────────────────

function extractMemoryPercent(data: RawHealthResponse): {
  percent?: number;
  usedMb?: number;
} {
  // Our standard format: metrics.memory_percent / memory_used_mb
  const m = data.metrics;
  if (m) {
    const pct =
      m.memory_percent ??
      (m.memory_used_mb && m.memory_total_mb
        ? Math.round((m.memory_used_mb / m.memory_total_mb) * 100)
        : undefined) ??
      (m.heap_used && m.heap_total
        ? Math.round(((m.heap_used as number) / (m.heap_total as number)) * 100)
        : undefined);
    return { percent: pct, usedMb: m.memory_used_mb };
  }

  // Alternative shape: memory.used / memory.total
  if (data.memory) {
    const used  = data.memory.used;
    const total = data.memory.total;
    const pct   = data.memory.percent ?? (used && total ? Math.round((used / total) * 100) : undefined);
    return { percent: pct };
  }

  return {};
}

// ─── Is this response a health endpoint? ──────────────────────────────────────

function isHealthEndpointShape(data: unknown): data is RawHealthResponse {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  // Must have at least one of these status indicators
  const hasStatus = ['status', 'health', 'state'].some(
    (k) => typeof d[k] === 'string' && (d[k] as string).length > 0
  );
  if (!hasStatus) return false;
  // Must look like an app health response (not just any API JSON)
  // Either has known health fields or a checks/services/dependencies object
  const hasHealthFields =
    'version' in d ||
    'uptime' in d ||
    'uptime_seconds' in d ||
    'uptimeSeconds' in d ||
    'checks' in d ||
    'services' in d ||
    'dependencies' in d ||
    'components' in d ||
    'metrics' in d;
  return hasHealthFields;
}

// ─── Main parse function ───────────────────────────────────────────────────────

export function parseHealthEndpoint(
  responseText: string,
  responseTimeMs: number
): HealthEndpointSnapshot {
  const NOT_HEALTH: HealthEndpointSnapshot = {
    isHealthEndpoint: false,
    overallStatus: 'unknown',
    checksTotal: 0,
    checksPassed: 0,
    checksFailed: 0,
    checksWarning: 0,
    checks: [],
    rawSnapshot: null,
  };

  let data: unknown;
  try {
    data = JSON.parse(responseText);
  } catch {
    return NOT_HEALTH;
  }

  if (!isHealthEndpointShape(data)) return NOT_HEALTH;

  const raw = data as RawHealthResponse;

  // Overall status
  const rawStatus   = raw.status ?? raw.health ?? raw.state ?? '';
  const overallStatus = normalizeOverallStatus(rawStatus);

  // Metadata
  const service       = raw.service ?? raw.name ?? raw.appName;
  const version       = raw.version;
  const environment   = raw.environment ?? raw.env;
  const uptimeSeconds = raw.uptime_seconds ?? raw.uptimeSeconds ?? raw.uptime;
  const responseTime  = raw.response_time_ms ?? raw.responseTime ?? responseTimeMs;

  // Memory
  const { percent: memPercent, usedMb: memUsedMb } = extractMemoryPercent(raw);

  // Checks — try every namespace
  const checksSource: Record<string, unknown> =
    raw.checks ??
    raw.services ??
    raw.dependencies ??
    raw.components ??
    raw.details ??
    {};

  const checks: ParsedCheck[] = [];

  for (const [key, value] of Object.entries(checksSource)) {
    if (
      (key === 'external_apis' || key === 'externalApis' || key === 'external') &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Nested map: { external_apis: { gemini: {...}, stripe: {...} } }
      for (const [apiName, apiResult] of Object.entries(value as Record<string, unknown>)) {
        checks.push(parseCheckEntry(`${key}:${apiName}`, apiResult));
      }
    } else {
      checks.push(parseCheckEntry(key, value));
    }
  }

  // Synthetic memory check if usage is high
  if (memPercent !== undefined && memPercent > 85) {
    checks.push({
      name: 'system:memory',
      status: memPercent > 95 ? 'error' : 'warning',
      detail: `Memory at ${memPercent}%${memUsedMb ? ` (${memUsedMb}MB used)` : ''}`,
      category: 'unknown',
      severity: memPercent > 95 ? 'high' : 'medium',
    });
  }

  const checksPassed  = checks.filter((c) => c.status === 'ok').length;
  const checksFailed  = checks.filter((c) => c.status === 'error').length;
  const checksWarning = checks.filter((c) => c.status === 'warning').length;

  return {
    isHealthEndpoint: true,
    overallStatus,
    service,
    version,
    environment,
    uptimeSeconds,
    responseTimeMs: responseTime,
    memoryPercent: memPercent,
    memoryUsedMb: memUsedMb,
    nodeVersion: raw.metrics?.node_version,
    checksTotal: checks.length,
    checksPassed,
    checksFailed,
    checksWarning,
    checks,
    rawSnapshot: data,
  };
}

// ─── Convert snapshot → PersistableErrors ────────────────────────────────────

export type SnapshotError = {
  project_id: string;
  feature_id: null;
  error_message: string;
  page_url: string;
  functionality: string;
  severity: Severity;
  category: BugCategory;
  screenshot_url: null;
};

export function snapshotToErrors(
  snapshot: HealthEndpointSnapshot,
  projectId: string,
  endpointUrl: string
): SnapshotError[] {
  if (!snapshot.isHealthEndpoint) return [];

  const errors: SnapshotError[] = [];

  // No individual checks? Use the overall status as a single error.
  if (snapshot.checks.length === 0 && snapshot.overallStatus === 'critical') {
    errors.push({
      project_id: projectId,
      feature_id: null,
      error_message: `Health endpoint status: ${snapshot.overallStatus}${snapshot.service ? ` (${snapshot.service})` : ''}`,
      page_url: endpointUrl,
      functionality: 'health_check',
      severity: 'critical',
      category: 'unknown',
      screenshot_url: null,
    });
    return errors;
  }

  // Per-failing-check errors
  for (const check of snapshot.checks) {
    if (check.status === 'ok' || check.status === 'skipped') continue;

    const friendlyName = check.name.replace(/^external:/, 'external API: ');
    const baseMsg      = check.status === 'error' ? `failed` : `degraded`;
    const detail       = check.detail ? `: ${check.detail}` : '';

    errors.push({
      project_id: projectId,
      feature_id: null,
      error_message: `[health] ${friendlyName} ${baseMsg}${detail}`,
      page_url: endpointUrl,
      functionality: check.name,
      severity: check.severity,
      category: check.category,
      screenshot_url: null,
    });
  }

  return errors;
}

// ─── Score from snapshot ──────────────────────────────────────────────────────

/**
 * Compute a health score 0–100 directly from a health endpoint snapshot.
 * Uses the same SEVERITY_WEIGHTS as the rest of the platform.
 */
export function scoreFromSnapshot(snapshot: HealthEndpointSnapshot): number {
  if (!snapshot.isHealthEndpoint) return 100;

  const WEIGHTS: Record<Severity, number> = { low: 1, medium: 3, high: 8, critical: 15 };

  const penalty = snapshot.checks
    .filter((c) => c.status !== 'ok' && c.status !== 'skipped')
    .reduce((sum, c) => sum + WEIGHTS[c.severity], 0);

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}
