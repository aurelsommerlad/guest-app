/**
 * Minimal structured logger.
 *
 * Writes one JSON object per line, which Vercel and any later log/monitoring
 * backend can ingest. Keys that typically carry secrets or personal data are
 * redacted. Swap the sink later (e.g. for Sentry/Axiom) without touching callers.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Record<string, unknown>;
export type LogSink = (level: LogLevel, line: string) => void;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that adds the given fields (e.g. requestId, tenantId) to every entry. */
  child(bindings: LogContext): Logger;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|email|phone|last[-_]?name|surname|booking[-_]?(reference|number)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(nested, depth + 1),
    ]),
  );
}

const consoleSink: LogSink = (level, line) => {
  // The logger is the single place allowed to write to the console.
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
};

export function createLogger(
  options: { level?: LogLevel; bindings?: LogContext; sink?: LogSink; now?: () => Date } = {},
): Logger {
  const { level = "info", bindings = {}, sink = consoleSink, now = () => new Date() } = options;
  const minIndex = LOG_LEVELS.indexOf(level);

  const write = (entryLevel: LogLevel, message: string, context?: LogContext) => {
    if (LOG_LEVELS.indexOf(entryLevel) < minIndex) {
      return;
    }
    const entry = redact({ ...bindings, ...context }) as LogContext;
    sink(
      entryLevel,
      JSON.stringify({ ...entry, level: entryLevel, msg: message, time: now().toISOString() }),
    );
  };

  return {
    debug: (message, context) => {
      write("debug", message, context);
    },
    info: (message, context) => {
      write("info", message, context);
    },
    warn: (message, context) => {
      write("warn", message, context);
    },
    error: (message, context) => {
      write("error", message, context);
    },
    child: (childBindings) =>
      createLogger({ level, sink, now, bindings: { ...bindings, ...childBindings } }),
  };
}
