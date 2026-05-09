import { computed } from "vue";
import { useRoute, useRouter } from "#app";
import type { DashboardView } from "~/types/dashboard";
import { parseDashboardRoute, routePath } from "~/utils/dashboard";

export function useDashboardRoute() {
  const route = useRoute();
  const router = useRouter();

  const state = computed(() => parseDashboardRoute(route.path));
  const query = computed(() => route.query);

  function firstQuery(name: string, fallback = "") {
    const value = route.query[name];
    return Array.isArray(value) ? String(value[0] ?? fallback) : String(value ?? fallback);
  }

  function pushView(view: DashboardView, extra: Record<string, string | number | undefined> = {}) {
    const nextQuery = compactQuery({ ...route.query, ...extra });
    return router.push({ path: routePath(state.value.appId, view), query: nextQuery });
  }

  function replaceQuery(next: Record<string, string | number | undefined>) {
    return router.replace({ path: route.path, query: compactQuery({ ...route.query, ...next }) });
  }

  return {
    firstQuery,
    pushView,
    query,
    replaceQuery,
    route,
    state,
  };
}

function compactQuery(query: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === "") continue;
    out[key] = String(raw);
  }
  return out;
}
