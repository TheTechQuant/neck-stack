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
  avgDurationMs: number;
  source: string;
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
  count?: number;
};

type FlowEdge = {
  source: string;
  target: string;
  kind: string;
  count: number;
};

const tabs = ["Traces", "Metrics", "Flow", "Catalog", "Settings"] as const;
const activeTab = ref<(typeof tabs)[number]>("Traces");
const api = useDashApi();
const search = ref("");
const service = ref("");
const selectedTraceID = ref("");
const selectedEvent = ref<TraceEvent | null>(null);

const { data: traceList, refresh: refreshTraces } = await useAsyncData(
  "neckdash-traces",
  () => api<{ traces: TraceSummary[] }>("/traces", {
    query: {
      limit: 100,
      service: service.value,
      search: search.value,
    },
  }),
  { watch: [service, search] },
);

const traces = computed(() => traceList.value?.traces ?? []);
const services = computed(() => [...new Set(traces.value.map((trace) => trace.service).filter(Boolean))].sort());
const selectedTrace = computed(() => traces.value.find((trace) => trace.traceId === selectedTraceID.value) ?? traces.value[0]);

watchEffect(() => {
  if (!selectedTraceID.value && traces.value[0]) {
    selectedTraceID.value = traces.value[0].traceId;
  }
});

const { data: traceDetail, refresh: refreshTraceDetail } = await useAsyncData(
  "neckdash-trace-detail",
  () => selectedTrace.value
    ? api<TraceDetail>(`/traces/${selectedTrace.value.traceId}`)
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
  () => api<{ metaJson: string; openapiJson: string }>("/catalog"),
);

const { data: samplingData, refresh: refreshSampling } = await useAsyncData(
  "neckdash-sampling",
  () => api<{ rules: { scopeType: string; scopeValue: string; rate: number }[]; runtimeNote: string }>("/settings/sampling"),
);

const metrics = computed(() => metricsData.value?.services ?? []);
const runtimeMetrics = computed(() => metricsData.value?.runtime ?? []);
const customMetricDefinitions = computed(() => customMetricsData.value?.definitions ?? []);
const customMetricSamples = computed(() => customMetricsData.value?.samples ?? []);
const flowEdges = computed(() => flowData.value?.edges ?? []);
const flowNodes = computed(() => {
  const nodes = new Map<string, FlowNode>((flowData.value?.nodes ?? []).map((node) => [node.id, node]));
  for (const edge of flowEdges.value) {
    for (const name of [edge.source, edge.target]) {
      const existing = nodes.get(name) ?? { id: name, kind: "service", name, count: 0 };
      existing.count = (existing.count ?? 0) + edge.count;
      nodes.set(name, existing);
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
const parsedMeta = computed(() => safeParse(catalogData.value?.metaJson));
const parsedOpenApi = computed(() => safeParse(catalogData.value?.openapiJson));

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
  if (activeTab.value === "Traces") {
    refreshTraces();
    refreshTraceDetail();
  }
  if (activeTab.value === "Metrics") {
    refreshMetrics();
    refreshCustomMetrics();
  }
  if (activeTab.value === "Flow") refreshFlow();
  if (activeTab.value === "Catalog") refreshCatalog();
  if (activeTab.value === "Settings") refreshSampling();
}
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
          <select v-if="activeTab === 'Traces'" v-model="service" class="input">
            <option value="">All services</option>
            <option v-for="item in services" :key="item" :value="item">
              {{ item }}
            </option>
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

      <section v-if="activeTab === 'Traces'">
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

      <section v-else-if="activeTab === 'Metrics'" class="stack">
        <div class="panel">
          <table class="table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Endpoint</th>
                <th>Requests</th>
                <th>Errors</th>
                <th>Average</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in metrics" :key="`${metric.service}:${metric.endpoint}`">
                <td>{{ metric.service }}</td>
                <td>{{ metric.endpoint }}</td>
                <td>{{ formatMetricValue(metric.traceCount) }}</td>
                <td>{{ formatMetricValue(metric.errorCount) }}</td>
                <td>{{ formatMs(metric.avgDurationMs) }}</td>
                <td><span class="pill">{{ metric.source }}</span></td>
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

      <section v-else-if="activeTab === 'Flow'" class="split">
        <div class="panel">
          <div class="flow-row" style="color: var(--muted);">
            <strong>Source</strong>
            <strong>Edge</strong>
            <strong>Target</strong>
            <strong>Count</strong>
          </div>
          <div v-for="edge in flowEdges" :key="`${edge.source}-${edge.target}`" class="flow-row">
            <span>{{ flowNodes.find((node) => node.id === edge.source)?.name || edge.source }}</span>
            <span class="arrow">{{ edge.kind || "calls" }} →</span>
            <span>{{ flowNodes.find((node) => node.id === edge.target)?.name || edge.target }}</span>
            <span>{{ edge.count || "model" }}</span>
          </div>
          <div v-if="flowEdges.length === 0" class="empty">
            No dependency edges observed yet.
          </div>
        </div>
        <div class="panel detail">
          <h3>Nodes</h3>
          <div class="list">
            <div v-for="node in flowNodes" :key="node.id" class="list-item">
              <span class="pill">{{ node.kind }}</span>
              <strong>{{ node.name }}</strong>
              <span class="muted">{{ node.count || 0 }} observations</span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'Catalog'" class="split">
        <div class="panel detail">
          <h3>Services</h3>
          <div class="list">
            <div v-for="svc in parsedMeta?.svcs || []" :key="svc.name" class="list-item">
              <strong>{{ svc.name }}</strong>
              <div v-for="rpc in svc.rpcs || []" :key="rpc.name" class="muted">
                {{ rpc.http_methods?.[0] || "POST" }} / {{ rpc.name }}
              </div>
            </div>
          </div>
        </div>
        <div class="panel detail">
          <h3>OpenAPI</h3>
          <pre class="event-json mono">{{ JSON.stringify(parsedOpenApi?.paths || {}, null, 2) }}</pre>
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
