<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type { ConfigResponse, ConfigVariable, LoadState, SamplingResponse } from "~/types/dashboard";

const props = defineProps<{
  appId: string;
  refreshNonce: number;
}>();

const client = useDashClient();
const state = ref<LoadState>("idle");
const error = ref("");
const config = ref<ConfigResponse>();
const sampling = ref<SamplingResponse>();
const redeploy = ref(true);
const values = reactive<Record<string, string>>({});
const saving = ref("");
const saveMessage = ref("");

const configRows = computed(() => [
  ...(config.value?.backendSecrets || []),
  ...(config.value?.frontendVariables || []),
]);

async function load() {
  saveMessage.value = "";
  if (!props.appId) {
    config.value = undefined;
    sampling.value = undefined;
    state.value = "ready";
    return;
  }
  state.value = "loading";
  error.value = "";
  try {
    const [configResponse, samplingResponse] = await Promise.all([
      client.dash.config({ app: props.appId }),
      client.dash.getSampling(),
    ]);
    config.value = configResponse;
    sampling.value = samplingResponse;
    for (const row of configRows.value) {
      values[rowKey(row)] = row.masked ? "" : row.value || "";
    }
    state.value = "ready";
  } catch (err: any) {
    error.value = err?.message || "Could not load settings.";
    state.value = "error";
  }
}

async function save(row: ConfigVariable) {
  const key = rowKey(row);
  saving.value = key;
  saveMessage.value = "";
  try {
    const response = await client.dash.updateConfigEndpoint({
      app: props.appId,
      kind: row.kind,
      name: row.name,
      value: values[key] || "",
      redeploy: redeploy.value,
    });
    saveMessage.value = response.message;
    await load();
  } catch (err: any) {
    saveMessage.value = err?.message || "Update failed.";
  } finally {
    saving.value = "";
  }
}

function rowKey(row: ConfigVariable) {
  return `${row.kind}:${row.name}`;
}

watch(() => [props.appId, props.refreshNonce], load);
onMounted(load);
</script>

<template>
  <section class="view-stack">
    <StatePanel
      :loading="state === 'loading'"
      :error="error"
      title="Settings unavailable"
      :empty="state === 'ready' && !props.appId"
      empty-text="Select an app before editing production configuration."
    >
      <div class="settings-grid">
        <section class="panel detail">
          <div class="panel-heading">
            <div>
              <h3>Telemetry Sampling</h3>
              <p>{{ sampling?.runtimeNote }}</p>
            </div>
          </div>
          <div class="kv-grid">
            <div v-for="rule in sampling?.rules || []" :key="`${rule.scopeType}:${rule.scopeValue}`">
              <dt>{{ rule.scopeType || "default" }}</dt>
              <dd>{{ Math.round(rule.rate * 10000) / 100 }}%</dd>
            </div>
          </div>
        </section>

        <section class="panel detail">
          <div class="panel-heading">
            <div>
              <h3>Komodo Access</h3>
              <p>{{ config?.runtimeNote }}</p>
            </div>
            <span class="pill" :class="{ public: config?.komodoConfigured }">
              {{ config?.komodoConfigured ? "configured" : "missing" }}
            </span>
          </div>
          <p v-if="!config?.komodoConfigured" class="notice">
            Run <code>pnpm komodo:setup</code> once so NECK Dash can store backend secrets as Komodo secret variables.
          </p>
        </section>
      </div>

      <section class="panel">
        <div class="panel-heading pad">
          <div>
            <h3>Runtime Variables</h3>
            <p>Backend secrets and public frontend variables are scoped to the selected app stack.</p>
          </div>
          <label class="toggle">
            <input v-model="redeploy" type="checkbox" />
            Redeploy after save
          </label>
        </div>

        <div class="config-list">
          <article v-for="row in configRows" :key="rowKey(row)" class="config-row">
            <div>
              <strong>{{ row.name }}</strong>
              <span>{{ row.description || row.source }}</span>
              <small>{{ row.source }} - {{ row.present ? "present" : "missing" }}</small>
            </div>
            <input
              v-model="values[rowKey(row)]"
              class="input"
              :type="row.masked ? 'password' : 'text'"
              :placeholder="row.masked ? 'new value' : ''"
              :disabled="!row.editable"
            />
            <button class="control-button" type="button" :disabled="!row.editable || saving === rowKey(row)" @click="save(row)">
              {{ saving === rowKey(row) ? "Saving" : "Save" }}
            </button>
          </article>
        </div>
        <p v-if="saveMessage" class="notice">{{ saveMessage }}</p>
      </section>
    </StatePanel>
  </section>
</template>
