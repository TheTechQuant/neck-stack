import { api } from "encore.dev/api";
import { buildCatalog } from "./catalog";
import { discoverApps, selectedCatalog } from "./apps";
import { readConfig, updateConfig } from "./configApi";
import { buildFlow } from "./flow";
import { serveLiveEvents } from "./live";
import { listLogEntries, tailLogs } from "./logs";
import {
  insightRateSeries,
  insightServices,
  latestCustomMetricSamples,
  mergeMetricFilter,
  metricAppFilter,
  metricDefinitions,
  metricsSummary,
  queryScalar,
  resolveInsightsWindow,
  runtimeMetrics,
} from "./metrics";
import { getJSON, numberValue, sortBy, stringValue, valueOr, victoriaTracesQueryURL } from "./config";
import { handleTrace } from "./trace";
import type {
  AppParams,
  AppsResponse,
  CatalogResponse,
  ConfigResponse,
  ConfigUpdateParams,
  ConfigUpdateResponse,
  CustomMetricsResponse,
  FlowResponse,
  HealthResponse,
  InsightsParams,
  InsightsResponse,
  LiveEvent,
  LogListParams,
  LogListResponse,
  MetricsParams,
  MetricsResponse,
  SamplingResponse,
  TraceDetailParams,
  TraceDetailResponse,
  TraceListParams,
  TraceListResponse,
  TraceServicesResponse,
  TraceSummary,
} from "./types";

// Health reports whether NECK Dash is serving requests.
export const health = api(
  { expose: true, method: "GET", path: "/health" },
  async (): Promise<HealthResponse> => ({ ok: true }),
);

// ListApps returns Encore apps discovered by the shared per-server dashboard.
export const listApps = api(
  { expose: true, method: "GET", path: "/apps" },
  async (): Promise<AppsResponse> => {
    const apps = discoverApps();
    return { apps, defaultApp: apps[0]?.id || "" };
  },
);

// ListTraces returns recent traces from VictoriaTraces through its Jaeger API.
export const listTraces = api(
  { expose: true, method: "GET", path: "/traces" },
  async (params: TraceListParams): Promise<TraceListResponse> => {
    const appID = String(params.app || "").trim();
    const limit = boundedInt(params.limit, 100, 500);
    const hours = boundedInt(params.hours, 1, 168);
    const search = String(params.search || "");
    if (looksLikeTraceID(search)) {
      const trace = await getJaegerTrace(search).catch(() => undefined);
      if (trace?.traceID && (!appID || jaegerTraceAppID(trace) === appID)) {
        return { traces: [summarizeJaegerTrace(trace)] };
      }
    }

    let services = [String(params.service || "")];
    if (!services[0]) {
      services = await listServices().catch(() => []);
      if (appID) services = filterServicesByAppCatalog(services, appID);
      services = services.slice(0, traceServiceFanoutLimit());
    }

    const end = new Date();
    const start = new Date(end.getTime() - hours * 60 * 60_000);
    const seen = new Set<string>();
    const traces: TraceSummary[] = [];
    for (const service of services) {
      if (!service) continue;
      for (const trace of await queryJaegerTraces(service, limit, start, end, appID)) {
        if (search && !`${trace.traceId}${trace.service}${trace.endpoint}`.includes(search)) continue;
        if (seen.has(trace.traceId)) continue;
        seen.add(trace.traceId);
        traces.push(trace);
      }
    }
    traces.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return { traces: traces.slice(0, limit) };
  },
);

// ListTraceServices returns service names indexed by VictoriaTraces.
export const listTraceServices = api(
  { expose: true, method: "GET", path: "/traces/services" },
  async (params: AppParams): Promise<TraceServicesResponse> => {
    let services = await listServices();
    if (String(params.app || "").trim()) services = filterServicesByAppCatalog(services, String(params.app));
    return { services };
  },
);

// GetTrace returns a raw Jaeger trace payload from VictoriaTraces.
export const getTrace = api(
  { expose: true, method: "GET", path: "/traces/detail/:traceID" },
  async ({ traceID }: TraceDetailParams): Promise<TraceDetailResponse> => {
    const raw = await getJSON<unknown>(`${victoriaTracesQueryURL()}/api/traces/${encodeURIComponent(traceID)}`);
    return { traceId: traceID, rawJson: JSON.stringify(raw) };
  },
);

// Insights returns an Encore Cloud-style operational overview.
export const insights = api(
  { expose: true, method: "GET", path: "/insights" },
  async (params: InsightsParams): Promise<InsightsResponse> => {
    const window = resolveInsightsWindow(String(params.range || ""));
    const filter = metricAppFilter(String(params.app || ""));
    const requests = await queryScalar(`sum(increase(e_requests_total${filter}[${window.promDuration}]))`).catch(() => 0);
    const errors = await queryScalar(`sum(increase(e_requests_total${mergeMetricFilter(filter, `code!="ok"`)}[${window.promDuration}]))`).catch(() => 0);
    return {
      range: window.id,
      windowSeconds: Math.floor(window.durationMs / 1000),
      requests,
      errors,
      errorRate: requests > 0 ? errors / requests : 0,
      requestRate: await insightRateSeries(window, filter).catch(() => []),
      services: await insightServices(window, filter).catch(() => []),
    };
  },
);

// MetricsSummary returns Encore runtime RED metrics from Prometheus remote write.
export const metricsSummaryEndpoint = api(
  { expose: true, method: "GET", path: "/metrics/summary" },
  async (params: MetricsParams): Promise<MetricsResponse> => {
    const hours = boundedInt(params.hours, 24, 720);
    const filter = metricAppFilter(String(params.app || ""));
    return {
      windowHours: hours,
      services: await metricsSummary(hours, filter).catch(() => []),
      runtime: await runtimeMetrics(filter).catch(() => []),
    };
  },
);

// CustomMetrics returns app-defined Encore metrics exported through Prometheus remote write.
export const customMetrics = api(
  { expose: true, method: "GET", path: "/metrics/custom" },
  async (params: MetricsParams): Promise<CustomMetricsResponse> => {
    const hours = boundedInt(params.hours, 24, 720);
    const definitions = metricDefinitions(String(params.app || ""));
    const filter = metricAppFilter(String(params.app || ""));
    return { windowHours: hours, definitions, samples: await latestCustomMetricSamples(definitions, filter, hours) };
  },
);

// Catalog returns generated Encore metadata and OpenAPI JSON mounted by the deployed app.
export const catalog = api(
  { expose: true, method: "GET", path: "/catalog" },
  async (params: AppParams): Promise<CatalogResponse> => {
    const catalog = selectedCatalog(String(params.app || ""));
    return {
      appId: catalog.app.id,
      metaJson: catalog.metaBytes.toString(),
      openapiJson: catalog.openAPIBytes.toString(),
      services: buildCatalog(catalog.metaBytes, catalog.openAPIBytes),
    };
  },
);

// Flow returns an Encore Flow-style dependency graph from generated metadata plus observed servicegraph counts.
export const flow = api(
  { expose: true, method: "GET", path: "/flow" },
  async (params: AppParams): Promise<FlowResponse> => buildFlow(selectedCatalog(String(params.app || "")).metaBytes),
);

// GetSampling documents how sampling is applied for self-hosted deployments.
export const getSampling = api(
  { expose: true, method: "GET", path: "/settings/sampling" },
  async (): Promise<SamplingResponse> => {
    const parsed = Number(process.env.NECK_TRACE_SAMPLE_RATE || "1");
    const rate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
    return {
      rules: [{ scopeType: "default", scopeValue: "", rate }],
      runtimeNote: "Sampling is enforced by the Encore runtime trace exporter. Change NECK_TRACE_SAMPLE_RATE, regenerate deployment config, rebuild the backend image, and redeploy.",
    };
  },
);

// Config returns the editable production configuration surface for one NECK app.
export const config = api(
  { expose: true, method: "GET", path: "/settings/config" },
  async (params: AppParams): Promise<ConfigResponse> => readConfig(String(params.app || "")),
);

// UpdateConfig updates one backend secret or frontend runtime variable through Komodo.
export const updateConfigEndpoint = api(
  { expose: true, sensitive: true, method: "POST", path: "/settings/config" },
  async (params: ConfigUpdateParams): Promise<ConfigUpdateResponse> => updateConfig(params),
);

// Events streams dashboard ticks so the UI can refresh active data through the generated client.
export const events = api.streamOut<LiveEvent>(
  { expose: true, path: "/events" },
  serveLiveEvents,
);

// TailLogs proxies VictoriaLogs live tailing for CLI and UI clients.
export const tailLogsRaw = api.raw(
  { expose: true, method: "GET", path: "/logs/tail" },
  tailLogs,
);

// Trace receives Encore runtime trace streams and forwards them to VictoriaTraces and VictoriaLogs.
export const trace = api.raw(
  { expose: true, method: "POST", path: "/trace" },
  handleTrace,
);

// TraceFromSingleDomain receives Encore trace streams through the single-domain Caddy route.
export const traceFromSingleDomain = api.raw(
  { expose: true, method: "POST", path: "/__neck_dash/api/trace" },
  handleTrace,
);

// ListLogs returns searchable Encore structured logs stored in VictoriaLogs.
export const listLogs = api(
  { expose: true, method: "GET", path: "/logs" },
  async (params: LogListParams): Promise<LogListResponse> => listLogEntries(params),
);

type JaegerTrace = {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, { serviceName?: string }>;
};

type JaegerSpan = {
  processID: string;
  operationName: string;
  startTime: number;
  duration: number;
  tags?: Array<{ key: string; value: unknown }>;
  references?: unknown[];
};

async function listServices() {
  const raw = await getJSON<{ data?: string[] }>(`${victoriaTracesQueryURL()}/api/services`);
  return sortBy(raw.data ?? [], (value) => value);
}

async function getJaegerTrace(traceID: string) {
  const raw = await getJSON<{ data?: JaegerTrace[] }>(`${victoriaTracesQueryURL()}/api/traces/${encodeURIComponent(traceID)}`);
  return raw.data?.[0];
}

async function queryJaegerTraces(service: string, limit: number, start: Date, end: Date, appID: string) {
  const values = new URLSearchParams({
    service,
    limit: String(limit),
    start: String(start.getTime() * 1000),
    end: String(end.getTime() * 1000),
  });
  if (appID.trim()) values.set("tags", JSON.stringify({ "encore.app_id": appID.trim() }));
  const raw = await getJSON<{ data?: JaegerTrace[] }>(`${victoriaTracesQueryURL()}/api/traces?${values.toString()}`);
  return (raw.data ?? []).map(summarizeJaegerTrace);
}

function summarizeJaegerTrace(trace: JaegerTrace): TraceSummary {
  let root = trace.spans[0];
  for (const span of trace.spans ?? []) {
    if (!span.references || span.references.length === 0) {
      root = span;
      break;
    }
  }
  const summary: TraceSummary = {
    traceId: trace.traceID,
    service: stringValue(trace.processes?.[root?.processID]?.serviceName),
    endpoint: stringValue(root?.operationName),
    startedAt: root ? new Date(root.startTime / 1000).toISOString() : "",
    durationMs: root ? root.duration / 1000 : 0,
    spanCount: trace.spans?.length || 0,
    error: false,
    statusCode: 0,
    environment: "",
  };
  for (const tag of root?.tags ?? []) {
    if (tag.key === "encore.env_id") summary.environment = stringValue(tag.value);
    if (tag.key === "http.status_code" || tag.key === "http.response.status_code") summary.statusCode = Math.floor(numberValue(tag.value) || 0);
    if (tag.key === "error" && String(tag.value) === "true") summary.error = true;
  }
  return summary;
}

function jaegerTraceAppID(trace: JaegerTrace) {
  for (const span of trace.spans ?? []) {
    for (const tag of span.tags ?? []) {
      if (tag.key === "encore.app_id") return stringValue(tag.value);
    }
  }
  return "";
}

function filterServicesByAppCatalog(services: string[], appID: string) {
  const catalog = selectedCatalog(appID);
  const serviceSet = new Set(buildCatalog(catalog.metaBytes, catalog.openAPIBytes).map((service) => service.name));
  return serviceSet.size === 0 ? services : services.filter((service) => serviceSet.has(service));
}

function looksLikeTraceID(value: string) {
  return /^(?:[0-9a-fA-F]{16}|[0-9a-fA-F]{32})$/.test(value.trim());
}

function traceServiceFanoutLimit() {
  const limit = Number(process.env.NECKDASH_TRACE_SERVICE_FANOUT_LIMIT || "32");
  return Math.min(Math.max(Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 32, 1), 256);
}

function boundedInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? Math.floor(parsed) : fallback;
}
