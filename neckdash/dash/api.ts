import { api } from "encore.dev/api";
import { handlePrometheusRemoteWrite } from "./metrics";
import { handleTrace } from "./trace";
import type { HealthResponse } from "./types";

// Health reports whether NECK Dash is serving requests.
export const health = api(
  { expose: true, method: "GET", path: "/health" },
  async (): Promise<HealthResponse> => ({ ok: true }),
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
