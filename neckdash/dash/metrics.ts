import { createRequire } from "node:module";
import type { IncomingMessage, ServerResponse } from "node:http";
import protobuf from "protobufjs";
import { signozOTLPMetricsURL, stringValue } from "./config";
import type { OTLPAttribute } from "./traceTypes";
import { stringAttr } from "./traceUtil";

const require = createRequire(import.meta.url);
const snappy = require("snappyjs") as { uncompress(input: Uint8Array): Uint8Array };

const writeRequestType = protobuf.parse(`
syntax = "proto3";
package prometheus;

message WriteRequest {
  repeated TimeSeries timeseries = 1;
  repeated MetricMetadata metadata = 3;
}

message TimeSeries {
  repeated Label labels = 1;
  repeated Sample samples = 2;
}

message Label {
  string name = 1;
  string value = 2;
}

message Sample {
  double value = 1;
  int64 timestamp = 2;
}

message MetricMetadata {
  enum MetricType {
    UNKNOWN = 0;
    COUNTER = 1;
    GAUGE = 2;
    HISTOGRAM = 3;
    GAUGEHISTOGRAM = 4;
    SUMMARY = 5;
    INFO = 6;
    STATESET = 7;
  }
  MetricType type = 1;
  string metric_family_name = 2;
  string help = 4;
  string unit = 5;
}
`).root.lookupType("prometheus.WriteRequest");

type RemoteWriteRequest = {
  timeseries?: RemoteTimeSeries[];
  metadata?: RemoteMetricMetadata[];
};

type RemoteTimeSeries = {
  labels?: RemoteLabel[];
  samples?: RemoteSample[];
};

type RemoteLabel = {
  name?: string;
  value?: string;
};

type RemoteSample = {
  value?: number;
  timestamp?: string | number | { toString(): string; toNumber?(): number };
};

type RemoteMetricMetadata = {
  type?: string | number;
  metricFamilyName?: string;
  help?: string;
  unit?: string;
};

type OTLPMetric = {
  name: string;
  description?: string;
  unit?: string;
  gauge?: { dataPoints: OTLPDataPoint[] };
  sum?: { aggregationTemporality: number; isMonotonic: boolean; dataPoints: OTLPDataPoint[] };
};

type OTLPDataPoint = {
  attributes: OTLPAttribute[];
  timeUnixNano: string;
  asDouble: number;
};

const metricVersion = "0.1.0";

// PrometheusRemoteWrite receives Encore's Prometheus remote-write v1 metrics
// and forwards them to SigNoz as OTLP metrics.
export async function handlePrometheusRemoteWrite(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  try {
    validateRemoteWriteHeaders(req);
    const appID = remoteWriteAppID(req);
    const compressed = await readBody(req);
    const decoded = snappy.uncompress(compressed);
    const message = writeRequestType.decode(decoded);
    const request = writeRequestType.toObject(message, { longs: String, enums: String, defaults: false }) as RemoteWriteRequest;
    const otlp = convertRemoteWriteToOTLP(appID, request);
    await postOTLPMetrics(otlp);
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(400, { "content-type": "text/plain" });
    res.end(message);
  }
}

function validateRemoteWriteHeaders(req: IncomingMessage) {
  const version = header(req, "x-prometheus-remote-write-version");
  if (version !== metricVersion) throw new Error(`unsupported Prometheus remote-write version ${version || "<missing>"}`);
  const encoding = header(req, "content-encoding");
  if (encoding.toLowerCase() !== "snappy") throw new Error("Prometheus remote-write payload must be snappy encoded");
  const type = header(req, "content-type").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-protobuf") throw new Error("Prometheus remote-write payload must be application/x-protobuf");
}

function remoteWriteAppID(req: IncomingMessage) {
  const parsed = new URL(req.url || "/metrics/write", "http://neckdash.local");
  const app = parsed.searchParams.get("app");
  if (!app) throw new Error("missing app query parameter");
  return app;
}

function convertRemoteWriteToOTLP(appID: string, request: RemoteWriteRequest) {
  const metadata = metricMetadata(request.metadata ?? []);
  const metrics = new Map<string, OTLPMetric>();
  let serviceName = `${appID}-backend`;

  for (const series of request.timeseries ?? []) {
    const labels = series.labels ?? [];
    const name = labelValue(labels, "__name__");
    if (!name) continue;
    serviceName = labelValue(labels, "service") || labelValue(labels, "service_name") || labelValue(labels, "k_service") || serviceName;
    const meta = metadata.get(name) ?? metadata.get(name.replace(/_(total|count|sum)$/u, ""));
    const metric = ensureMetric(metrics, name, meta);
    const dataPoints = metric.gauge?.dataPoints ?? metric.sum?.dataPoints;
    if (!dataPoints) continue;

    for (const sample of series.samples ?? []) {
      if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) continue;
      dataPoints.push({
        attributes: dataPointAttributes(labels),
        timeUnixNano: String(BigInt(timestampMillis(sample.timestamp)) * 1_000_000n),
        asDouble: sample.value,
      });
    }
  }

  return {
    resourceMetrics: [{
      resource: {
        attributes: [
          stringAttr("service.name", serviceName),
          stringAttr("deployment.environment", "production"),
          stringAttr("encore.app_id", appID),
        ],
      },
      scopeMetrics: [{
        scope: { name: "neckdash.prometheus-remote-write", version: "0.1.0" },
        metrics: [...metrics.values()].filter((metric) => (metric.gauge?.dataPoints.length ?? metric.sum?.dataPoints.length ?? 0) > 0),
      }],
    }],
  };
}

function metricMetadata(values: RemoteMetricMetadata[]) {
  const out = new Map<string, RemoteMetricMetadata>();
  for (const value of values) {
    if (value.metricFamilyName) out.set(value.metricFamilyName, value);
  }
  return out;
}

function ensureMetric(metrics: Map<string, OTLPMetric>, name: string, metadata: RemoteMetricMetadata | undefined) {
  const existing = metrics.get(name);
  if (existing) return existing;

  const metric: OTLPMetric = {
    name,
    description: metadata?.help || undefined,
    unit: metadata?.unit || undefined,
  };
  if (isCounter(name, metadata?.type)) {
    metric.sum = { aggregationTemporality: 2, isMonotonic: true, dataPoints: [] };
  } else {
    metric.gauge = { dataPoints: [] };
  }
  metrics.set(name, metric);
  return metric;
}

function isCounter(name: string, type: string | number | undefined) {
  return type === "COUNTER" || type === 1 || /(_total|_count)$/u.test(name);
}

function dataPointAttributes(labels: RemoteLabel[]) {
  const attrs: OTLPAttribute[] = [];
  for (const label of labels) {
    const name = stringValue(label.name);
    if (!name || name === "__name__") continue;
    attrs.push(stringAttr(name, stringValue(label.value)));
  }
  return attrs;
}

function labelValue(labels: RemoteLabel[], name: string) {
  return stringValue(labels.find((label) => label.name === name)?.value);
}

function timestampMillis(value: RemoteSample["timestamp"]) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  if (value && typeof value === "object") {
    if (typeof value.toNumber === "function") return Math.trunc(value.toNumber());
    const parsed = Number(value.toString());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return Date.now();
}

async function postOTLPMetrics(payload: unknown) {
  const response = await fetch(signozOTLPMetricsURL(), {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
}

function header(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? stringValue(value[0]) : stringValue(value);
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
