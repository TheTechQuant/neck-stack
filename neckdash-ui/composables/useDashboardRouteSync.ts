import type { Ref } from "vue";
import { watch } from "vue";
import { useRoute, useRouter } from "#app";
import type { TraceEvent } from "~/types/dashboard";

type DashboardTab = "Insights" | "Traces" | "Logs" | "Metrics" | "Flow" | "Catalog" | "Settings";
type InsightRange = "10m" | "1h" | "8h" | "24h" | "3d" | "7d";

type DashboardRouteState = {
  activeTab: Ref<DashboardTab>;
  allAppsID: string;
  insightRange: Ref<InsightRange>;
  insightRanges: readonly InsightRange[];
  search: Ref<string>;
  selectedAppID: Ref<string>;
  selectedEvent: Ref<TraceEvent | null>;
  selectedSpanID: Ref<string>;
  selectedTraceID: Ref<string>;
  service: Ref<string>;
  tabs: readonly DashboardTab[];
  traceHours: Ref<number>;
};

export function useDashboardRouteSync(state: DashboardRouteState) {
  const route = useRoute();
  const router = useRouter();
  let syncingFromRoute = false;

  function tabSlug(tab: DashboardTab) {
    return tab === "Insights" ? "" : tab.toLowerCase();
  }

  function tabFromSlug(slug: string): DashboardTab {
    const normalized = slug.toLowerCase();
    if (!normalized || normalized === "overview" || normalized === "insights") return "Insights";
    return state.tabs.find((tab) => tabSlug(tab) === normalized) ?? "Insights";
  }

  function decodeSegment(segment: string) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }

  function encodeSegment(segment: string) {
    return encodeURIComponent(segment).replace(/%2F/g, "%252F");
  }

  function firstQueryValue(value: unknown) {
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }

  function applyRouteToState() {
    syncingFromRoute = true;
    try {
      let segments = route.path.split("/").filter(Boolean).map(decodeSegment);
      let nextAppID = state.allAppsID;
      if (segments[0] === "apps" && segments[1]) {
        nextAppID = segments[1];
        segments = segments.slice(2);
      }

      const nextTab = tabFromSlug(segments[0] || "");
      state.activeTab.value = nextTab;
      state.selectedAppID.value = nextAppID;

      if (nextTab === "Traces") {
        state.selectedTraceID.value = segments[1] || "";
        state.selectedSpanID.value = segments[2] || "";
      } else {
        state.selectedTraceID.value = "";
        state.selectedSpanID.value = "";
        state.selectedEvent.value = null;
      }

      const routeHours = Number(firstQueryValue(route.query.hours));
      if (Number.isFinite(routeHours) && routeHours > 0) {
        state.traceHours.value = Math.min(Math.floor(routeHours), 168);
      }

      const routeRange = firstQueryValue(route.query.range);
      if (state.insightRanges.includes(routeRange as InsightRange)) {
        state.insightRange.value = routeRange as InsightRange;
      }

      state.search.value = firstQueryValue(route.query.search);
      state.service.value = firstQueryValue(route.query.service);
    } finally {
      syncingFromRoute = false;
    }
  }

  function dashboardPath() {
    const appPrefix = state.selectedAppID.value && state.selectedAppID.value !== state.allAppsID
      ? `/apps/${encodeSegment(state.selectedAppID.value)}`
      : "";
    const slug = tabSlug(state.activeTab.value);
    if (!slug) return appPrefix || "/";

    const parts = [appPrefix, `/${slug}`];
    if (state.activeTab.value === "Traces" && state.selectedTraceID.value) {
      parts.push(`/${encodeSegment(state.selectedTraceID.value)}`);
      if (state.selectedSpanID.value) parts.push(`/${encodeSegment(state.selectedSpanID.value)}`);
    }
    return parts.join("") || "/";
  }

  function dashboardQuery() {
    const query: Record<string, string> = {};
    if (state.activeTab.value === "Insights" && state.insightRange.value !== "24h") {
      query.range = state.insightRange.value;
    }
    if (state.activeTab.value === "Traces") {
      if (state.traceHours.value !== 1) query.hours = String(state.traceHours.value);
      if (state.service.value) query.service = state.service.value;
      if (state.search.value) query.search = state.search.value;
    }
    return query;
  }

  function sameQuery(left: Record<string, string>, right: typeof route.query) {
    const rightKeys = Object.keys(right).filter((key) => Boolean(firstQueryValue(right[key])));
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => firstQueryValue(right[key]) === left[key]);
  }

  function syncRouteFromState() {
    if (!import.meta.client || syncingFromRoute) return;
    const path = dashboardPath();
    const query = dashboardQuery();
    if (route.path === path && sameQuery(query, route.query)) return;
    void router.replace({ path, query });
  }

  if (import.meta.client) {
    watch(() => route.fullPath, applyRouteToState);
    watch([
      state.activeTab,
      state.selectedAppID,
      state.selectedTraceID,
      state.selectedSpanID,
      state.insightRange,
      state.traceHours,
      state.search,
      state.service,
    ], syncRouteFromState);
  }

  return {
    applyRouteToState,
    isSyncingFromRoute: () => syncingFromRoute,
  };
}
