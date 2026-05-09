<script setup lang="ts">
import { Boxes, FileText, GitBranch, KeyRound, RadioTower, ScrollText, Search, ServerCog } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import type { CatalogService, DashApp, FlowEdge, FlowNode, LoadState } from "~/types/dashboard";
import { formatNumber } from "~/utils/dashboard";

const props = defineProps<{
  appId: string;
  apps: DashApp[];
  signozBaseUrl: string;
  refreshNonce: number;
}>();

const client = useDashClient();
const state = ref<LoadState>("idle");
const error = ref("");
const services = ref<CatalogService[]>([]);
const nodes = ref<FlowNode[]>([]);
const edges = ref<FlowEdge[]>([]);

const selectedApps = computed(() => props.appId ? props.apps.filter((app) => app.id === props.appId) : props.apps);
const publicEndpoints = computed(() => services.value.reduce((sum, service) => sum + service.publicCount, 0));
const privateEndpoints = computed(() => services.value.reduce((sum, service) => sum + service.privateCount, 0));
const streamingEndpoints = computed(() => services.value.reduce((sum, service) => sum + service.streamingCount, 0));

const signozLinks = computed(() => [
  {
    icon: Search,
    title: "Trace Explorer",
    text: "Request timelines, SQL spans, service calls, errors, and payload context.",
    href: signozUrl("/traces"),
  },
  {
    icon: ScrollText,
    title: "Logs",
    text: "Structured Encore logs correlated with trace_id, span_id, app_id, and service.",
    href: signozUrl("/logs"),
  },
  {
    icon: RadioTower,
    title: "Services",
    text: "RED metrics, latency percentiles, throughput, and error pressure by service.",
    href: signozUrl("/services"),
  },
  {
    icon: ServerCog,
    title: "Dashboards",
    text: "Custom metrics from encore.dev/metrics and infrastructure panels.",
    href: signozUrl("/dashboard"),
  },
]);

async function load() {
  state.value = "loading";
  error.value = "";
  try {
    if (!props.appId) {
      services.value = [];
      nodes.value = [];
      edges.value = [];
      state.value = "ready";
      return;
    }
    const [catalog, flow] = await Promise.all([
      client.dash.catalog({ app: props.appId }),
      client.dash.flow({ app: props.appId }),
    ]);
    services.value = catalog.services;
    nodes.value = flow.nodes;
    edges.value = flow.edges;
    state.value = "ready";
  } catch (err: any) {
    error.value = err?.message || "Could not load app metadata.";
    state.value = "error";
  }
}

function signozUrl(path: string) {
  return `${props.signozBaseUrl.replace(/\/+$/g, "")}${path}`;
}

watch(() => [props.appId, props.refreshNonce], load);
onMounted(load);
</script>

<template>
  <section class="view-stack">
    <div class="hero-panel">
      <div>
        <span class="section-kicker">Observability</span>
        <h3>SigNoz handles high-volume telemetry. NECK Dash keeps Encore context close.</h3>
        <p>
          Traces, logs, service metrics, and custom metrics are stored in the shared SigNoz stack.
          Catalog, Flow, and configuration stay here because they come from Encore metadata and Komodo.
        </p>
      </div>
      <div class="hero-counts">
        <div><strong>{{ formatNumber(selectedApps.length) }}</strong><span>apps</span></div>
        <div><strong>{{ formatNumber(services.length) }}</strong><span>services</span></div>
        <div><strong>{{ formatNumber(edges.length) }}</strong><span>flow edges</span></div>
      </div>
    </div>

    <StatePanel :loading="state === 'loading'" :error="error" title="Metadata unavailable">
      <div class="metric-grid">
        <article class="metric-tile">
          <Boxes :size="18" />
          <span>Services</span>
          <strong>{{ formatNumber(services.length) }}</strong>
          <small>{{ props.appId ? "from Encore metadata" : "select an app for details" }}</small>
        </article>
        <article class="metric-tile">
          <FileText :size="18" />
          <span>Public endpoints</span>
          <strong>{{ formatNumber(publicEndpoints) }}</strong>
          <small>{{ formatNumber(privateEndpoints) }} private endpoints</small>
        </article>
        <article class="metric-tile">
          <GitBranch :size="18" />
          <span>Dependencies</span>
          <strong>{{ formatNumber(edges.length) }}</strong>
          <small>{{ formatNumber(nodes.length) }} graph nodes</small>
        </article>
        <article class="metric-tile">
          <KeyRound :size="18" />
          <span>Streaming APIs</span>
          <strong>{{ formatNumber(streamingEndpoints) }}</strong>
          <small>typed Encore streams</small>
        </article>
      </div>
    </StatePanel>

    <div class="link-grid">
      <a v-for="link in signozLinks" :key="link.title" class="link-card" :href="link.href" target="_blank" rel="noreferrer">
        <component :is="link.icon" :size="22" />
        <span>{{ link.title }}</span>
        <p>{{ link.text }}</p>
      </a>
    </div>
  </section>
</template>
