import type { DashboardView } from "~/types/dashboard";

export const dashboardViews: Array<{ id: DashboardView; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "SigNoz entrypoints and app status" },
  { id: "catalog", label: "Catalog", description: "Encore services, endpoints, schemas, and docs" },
  { id: "flow", label: "Flow", description: "Static Encore architecture graph from metadata" },
  { id: "settings", label: "Settings", description: "Secrets, frontend variables, and sampling" },
];

export function routePath(appId: string, view: DashboardView) {
  const appPrefix = appId ? `/apps/${encodeURIComponent(appId)}` : "";
  return view === "overview" ? appPrefix || "/" : `${appPrefix}/${view}`;
}

export function parseDashboardRoute(path: string) {
  let parts = path.split("/").filter(Boolean).map(safeDecode);
  let appId = "";
  if (parts[0] === "apps" && parts[1]) {
    appId = parts[1];
    parts = parts.slice(2);
  }
  return { appId, view: normalizeView(parts[0] || "overview") };
}

export function normalizeView(value: string): DashboardView {
  const normalized = value.toLowerCase();
  if (!normalized || normalized === "overview" || normalized === "observability") return "overview";
  return dashboardViews.some((view) => view.id === normalized) ? normalized as DashboardView : "overview";
}

export function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat().format(value);
}

export function truncateMiddle(value: string, size = 34) {
  if (value.length <= size) return value;
  const head = Math.ceil((size - 1) / 2);
  const tail = Math.floor((size - 1) / 2);
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`;
}
