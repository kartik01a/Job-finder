export type LogFields = {
  level?: "info" | "warn" | "error";
  source?: string;
  stage: string;
  runId?: number;
  jobId?: number;
  message: string;
  error?: string;
};

const SECRET_PATTERNS = [/sk-[a-z0-9]/i, /api[_-]?key/i, /password/i, /cookie/i];

export function log(fields: LogFields): void {
  const error = fields.error ? redact(fields.error) : undefined;
  const line = {
    timestamp: new Date().toISOString(),
    level: fields.level ?? "info",
    source: fields.source,
    stage: fields.stage,
    runId: fields.runId,
    jobId: fields.jobId,
    message: redact(fields.message),
    error,
  };
  console.log(JSON.stringify(line));
}

function redact(value: string): string {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(value)) && value.length > 80) {
    return "[redacted]";
  }
  return value.replace(/sk-[a-zA-Z0-9_-]{8,}/g, "[redacted]");
}
