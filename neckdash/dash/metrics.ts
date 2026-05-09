import { getJSON, numberValue, sortBy, stringValue, valueOr, victoriaMetricsQueryURL, victoriaMetricsRangeQueryURL } from "./config";
import { selectedCatalog } from "./apps";
import type { InsightsPoint, InsightsSeries, InsightsService, MetricDefinition, MetricSample, ServiceMetric } from "./types";

type MetricVector = {
  labels: Record<string, string>;
  value: number;
  timestamp: Date;
};

type MetricRange = {
  labels: Record<string, string>;
  points: Array<{ timestamp: Date; value: number }>;
};

type InsightsWindow = {
  id: string;
  promDuration: string;
  durationMs: number;
  stepSeconds: number;
  rateWindow: string;
};

export function resolveInsightsWindow(value = ""): InsightsWindow {
  switch (value.trim().toLowerCase()) {
    case "10m":
      return { id: "10m", promDuration: "10m", durationMs: 10 * 60_000, stepSeconds: 15, rateWindow: "1m" };
    case "1h":
      return { id: "1h", promDuration: "1h", durationMs: 60 * 60_000, stepSeconds: 60, rateWindow: "2m" };
    case "8h":
      return { id: "8h", promDuration: "8h", durationMs: 8 * 60 * 60_000, stepSeconds: 5 * 60, rateWindow: "10m" };
    case "3d":
      return { id: "3d", promDuration: "3d", durationMs: 72 * 60 * 60_000, stepSeconds: 60 * 60, rateWindow: "2h" };
    case "7d":
      return { id: "7d", promDuration: "7d", durationMs: 7 * 24 * 60 * 60_000, stepSeconds: 2 * 60 * 60, rateWindow: "4h" };
    default:
      return { id: "24h", promDuration: "24h", durationMs: 24 * 60 * 60_000, stepSeconds: 15 * 60, rateWindow: "30m" };
  }
}

export async function queryScalar(query: string) {
  const results = await queryVector(query);
  return results.reduce((sum, result) => sum + result.value, 0);
}

export async function insightServices(window: InsightsWindow, filter: string): Promise<InsightsService[]> {
  const requests = await queryByLabel(`sum by (service) (increase(e_requests_total${filter}[${window.promDuration}]))`, "service");
  const errors = await queryByLabel(`sum by (service) (increase(e_requests_total${mergeMetricFilter(filter, `code!="ok"`)}[${window.promDuration}]))`, "service");
  const rates = await queryByLabel(`sum by (service) (rate(e_requests_total${filter}[${window.rateWindow}]))`, "service");
  const keys = new Set([...Object.keys(requests), ...Object.keys(errors)]);
  const services = [...keys].map((service) => {
    const reqs = requests[service] || 0;
    const errs = errors[service] || 0;
    return {
      service: valueOr(service, "unknown"),
      requests: reqs,
      errors: errs,
      errorRate: reqs > 0 ? errs / reqs : 0,
      rate: rates[service] || 0,
    };
  });
  return services.sort((a, b) => b.requests - a.requests);
}

export async function insightRateSeries(window: InsightsWindow, filter: string): Promise<InsightsSeries[]> {
  const end = new Date();
  const start = new Date(end.getTime() - window.durationMs);
  const results = await queryRange(`sum by (service) (rate(e_requests_total${filter}[${window.rateWindow}]))`, start, end, window.stepSeconds);
  return sortBy(results.map((result) => ({
    service: valueOr(result.labels.service, "unknown"),
    points: result.points.map<InsightsPoint>((point) => ({
      timestamp: point.timestamp.toISOString(),
      value: point.value,
    })),
  })), (series) => series.service);
}

export async function metricsSummary(hours: number, filter: string) {
  const counts = await queryMetric(`sum by (service,endpoint) (increase(e_requests_total${filter}[${hours}h]))`);
  const errorsByEndpoint = await queryMetric(`sum by (service,endpoint) (increase(e_requests_total${mergeMetricFilter(filter, `code!="ok"`)}[${hours}h]))`);
  const merged = new Map<string, ServiceMetric>();
  for (const [key, value] of Object.entries(counts)) {
    const [service, endpoint] = splitMetricKey(key);
    merged.set(key, { service, endpoint, traceCount: value, errorCount: 0 });
  }
  for (const [key, value] of Object.entries(errorsByEndpoint)) {
    const [service, endpoint] = splitMetricKey(key);
    const metric = merged.get(key) ?? { service, endpoint, traceCount: 0, errorCount: 0 };
    metric.errorCount = value;
    merged.set(key, metric);
  }
  return [...merged.values()].sort((a, b) => b.traceCount - a.traceCount);
}

export async function runtimeMetrics(filter: string): Promise<MetricSample[]> {
  const names = [
    { name: "e_requests_total", kind: "counter" },
    { name: "e_sys_memory_used_bytes", kind: "gauge" },
  ];
  const out: MetricSample[] = [];
  for (const item of names) {
    let results: MetricVector[];
    try {
      results = await queryVector(`last_over_time(${item.name}${filter}[1h])`);
    } catch {
      continue;
    }
    for (const result of results) {
      out.push({
        name: item.name,
        kind: item.kind,
        serviceName: valueOr(result.labels.service, result.labels.service_id || ""),
        labels: publicMetricLabels(result.labels),
        value: result.value,
        windowValue: result.value,
        timestamp: result.timestamp.toISOString(),
      });
    }
  }
  return out;
}

export function metricDefinitions(appID = ""): MetricDefinition[] {
  const catalog = selectedCatalog(appID);
  if (catalog.metaBytes.length === 0) return [];
  let raw: any;
  try {
    raw = JSON.parse(catalog.metaBytes.toString());
  } catch {
    return [];
  }
  const definitions = (raw.metrics ?? []).map((item: any) => ({
    name: stringValue(item.name),
    kind: metricKind(item.kind),
    doc: stringValue(item.doc),
    serviceName: stringValue(item.service_name),
    labels: (item.labels ?? []).map((label: any) => ({ key: stringValue(label.key), doc: stringValue(label.doc) })),
  })).filter((item: MetricDefinition) => item.name);
  return sortBy(definitions, (item: MetricDefinition) => item.name);
}

export async function latestCustomMetricSamples(definitions: MetricDefinition[], filter: string, hours: number) {
  const samples: MetricSample[] = [];
  for (const def of definitions) {
    if (!validMetricName(def.name)) continue;
    let latest: MetricVector[];
    try {
      latest = await queryVector(`last_over_time(${def.name}${filter}[${hours}h])`);
    } catch {
      continue;
    }
    const windowValues = new Map<string, number>();
    if (def.kind === "counter") {
      try {
        const window = await queryVector(`increase(${def.name}${filter}[${hours}h])`);
        for (const item of window) windowValues.set(labelsKey(item.labels), item.value);
      } catch {
        // Keep latest value when increase is unavailable.
      }
    }
    for (const item of latest) {
      samples.push({
        name: def.name,
        kind: def.kind,
        serviceName: valueOr(item.labels.service_id, def.serviceName),
        labels: publicMetricLabels(item.labels),
        value: item.value,
        windowValue: def.kind === "counter" ? (windowValues.get(labelsKey(item.labels)) || 0) : item.value,
        timestamp: item.timestamp.toISOString(),
      });
    }
  }
  return sortBy(samples, (sample) => `${sample.name}\x00${sample.serviceName}`);
}

async function queryByLabel(query: string, label: string) {
  const results = await queryVector(query);
  const out: Record<string, number> = {};
  for (const result of results) {
    let key = result.labels[label] || "";
    if (!key && label === "service") key = result.labels.service_id || "";
    out[key] = (out[key] || 0) + result.value;
  }
  return out;
}

async function queryMetric(query: string) {
  const results = await queryVector(query);
  const out: Record<string, number> = {};
  for (const result of results) out[`${result.labels.service || ""}\x00${result.labels.endpoint || ""}`] = result.value;
  return out;
}

async function queryVector(query: string): Promise<MetricVector[]> {
  const endpoint = `${victoriaMetricsQueryURL()}?query=${encodeURIComponent(query)}`;
  const raw = await getJSON<any>(endpoint);
  return (raw.data?.result ?? []).map((result: any) => {
    const value = Array.isArray(result.value) ? result.value : [];
    const ts = numberValue(value[0]) ?? 0;
    return {
      labels: result.metric ?? {},
      value: Number(value[1] || 0),
      timestamp: new Date(ts * 1000),
    };
  });
}

async function queryRange(query: string, start: Date, end: Date, stepSeconds: number): Promise<MetricRange[]> {
  const values = new URLSearchParams({
    query,
    start: String(Math.floor(start.getTime() / 1000)),
    end: String(Math.floor(end.getTime() / 1000)),
    step: String(stepSeconds),
  });
  const raw = await getJSON<any>(`${victoriaMetricsRangeQueryURL()}?${values.toString()}`);
  return (raw.data?.result ?? []).map((result: any) => ({
    labels: result.metric ?? {},
    points: (result.values ?? []).flatMap((value: any[]) => {
      const ts = numberValue(value[0]);
      const parsed = Number(value[1]);
      return ts !== undefined && Number.isFinite(parsed) ? [{ timestamp: new Date(ts * 1000), value: parsed }] : [];
    }),
  }));
}

function splitMetricKey(key: string): [string, string] {
  const index = key.indexOf("\x00");
  return index === -1 ? [key, ""] : [key.slice(0, index), key.slice(index + 1)];
}

function metricKind(value: unknown) {
  if (typeof value === "number") {
    if (value === 1) return "gauge";
    if (value === 2) return "histogram";
    return "counter";
  }
  switch (String(value).toLowerCase()) {
    case "gauge":
    case "metric_gauge":
    case "1":
      return "gauge";
    case "histogram":
    case "metric_histogram":
    case "2":
      return "histogram";
    case "counter":
    case "metric_counter":
    case "0":
      return "counter";
    default:
      return String(value || "counter").toLowerCase();
  }
}

function validMetricName(value: string) {
  return /^[A-Za-z_:][A-Za-z0-9_:]*$/.test(value);
}

function labelsKey(labels: Record<string, string>) {
  return Object.keys(labels).sort().map((key) => `${key}=${labels[key]}\x00`).join("");
}

function publicMetricLabels(labels: Record<string, string>) {
  return Object.fromEntries(Object.entries(labels).filter(([key]) => key !== "__name__"));
}

export function metricAppFilter(appID = "") {
  const trimmed = appID.trim();
  return trimmed ? `{app_id="${escapeMetricLabel(trimmed)}"}` : "";
}

export function mergeMetricFilter(filter: string, ...exprs: string[]) {
  const parts: string[] = [];
  const trimmed = filter.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner) parts.push(inner);
  }
  parts.push(...exprs.map((expr) => expr.trim()).filter(Boolean));
  return parts.length > 0 ? `{${parts.join(",")}}` : "";
}

function escapeMetricLabel(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}
