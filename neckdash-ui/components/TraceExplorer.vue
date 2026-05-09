<script setup lang="ts">
import type { SpanSummary, TraceEvent, TraceSummary } from "~/composables/useDashboardState";

const props = defineProps<{
  traces: TraceSummary[];
  services: string[];
  selectedTrace?: TraceSummary;
  spans: SpanSummary[];
  selectedSpan?: SpanSummary;
  events: TraceEvent[];
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const selectedTraceId = defineModel<string>("selectedTraceId", { required: true });
const selectedSpanId = defineModel<string>("selectedSpanId", { required: true });
const selectedEvent = defineModel<TraceEvent | null>("selectedEvent", { default: null });
const traceHours = defineModel<number>("traceHours", { required: true });
const service = defineModel<string>("service", { required: true });
const search = defineModel<string>("search", { required: true });

const grouped = ref(false);
const percentile = ref(95);
const copied = ref(false);

const selectedTrace = computed(() => props.selectedTrace);
const selectedSpan = computed(() => props.selectedSpan);
const traceDurationMs = computed(() => {
  if (props.spans.length === 0) return selectedTrace.value?.durationMs || 0;
  const starts = props.spans.map((span) => Date.parse(span.startedAt)).filter(Number.isFinite);
  if (starts.length === 0) return selectedTrace.value?.durationMs || 0;
  const rootStart = Math.min(...starts);
  const ends = props.spans.map((span) => Date.parse(span.startedAt) + span.durationMs).filter(Number.isFinite);
  const rootEnd = ends.length > 0 ? Math.max(...ends) : rootStart;
  return Math.max(rootEnd - rootStart, selectedTrace.value?.durationMs || 0, 1);
});
const traceStartMs = computed(() => {
  const starts = props.spans.map((span) => Date.parse(span.startedAt)).filter(Number.isFinite);
  return starts.length > 0 ? Math.min(...starts) : Date.parse(selectedTrace.value?.startedAt || "");
});
const maxTraceDuration = computed(() => Math.max(...props.traces.map((trace) => trace.durationMs), 1));
const totalSpanCount = computed(() => props.traces.reduce((sum, trace) => sum + trace.spanCount, 0));
const timelineTicks = computed(() => Array.from({ length: 6 }, (_, index) => ({
  left: `${(index / 5) * 100}%`,
  label: formatDuration((traceDurationMs.value / 5) * index),
})));
const selectedAttributes = computed(() => selectedSpan.value?.attributes ?? {});
const attributeEntries = computed(() => Object.entries(selectedAttributes.value).sort(([left], [right]) => left.localeCompare(right)));
const dbStatement = computed(() => selectedAttributes.value["db.statement"] || "");
const spanLogs = computed(() => selectedSpan.value?.logs ?? []);
const spanMetrics = computed(() => ({
  apiCalls: props.spans.filter((span) => span.kind === "rpc" || span.kind === "http").length,
  dbQueries: props.spans.filter((span) => span.kind === "db").length,
  publishes: props.spans.filter((span) => span.kind === "pubsub").length,
  logLines: props.spans.reduce((sum, span) => sum + span.logs.length, 0),
}));
const requestDetails = computed(() => ({
  method: selectedAttributes.value["http.request.method"] || selectedAttributes.value["http.method"] || "",
  path: selectedAttributes.value["url.path"] || selectedAttributes.value["http.route"] || "",
  status: selectedSpan.value?.statusCode || 0,
  endpoint: selectedAttributes.value["encore.endpoint"] || selectedSpan.value?.endpointName || "",
}));
const remoteDetails = computed(() => ({
  system: selectedAttributes.value["rpc.system"] || selectedAttributes.value["messaging.system"] || selectedAttributes.value["db.system"] || "",
  peer: selectedAttributes.value["peer.service"] || selectedAttributes.value["server.address"] || "",
  topic: selectedAttributes.value["messaging.destination.name"] || selectedSpan.value?.topicName || "",
  subscription: selectedSpan.value?.subscriptionName || "",
}));
const traceGroups = computed(() => {
  if (!grouped.value) return [{ name: "", traces: props.traces }];
  const groups = new Map<string, TraceSummary[]>();
  for (const trace of props.traces) {
    const name = trace.service || "unknown";
    groups.set(name, [...(groups.get(name) ?? []), trace]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, traces]) => ({ name, traces }));
});
const requestBuckets = computed(() => {
  const bucketCount = 48;
  const now = Date.now();
  const start = now - traceHours.value * 60 * 60 * 1000;
  const width = Math.max((now - start) / bucketCount, 1);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    label: formatBucketTime(start + width * index),
    count: 0,
    errors: 0,
  }));
  for (const trace of props.traces) {
    const at = Date.parse(trace.startedAt);
    if (!Number.isFinite(at)) continue;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((at - start) / width)));
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.count += 1;
    if (trace.error) bucket.errors += 1;
  }
  return buckets;
});
const requestsMax = computed(() => Math.max(...requestBuckets.value.map((bucket) => bucket.count), 1));
const requestPath = computed(() => chartPath(requestBuckets.value.map((bucket) => bucket.count), requestsMax.value, 86, 34));
const latencyBuckets = computed(() => {
  const durations = props.traces.map((trace) => trace.durationMs).filter((value) => Number.isFinite(value) && value >= 0);
  const max = Math.max(...durations, 1);
  const bucketCount = 36;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    count: 0,
    floor: (max / bucketCount) * index,
    ceil: (max / bucketCount) * (index + 1),
  }));
  for (const duration of durations) {
    const index = Math.min(bucketCount - 1, Math.floor((duration / max) * bucketCount));
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }
  return buckets;
});
const latencyMax = computed(() => Math.max(...latencyBuckets.value.map((bucket) => bucket.count), 1));
const selectedPercentile = computed(() => percentileValue(props.traces.map((trace) => trace.durationMs), percentile.value));
const selectedPercentileLeft = computed(() => {
  const max = Math.max(...props.traces.map((trace) => trace.durationMs), 1);
  return `${Math.min(99, Math.max(1, (selectedPercentile.value / max) * 100))}%`;
});

function selectTrace(trace: TraceSummary) {
  selectedTraceId.value = trace.traceId;
  selectedEvent.value = null;
}

function selectSpan(span: SpanSummary) {
  selectedSpanId.value = span.spanId;
  selectedEvent.value = null;
}

function openTrace() {
  const value = window.prompt("Trace ID", selectedTraceId.value || search.value);
  if (!value) return;
  search.value = value.trim();
  selectedTraceId.value = value.trim();
  emit("refresh");
}

async function copyTraceIds() {
  const ids = props.traces.map((trace) => trace.traceId).join("\n");
  if (!ids) return;
  await navigator.clipboard.writeText(ids);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1200);
}

function selectLogEvent(index: number) {
  const spanId = selectedSpan.value?.spanId;
  if (!spanId) return;
  selectedEvent.value = props.events.find((event) => event.spanId === spanId && event.eventId.endsWith(`-${index}`)) || null;
}

function durationBarStyle(trace: TraceSummary) {
  return { width: `${Math.max(4, (trace.durationMs / maxTraceDuration.value) * 100)}%` };
}

function timelineStyle(span: SpanSummary) {
  const start = Math.max(0, Date.parse(span.startedAt) - traceStartMs.value);
  const left = (start / traceDurationMs.value) * 100;
  const width = (span.durationMs / traceDurationMs.value) * 100;
  return {
    left: `${Math.min(99, Math.max(0, left))}%`,
    width: `${Math.min(100, Math.max(0.7, width))}%`,
  };
}

function barHeight(count: number) {
  return `${Math.max(4, (count / latencyMax.value) * 100)}%`;
}

function statusLabel(trace: TraceSummary) {
  if (trace.error) return trace.statusCode ? `${trace.statusCode} ERR` : "ERR";
  if (trace.statusCode) return `${trace.statusCode} OK`;
  return "OK";
}

function spanErrorText(span?: SpanSummary) {
  if (!span) return "";
  const attrs = span.attributes;
  if (span.isError) return attrs["error.message"] || attrs.error || attrs["otel.status_description"] || "Span completed with an error.";
  return "Completed successfully.";
}

function traceRelative(value?: string) {
  if (!value) return "";
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 0) return formatDate(value);
  const minute = 60_000;
  const hour = minute * 60;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)} minutes ago`;
  return `${Math.floor(diff / hour)} hours ago`;
}

function formatDate(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatBucketTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "0ms";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}s`;
  return `${value.toFixed(value >= 10 ? 0 : 1)}ms`;
}

function percentileValue(values: number[], selected: number) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((selected / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function chartPath(values: number[], max: number, width: number, height: number) {
  if (values.length === 0) return "";
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - (value / max) * (height - 3);
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function prettyJSON(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
</script>

<template>
  <div class="trace-explorer">
    <div class="trace-toolbar">
      <button class="trace-icon-button" type="button" title="Refresh" @click="emit('refresh')">
        R
      </button>
      <select v-model.number="traceHours" class="trace-control">
        <option :value="1">Last hour</option>
        <option :value="8">Last 8 hours</option>
        <option :value="24">Last 24 hours</option>
        <option :value="72">Last 3 days</option>
        <option :value="168">Last 7 days</option>
      </select>
      <select v-model="service" class="trace-control">
        <option value="">All services</option>
        <option v-for="item in services" :key="item" :value="item">
          {{ item }}
        </option>
      </select>
      <div class="trace-search">
        <span />
        <input v-model="search" placeholder="Trace, service, endpoint">
      </div>
      <button class="trace-button" type="button" @click="openTrace">
        Open trace
      </button>
      <div class="trace-toolbar-spacer" />
      <button class="trace-button ghost" type="button" @click="grouped = !grouped">
        {{ grouped ? "Ungroup" : "Group by" }}
      </button>
      <button class="trace-button ghost" type="button" @click="copyTraceIds">
        {{ copied ? "Copied" : "Copy IDs" }}
      </button>
    </div>

    <section class="trace-chart-panel">
      <div class="trace-panel-heading">
        <div>
          <h3>Requests &amp; Errors <span>{{ totalSpanCount }} spans</span></h3>
          <small>Drag to select time range</small>
        </div>
        <button class="trace-button light" type="button">
          Error Distribution
        </button>
      </div>
      <div class="request-chart">
        <svg viewBox="0 0 86 34" preserveAspectRatio="none" aria-label="Requests over time">
          <path :d="requestPath" />
          <line x1="0" x2="86" y1="34" y2="34" />
        </svg>
        <div class="error-bars">
          <span
            v-for="bucket in requestBuckets"
            :key="bucket.index"
            :style="{ height: `${Math.max(0, (bucket.errors / requestsMax) * 100)}%` }"
          />
        </div>
      </div>
      <div class="chart-axis">
        <span>{{ requestBuckets[0]?.label }}</span>
        <span>{{ requestBuckets[Math.floor(requestBuckets.length / 2)]?.label }}</span>
        <span>{{ requestBuckets[requestBuckets.length - 1]?.label }}</span>
      </div>
    </section>

    <section class="trace-chart-panel">
      <div class="trace-panel-heading">
        <div>
          <h3>Latency Distribution <span>{{ totalSpanCount }} spans</span></h3>
          <small>Drag to select latency range</small>
        </div>
        <label class="percentile-select">
          <span>Show percentile:</span>
          <select v-model.number="percentile">
            <option :value="50">p50</option>
            <option :value="75">p75</option>
            <option :value="90">p90</option>
            <option :value="95">p95</option>
            <option :value="99">p99</option>
          </select>
        </label>
      </div>
      <div class="latency-chart">
        <span
          v-for="bucket in latencyBuckets"
          :key="bucket.index"
          class="latency-bar"
          :style="{ height: barHeight(bucket.count) }"
          :title="`${formatDuration(bucket.floor)} - ${formatDuration(bucket.ceil)}: ${bucket.count}`"
        />
        <div class="percentile-marker" :style="{ left: selectedPercentileLeft }">
          <b>p{{ percentile }}</b>
        </div>
      </div>
      <div class="chart-axis">
        <span>0ms</span>
        <span>{{ formatDuration(selectedPercentile) }}</span>
        <span>{{ formatDuration(maxTraceDuration) }}</span>
      </div>
    </section>

    <section class="trace-table-panel">
      <table class="trace-table">
        <thead>
          <tr>
            <th />
            <th>Trace ID</th>
            <th>Service</th>
            <th>Endpoint</th>
            <th>Duration</th>
            <th>End Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in traceGroups" :key="group.name || 'all'">
            <tr v-if="group.name" class="trace-group-row">
              <td colspan="7">{{ group.name }} <span>{{ group.traces.length }} traces</span></td>
            </tr>
            <tr
              v-for="trace in group.traces"
              :key="trace.traceId"
              :class="{ selected: selectedTrace?.traceId === trace.traceId }"
              @click="selectTrace(trace)"
            >
              <td><span class="trace-check" /></td>
              <td class="mono trace-id-cell">{{ trace.traceId.slice(0, 12) }}</td>
              <td><strong>{{ trace.service || "unknown" }}</strong></td>
              <td>{{ trace.endpoint || "root" }}</td>
              <td>
                <span>{{ formatDuration(trace.durationMs) }}</span>
                <i class="duration-track"><b :style="durationBarStyle(trace)" /></i>
              </td>
              <td>
                <span>{{ traceRelative(trace.startedAt) }}</span>
                <small>{{ trace.startedAt }}</small>
              </td>
              <td>
                <span class="status-pill" :class="{ error: trace.error }">{{ statusLabel(trace) }}</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-if="traces.length === 0" class="trace-empty">
        No traces captured for the selected range.
      </div>
    </section>

    <section v-if="selectedTrace" class="trace-detail-grid">
      <div class="trace-timeline-panel">
        <div class="trace-detail-header">
          <div>
            <h3>Trace Details <span>{{ selectedTrace.environment }}</span></h3>
            <dl>
              <div><dt>Trace ID</dt><dd class="mono">{{ selectedTrace.traceId }}</dd></div>
              <div><dt>Duration</dt><dd>{{ formatDuration(traceDurationMs) }}</dd></div>
              <div><dt>Recorded</dt><dd>{{ traceRelative(selectedTrace.startedAt) }} <small>{{ selectedTrace.startedAt }}</small></dd></div>
            </dl>
          </div>
        </div>
        <div class="timeline-scale">
          <span v-for="tick in timelineTicks" :key="tick.left" :style="{ left: tick.left }">{{ tick.label }}</span>
        </div>
        <div class="timeline-list">
          <button
            v-for="span in spans"
            :key="span.spanId"
            class="timeline-row"
            :class="{ selected: selectedSpan?.spanId === span.spanId, error: span.isError }"
            type="button"
            @click="selectSpan(span)"
          >
            <span class="timeline-label">{{ span.serviceName }}.{{ span.endpointName || span.name }}</span>
            <i class="timeline-bar" :class="span.kind" :style="timelineStyle(span)">
              <b>{{ span.name }}</b>
            </i>
          </button>
        </div>
      </div>

      <aside class="span-detail-panel">
        <template v-if="selectedSpan">
          <header class="span-header">
            <div>
              <span class="span-kind">{{ selectedSpan.spanType }}</span>
              <h3>{{ selectedSpan.serviceName }}.{{ selectedSpan.endpointName || selectedSpan.name }}</h3>
              <p class="mono">Span ID: {{ selectedSpan.spanId }}</p>
            </div>
          </header>

          <div class="span-metrics">
            <span>{{ formatDuration(traceDurationMs) }} Duration</span>
            <span>{{ spanMetrics.apiCalls }} API Calls</span>
            <span>{{ spanMetrics.dbQueries }} DB Query</span>
            <span>{{ spanMetrics.publishes }} Publishes</span>
            <span>{{ spanMetrics.logLines }} Log Lines</span>
          </div>

          <div class="selected-span-track">
            <i :class="selectedSpan.kind" :style="timelineStyle(selectedSpan)" />
          </div>

          <div v-if="dbStatement" class="span-card sql-card">
            <div class="span-card-title">
              <strong>DB Query</strong>
              <span>{{ formatDuration(selectedSpan.durationMs) }}</span>
            </div>
            <h4>Query</h4>
            <pre class="sql-block">{{ dbStatement }}</pre>
            <h4>Error</h4>
            <p>{{ spanErrorText(selectedSpan) }}</p>
          </div>

          <div v-else class="span-card">
            <div class="span-card-title">
              <strong>{{ selectedSpan.spanType }}</strong>
              <span>{{ formatDuration(selectedSpan.durationMs) }}</span>
            </div>
            <dl class="compact-dl">
              <div v-if="requestDetails.method"><dt>Method</dt><dd>{{ requestDetails.method }}</dd></div>
              <div v-if="requestDetails.path"><dt>Path</dt><dd>{{ requestDetails.path }}</dd></div>
              <div v-if="requestDetails.endpoint"><dt>Endpoint</dt><dd>{{ requestDetails.endpoint }}</dd></div>
              <div v-if="requestDetails.status"><dt>Status</dt><dd>{{ requestDetails.status }}</dd></div>
              <div v-if="remoteDetails.system"><dt>System</dt><dd>{{ remoteDetails.system }}</dd></div>
              <div v-if="remoteDetails.peer"><dt>Peer</dt><dd>{{ remoteDetails.peer }}</dd></div>
              <div v-if="remoteDetails.topic"><dt>Topic</dt><dd>{{ remoteDetails.topic }}</dd></div>
              <div v-if="remoteDetails.subscription"><dt>Subscription</dt><dd>{{ remoteDetails.subscription }}</dd></div>
            </dl>
            <p>{{ spanErrorText(selectedSpan) }}</p>
          </div>

          <div class="span-card">
            <div class="span-card-title">
              <strong>Event Details</strong>
              <span>{{ spanLogs.length }} events</span>
            </div>
            <div v-if="spanLogs.length" class="log-lines">
              <button
                v-for="(log, index) in spanLogs"
                :key="`${selectedSpan?.spanId || 'span'}:${index}`"
                type="button"
                @click="selectLogEvent(index)"
              >
                <span>{{ formatDate(log.timestamp) }}</span>
                <b>{{ log.level || "log" }}</b>
                <strong>{{ log.message || "event" }}</strong>
                <small v-for="[key, value] in Object.entries(log.fields).filter(([field]) => field.startsWith('log.field.'))" :key="key">
                  {{ key.replace('log.field.', '') }}: {{ value }}
                </small>
              </button>
            </div>
            <div v-else class="trace-empty compact">
              No logs recorded for this span.
            </div>
            <pre v-if="selectedEvent" class="event-json mono">{{ prettyJSON(selectedEvent.eventJson) }}</pre>
          </div>

          <div class="span-card">
            <div class="span-card-title">
              <strong>Attributes</strong>
              <span>{{ attributeEntries.length }} fields</span>
            </div>
            <table class="attributes-table">
              <tbody>
                <tr v-for="[key, value] in attributeEntries" :key="key">
                  <th>{{ key }}</th>
                  <td class="mono">{{ value }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </aside>
    </section>
  </div>
</template>
