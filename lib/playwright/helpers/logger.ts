export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  entries(): LogEntry[];
  summary(): string;
}

export function createLogger(prefix: string): Logger {
  const entries: LogEntry[] = [];

  const push = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const entry: LogEntry = { level, message, context, timestamp: Date.now() };
    entries.push(entry);
    const tag = level.toUpperCase().padEnd(5);
    const ctxStr = context ? ' ' + JSON.stringify(context) : '';
    // eslint-disable-next-line no-console
    console.log(`[${tag}] [${prefix}] ${message}${ctxStr}`);
  };

  return {
    info: (m, c) => push('info', m, c),
    warn: (m, c) => push('warn', m, c),
    error: (m, c) => push('error', m, c),
    entries: () => entries,
    summary: () => entries.map((e) => `${e.level.toUpperCase()}: ${e.message}`).join(' | '),
  };
}
