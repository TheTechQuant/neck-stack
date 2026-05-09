import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { refreshNuxtData, useAsyncData } from "#app";
import { useDashClient } from "./useDashApi";
import { useDashboardRouteSync } from "./useDashboardRouteSync";
import type { SpanLog, SpanSummary, TraceEvent, TraceSummary } from "~/types/dashboard";

type ServiceMetric = {
  service: string;
  endpoint: string;
  traceCount: number;
  errorCount: number;
};

type InsightsPoint = {
  timestamp: string;
  value: number;
};

type InsightsSeries = {
  service: string;
  points: InsightsPoint[];
};

type InsightsService = {
  service: string;
  requests: number;
  errors: number;
  errorRate: number;
  rate: number;
};

type InsightsResponse = {
  range: string;
  windowSeconds: number;
  requests: number;
  errors: number;
  errorRate: number;
  requestRate: InsightsSeries[];
  services: InsightsService[];
};

type MetricDefinition = {
  name: string;
  kind: string;
  doc: string;
  serviceName: string;
  labels: Array<{ key: string; doc: string }>;
};

type MetricSample = {
  name: string;
  kind: string;
  serviceName: string;
  labels: Record<string, string>;
  value: number;
  windowValue: number;
  timestamp: string;
};

type FlowNode = {
  id: string;
  kind: string;
  name: string;
  doc?: string;
  publicEndpoints?: number;
  authEndpoints?: number;
  privateEndpoints?: number;
  databases?: string[];
  cronJobs?: string[];
};

type FlowEdge = {
  source: string;
  target: string;
  kind: string;
  count: number;
  static?: boolean;
  observed?: boolean;
  staticCount?: number;
  observedCount?: number;
  details?: string[];
};

type CatalogEndpoint = {
  serviceName: string;
  name: string;
  method: string;
  path: string;
  access: string;
  protocol: string;
  doc: string;
  summary: string;
  description: string;
  exposed: boolean;
  authRequired: boolean;
  allowUnauthenticated: boolean;
  streaming: boolean;
  tags: string[];
  requestSchemaJson: string;
  responseSchemaJson: string;
};

type CatalogService = {
  name: string;
  relPath: string;
  doc: string;
  databases: string[];
  metrics: string[];
  buckets: Array<{ name: string; operations: string[] }>;
  endpoints: CatalogEndpoint[];
  publicCount: number;
  privateCount: number;
  streamingCount: number;
};

type CatalogResponse = {
  appId: string;
  metaJson: string;
  openapiJson: string;
  services: CatalogService[];
};

type DashApp = {
  id: string;
  name: string;
  metaPath: string;
  openapiPath: string;
  hasMeta: boolean;
  hasOpenapi: boolean;
};

type ConfigVariable = {
  name: string;
  kind: string;
  value?: string;
  masked: boolean;
  present: boolean;
  required: boolean;
  editable: boolean;
  source: string;
  description: string;
};

type ConfigResponse = {
  appId: string;
  stackName: string;
  komodoConfigured: boolean;
  komodoUrl?: string;
  backendSecrets: ConfigVariable[];
  frontendVariables: ConfigVariable[];
  stackVariables: ConfigVariable[];
  requiredEnv: string[];
  runtimeNote: string;
};

export function useDashboardState() {
  const tabs = ["Insights", "Traces", "Logs", "Metrics", "Flow", "Catalog", "Settings"] as const;
  const insightRanges = ["10m", "1h", "8h", "24h", "3d", "7d"] as const;
  const allAppsID = "__all__";
  const activeTab = ref<(typeof tabs)[number]>("Insights");
  const client = useDashClient();
  type LiveStream = Awaited<ReturnType<typeof client.dash.events>>;
  const selectedAppID = ref(allAppsID);
  const insightRange = ref<(typeof insightRanges)[number]>("24h");
  const traceHours = ref(1);
  const search = ref("");
  const service = ref("");
  const selectedTraceID = ref("");
  const selectedSpanID = ref("");
  const selectedEvent = ref<TraceEvent | null>(null);
  const selectedCatalogServiceName = ref("");
  const selectedCatalogEndpointKey = ref("");
  const liveMode = ref(true);
  const liveStatus = ref<"connecting" | "live" | "paused" | "reconnecting">("connecting");
  const configSecretName = ref("");
  const configSecretValue = ref("");
  const frontendVarName = ref("NUXT_PUBLIC_");
  const frontendVarValue = ref("");
  const configRedeploy = ref(true);
  const configSaving = ref(false);
  const configMessage = ref("");
  const configError = ref("");
  const routeSync = useDashboardRouteSync({
    activeTab,
    allAppsID,
    insightRange,
    insightRanges,
    search,
    selectedAppID,
    selectedEvent,
    selectedSpanID,
    selectedTraceID,
    service,
    tabs,
    traceHours,
  });
  const liveDataOptions = (watchSources: any[] = []) => ({
    watch: watchSources,
    dedupe: "cancel" as const,
    getCachedData: () => undefined,
  });
  const { data: appsData, refresh: refreshApps } = useAsyncData(
    "neckdash-apps",
    () => client.dash.listApps(),
    liveDataOptions(),
  );

  const apps = computed(() => appsData.value?.apps ?? []);
  const selectedApp = computed(() => selectedAppID.value === allAppsID ? null : apps.value.find((app) => app.id === selectedAppID.value));
  const detailApp = computed(() => selectedApp.value ?? apps.value[0]);
  const appQuery = computed(() => selectedApp.value?.id || "");
  const detailAppQuery = computed(() => detailApp.value?.id || "");
  const selectedAppLabel = computed(() => selectedApp.value?.name || selectedApp.value?.id || "All apps");

  watchEffect(() => {
    if (!selectedAppID.value) {
      selectedAppID.value = allAppsID;
      return;
    }
    if (selectedAppID.value !== allAppsID && apps.value.length > 0 && !apps.value.some((app) => app.id === selectedAppID.value)) {
      selectedAppID.value = allAppsID;
    }
  });

  const { data: insightsData, refresh: refreshInsights } = useAsyncData(
    "neckdash-insights",
    () => client.dash.insights({ range: insightRange.value, app: appQuery.value }),
    liveDataOptions([insightRange, selectedAppID]),
  );

  const { data: traceList, refresh: refreshTraces } = useAsyncData(
    "neckdash-traces",
    () => client.dash.listTraces({
      limit: 250,
      app: appQuery.value,
      service: service.value,
      search: search.value,
      hours: traceHours.value,
    }),
    liveDataOptions([selectedAppID, service, search, traceHours]),
  );

  const { data: traceServicesData, refresh: refreshTraceServices } = useAsyncData(
    "neckdash-trace-services",
    () => client.dash.listTraceServices({ app: appQuery.value }),
    liveDataOptions([selectedAppID]),
  );

  const traces = computed(() => traceList.value?.traces ?? []);
  const services = computed(() => traceServicesData.value?.services ?? []);

  const { data: traceDetail, refresh: refreshTraceDetail } = useAsyncData(
    "neckdash-trace-detail",
    () => selectedTraceID.value
      ? client.dash.getTrace(selectedTraceID.value)
      : Promise.resolve(null),
    liveDataOptions([selectedTraceID]),
  );

  const { data: metricsData, refresh: refreshMetrics } = useAsyncData(
    "neckdash-metrics",
    () => client.dash.metricsSummaryEndpoint({ hours: 24, app: appQuery.value }),
    liveDataOptions([selectedAppID]),
  );

  const { data: customMetricsData, refresh: refreshCustomMetrics } = useAsyncData(
    "neckdash-custom-metrics",
    () => client.dash.customMetrics({ hours: 24, app: appQuery.value }),
    liveDataOptions([selectedAppID]),
  );

  const { data: flowData, refresh: refreshFlow } = useAsyncData(
    "neckdash-flow",
    () => client.dash.flow({ app: detailAppQuery.value }),
    liveDataOptions([selectedAppID]),
  );

  const { data: catalogData, refresh: refreshCatalog } = useAsyncData(
    "neckdash-catalog",
    () => client.dash.catalog({ app: detailAppQuery.value }),
    liveDataOptions([selectedAppID]),
  );

  const { data: samplingData, refresh: refreshSampling } = useAsyncData(
    "neckdash-sampling",
    () => client.dash.getSampling(),
    liveDataOptions(),
  );

  const { data: configData, refresh: refreshConfig } = useAsyncData(
    "neckdash-config",
    () => detailAppQuery.value
      ? client.dash.config({ app: detailAppQuery.value })
      : Promise.resolve(null),
    liveDataOptions([selectedAppID]),
  );

  const insights = computed(() => insightsData.value);
  const insightServices = computed(() => insightsData.value?.services ?? []);
  const insightSeries = computed(() => insightsData.value?.requestRate ?? []);
  const chartSize = { width: 760, height: 260, padX: 34, padY: 22 };
  const chartColors = ["#4cc9a7", "#79a7ff", "#f2b84b", "#ff6b6b", "#c084fc", "#67e8f9", "#f472b6", "#a3e635"];
  const chartMax = computed(() => {
    const values = insightSeries.value.flatMap((series) => series.points.map((point) => point.value));
    return Math.max(...values, 0);
  });
  const chartHasData = computed(() => chartMax.value > 0 && insightSeries.value.some((series) => series.points.length > 1));
  const metrics = computed(() => metricsData.value?.services ?? []);
  const runtimeMetrics = computed(() => metricsData.value?.runtime ?? []);
  const customMetricDefinitions = computed(() => customMetricsData.value?.definitions ?? []);
  const customMetricSamples = computed(() => customMetricsData.value?.samples ?? []);
  const configPanel = computed(() => configData.value);
  const backendSecrets = computed(() => configPanel.value?.backendSecrets ?? []);
  const frontendVariables = computed(() => configPanel.value?.frontendVariables ?? []);
  const stackVariables = computed(() => configPanel.value?.stackVariables ?? []);
  const flowEdges = computed(() => flowData.value?.edges ?? []);
  const flowNodes = computed(() => {
    const nodes = new Map<string, FlowNode>((flowData.value?.nodes ?? []).map((node) => [node.id, node]));
    for (const edge of flowEdges.value) {
      for (const name of [edge.source, edge.target]) {
        if (!nodes.has(name)) {
          nodes.set(name, { id: name, kind: flowNodeKind(name), name: flowNodeName(name) });
        }
      }
    }
    return [...nodes.values()];
  });
  const jaegerTrace = computed(() => {
    const raw = safeParse(traceDetail.value?.rawJson) as { data?: Array<{ spans?: Array<Record<string, any>>; processes?: Record<string, { serviceName?: string }> }> } | null;
    return raw?.data?.[0];
  });
  const selectedTraceFromDetail = computed<TraceSummary | undefined>(() => {
    const trace = jaegerTrace.value;
    if (!trace || !selectedTraceID.value) return undefined;
    const traceSpans = Array.isArray(trace.spans) ? trace.spans : [];
    const root = traceSpans.find((span) => !Array.isArray(span.references) || span.references.length === 0) ?? traceSpans[0];
    const attributes = root ? jaegerTags(root) : {};
    const statusCode = spanStatusCode(attributes);
    return {
      traceId: selectedTraceID.value,
      service: root ? String(trace.processes?.[String(root.processID || "")]?.serviceName || root.processID || "") : "",
      endpoint: String(root?.operationName || ""),
      startedAt: root ? new Date(Number(root.startTime || 0) / 1000).toISOString() : "",
      durationMs: root ? Number(root.duration || 0) / 1000 : 0,
      spanCount: traceSpans.length,
      error: attributes.error === "true" || attributes["otel.status_code"] === "ERROR" || statusCode >= 500,
      statusCode,
      environment: attributes["encore.env_id"] || "",
    };
  });
  const selectedTrace = computed(() => (
    traces.value.find((trace) => trace.traceId === selectedTraceID.value)
    ?? selectedTraceFromDetail.value
    ?? undefined
  ));
  const spans = computed<SpanSummary[]>(() => (jaegerTrace.value?.spans ?? []).map((span) => {
    const attributes = jaegerTags(span);
    const serviceName = String(jaegerTrace.value?.processes?.[String(span.processID || "")]?.serviceName || span.processID || "");
    const endpointName = attributes["encore.endpoint"] || String(span.operationName || "");
    const kind = spanKind(attributes, span);
    return {
      spanId: String(span.spanID || ""),
      parentSpanId: Array.isArray(span.references) && span.references[0] ? String(span.references[0].spanID || "") : "",
      spanType: spanTypeLabel(kind),
      kind,
      name: spanDisplayName(attributes, span, endpointName),
      serviceName,
      endpointName,
      topicName: attributes["messaging.destination.name"] || attributes["encore.topic"] || "",
      subscriptionName: attributes["encore.subscription"] || "",
      messageId: attributes["messaging.message.id"] || "",
      startedAt: new Date(Number(span.startTime || 0) / 1000).toISOString(),
      durationMs: Number(span.duration || 0) / 1000,
      statusCode: spanStatusCode(attributes),
      isError: spanIsError(attributes),
      attributes,
      logs: spanLogs(span),
    };
  }));
  const selectedSpan = computed(() => spans.value.find((span) => span.spanId === selectedSpanID.value) ?? spans.value[0]);
  const events = computed<TraceEvent[]>(() => spans.value.flatMap((span) => span.logs.map((log, index) => ({
    spanId: span.spanId,
    eventId: `${span.spanId || "span"}-${index}`,
    eventType: log.level || "log",
    eventTime: log.timestamp,
    eventJson: JSON.stringify({
      timestamp: log.timestamp,
      level: log.level,
      message: log.message,
      fields: log.fields,
    }),
  }))));
  const catalogServices = computed(() => catalogData.value?.services ?? []);
  const catalogTotals = computed(() => ({
    services: catalogServices.value.length,
    endpoints: catalogServices.value.reduce((sum, item) => sum + item.endpoints.length, 0),
    publicEndpoints: catalogServices.value.reduce((sum, item) => sum + item.publicCount, 0),
    streamingEndpoints: catalogServices.value.reduce((sum, item) => sum + item.streamingCount, 0),
  }));
  const selectedCatalogService = computed(() => (
    catalogServices.value.find((item) => item.name === selectedCatalogServiceName.value)
    ?? catalogServices.value[0]
  ));
  const selectedCatalogEndpoint = computed(() => {
    const endpoints = selectedCatalogService.value?.endpoints ?? [];
    return endpoints.find((item) => endpointKey(item) === selectedCatalogEndpointKey.value) ?? endpoints[0];
  });

  watchEffect(() => {
    if (!catalogServices.value.some((item) => item.name === selectedCatalogServiceName.value) && catalogServices.value[0]) {
      selectedCatalogServiceName.value = catalogServices.value[0].name;
    }
  });

  watch(selectedAppID, () => {
    if (routeSync.isSyncingFromRoute()) return;
    service.value = "";
    selectedTraceID.value = "";
    selectedSpanID.value = "";
    selectedEvent.value = null;
    selectedCatalogServiceName.value = "";
    selectedCatalogEndpointKey.value = "";
  });

  watch(selectedTraceID, () => {
    selectedEvent.value = null;
    if (routeSync.isSyncingFromRoute()) return;
    selectedSpanID.value = "";
  });

  watchEffect(() => {
    if (spans.value.length === 0) {
      if (!selectedTraceID.value) selectedSpanID.value = "";
      return;
    }
    if (!selectedSpanID.value || !spans.value.some((span) => span.spanId === selectedSpanID.value)) {
      const first = spans.value[0];
      if (first) selectedSpanID.value = first.spanId;
    }
  });

  watchEffect(() => {
    const endpoints = selectedCatalogService.value?.endpoints ?? [];
    if (endpoints[0] && !endpoints.some((item) => endpointKey(item) === selectedCatalogEndpointKey.value)) {
      selectedCatalogEndpointKey.value = endpointKey(endpoints[0]);
    }
  });

  watchEffect(() => {
    if (!backendSecrets.value.some((item) => item.name === configSecretName.value) && backendSecrets.value[0]) {
      configSecretName.value = backendSecrets.value[0].name;
    }
    if (frontendVariables.value[0] && !frontendVariables.value.some((item) => item.name === frontendVarName.value)) {
      frontendVarName.value = frontendVariables.value[0].name;
      frontendVarValue.value = frontendVariables.value[0].value || "";
    }
  });

  function safeParse(value?: string) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function jaegerTags(span: any) {
    const tags = Array.isArray(span?.tags) ? span.tags : [];
    const result: Record<string, string> = {};
    for (const tag of tags) {
      const key = String(tag?.key || "");
      if (key) result[key] = String(tag?.value ?? "");
    }
    return result;
  }

  function spanKind(attributes: Record<string, string>, span: any) {
    const synthetic = attributes["encore.synthetic.kind"];
    if (synthetic === "db") return "db";
    if (synthetic === "pubsub") return "pubsub";
    if (synthetic === "cache") return "cache";
    if (attributes["db.statement"] || attributes["db.system"]) return "db";
    if (attributes["messaging.system"] || attributes["messaging.destination.name"]) return "pubsub";
    if (attributes["rpc.system"] || attributes["encore.rpc"]) return "rpc";
    if (attributes["http.request.method"] || attributes["http.method"]) return "http";
    const operation = String(span?.operationName || "").toLowerCase();
    if (operation.includes("query") || operation.includes("sql")) return "db";
    if (operation.includes("publish") || operation.includes("subscription")) return "pubsub";
    return "endpoint";
  }

  function spanTypeLabel(kind: string) {
    const labels: Record<string, string> = {
      cache: "cache",
      db: "db query",
      endpoint: "request",
      http: "http",
      pubsub: "pub/sub",
      rpc: "api call",
    };
    return labels[kind] || "span";
  }

  function spanDisplayName(attributes: Record<string, string>, span: any, endpointName: string) {
    if (attributes["db.statement"]) return firstSQLLine(attributes["db.statement"]);
    if (attributes["messaging.destination.name"]) return attributes["messaging.destination.name"];
    if (attributes["http.request.method"] && attributes["url.path"]) return `${attributes["http.request.method"]} ${attributes["url.path"]}`;
    if (attributes["rpc.service"] || attributes["rpc.method"]) {
      return [attributes["rpc.service"], attributes["rpc.method"]].filter(Boolean).join(".");
    }
    return endpointName || String(span?.operationName || "span");
  }

  function firstSQLLine(statement: string) {
    return statement.trim().split(/\s+/).slice(0, 8).join(" ");
  }

  function spanStatusCode(attributes: Record<string, string>) {
    const code = Number(attributes["http.response.status_code"] || attributes["http.status_code"] || attributes["rpc.grpc.status_code"] || 0);
    return Number.isFinite(code) ? code : 0;
  }

  function spanIsError(attributes: Record<string, string>) {
    if (attributes.error === "true" || attributes["otel.status_code"] === "ERROR" || attributes["status.code"] === "2") return true;
    const statusCode = spanStatusCode(attributes);
    return statusCode >= 500;
  }

  function spanLogs(span: any): SpanLog[] {
    const logs = Array.isArray(span?.logs) ? span.logs : [];
    return logs.map((entry: any) => {
      const fields = jaegerFields(entry);
      return {
        timestamp: new Date(Number(entry.timestamp || 0) / 1000).toISOString(),
        level: fields["log.level"] || fields.level || "",
        message: fields["log.message"] || fields.message || fields.event || "",
        fields,
      };
    });
  }

  function jaegerFields(log: any) {
    const fields = Array.isArray(log?.fields) ? log.fields : [];
    const result: Record<string, string> = {};
    for (const field of fields) {
      const key = String(field?.key || "");
      if (key) result[key] = String(field?.value ?? "");
    }
    return result;
  }

  function formatDate(value: string) {
    if (!value) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  }

  function formatMs(value: number) {
    if (!Number.isFinite(value)) return "0 ms";
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${value.toFixed(value >= 10 ? 0 : 1)} ms`;
  }

  function formatMetricValue(value: number) {
    if (!Number.isFinite(value)) return "0";
    if (Math.abs(value) >= 1000) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
    if (Math.abs(value) >= 10) return value.toFixed(2);
    return value.toFixed(4).replace(/0+$/g, "").replace(/\.$/, "");
  }

  function formatPercent(value: number) {
    if (!Number.isFinite(value)) return "0.0%";
    return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`;
  }

  function formatRate(value: number) {
    if (!Number.isFinite(value)) return "0/s";
    if (value >= 100) return `${value.toFixed(0)}/s`;
    if (value >= 1) return `${value.toFixed(2)}/s`;
    return `${value.toFixed(4).replace(/0+$/g, "").replace(/\.$/, "")}/s`;
  }

  function rangeLabel(value?: string) {
    const labels: Record<string, string> = {
      "10m": "Last 10 minutes",
      "1h": "Last hour",
      "8h": "Last 8 hours",
      "24h": "Last 24 hours",
      "3d": "Last 3 days",
      "7d": "Last 7 days",
    };
    return labels[value || ""] || "Last 24 hours";
  }

  function chartPath(series: InsightsSeries) {
    const points = series.points;
    if (points.length < 2 || chartMax.value <= 0) return "";
    const innerWidth = chartSize.width - chartSize.padX * 2;
    const innerHeight = chartSize.height - chartSize.padY * 2;
    return points
      .map((point, index) => {
        const x = chartSize.padX + (index / Math.max(points.length - 1, 1)) * innerWidth;
        const y = chartSize.padY + innerHeight - (point.value / chartMax.value) * innerHeight;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }

  function chartAreaPath(series: InsightsSeries) {
    const points = series.points;
    const path = chartPath(series);
    if (!path || points.length < 2) return "";
    const innerWidth = chartSize.width - chartSize.padX * 2;
    const baseline = chartSize.height - chartSize.padY;
    const firstX = chartSize.padX;
    const lastX = chartSize.padX + innerWidth;
    return `${path} L ${lastX.toFixed(2)} ${baseline.toFixed(2)} L ${firstX.toFixed(2)} ${baseline.toFixed(2)} Z`;
  }

  function chartColor(index: number) {
    return chartColors[index % chartColors.length];
  }

  function endpointKey(endpoint: CatalogEndpoint) {
    return `${endpoint.method}:${endpoint.path}:${endpoint.name}`;
  }

  function selectCatalogService(name: string) {
    selectedCatalogServiceName.value = name;
    const service = catalogServices.value.find((item) => item.name === name);
    selectedCatalogEndpointKey.value = service?.endpoints[0] ? endpointKey(service.endpoints[0]) : "";
  }

  function methodClass(method: string) {
    return `method method-${method.toLowerCase()}`;
  }

  function endpointAccess(endpoint: CatalogEndpoint) {
    if (endpoint.access === "auth") return "auth";
    return endpoint.exposed ? "public" : "private";
  }

  function metricLabels(labels: Record<string, string>) {
    return Object.entries(labels)
      .filter(([key]) => !["env_name", "instance_id", "revision_id"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
  }

  function prettyJSON(value: string) {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  function refreshActive() {
    refreshApps();
    if (activeTab.value === "Insights") refreshInsights();
    if (activeTab.value === "Traces") {
      refreshTraceServices();
      refreshTraces();
      refreshTraceDetail();
    }
    if (activeTab.value === "Logs") refreshNuxtData("neckdash-logs");
    if (activeTab.value === "Metrics") {
      refreshMetrics();
      refreshCustomMetrics();
    }
    if (activeTab.value === "Flow") refreshFlow();
    if (activeTab.value === "Catalog") refreshCatalog();
    if (activeTab.value === "Settings") {
      refreshSampling();
      refreshConfig();
    }
  }

  function refreshRealtime() {
    refreshApps();
    if (activeTab.value === "Insights") refreshInsights();
    if (activeTab.value === "Traces") {
      refreshTraceServices();
      refreshTraces();
      refreshTraceDetail();
    }
    if (activeTab.value === "Logs") refreshNuxtData("neckdash-logs");
    if (activeTab.value === "Metrics") {
      refreshMetrics();
      refreshCustomMetrics();
    }
    if (activeTab.value === "Flow") refreshFlow();
  }

  function openTraceFromLog(traceId: string) {
    search.value = traceId;
    selectedTraceID.value = traceId;
    activeTab.value = "Traces";
    refreshTraces();
  }

  let flowRefreshTimer: number | undefined;
  let liveStream: LiveStream | undefined;
  let liveRestartTimer: number | undefined;

  function flowNodeKind(id: string) {
    return id.startsWith("topic:") ? "topic" : "service";
  }

  function flowNodeName(id: string) {
    return id.replace(/^(service|topic):/, "");
  }

  function stopFlowRefresh() {
    if (flowRefreshTimer !== undefined) {
      window.clearInterval(flowRefreshTimer);
      flowRefreshTimer = undefined;
    }
  }

  function storageGet(key: string) {
    if (!import.meta.client) return "";
    return window.localStorage.getItem(`neckdash.${key}`) || "";
  }

  function storageSet(key: string, value: string | number | boolean) {
    if (!import.meta.client) return;
    window.localStorage.setItem(`neckdash.${key}`, String(value));
  }

  function restoreDashboardState() {
    const storedTab = storageGet("activeTab");
    if ((tabs as readonly string[]).includes(storedTab)) {
      activeTab.value = storedTab as (typeof tabs)[number];
    }
    const storedApp = storageGet("selectedAppID");
    if (storedApp) selectedAppID.value = storedApp;
    const storedRange = storageGet("insightRange");
    if ((insightRanges as readonly string[]).includes(storedRange)) {
      insightRange.value = storedRange as (typeof insightRanges)[number];
    }
    const storedTraceHours = Number(storageGet("traceHours"));
    if (Number.isFinite(storedTraceHours) && storedTraceHours > 0) traceHours.value = storedTraceHours;
    search.value = storageGet("search");
    service.value = storageGet("service");
    liveMode.value = storageGet("liveMode") !== "false";
  }

  function persistDashboardState() {
    storageSet("activeTab", activeTab.value);
    storageSet("selectedAppID", selectedAppID.value);
    storageSet("insightRange", insightRange.value);
    storageSet("traceHours", traceHours.value);
    storageSet("search", search.value);
    storageSet("service", service.value);
    storageSet("liveMode", liveMode.value);
  }

  function stopLiveStream() {
    if (liveRestartTimer !== undefined) {
      window.clearTimeout(liveRestartTimer);
      liveRestartTimer = undefined;
    }
    if (liveStream) {
      const stream = liveStream;
      liveStream = undefined;
      stream.close();
    }
  }

  async function startLiveStream() {
    if (!import.meta.client) return;
    stopLiveStream();
    if (!liveMode.value) {
      liveStatus.value = "paused";
      return;
    }
    liveStatus.value = "connecting";
    try {
      const stream = await client.dash.events();
      liveStream = stream;
      liveStatus.value = "live";
      stream.socket.on("error", () => {
        if (liveStream === stream) scheduleLiveReconnect();
      });
      stream.socket.on("close", () => {
        if (liveStream === stream) scheduleLiveReconnect();
      });
      void consumeLiveStream(stream);
    } catch {
      scheduleLiveReconnect();
    }
  }

  async function consumeLiveStream(stream: LiveStream) {
    try {
      for await (const event of stream) {
        if (liveStream !== stream) return;
        liveStatus.value = "live";
        if (event.type === "ready" || event.type === "tick") refreshRealtime();
      }
    } catch {
      if (liveStream === stream) scheduleLiveReconnect();
    }
  }

  function scheduleLiveReconnect() {
    if (!import.meta.client || !liveMode.value || liveRestartTimer !== undefined) return;
    liveStatus.value = "reconnecting";
    liveRestartTimer = window.setTimeout(() => {
      liveRestartTimer = undefined;
      void startLiveStream();
    }, 1500);
  }

  async function saveBackendSecret() {
    await saveConfigValue("backend_secret", configSecretName.value, configSecretValue.value);
    configSecretValue.value = "";
  }

  async function saveFrontendVariable() {
    await saveConfigValue("frontend_variable", frontendVarName.value, frontendVarValue.value);
  }

  async function saveConfigValue(kind: string, name: string, value: string) {
    configSaving.value = true;
    configMessage.value = "";
    configError.value = "";
    try {
      const result = await client.dash.updateConfigEndpoint({
        app: detailAppQuery.value,
        kind,
        name,
        value,
        redeploy: configRedeploy.value,
      });
      configMessage.value = result.deployed ? "Saved and redeployed the stack." : result.message || "Saved.";
      await refreshConfig();
    } catch (error: any) {
      configError.value = error?.data?.message || error?.message || "Configuration update failed.";
    } finally {
      configSaving.value = false;
    }
  }

  function editFrontendVariable(item: ConfigVariable) {
    frontendVarName.value = item.name;
    frontendVarValue.value = item.value || "";
  }

  watch(activeTab, (tab) => {
    if (!import.meta.client) return;
    stopFlowRefresh();
    if (tab === "Flow") {
      refreshFlow();
      flowRefreshTimer = window.setInterval(() => {
        refreshFlow();
      }, 10_000);
    }
  }, { immediate: true });

  if (import.meta.client) {
    onMounted(() => {
      restoreDashboardState();
      routeSync.applyRouteToState();
      startLiveStream();
    });
    watch([
      activeTab,
      selectedAppID,
      insightRange,
      traceHours,
      search,
      service,
      selectedTraceID,
      selectedSpanID,
      liveMode,
    ], persistDashboardState);
    watch(liveMode, startLiveStream);
  }

  onBeforeUnmount(() => {
    stopFlowRefresh();
    stopLiveStream();
  });

  return {
    activeTab,
    allAppsID,
    appQuery,
    apps,
    backendSecrets,
    catalogServices,
    catalogTotals,
    chartAreaPath,
    chartColor,
    chartHasData,
    chartMax,
    chartPath,
    chartSize,
    configError,
    configMessage,
    configPanel,
    configRedeploy,
    configSaving,
    configSecretName,
    configSecretValue,
    customMetricDefinitions,
    customMetricSamples,
    detailApp,
    detailAppQuery,
    editFrontendVariable,
    endpointAccess,
    endpointKey,
    events,
    flowEdges,
    flowNodes,
    formatDate,
    formatMetricValue,
    formatMs,
    formatPercent,
    formatRate,
    frontendVarName,
    frontendVarValue,
    frontendVariables,
    insightRange,
    insightRanges,
    insightSeries,
    insightServices,
    insights,
    liveMode,
    liveStatus,
    metricLabels,
    metrics,
    methodClass,
    openTraceFromLog,
    prettyJSON,
    rangeLabel,
    refreshActive,
    runtimeMetrics,
    samplingData,
    saveBackendSecret,
    saveFrontendVariable,
    search,
    selectCatalogService,
    selectedAppID,
    selectedAppLabel,
    selectedCatalogEndpoint,
    selectedCatalogEndpointKey,
    selectedCatalogService,
    selectedEvent,
    selectedSpan,
    selectedSpanID,
    selectedTrace,
    selectedTraceID,
    service,
    services,
    spans,
    stackVariables,
    tabs,
    traceHours,
    traces,
  };
}
