<script setup lang="ts">
import { Boxes, ExternalLink, FileText, GitBranch, LayoutDashboard, RefreshCw, Settings, ShieldCheck } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import type { DashApp, DashboardView } from "~/types/dashboard";
import { dashboardViews, routePath } from "~/utils/dashboard";

const client = useDashClient();
const dashRoute = useDashboardRoute();
const router = useRouter();
const config = useRuntimeConfig();

const apps = ref<DashApp[]>([]);
const appsError = ref("");
const appsLoading = ref(true);
const refreshNonce = ref(0);

const current = computed(() => dashRoute.state.value);
const selectedApp = computed(() => apps.value.find((app) => app.id === current.value.appId));
const selectedLabel = computed(() => selectedApp.value?.name || selectedApp.value?.id || "All apps");
const signozBaseUrl = computed(() => String(config.public.signozBaseUrl || "/__neck_dash/signoz").replace(/\/+$/g, ""));

const icons: Record<DashboardView, any> = {
  overview: LayoutDashboard,
  catalog: FileText,
  flow: GitBranch,
  settings: Settings,
};

async function loadApps() {
  appsLoading.value = true;
  appsError.value = "";
  try {
    const response = await client.dash.listApps();
    apps.value = response.apps;
  } catch (error: any) {
    appsError.value = error?.message || "Could not load apps.";
  } finally {
    appsLoading.value = false;
  }
}

function selectApp(appId: string) {
  void router.push({ path: routePath(appId, current.value.view), query: dashRoute.query.value });
}

function selectView(view: DashboardView) {
  void router.push({ path: routePath(current.value.appId, view), query: view === "overview" ? {} : dashRoute.query.value });
}

function refreshActive() {
  refreshNonce.value++;
}

function signozUrl(path = "") {
  return `${signozBaseUrl.value}${path.startsWith("/") ? path : `/${path}`}`;
}

onMounted(loadApps);
</script>

<template>
  <div class="dash-shell">
    <aside class="dash-sidebar">
      <div class="brand-block">
        <div class="brand-mark"><ShieldCheck :size="20" /></div>
        <div>
          <h1>NECK Dash</h1>
          <p>Encore control plane</p>
        </div>
      </div>

      <div class="sidebar-section">
        <span class="section-kicker">Application</span>
        <button class="app-select" :class="{ active: !current.appId }" type="button" @click="selectApp('')">
          <Boxes :size="16" />
          <span>All apps</span>
          <small>{{ apps.length }}</small>
        </button>
        <button
          v-for="app in apps"
          :key="app.id"
          class="app-select"
          :class="{ active: current.appId === app.id }"
          type="button"
          @click="selectApp(app.id)"
        >
          <Boxes :size="16" />
          <span>{{ app.name || app.id }}</span>
          <small>{{ app.hasOpenapi ? "docs" : "meta" }}</small>
        </button>
        <p v-if="appsLoading" class="sidebar-note">Discovering apps...</p>
        <p v-if="appsError" class="sidebar-error">{{ appsError }}</p>
      </div>

      <nav class="view-nav" aria-label="Dashboard sections">
        <button
          v-for="view in dashboardViews"
          :key="view.id"
          type="button"
          :class="{ active: current.view === view.id }"
          @click="selectView(view.id)"
        >
          <component :is="icons[view.id]" :size="16" />
          <span>{{ view.label }}</span>
        </button>
      </nav>
    </aside>

    <main class="dash-main">
      <header class="dash-topbar">
        <div>
          <p class="eyebrow">{{ selectedLabel }}</p>
          <h2>{{ dashboardViews.find((view) => view.id === current.view)?.label || "Overview" }}</h2>
          <p>{{ dashboardViews.find((view) => view.id === current.view)?.description }}</p>
        </div>
        <div class="topbar-actions">
          <a class="control-button primary" :href="signozUrl('/')" target="_blank" rel="noreferrer">
            <ExternalLink :size="16" />
            SigNoz
          </a>
          <button class="icon-button" type="button" title="Refresh" @click="refreshActive">
            <RefreshCw :size="17" />
          </button>
        </div>
      </header>

      <DashboardObservabilityView
        v-if="current.view === 'overview'"
        :app-id="current.appId"
        :apps="apps"
        :signoz-base-url="signozBaseUrl"
        :refresh-nonce="refreshNonce"
      />
      <DashboardCatalogView
        v-else-if="current.view === 'catalog'"
        :app-id="current.appId"
        :refresh-nonce="refreshNonce"
      />
      <DashboardFlowView
        v-else-if="current.view === 'flow'"
        :app-id="current.appId"
        :refresh-nonce="refreshNonce"
      />
      <DashboardSettingsView
        v-else
        :app-id="current.appId"
        :refresh-nonce="refreshNonce"
      />
    </main>
  </div>
</template>
