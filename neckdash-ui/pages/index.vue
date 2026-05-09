<script setup lang="ts">
const {
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
  selectedTrace,
  selectedTraceID,
  service,
  services,
  spans,
  stackVariables,
  stats,
  tabs,
  traceHours,
  traces,
} = await useDashboardState();
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <h1>NECK Dash</h1>
        <span class="status" :class="liveStatus" />
      </div>
      <div class="app-switcher" aria-label="Application selector">
        <span class="section-label">Apps</span>
        <button
          class="app-option"
          :class="{ active: selectedAppID === allAppsID }"
          type="button"
          @click="selectedAppID = allAppsID"
        >
          <span>All apps</span>
          <small>{{ apps.length }} discovered</small>
        </button>
        <button
          v-for="app in apps"
          :key="app.id"
          class="app-option"
          :class="{ active: selectedAppID === app.id }"
          type="button"
          @click="selectedAppID = app.id"
        >
          <span>{{ app.name || app.id }}</span>
          <small>{{ app.hasOpenapi ? "catalog ready" : "metadata only" }}</small>
        </button>
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
        <div>
          <h2>{{ activeTab }}</h2>
          <p>{{ selectedAppLabel }} · {{ liveStatus === "live" ? "live updates" : liveStatus }}</p>
        </div>
        <div class="toolbar">
          <button
            class="button live-toggle"
            :class="{ active: liveMode }"
            type="button"
            @click="liveMode = !liveMode"
          >
            {{ liveMode ? "Live" : "Paused" }}
          </button>
          <select v-if="activeTab === 'Insights'" v-model="insightRange" class="input compact">
            <option v-for="range in insightRanges" :key="range" :value="range">
              {{ rangeLabel(range) }}
            </option>
          </select>
          <select v-model="selectedAppID" class="input compact">
            <option :value="allAppsID">All apps</option>
            <option v-for="app in apps" :key="app.id" :value="app.id">
              {{ app.name || app.id }}
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
              <defs>
                <linearGradient
                  v-for="(series, index) in insightSeries"
                  :id="`area-${index}`"
                  :key="`area-${series.service}`"
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0%" :stop-color="chartColor(index)" stop-opacity="0.24" />
                  <stop offset="100%" :stop-color="chartColor(index)" stop-opacity="0" />
                </linearGradient>
              </defs>
              <line
                v-for="line in 4"
                :key="line"
                :x1="chartSize.padX"
                :x2="chartSize.width - chartSize.padX"
                :y1="chartSize.padY + ((chartSize.height - chartSize.padY * 2) / 4) * line"
                :y2="chartSize.padY + ((chartSize.height - chartSize.padY * 2) / 4) * line"
                class="grid-line"
              />
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
                :key="`fill-${series.service}`"
                :d="chartAreaPath(series)"
                :fill="`url(#area-${index})`"
                class="chart-area"
              />
              <path
                v-for="(series, index) in insightSeries"
                :key="series.service"
                :d="chartPath(series)"
                :stroke="chartColor(index)"
                class="chart-line"
              />
              <text :x="chartSize.padX" :y="chartSize.padY - 6" class="chart-label">
                {{ formatRate(chartMax) }}
              </text>
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
        <LogsPanel :app-id="appQuery" @select-trace="openTraceFromLog" />
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
            No catalog metadata found for this app.
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

      <section v-else class="settings-grid">
        <div class="panel detail settings-summary">
          <div class="panel-heading">
            <div>
              <h3>Production config</h3>
              <p class="muted">
                {{ detailApp?.name || detailAppQuery || "No app selected" }} · {{ configPanel?.stackName || detailAppQuery || "stack" }}
              </p>
            </div>
            <span class="pill" :class="{ error: !configPanel?.komodoConfigured }">
              {{ configPanel?.komodoConfigured ? "Komodo connected" : "Komodo missing" }}
            </span>
          </div>
          <p class="muted summary-copy">
            {{ configPanel?.runtimeNote }}
          </p>
          <div v-if="!configPanel?.komodoConfigured" class="notice">
            Set {{ configPanel?.requiredEnv?.join(", ") || "NECKDASH_KOMODO_URL, NECKDASH_KOMODO_API_KEY, NECKDASH_KOMODO_API_SECRET" }}
            on the shared neckdash stack to edit app configuration from here.
          </div>
          <div v-if="configMessage" class="notice success">
            {{ configMessage }}
          </div>
          <div v-if="configError" class="notice error">
            {{ configError }}
          </div>
        </div>

        <form class="panel detail config-card" @submit.prevent="saveBackendSecret">
          <div class="panel-heading">
            <div>
              <h3>Backend secrets</h3>
              <p class="muted">Encore `secret(...)` values stored as Komodo secret variables.</p>
            </div>
            <span class="pill">{{ backendSecrets.length }} declared</span>
          </div>
          <label class="field">
            <span>Secret</span>
            <select v-if="backendSecrets.length" v-model="configSecretName" class="input">
              <option v-for="item in backendSecrets" :key="item.name" :value="item.name">
                {{ item.name }} · {{ item.present ? "set" : "missing" }}
              </option>
            </select>
            <input v-else v-model="configSecretName" class="input" placeholder="No Encore secrets found" disabled>
          </label>
          <label class="field">
            <span>Value</span>
            <input v-model="configSecretValue" class="input" type="password" autocomplete="new-password" placeholder="New secret value">
          </label>
          <div class="config-actions">
            <label class="toggle">
              <input v-model="configRedeploy" type="checkbox">
              Redeploy after save
            </label>
            <button
              class="button primary"
              type="submit"
              :disabled="configSaving || !configPanel?.komodoConfigured || !configSecretName || !configSecretValue || backendSecrets.length === 0"
            >
              {{ configSaving ? "Saving" : "Save secret" }}
            </button>
          </div>
          <div class="config-list compact-list">
            <div v-for="item in backendSecrets" :key="item.name" class="config-row">
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.source }}</small>
              </div>
              <span class="pill" :class="{ error: !item.present }">
                {{ item.present ? "set" : "missing" }}
              </span>
            </div>
            <div v-if="backendSecrets.length === 0" class="empty small">
              No backend secret declarations in this app's Encore metadata.
            </div>
          </div>
        </form>

        <form class="panel detail config-card" @submit.prevent="saveFrontendVariable">
          <div class="panel-heading">
            <div>
              <h3>Frontend variables</h3>
              <p class="muted">Nuxt public/runtime variables written into the app stack environment.</p>
            </div>
            <span class="pill">{{ frontendVariables.length }} active</span>
          </div>
          <label class="field">
            <span>Name</span>
            <input v-model="frontendVarName" class="input mono" list="frontend-vars" placeholder="NUXT_PUBLIC_FEATURE_FLAG">
            <datalist id="frontend-vars">
              <option v-for="item in frontendVariables" :key="item.name" :value="item.name" />
            </datalist>
          </label>
          <label class="field">
            <span>Value</span>
            <input v-model="frontendVarValue" class="input mono" placeholder="value">
          </label>
          <div class="config-actions">
            <label class="toggle">
              <input v-model="configRedeploy" type="checkbox">
              Redeploy after save
            </label>
            <button
              class="button primary"
              type="submit"
              :disabled="configSaving || !configPanel?.komodoConfigured || !frontendVarName"
            >
              {{ configSaving ? "Saving" : "Save variable" }}
            </button>
          </div>
          <div class="config-list compact-list">
            <button
              v-for="item in frontendVariables"
              :key="item.name"
              class="config-row interactive"
              type="button"
              @click="editFrontendVariable(item)"
            >
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.source }}</small>
              </div>
              <span class="mono">{{ item.value || "empty" }}</span>
            </button>
            <div v-if="frontendVariables.length === 0" class="empty small">
              No frontend variables found. Add a `NUXT_PUBLIC_` variable above.
            </div>
          </div>
        </form>

        <div class="panel detail config-card">
          <div class="panel-heading">
            <div>
              <h3>Stack environment</h3>
              <p class="muted">Read-only generated values from the app stack.</p>
            </div>
            <span class="pill">{{ stackVariables.length }}</span>
          </div>
          <div class="config-list">
            <div v-for="item in stackVariables" :key="item.name" class="config-row">
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.source }}</small>
              </div>
              <span class="mono">{{ item.value || "empty" }}</span>
            </div>
            <div v-if="stackVariables.length === 0" class="empty small">
              No read-only stack variables.
            </div>
          </div>
        </div>

        <div class="panel detail config-card">
          <div class="panel-heading">
            <div>
              <h3>Sampling</h3>
              <p class="muted">Current local runtime sampling note.</p>
            </div>
            <span class="pill">{{ samplingData?.rules?.length || 0 }} rules</span>
          </div>
          <div class="list">
            <div v-for="rule in samplingData?.rules || []" :key="`${rule.scopeType}:${rule.scopeValue}`" class="list-item">
              <span class="pill">{{ rule.scopeType }}</span>
              <strong>{{ rule.scopeValue || "default" }}</strong>
              <span class="muted">{{ Math.round(rule.rate * 100) }}%</span>
            </div>
            <div v-if="(samplingData?.rules || []).length === 0" class="empty small">
              No explicit sampling rules.
            </div>
          </div>
          <p class="muted summary-copy">{{ samplingData?.runtimeNote }}</p>
        </div>
      </section>
    </main>
  </div>
</template>
