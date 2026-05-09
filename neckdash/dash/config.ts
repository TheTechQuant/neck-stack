export function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

export function signozOTLPTracesURL() {
  return env("SIGNOZ_OTLP_TRACES_URL", "http://signoz-otel-collector:4318/v1/traces");
}

export function signozOTLPLogsURL() {
  return env("SIGNOZ_OTLP_LOGS_URL", "http://signoz-otel-collector:4318/v1/logs");
}

export function signozOTLPMetricsURL() {
  return env("SIGNOZ_OTLP_METRICS_URL", "http://signoz-otel-collector:4318/v1/metrics");
}

export function valueOr(value: string | undefined | null, fallback: string) {
  return value && value.length > 0 ? value : fallback;
}

export function stringValue(value: unknown, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const text = String(value);
  return text.length > 0 ? text : fallback;
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
