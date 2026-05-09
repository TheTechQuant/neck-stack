<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { CatalogEndpoint, CatalogService, LoadState } from "~/types/dashboard";

const props = defineProps<{
  appId: string;
  refreshNonce: number;
}>();

const client = useDashClient();
const state = ref<LoadState>("idle");
const error = ref("");
const services = ref<CatalogService[]>([]);
const selectedService = ref("");
const selectedEndpoint = ref("");

const activeService = computed(() => services.value.find((service) => service.name === selectedService.value) || services.value[0]);
const activeEndpoint = computed(() => activeService.value?.endpoints.find((endpoint) => endpoint.name === selectedEndpoint.value) || activeService.value?.endpoints[0]);

async function load() {
  if (!props.appId) {
    services.value = [];
    state.value = "ready";
    return;
  }
  state.value = "loading";
  error.value = "";
  try {
    const response = await client.dash.catalog({ app: props.appId });
    services.value = response.services;
    selectedService.value = response.services[0]?.name || "";
    selectedEndpoint.value = response.services[0]?.endpoints[0]?.name || "";
    state.value = "ready";
  } catch (err: any) {
    error.value = err?.message || "Could not load catalog.";
    state.value = "error";
  }
}

function endpointLabel(endpoint: CatalogEndpoint) {
  return `${endpoint.method} ${endpoint.path}`;
}

watch(() => [props.appId, props.refreshNonce], load);
onMounted(load);
</script>

<template>
  <section class="view-stack">
    <StatePanel
      :loading="state === 'loading'"
      :error="error"
      title="Catalog unavailable"
      :empty="state === 'ready' && !props.appId"
      empty-text="Select an app to view its generated Encore Service Catalog."
    >
      <div class="catalog-layout">
        <aside class="catalog-list">
          <button
            v-for="service in services"
            :key="service.name"
            type="button"
            :class="{ active: activeService?.name === service.name }"
            @click="selectedService = service.name; selectedEndpoint = service.endpoints[0]?.name || ''"
          >
            <strong>{{ service.name }}</strong>
            <span>{{ service.publicCount }} public / {{ service.privateCount }} private</span>
          </button>
        </aside>

        <article v-if="activeService" class="panel detail">
          <div class="panel-heading">
            <div>
              <h3>{{ activeService.name }}</h3>
              <p>{{ activeService.doc || "No service doc comment found." }}</p>
            </div>
            <span class="pill">{{ activeService.endpoints.length }} endpoints</span>
          </div>

          <div class="endpoint-tabs">
            <button
              v-for="endpoint in activeService.endpoints"
              :key="endpoint.name"
              type="button"
              :class="{ active: activeEndpoint?.name === endpoint.name }"
              @click="selectedEndpoint = endpoint.name"
            >
              <span>{{ endpoint.name }}</span>
              <small>{{ endpointLabel(endpoint) }}</small>
            </button>
          </div>

          <div v-if="activeEndpoint" class="endpoint-detail">
            <div class="endpoint-title">
              <div>
                <h4>{{ activeEndpoint.summary || activeEndpoint.name }}</h4>
                <p>{{ activeEndpoint.description || activeEndpoint.doc || "No endpoint doc comment found." }}</p>
              </div>
              <span class="pill" :class="activeEndpoint.access">{{ activeEndpoint.access }}</span>
            </div>

            <dl class="kv-grid">
              <div><dt>Route</dt><dd>{{ activeEndpoint.method }} {{ activeEndpoint.path }}</dd></div>
              <div><dt>Protocol</dt><dd>{{ activeEndpoint.streaming ? "streaming" : activeEndpoint.protocol }}</dd></div>
              <div><dt>Auth</dt><dd>{{ activeEndpoint.authRequired ? "required" : "not required" }}</dd></div>
              <div><dt>Exposure</dt><dd>{{ activeEndpoint.exposed ? "public" : "service-only" }}</dd></div>
            </dl>

            <div class="schema-grid">
              <section>
                <h5>Request</h5>
                <pre>{{ activeEndpoint.requestSchemaJson || "{}" }}</pre>
              </section>
              <section>
                <h5>Response</h5>
                <pre>{{ activeEndpoint.responseSchemaJson || "{}" }}</pre>
              </section>
            </div>
          </div>
        </article>
      </div>
    </StatePanel>
  </section>
</template>
