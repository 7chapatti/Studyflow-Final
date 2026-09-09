// Minimal structured logging.
//
// Every call site in this app currently does `console.error("some string:",
// err)` with no consistent shape, which makes it hard to search/alert on in
// whatever log drain ends up in front of this (Vercel's own log explorer,
// or a real APM later) -- you can't filter on "route" or "level" if it was
// never a field. This doesn't add a monitoring *service* (no new
// dependency, no third-party account needed) -- it just makes what's
// already going to stdout/stderr machine-parseable JSON, one line per
// event, so a log drain can filter and alert on it later without changing
// every call site again.
type LogContext = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", message: string, context?: LogContext) {
  const line = {
    level,
    message,
    time: new Date().toISOString(),
    ...context,
  };

  const output = JSON.stringify(line);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
