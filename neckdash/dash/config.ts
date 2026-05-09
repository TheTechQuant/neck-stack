export function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

export function victoriaTracesOTLPURL() {
  return env("VICTORIA_TRACES_OTLP_URL", "http://victoria-traces:10428/insert/opentelemetry/v1/traces");
}

export function victoriaTracesQueryURL() {
  return env("VICTORIA_TRACES_QUERY_URL", "http://victoria-traces:10428/select/jaeger").replace(/\/+$/g, "");
}

export function victoriaMetricsQueryURL() {
  return env("VICTORIA_METRICS_QUERY_URL", "http://victoria-metrics:8428/api/v1/query");
}

export function victoriaMetricsRangeQueryURL() {
  const value = env("VICTORIA_METRICS_RANGE_QUERY_URL", "");
  if (value) return value;
  return victoriaMetricsQueryURL().replace(/\/query\/?$/g, "/query_range");
}

export function victoriaLogsInsertURL() {
  return env("VICTORIA_LOGS_INSERT_URL", "http://victoria-logs:9428/insert/jsonline?_stream_fields=app_id,env_id,service,level&_time_field=timestamp&_msg_field=message");
}

export function victoriaLogsQueryURL() {
  return env("VICTORIA_LOGS_QUERY_URL", "http://victoria-logs:9428/select/logsql/query");
}

export function victoriaLogsTailURL() {
  const value = env("VICTORIA_LOGS_TAIL_URL", "");
  if (value) return value;
  return victoriaLogsQueryURL().replace(/\/query\/?$/g, "/tail");
}

export async function getJSON<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed with HTTP ${response.status}`);
  }
  return await response.json() as T;
}

export function valueOr(value: string | undefined | null, fallback: string) {
  return value && value.length > 0 ? value : fallback;
}

export function stringValue(value: unknown, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const text = String(value);
  return text.length > 0 ? text : fallback;
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function safeJSONParse<T>(value: string | Buffer | undefined): T | undefined {
  if (!value || value.length === 0) return undefined;
  try {
    return JSON.parse(value.toString()) as T;
  } catch {
    return undefined;
  }
}

export function sortBy<T>(values: T[], key: (value: T) => string | number) {
  return values.sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}
