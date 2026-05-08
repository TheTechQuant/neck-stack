<script setup lang="ts">
type TraceSummary = {
  traceId: string;
  service: string;
  endpoint: string;
  startedAt: string;
  durationMs: number;
  spanCount: number;
  error: boolean;
  statusCode: number;
  environment: string;
};

type SpanSummary = {
  spanId: string;
  parentSpanId: string;
  spanType: string;
  serviceName: string;
  endpointName: string;
  topicName: string;
  subscriptionName: string;
  messageId: string;
  startedAt: string;
  durationMs: number;
  statusCode: number;
  isError: boolean;
};

type TraceEvent = {
  spanId: string;
  eventId: string;
  eventType: string;
  eventTime: string;
  eventJson: string;
};

type TraceDetail = {
  traceId: string;
  rawJson: string;
};

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
  metaJson: string;
  openapiJson: string;
  services: CatalogService[];
};

const tabs = ["Insights", "Traces", "Logs", "Metrics", "Flow", "Catalog", "Settings"] as const;
const insightRanges = ["10m", "1h", "8h", "24h", "3d", "7d"] as const;
const activeTab = ref<(typeof tabs)[number]>("Insights");
const api = useDashApi();
const insightRange = ref<(typeof insightRanges)[number]>("24h");
const traceHours = ref(1);
const search = ref("");
const service = ref("");
const selectedTraceID = ref("");
const selectedEvent = ref<TraceEvent | null>(null);
const selectedCatalogServiceName = ref("");
const selectedCatalogEndpointKey = ref("");

const { data: insightsData, refresh: refreshInsights } = await useAsyncData(
  "neckdash-insights",
  () => api<InsightsResponse>("/insights", { query: { range: insightRange.value } }),
  { watch: [insightRange] },
);

const { data: traceList, refresh: refreshTraces } = await useAsyncData(
  "neckdash-traces",
  () => api<{ traces: TraceSummary[] }>("/traces", {
    query: {
      limit: 50,
      service: service.value,
      search: search.value,
      hours: traceHours.value,
    },
  }),
  { watch: [service, search, traceHours] },
);

const { data: traceServicesData, refresh: refreshTraceServices } = await useAsyncData(
  "neckdash-trace-services",
  () => api<{ services: string[] }>("/traces/services"),
);

const traces = computed(() => traceList.value?.traces ?? []);
const services = computed(() => traceServicesData.value?.services ?? []);
const selectedTrace = computed(() => traces.value.find((trace) => trace.traceId === selectedTraceID.value) ?? traces.value[0]);

watchEffect(() => {
  if (!selectedTraceID.value && traces.value[0]) {
    selectedTraceID.value = traces.value[0].traceId;
  }
});

const { data: traceDetail, refresh: refreshTraceDetail } = await useAsyncData(
  "neckdash-trace-detail",
  () => selectedTrace.value
    ? api<TraceDetail>(`/traces/detail/${selectedTrace.value.traceId}`)
    : Promise.resolve(null),
  { watch: [selectedTraceID] },
);

const { data: metricsData, refresh: refreshMetrics } = await useAsyncData(
  "neckdash-metrics",
  () => api<{ windowHours: number; services: ServiceMetric[]; runtime: MetricSample[] }>("/metrics/summary", { query: { hours: 24 } }),
);

const { data: customMetricsData, refresh: refreshCustomMetrics } = await useAsyncData(
  "neckdash-custom-metrics",
  () => api<{ windowHours: number; definitions: MetricDefinition[]; samples: MetricSample[] }>("/metrics/custom", { query: { hours: 24 } }),
);

const { data: flowData, refresh: refreshFlow } = await useAsyncData(
  "neckdash-flow",
  () => api<{ nodes: FlowNode[]; edges: FlowEdge[] }>("/flow"),
);

const { data: catalogData, refresh: refreshCatalog } = await useAsyncData(
  "neckdash-catalog",
  () => api<CatalogResponse>("/catalog"),
);

const { data: samplingData, refresh: refreshSampling } = await useAsyncData(
  "neckdash-sampling",
  () => api<{ rules: { scopeType: string; scopeValue: string; rate: number }[]; runtimeNote: string }>("/settings/sampling"),
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
const spans = computed<SpanSummary[]>(() => (jaegerTrace.value?.spans ?? []).map((span) => ({
  spanId: String(span.spanID || ""),
  parentSpanId: Array.isArray(span.references) && span.references[0] ? String(span.references[0].spanID || "") : "",
  spanType: "span",
  serviceName: String(jaegerTrace.value?.processes?.[String(span.processID || "")]?.serviceName || span.processID || ""),
  endpointName: String(span.operationName || ""),
  topicName: "",
  subscriptionName: "",
  messageId: "",
  startedAt: new Date(Number(span.startTime || 0) / 1000).toISOString(),
  durationMs: Number(span.duration || 0) / 1000,
  statusCode: 0,
  isError: Array.isArray(span.tags) && span.tags.some((tag: any) => tag.key === "error" && String(tag.value) === "true"),
})));
const events = computed<TraceEvent[]>(() => (jaegerTrace.value?.spans ?? []).flatMap((span) => (span.logs ?? []).map((log: any, index: number) => ({
  spanId: String(span.spanID || ""),
  eventId: `${span.spanID || "span"}-${index}`,
  eventType: jaegerLogField(log, "event") || jaegerLogField(log, "log.level") || "log",
  eventTime: new Date(Number(log.timestamp || 0) / 1000).toISOString(),
  eventJson: JSON.stringify(log),
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
  if (!selectedCatalogServiceName.value && catalogServices.value[0]) {
    selectedCatalogServiceName.value = catalogServices.value[0].name;
  }
});

watchEffect(() => {
  const endpoints = selectedCatalogService.value?.endpoints ?? [];
  if (endpoints[0] && !endpoints.some((item) => endpointKey(item) === selectedCatalogEndpointKey.value)) {
    selectedCatalogEndpointKey.value = endpointKey(endpoints[0]);
  }
});

const stats = computed(() => {
  const total = traces.value.length;
  const errors = traces.value.filter((trace) => trace.error).length;
  const avg = total ? traces.value.reduce((sum, trace) => sum + trace.durationMs, 0) / total : 0;
  return { total, errors, avg };
});

function safeParse(value?: string) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function jaegerLogField(log: any, key: string) {
  const fields = Array.isArray(log?.fields) ? log.fields : [];
  const item = fields.find((field: any) => field.key === key);
  return item ? String(item.value ?? "") : "";
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
  if (activeTab.value === "Settings") refreshSampling();
}

function openTraceFromLog(traceId: string) {
  search.value = traceId;
  selectedTraceID.value = traceId;
  activeTab.value = "Traces";
  refreshTraces();
}

let flowRefreshTimer: number | undefined;

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

onBeforeUnmount(stopFlowRefresh);
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <h1>NECK Dash</h1>
        <span class="status" />
      </div>
      <nav class="nav">
        <button
          v-for="tab in tabs"
          :key="tab"
          :class="{ active: activeTab === tab }"
          type="button"
          @click="activeTab = tab"
        >
          {{ tab }}
        </button>
      </nav>
    </aside>

    <main class="main">
      <div class="topbar">
        <h2>{{ activeTab }}</h2>
        <div class="toolbar">
          <select v-if="activeTab === 'Insights'" v-model="insightRange" class="input compact">
            <option v-for="range in insightRanges" :key="range" :value="range">
              {{ rangeLabel(range) }}
            </option>
          </select>
          <select v-if="activeTab === 'Traces'" v-model="service" class="input">
            <option value="">All services</option>
            <option v-for="item in services" :key="item" :value="item">
              {{ item }}
            </option>
          </select>
          <select v-if="activeTab === 'Traces'" v-model.number="traceHours" class="input compact">
            <option :value="1">Last hour</option>
            <option :value="8">Last 8 hours</option>
            <option :value="24">Last 24 hours</option>
            <option :value="72">Last 3 days</option>
            <option :value="168">Last 7 days</option>
          </select>
          <input
            v-if="activeTab === 'Traces'"
            v-model="search"
            class="input"
            placeholder="Trace, service, endpoint"
          >
          <button class="button" type="button" @click="refreshActive">
            Refresh
          </button>
        </div>
      </div>

      <section v-if="activeTab === 'Insights'" class="stack">
        <div class="grid">
          <div class="stat">
            <span>Requests</span>
            <strong>{{ formatMetricValue(insights?.requests || 0) }}</strong>
            <small>{{ rangeLabel(insights?.range) }}</small>
          </div>
          <div class="stat">
            <span>Errors</span>
            <strong>{{ formatMetricValue(insights?.errors || 0) }}</strong>
            <small>{{ rangeLabel(insights?.range) }}</small>
          </div>
          <div class="stat">
            <span>Error rate</span>
            <strong>{{ formatPercent(insights?.errorRate || 0) }}</strong>
            <small>{{ rangeLabel(insights?.range) }}</small>
          </div>
          <div class="stat">
            <span>Services</span>
            <strong>{{ insightServices.length }}</strong>
            <small>{{ rangeLabel(insights?.range) }}</small>
          </div>
        </div>

        <div class="panel detail">
          <div class="panel-heading">
            <h3>Request rate</h3>
            <span class="muted">requests/sec by service</span>
          </div>
          <div v-if="chartHasData" class="chart-wrap">
            <svg
              class="rate-chart"
              :viewBox="`0 0 ${chartSize.width} ${chartSize.height}`"
              role="img"
              aria-label="Request rate by service"
            >
              <line
                :x1="chartSize.padX"
                :x2="chartSize.width - chartSize.padX"
                :y1="chartSize.height - chartSize.padY"
                :y2="chartSize.height - chartSize.padY"
                class="axis"
              />
              <line
                :x1="chartSize.padX"
                :x2="chartSize.padX"
                :y1="chartSize.padY"
                :y2="chartSize.height - chartSize.padY"
                class="axis"
              />
              <path
                v-for="(series, index) in insightSeries"
                :key="series.service"
                :d="chartPath(series)"
                :stroke="chartColor(index)"
                class="chart-line"
              />
            </svg>
            <div class="legend">
              <span v-for="(series, index) in insightSeries" :key="series.service">
                <i :style="{ background: chartColor(index) }" />
                {{ series.service }}
              </span>
            </div>
          </div>
          <div v-else class="empty">
            No request rate data for this time period.
          </div>
        </div>

        <div class="panel">
          <table class="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Requests</th>
                <th>Errors</th>
                <th>Error rate</th>
                <th>Current rate</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in insightServices" :key="item.service">
                <td><strong>{{ item.service }}</strong></td>
                <td>{{ formatMetricValue(item.requests) }}</td>
                <td>{{ formatMetricValue(item.errors) }}</td>
                <td>{{ formatPercent(item.errorRate) }}</td>
                <td>{{ formatRate(item.rate) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="insightServices.length === 0" class="empty">
            No service request data for this time period.
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'Traces'">
        <div class="grid">
          <div class="stat">
            <span>Recent traces</span>
            <strong>{{ stats.total }}</strong>
          </div>
          <div class="stat">
            <span>Errors</span>
            <strong>{{ stats.errors }}</strong>
          </div>
          <div class="stat">
            <span>Average latency</span>
            <strong>{{ formatMs(stats.avg) }}</strong>
          </div>
          <div class="stat">
            <span>Selected events</span>
            <strong>{{ events.length }}</strong>
          </div>
        </div>

        <div class="split">
          <div class="panel">
            <table class="table">
              <thead>
                <tr>
                  <th>Trace</th>
                  <th>Root</th>
                  <th>Latency</th>
                  <th>Status</th>
                  <th>Seen</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="trace in traces"
                  :key="trace.traceId"
                  :class="{ selected: selectedTrace?.traceId === trace.traceId }"
                  @click="selectedTraceID = trace.traceId; selectedEvent = null"
                >
                  <td class="mono">{{ trace.traceId }}</td>
                  <td>
                    <strong>{{ trace.service || "unknown" }}</strong>
                    <div class="muted">{{ trace.endpoint }}</div>
                  </td>
                  <td>{{ formatMs(trace.durationMs) }}</td>
                  <td>
                    <span class="pill" :class="{ error: trace.error }">
                      {{ trace.error ? "error" : trace.statusCode || "ok" }}
                    </span>
                  </td>
                  <td>{{ formatDate(trace.startedAt) }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="traces.length === 0" class="empty">
              No traces captured yet.
            </div>
          </div>

          <div class="panel detail">
            <h3>{{ selectedTrace?.service || "Trace" }} {{ selectedTrace?.endpoint }}</h3>
            <div class="list">
              <div v-for="span in spans" :key="span.spanId" class="list-item">
                <div>
                  <span class="pill">{{ span.spanType }}</span>
                  <strong>{{ span.serviceName || span.topicName || "unknown" }}</strong>
                  <span class="muted">{{ span.endpointName || span.subscriptionName }}</span>
                </div>
                <div class="muted">
                  {{ formatMs(span.durationMs) }} · {{ span.spanId }}
                </div>
              </div>
            </div>

            <h3 style="margin-top: 18px;">Events</h3>
            <div class="list">
              <button
                v-for="event in events"
                :key="`${event.spanId}-${event.eventId}`"
                class="list-item"
                type="button"
                @click="selectedEvent = event"
              >
                <span class="pill">{{ event.eventType }}</span>
                <span class="muted">{{ formatDate(event.eventTime) }}</span>
                <span class="mono">{{ event.spanId }}</span>
              </button>
            </div>
            <pre v-if="selectedEvent" class="event-json mono">{{ prettyJSON(selectedEvent.eventJson) }}</pre>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'Logs'">
        <LogsPanel @select-trace="openTraceFromLog" />
      </section>

      <section v-else-if="activeTab === 'Metrics'" class="stack">
        <div class="panel">
          <table class="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Endpoint</th>
                <th>Requests</th>
                <th>Errors</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in metrics" :key="`${metric.service}:${metric.endpoint}`">
                <td>{{ metric.service }}</td>
                <td>{{ metric.endpoint }}</td>
                <td>{{ formatMetricValue(metric.traceCount) }}</td>
                <td>{{ formatMetricValue(metric.errorCount) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="metrics.length === 0" class="empty">
            No request metric samples yet.
          </div>
        </div>

        <div class="panel">
          <table class="table">
            <thead>
              <tr>
                <th>Custom metric</th>
                <th>Kind</th>
                <th>Service</th>
                <th>Latest</th>
                <th>Window</th>
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sample in customMetricSamples" :key="`${sample.name}:${sample.serviceName}:${metricLabels(sample.labels)}`">
                <td>
                  <strong>{{ sample.name }}</strong>
                  <div class="muted">{{ customMetricDefinitions.find((metric) => metric.name === sample.name)?.doc }}</div>
                </td>
                <td><span class="pill">{{ sample.kind }}</span></td>
                <td>{{ sample.serviceName || sample.labels.service_id || "app" }}</td>
                <td>{{ formatMetricValue(sample.value) }}</td>
                <td>{{ formatMetricValue(sample.windowValue) }}</td>
                <td class="mono">{{ metricLabels(sample.labels) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="customMetricSamples.length === 0" class="empty">
            No custom metric samples yet.
          </div>
        </div>

        <div class="panel">
          <table class="table">
            <thead>
              <tr>
                <th>Runtime metric</th>
                <th>Kind</th>
                <th>Value</th>
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sample in runtimeMetrics" :key="`${sample.name}:${metricLabels(sample.labels)}`">
                <td>{{ sample.name }}</td>
                <td><span class="pill">{{ sample.kind }}</span></td>
                <td>{{ formatMetricValue(sample.value) }}</td>
                <td class="mono">{{ metricLabels(sample.labels) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="runtimeMetrics.length === 0" class="empty">
            No runtime metric samples yet.
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'Flow'">
        <ClientOnly>
          <LazyFlowDiagram :nodes="flowNodes" :edges="flowEdges" />
        </ClientOnly>
      </section>

      <section v-else-if="activeTab === 'Catalog'" class="catalog-layout">
        <div class="panel catalog-nav">
          <div class="catalog-counts">
            <div>
              <span>Services</span>
              <strong>{{ catalogTotals.services }}</strong>
            </div>
            <div>
              <span>Endpoints</span>
              <strong>{{ catalogTotals.endpoints }}</strong>
            </div>
            <div>
              <span>Public</span>
              <strong>{{ catalogTotals.publicEndpoints }}</strong>
            </div>
            <div>
              <span>Streams</span>
              <strong>{{ catalogTotals.streamingEndpoints }}</strong>
            </div>
          </div>

          <button
            v-for="svc in catalogServices"
            :key="svc.name"
            :class="{ active: selectedCatalogService?.name === svc.name }"
            class="catalog-service"
            type="button"
            @click="selectCatalogService(svc.name)"
          >
            <span>
              <strong>{{ svc.name }}</strong>
              <small>{{ svc.relPath }}</small>
            </span>
            <span class="pill">{{ svc.endpoints.length }}</span>
          </button>
          <div v-if="catalogServices.length === 0" class="empty">
            No catalog metadata mounted.
          </div>
        </div>

        <div class="panel detail catalog-detail">
          <div class="catalog-header">
            <div>
              <span class="muted">Service</span>
              <h3>{{ selectedCatalogService?.name || "Catalog" }}</h3>
              <p v-if="selectedCatalogService?.doc" class="muted">
                {{ selectedCatalogService.doc }}
              </p>
            </div>
            <div class="catalog-meta">
              <span v-if="selectedCatalogService?.databases.length" class="pill">
                {{ selectedCatalogService.databases.length }} db
              </span>
              <span v-if="selectedCatalogService?.metrics.length" class="pill">
                {{ selectedCatalogService.metrics.length }} metrics
              </span>
              <span v-if="selectedCatalogService?.buckets.length" class="pill">
                {{ selectedCatalogService.buckets.length }} buckets
              </span>
            </div>
          </div>

          <div class="endpoint-tabs">
            <button
              v-for="endpoint in selectedCatalogService?.endpoints || []"
              :key="endpointKey(endpoint)"
              :class="{ active: selectedCatalogEndpointKey === endpointKey(endpoint) }"
              type="button"
              @click="selectedCatalogEndpointKey = endpointKey(endpoint)"
            >
              <span :class="methodClass(endpoint.method)">{{ endpoint.method }}</span>
              <span>{{ endpoint.name }}</span>
            </button>
          </div>

          <article v-if="selectedCatalogEndpoint" class="endpoint-doc">
            <div class="endpoint-title">
              <div>
                <h3>{{ selectedCatalogEndpoint.summary || selectedCatalogEndpoint.name }}</h3>
                <div class="endpoint-route mono">
                  <span :class="methodClass(selectedCatalogEndpoint.method)">{{ selectedCatalogEndpoint.method }}</span>
                  {{ selectedCatalogEndpoint.path }}
                </div>
              </div>
              <div class="catalog-meta">
                <span class="pill">{{ endpointAccess(selectedCatalogEndpoint) }}</span>
                <span v-if="selectedCatalogEndpoint.protocol === 'raw'" class="pill">raw</span>
                <span v-if="selectedCatalogEndpoint.streaming" class="pill">stream</span>
              </div>
            </div>

            <p v-if="selectedCatalogEndpoint.description" class="doc-copy">
              {{ selectedCatalogEndpoint.description }}
            </p>

            <div class="schema-grid">
              <div class="schema-block">
                <h4>Request</h4>
                <pre v-if="selectedCatalogEndpoint.requestSchemaJson" class="event-json mono">{{ prettyJSON(selectedCatalogEndpoint.requestSchemaJson) }}</pre>
                <div v-else class="schema-empty">No request body</div>
              </div>
              <div class="schema-block">
                <h4>Response</h4>
                <pre v-if="selectedCatalogEndpoint.responseSchemaJson" class="event-json mono">{{ prettyJSON(selectedCatalogEndpoint.responseSchemaJson) }}</pre>
                <div v-else class="schema-empty">No response schema</div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section v-else class="panel detail">
        <h3>Sampling</h3>
        <div class="list">
          <div v-for="rule in samplingData?.rules || []" :key="`${rule.scopeType}:${rule.scopeValue}`" class="list-item">
            <span class="pill">{{ rule.scopeType }}</span>
            <strong>{{ rule.scopeValue || "default" }}</strong>
            <span class="muted">{{ Math.round(rule.rate * 100) }}%</span>
          </div>
        </div>
        <p class="muted">{{ samplingData?.runtimeNote }}</p>
      </section>
    </main>
  </div>
</template>
