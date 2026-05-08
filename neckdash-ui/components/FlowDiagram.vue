<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";

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

type ElkPoint = {
  x: number;
  y: number;
};

type ElkNode = FlowNode & {
  labels: Array<{ text: string }>;
  ports?: Array<{ id: string }>;
  type: "service" | "topic";
  width: number;
  height: number;
  x?: number;
  y?: number;
};

type ElkEdge = {
  id: string;
  sources: string[];
  targets: string[];
  type: string;
  labels: Array<{ text: string; x?: number; y?: number }>;
  sections?: Array<{ startPoint?: ElkPoint; bendPoints?: ElkPoint[]; endPoint?: ElkPoint }>;
};

type ElkGraph = {
  id: string;
  width: number;
  height: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
};

const props = defineProps<{
  nodes: FlowNode[];
  edges: FlowEdge[];
}>();

const container = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const panZoomRef = shallowRef<any>(null);
const graph = shallowRef<ElkGraph | null>(null);
const selectedId = ref("");
const hoverId = ref("");
const query = ref("");
const isFitting = ref(true);
const isMounted = ref(false);

const graphNodes = computed(() => props.nodes.filter((node) => node.kind === "service" || node.kind === "topic"));
const nodeById = computed(() => new Map(graphNodes.value.map((node) => [node.id, node])));
const selectedNode = computed(() => nodeById.value.get(selectedId.value));
const searchResults = computed(() => {
  const value = query.value.trim().toLowerCase();
  if (!value) return graphNodes.value;
  return graphNodes.value.filter((node) => node.name.toLowerCase().includes(value));
});

const focusIds = computed(() => {
  if (!selectedId.value) return new Set<string>();
  const ids = new Set<string>([selectedId.value]);
  for (const edge of props.edges) {
    const targets = edgeTargets(edge);
    if (edge.source === selectedId.value) {
      targets.forEach((target) => ids.add(nodeIdFromPort(target)));
    }
    if (targets.includes(selectedId.value) || targets.includes(`${selectedId.value}:port`)) {
      ids.add(edge.source);
    }
  }
  return ids;
});

const hoverTargets = computed(() => {
  if (!hoverId.value) return new Set<string>();
  const ids = new Set<string>();
  for (const edge of props.edges) {
    if (edge.source === hoverId.value) {
      edgeTargets(edge).forEach((target) => ids.add(nodeIdFromPort(target)));
    }
  }
  return ids;
});

watch(
  () => [props.nodes, props.edges, selectedId.value],
  () => {
    if (isMounted.value) {
      void layout();
    }
  },
  { deep: true },
);

onMounted(async () => {
  isMounted.value = true;
  await layout();
});

onBeforeUnmount(() => {
  if (panZoomRef.value && typeof panZoomRef.value.dispose === "function") {
    panZoomRef.value.dispose();
  }
});

watch(graph, async () => {
  await nextTick();
  await ensurePanzoom();
  fitGraph();
});

async function ensurePanzoom() {
  if (panZoomRef.value || !svgEl.value) return;
  const mod = await import("panzoom");
  const createPanzoom = mod.default ?? mod;
  panZoomRef.value = createPanzoom(svgEl.value, {
    smoothScroll: false,
    maxZoom: 5,
    minZoom: 0.2,
  });
}

async function layout() {
  const nodes = layoutNodes();
  const edges = layoutEdges();
  if (nodes.length === 0) {
    graph.value = { id: "app-graph", width: 0, height: 0, children: [], edges: [] };
    return;
  }
  const mod = await import("elkjs/lib/elk.bundled.js");
  const ELK = mod.default ?? mod;
  const elk = new ELK({
    defaultLayoutOptions: {
      "elk.edgeRouting": "ORTHOGONAL",
      "org.eclipse.elk.spacing.portPort": "20",
      "org.eclipse.elk.spacing.edgeNode": "20",
      "org.eclipse.elk.edgeLabels.placement": "HEAD",
      "org.eclipse.elk.spacing.edgeLabel": "20",
      "org.eclipse.elk.edgeLabels.inline": "true",
      "org.eclipse.elk.layered.edgeLabels.sideSelection": "SMART_DOWN",
      "elk.direction": selectedId.value ? "DOWN" : "RIGHT",
    },
  });
  graph.value = await elk.layout({ id: "app-graph", children: nodes, edges });
}

function layoutNodes() {
  return graphNodes.value
    .filter((node) => focusIds.value.size === 0 || focusIds.value.has(node.id))
    .map<ElkNode>((node) => {
      if (node.kind === "topic") {
        return {
          ...node,
          type: "topic",
          labels: [{ text: node.name }],
          ports: [{ id: `${node.id}:port` }],
          width: topicWidth(node.name),
          height: 40,
        };
      }
      return {
        ...node,
        type: "service",
        labels: [{ text: node.name }],
        width: Math.max(220, node.name.length * 12),
        height: serviceHeight(node),
      };
    });
}

function layoutEdges() {
  return props.edges
    .filter((edge) => {
      if (focusIds.value.size === 0) return true;
      const targets = edgeTargets(edge).map(nodeIdFromPort);
      return focusIds.value.has(edge.source) && targets.some((target) => focusIds.value.has(target));
    })
    .map<ElkEdge>((edge) => ({
      id: `${edge.source}-${edge.target}:${edge.kind}`,
      sources: [edge.source],
      targets: edgeTargets(edge),
      type: normalizeKind(edge.kind),
      labels: [{ text: edgeCountLabel(edge) }],
    }));
}

function edgeTargets(edge: FlowEdge) {
  const kind = normalizeKind(edge.kind);
  if (kind === "publish" && nodeById.value.get(edge.target)?.kind === "topic") {
    return [`${edge.target}:port`];
  }
  return [edge.target];
}

function normalizeKind(kind: string) {
  if (kind === "subscribe") return "subscription";
  if (kind === "observed") return "rpc";
  return kind || "rpc";
}

function nodeIdFromPort(value: string) {
  return value.endsWith(":port") ? value.slice(0, -5) : value;
}

function topicWidth(name: string) {
  return Math.min(Math.max(50, name.length * 9 + 60), 300);
}

function serviceHeight(node: FlowNode) {
  let height = 60;
  if (node.databases?.length) height += 26;
  if (node.cronJobs?.length) height += 26;
  return height;
}

function isNodeActive(node: ElkNode) {
  if (selectedId.value) return true;
  if (!hoverId.value) return true;
  return node.id === hoverId.value || hoverTargets.value.has(node.id);
}

function isEdgeActive(edge: ElkEdge) {
  if (selectedId.value) return true;
  if (!hoverId.value) return true;
  return edge.sources[0] === hoverId.value;
}

function isLabelActive(edge: ElkEdge) {
  if (selectedId.value) return edge.sources[0] === selectedId.value;
  return !!hoverId.value && edge.sources[0] === hoverId.value;
}

function edgePoints(edge: ElkEdge) {
  const points: ElkPoint[] = [];
  for (const section of edge.sections ?? []) {
    if (section.startPoint) points.push(section.startPoint);
    if (section.bendPoints) points.push(...section.bendPoints);
    if (section.endPoint) points.push(section.endPoint);
  }
  return points;
}

function edgePath(edge: ElkEdge) {
  return edgePoints(edge)
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function edgeLabel(edge: ElkEdge) {
  const label = edge.labels[0];
  const points = edgePoints(edge);
  if (label?.x !== undefined && label?.y !== undefined) {
    const start = points[0];
    const end = points[points.length - 1];
    const inverted = !!(start && end && start.y > end.y);
    return { text: edgeLabelText(edge), x: label.x - 60, y: label.y - (inverted ? 5 : 20) };
  }
  const mid = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
  return { text: edgeLabelText(edge), x: mid.x - 40, y: mid.y - 12 };
}

function edgeLabelText(edge: ElkEdge) {
  const suffix: Record<string, string> = {
    publish: "pub",
    subscription: "sub",
    rpc: "RPCs",
    database: "Uses db",
  };
  if (edge.type === "database") return suffix.database;
  return `${edge.labels[0]?.text || "1"} ${suffix[edge.type] || edge.type}`;
}

function edgeCountLabel(edge: FlowEdge) {
  const count = edge.observedCount || edge.staticCount || edge.count || 1;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function selectNode(id: string) {
  selectedId.value = id;
  query.value = "";
}

function clearSelection() {
  selectedId.value = "";
}

function fitGraph() {
  if (!container.value || !graph.value || !panZoomRef.value) return;
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;
  if (!width || !height || !graph.value.width || !graph.value.height) return;
  const xScale = width / graph.value.width;
  const yScale = height / graph.value.height;
  const scale = Math.min(Math.min(xScale, yScale), 1.5) * 0.9;
  isFitting.value = true;
  panZoomRef.value.zoomAbs(0, 0, scale);
  panZoomRef.value.moveTo(width / 2 - (graph.value.width * scale) / 2, height / 2 - (graph.value.height * scale) / 2);
  window.setTimeout(() => {
    isFitting.value = false;
  }, 600);
}
</script>

<template>
  <div class="flow-shell">
    <div class="flow-header">
      <div class="flow-breadcrumb">
        <button v-if="selectedNode" type="button" @click="clearSelection">
          System Diagram
        </button>
        <span v-else>System Diagram</span>
        <span v-if="selectedNode" class="flow-separator">/</span>
        <strong v-if="selectedNode">{{ selectedNode.name }}</strong>
      </div>
      <div class="flow-search">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M8.5 3a5.5 5.5 0 0 1 4.35 8.86l3.15 3.14-1 1-3.14-3.15A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
        <input v-model="query" placeholder="Search services and topics">
        <div v-if="query" class="flow-results">
          <button v-for="node in searchResults" :key="node.id" type="button" @click="selectNode(node.id)">
            <span :class="['flow-result-kind', node.kind]">{{ node.kind }}</span>
            {{ node.name }}
          </button>
          <div v-if="searchResults.length === 0" class="flow-result-empty">No services found.</div>
        </div>
      </div>
    </div>

    <div ref="container" class="flow-canvas">
      <svg
        v-if="graph?.children?.length"
        id="flow-diagram"
        ref="svgEl"
        :width="graph.width"
        :height="graph.height"
        :viewBox="`0 0 ${graph.width} ${graph.height}`"
      >
        <defs>
          <marker
            id="neck-flow-arrow"
            markerUnits="userSpaceOnUse"
            markerWidth="20"
            markerHeight="20"
            refX="13"
            refY="8"
            orient="auto"
            fill="none"
          >
            <path
              d="M2.344 14c2.465-3.708 5.874-6 9.636-6C8.218 8 4.81 5.708 2.344 2"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </marker>
          <filter id="neck-flow-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="4" result="blur" />
          </filter>
        </defs>

        <g class="flow-graph">
          <g v-for="edge in graph.edges || []" :key="`edge-${edge.id}`" class="edge-group">
            <path
              v-if="edge.type === 'publish' || edge.type === 'subscription'"
              :d="edgePath(edge)"
              :class="['edge edge-underlay', { active: isEdgeActive(edge) }]"
              marker-end="url(#neck-flow-arrow)"
            />
            <path
              :d="edgePath(edge)"
              :class="['edge', { active: isEdgeActive(edge), message: edge.type === 'publish' || edge.type === 'subscription' }]"
              marker-end="url(#neck-flow-arrow)"
            />
          </g>

          <g
            v-for="node in graph.children || []"
            :key="node.id"
            :transform="`translate(${node.x || 0}, ${node.y || 0})`"
            :class="['node', node.type, { active: isNodeActive(node), fitting: isFitting }]"
            @mouseenter="hoverId = node.id"
            @mouseleave="hoverId = ''"
            @click="selectNode(node.id)"
          >
            <template v-if="node.type === 'service'">
              <rect
                class="service-glow"
                :width="node.width"
                :height="node.height"
                rx="8"
                ry="8"
                filter="url(#neck-flow-shadow)"
              />
              <foreignObject :width="node.width" :height="node.height">
                <div class="service-card">
                  <h3>{{ node.name }}</h3>
                  <div class="service-row">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M3 10a.75.75 0 0 1 .75-.75h10.64l-4.16-3.96a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.16-3.96H3.75A.75.75 0 0 1 3 10Z" />
                    </svg>
                    <span><b>{{ node.publicEndpoints || 0 }}</b> public</span>
                    <span><b>{{ node.authEndpoints || 0 }}</b> auth</span>
                    <span><b>{{ node.privateEndpoints || 0 }}</b> private</span>
                  </div>
                  <div v-if="node.databases?.length" class="service-row compact">
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M10 1c3.87 0 7 1.79 7 4s-3.13 4-7 4-7-1.79-7-4 3.13-4 7-4Zm5.69 8.13c.47-.27.91-.58 1.31-.95V10c0 2.21-3.13 4-7 4s-7-1.79-7-4V8.18c.4.37.84.68 1.31.95 1.53.88 3.54 1.37 5.69 1.37s4.16-.49 5.69-1.37ZM3 13.18V15c0 2.21 3.13 4 7 4s7-1.79 7-4v-1.82c-.4.37-.84.68-1.31.95-1.53.88-3.54 1.37-5.69 1.37s-4.16-.49-5.69-1.37A7.01 7.01 0 0 1 3 13.18Z" />
                    </svg>
                    <span>{{ node.databases.length === 1 ? node.databases[0] : `${node.databases.length} databases` }}</span>
                  </div>
                  <div v-if="node.cronJobs?.length" class="service-row compact">
                    <svg viewBox="0 0 256 256" aria-hidden="true">
                      <path d="M140 80v41.21l34.17 20.5a12 12 0 1 1-12.34 20.58l-40-24A12 12 0 0 1 116 128V80a12 12 0 0 1 24 0Zm84-28a12 12 0 0 0-12 12v7.37c-4.21-4.67-8.58-9.31-13.29-14.08a100 100 0 1 0-2.07 143.44 12 12 0 0 0-16.48-17.46 76 76 0 1 1 1.53-109.06C187.61 80.2 193 86 198.23 92H184a12 12 0 0 0 0 24h40a12 12 0 0 0 12-12V64a12 12 0 0 0-12-12Z" />
                    </svg>
                    <span>{{ node.cronJobs.length === 1 ? node.cronJobs[0] : `${node.cronJobs.length} cron jobs` }}</span>
                  </div>
                </div>
              </foreignObject>
            </template>

            <foreignObject v-else :width="node.width" :height="node.height">
              <div class="topic-card">
                <p>{{ node.name }}</p>
              </div>
            </foreignObject>
          </g>

          <g v-for="edge in graph.edges || []" :key="`label-${edge.id}`" class="edge-label-group">
            <foreignObject
              v-if="edge.labels?.length"
              :x="edgeLabel(edge).x"
              :y="edgeLabel(edge).y"
              width="80"
              height="25"
              :class="['edge-label', { active: isLabelActive(edge) }]"
            >
              <div>
                <p>{{ edgeLabel(edge).text }}</p>
              </div>
            </foreignObject>
          </g>
        </g>
      </svg>

      <div v-else class="flow-empty">
        Add a service to your app and it will show up here
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow-shell {
  display: flex;
  min-height: calc(100vh - 124px);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  flex-direction: column;
}

.flow-header {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 66px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: #12161a;
}

.flow-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--muted);
  font-size: 14px;
}

.flow-breadcrumb button {
  border: 0;
  padding: 0;
  color: var(--muted);
  background: transparent;
}

.flow-breadcrumb strong {
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-search {
  position: relative;
  width: min(320px, 44vw);
}

.flow-search svg {
  position: absolute;
  top: 50%;
  left: 10px;
  width: 16px;
  height: 16px;
  fill: var(--muted);
  transform: translateY(-50%);
}

.flow-search input {
  width: 100%;
  height: 38px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 10px 0 34px;
  color: var(--text);
  background: rgba(255, 255, 255, 0.04);
}

.flow-results {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 280px;
  max-height: 340px;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: auto;
  background: var(--panel);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}

.flow-results button,
.flow-result-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  padding: 10px 12px;
  color: var(--text);
  background: transparent;
  text-align: left;
}

.flow-results button:hover {
  background: rgba(255, 255, 255, 0.06);
}

.flow-result-kind {
  min-width: 52px;
  color: var(--muted);
  font-size: 12px;
}

.flow-canvas {
  position: relative;
  flex: 1;
  min-height: 620px;
  overflow: hidden;
  background: #101214;
}

#flow-diagram {
  display: block;
  color: #ffffff;
  overflow: visible;
}

#flow-diagram .node,
#flow-diagram .edge,
#flow-diagram .edge-label {
  transition: opacity 160ms ease, transform 1s ease-in-out;
}

#flow-diagram .node:not(.active),
#flow-diagram .edge:not(.active),
#flow-diagram .edge-label:not(.active) {
  opacity: 0.1;
}

#flow-diagram .node {
  cursor: pointer;
}

#flow-diagram .node.fitting {
  transition: opacity 160ms ease;
}

.edge {
  fill: none;
  stroke: #ffffff;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.edge-underlay {
  stroke: #111111;
  stroke-width: 2.5;
}

.edge.message {
  stroke-dasharray: 5;
  animation: flow-dash 0.6s linear infinite;
}

@keyframes flow-dash {
  0% {
    stroke-dashoffset: 10;
  }
}

.service-glow {
  fill: #ffffff;
  opacity: 0;
  transition: opacity 120ms ease;
}

.node.service:hover .service-glow {
  opacity: 0.15;
}

.service-card {
  display: flex;
  width: 100%;
  height: 100%;
  border: 1px solid #ffffff;
  border-radius: 8px;
  padding: 8px;
  color: #ffffff;
  background: #111111;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.service-card h3,
.topic-card p {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 700;
  line-height: 1.2;
}

.service-card h3 {
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.service-row {
  display: grid;
  grid-template-columns: 18px repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 12px;
}

.service-row.compact {
  grid-template-columns: 18px minmax(0, 1fr);
}

.service-row svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}

.service-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-card {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  padding: 0 8px;
  color: #111111;
  background: #ffffff;
  overflow: hidden;
  text-align: center;
}

.topic-card p {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 14px;
}

.edge-label {
  pointer-events: none;
}

.edge-label div {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.edge-label p {
  display: inline-block;
  margin: 0;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 1px 4px;
  color: #111111;
  background: #ffffff;
  font-size: 12px;
  line-height: 1.3;
}

.flow-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 620px;
  color: var(--muted);
}

@media (max-width: 760px) {
  .flow-shell {
    min-height: 680px;
  }

  .flow-header {
    align-items: stretch;
    flex-direction: column;
  }

  .flow-search {
    width: 100%;
  }

  .flow-results {
    right: auto;
    left: 0;
    width: 100%;
  }
}
</style>
