<script setup lang="ts">
import { Boxes, Database, GitBranch, RadioTower } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import type { FlowEdge, FlowNode, LoadState } from "~/types/dashboard";

const props = defineProps<{
  appId: string;
  refreshNonce: number;
}>();

const client = useDashClient();
const state = ref<LoadState>("idle");
const error = ref("");
const nodes = ref<FlowNode[]>([]);
const edges = ref<FlowEdge[]>([]);

const services = computed(() => nodes.value.filter((node) => node.kind === "service"));
const topics = computed(() => nodes.value.filter((node) => node.kind === "topic"));
const databases = computed(() => nodes.value.filter((node) => node.kind === "database"));

async function load() {
  if (!props.appId) {
    nodes.value = [];
    edges.value = [];
    state.value = "ready";
    return;
  }
  state.value = "loading";
  error.value = "";
  try {
    const response = await client.dash.flow({ app: props.appId });
    nodes.value = response.nodes;
    edges.value = response.edges;
    state.value = "ready";
  } catch (err: any) {
    error.value = err?.message || "Could not load flow.";
    state.value = "error";
  }
}

function nodeName(id: string) {
  return nodes.value.find((node) => node.id === id)?.name || id.replace(/^[^:]+:/, "");
}

function edgeLabel(edge: FlowEdge) {
  if (edge.kind === "rpc") return "calls";
  if (edge.kind === "database") return "queries";
  if (edge.kind === "publish") return "publishes";
  if (edge.kind === "subscription") return "subscribes";
  return edge.kind;
}

watch(() => [props.appId, props.refreshNonce], load);
onMounted(load);
</script>

<template>
  <section class="view-stack">
    <StatePanel
      :loading="state === 'loading'"
      :error="error"
      title="Flow unavailable"
      :empty="state === 'ready' && !props.appId"
      empty-text="Select an app to view its Encore Flow graph."
    >
      <div class="flow-layout">
        <section class="flow-column">
          <div class="panel-heading">
            <h3>Services</h3>
            <span class="pill">{{ services.length }}</span>
          </div>
          <article v-for="node in services" :key="node.id" class="flow-node">
            <Boxes :size="18" />
            <div>
              <strong>{{ node.name }}</strong>
              <p>{{ node.publicEndpoints || 0 }} public / {{ node.privateEndpoints || 0 }} private</p>
              <small v-if="node.databases?.length"><Database :size="13" /> {{ node.databases.join(", ") }}</small>
            </div>
          </article>
        </section>

        <section class="flow-column">
          <div class="panel-heading">
            <h3>Resources</h3>
            <span class="pill">{{ topics.length + databases.length }}</span>
          </div>
          <article v-for="node in databases" :key="node.id" class="flow-node database">
            <Database :size="18" />
            <div>
              <strong>{{ node.name }}</strong>
              <p>SQL database</p>
            </div>
          </article>
          <article v-for="node in topics" :key="node.id" class="flow-node topic">
            <RadioTower :size="18" />
            <div>
              <strong>{{ node.name }}</strong>
              <p>{{ node.doc || "Pub/Sub topic" }}</p>
            </div>
          </article>
          <div v-if="topics.length + databases.length === 0" class="empty-panel">No databases or Pub/Sub topics declared.</div>
        </section>

        <section class="flow-column wide">
          <div class="panel-heading">
            <h3>Edges</h3>
            <span class="pill">{{ edges.length }}</span>
          </div>
          <article v-for="edge in edges" :key="`${edge.source}-${edge.target}-${edge.kind}`" class="edge-row">
            <GitBranch :size="16" />
            <span>{{ nodeName(edge.source) }}</span>
            <em>{{ edgeLabel(edge) }}</em>
            <span>{{ nodeName(edge.target) }}</span>
          </article>
          <div v-if="edges.length === 0" class="empty-panel">No service dependencies found in metadata.</div>
        </section>
      </div>
    </StatePanel>
  </section>
</template>
