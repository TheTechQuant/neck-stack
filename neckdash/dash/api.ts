import { api } from "encore.dev/api";
import { buildCatalog } from "./catalog";
import { discoverApps, selectedCatalog } from "./apps";
import { readConfig, updateConfig } from "./configApi";
import { buildFlow } from "./flow";
import { handlePrometheusRemoteWrite } from "./metrics";
import { handleTrace } from "./trace";
import type {
  AppParams,
  AppsResponse,
  CatalogResponse,
  ConfigResponse,
  ConfigUpdateParams,
  ConfigUpdateResponse,
  FlowResponse,
  HealthResponse,
  SamplingResponse,
} from "./types";

// Health reports whether NECK Dash is serving requests.
export const health = api(
  { expose: true, method: "GET", path: "/health" },
  async (): Promise<HealthResponse> => ({ ok: true }),
);

// ListApps returns Encore apps discovered by the shared per-server dashboard.
export const listApps = api(
  { expose: true, method: "GET", path: "/apps" },
  async (): Promise<AppsResponse> => {
    const apps = discoverApps();
    return { apps, defaultApp: apps[0]?.id || "" };
  },
);

// Catalog returns generated Encore metadata and OpenAPI JSON mounted by the deployed app.
export const catalog = api(
  { expose: true, method: "GET", path: "/catalog" },
  async (params: AppParams): Promise<CatalogResponse> => {
    const catalog = selectedCatalog(String(params.app || ""));
    return {
      appId: catalog.app.id,
      metaJson: catalog.metaBytes.toString(),
      openapiJson: catalog.openAPIBytes.toString(),
      services: buildCatalog(catalog.metaBytes, catalog.openAPIBytes),
    };
  },
);

// Flow returns an Encore Flow-style dependency graph from generated metadata.
export const flow = api(
  { expose: true, method: "GET", path: "/flow" },
  async (params: AppParams): Promise<FlowResponse> => buildFlow(selectedCatalog(String(params.app || "")).metaBytes),
);

// GetSampling documents how sampling is applied for self-hosted deployments.
export const getSampling = api(
  { expose: true, method: "GET", path: "/settings/sampling" },
  async (): Promise<SamplingResponse> => {
    const parsed = Number(process.env.NECK_TRACE_SAMPLE_RATE || "1");
    const rate = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
    return {
      rules: [{ scopeType: "default", scopeValue: "", rate }],
      runtimeNote: "Sampling is enforced by the Encore runtime trace exporter. Change NECK_TRACE_SAMPLE_RATE, regenerate deployment config, rebuild the backend image, and redeploy.",
    };
  },
);

// Config returns the editable production configuration surface for one NECK app.
export const config = api(
  { expose: true, method: "GET", path: "/settings/config" },
  async (params: AppParams): Promise<ConfigResponse> => readConfig(String(params.app || "")),
);

// UpdateConfig updates one backend secret or frontend runtime variable through Komodo.
export const updateConfigEndpoint = api(
  { expose: true, sensitive: true, method: "POST", path: "/settings/config" },
  async (params: ConfigUpdateParams): Promise<ConfigUpdateResponse> => updateConfig(params),
);

// Trace receives Encore runtime trace streams and forwards them to SigNoz through OTLP.
export const trace = api.raw(
  { expose: true, method: "POST", path: "/trace" },
  handleTrace,
);

// TraceFromSingleDomain receives Encore trace streams through the single-domain Caddy route.
export const traceFromSingleDomain = api.raw(
  { expose: true, method: "POST", path: "/__neck_dash/api/trace" },
  handleTrace,
);

// PrometheusRemoteWrite receives internal Encore metrics and forwards them to SigNoz.
export const prometheusRemoteWrite = api.raw(
  { expose: true, method: "POST", path: "/metrics/write" },
  handlePrometheusRemoteWrite,
);
