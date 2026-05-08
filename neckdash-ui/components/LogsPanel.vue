<script setup lang="ts">
type LogEntry = {
  timestamp: string;
  message: string;
  level: string;
  service: string;
  endpoint: string;
  traceId: string;
  spanId: string;
  fields: Record<string, string>;
};

type LogListResponse = {
  query: string;
  logs: LogEntry[];
};

const emit = defineEmits<{
  selectTrace: [traceId: string];
}>();

const api = useDashApi();
const query = ref("");
const service = ref("");
const level = ref("");
const traceId = ref("");
const hours = ref(1);
const autoRefresh = ref(false);

const { data: logsData, pending, refresh } = await useAsyncData(
  "neckdash-logs",
  () => api<LogListResponse>("/logs", {
    query: {
      query: query.value,
      service: service.value,
      level: level.value,
      traceId: traceId.value,
      hours: hours.value,
      limit: 200,
    },
  }),
  { watch: [query, service, level, traceId, hours] },
);

const logs = computed(() => logsData.value?.logs ?? []);
const services = computed(() => [...new Set(logs.value.map((log) => log.service).filter(Boolean))].sort());
const errors = computed(() => logs.value.filter((log) => ["error", "warn"].includes(log.level)).length);
const hasTailFilter = computed(() => Boolean(query.value || service.value || level.value || traceId.value));
const tailURL = computed(() => {
  const params = new URLSearchParams();
  if (query.value) params.set("query", query.value);
  if (service.value) params.set("service", service.value);
  if (level.value) params.set("level", level.value);
  if (traceId.value) params.set("traceId", traceId.value);
  params.set("start_offset", "10m");
  return `/api/logs/tail?${params.toString()}`;
});

let refreshTimer: ReturnType<typeof setInterval> | undefined;

watch(autoRefresh, (enabled) => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = enabled ? setInterval(() => refresh(), 2500) : undefined;
});

onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

function levelClass(value: string) {
  return `pill level level-${value || "unknown"}`;
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

function fieldSummary(fields: Record<string, string>) {
  return Object.entries(fields)
    .filter(([key]) => key.startsWith("field."))
    .map(([key, value]) => `${key.slice(6)}=${value}`)
    .join(", ");
}
</script>

<template>
  <div class="stack">
    <div class="grid">
      <div class="stat">
        <span>Log lines</span>
        <strong>{{ logs.length }}</strong>
        <small>Last {{ hours }} hours</small>
      </div>
      <div class="stat">
        <span>Warnings/errors</span>
        <strong>{{ errors }}</strong>
        <small>Structured Encore logs</small>
      </div>
      <div class="stat">
        <span>Services</span>
        <strong>{{ services.length }}</strong>
        <small>Seen in results</small>
      </div>
      <div class="stat">
        <span>Live tail</span>
        <strong>{{ autoRefresh ? "on" : "off" }}</strong>
        <small v-if="hasTailFilter"><a class="muted" :href="tailURL" target="_blank">NDJSON stream</a></small>
        <small v-else>Add a filter first</small>
      </div>
    </div>

    <div class="panel detail">
      <div class="logs-toolbar">
        <input v-model="query" class="input" placeholder="Search message">
        <input v-model="service" class="input" list="log-services" placeholder="Service">
        <datalist id="log-services">
          <option v-for="item in services" :key="item" :value="item" />
        </datalist>
        <select v-model="level" class="input compact">
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
          <option value="trace">Trace</option>
        </select>
        <input v-model="traceId" class="input" placeholder="Trace ID">
        <select v-model.number="hours" class="input compact">
          <option :value="1">1h</option>
          <option :value="8">8h</option>
          <option :value="24">24h</option>
          <option :value="72">3d</option>
          <option :value="168">7d</option>
        </select>
        <label class="toggle">
          <input v-model="autoRefresh" type="checkbox">
          Auto
        </label>
        <button class="button" type="button" @click="() => refresh()">
          {{ pending ? "Loading" : "Refresh" }}
        </button>
      </div>
    </div>

    <div class="panel">
      <table class="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Level</th>
            <th>Service</th>
            <th>Message</th>
            <th>Trace</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="`${log.timestamp}:${log.spanId}:${log.message}`">
            <td>{{ formatDate(log.timestamp) }}</td>
            <td><span :class="levelClass(log.level)">{{ log.level || "log" }}</span></td>
            <td>
              <strong>{{ log.service || "unknown" }}</strong>
              <div class="muted">{{ log.endpoint }}</div>
            </td>
            <td>
              <div class="log-message">{{ log.message }}</div>
              <div v-if="fieldSummary(log.fields)" class="muted mono">{{ fieldSummary(log.fields) }}</div>
            </td>
            <td>
              <button
                v-if="log.traceId"
                class="link-button mono"
                type="button"
                @click="emit('selectTrace', log.traceId)"
              >
                {{ log.traceId }}
              </button>
              <span v-else class="muted">none</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="logs.length === 0" class="empty">
        No structured logs captured yet.
      </div>
    </div>
  </div>
</template>
