import { signozOTLPLogsURL, stringValue } from "./config";
import type { OTLPAttribute, TraceEvent, TraceRequestMeta, SpanBuilder, LogField } from "./traceTypes";
import { boolAttr, doubleAttr, encoreTraceID, errorMessage, hexSpanID, hexTraceID, intAttr, stringAttr, unixNano } from "./traceUtil";

type StructuredLogEntry = Record<string, unknown>;

const logFieldNamePattern = /[^A-Za-z0-9_.-]+/g;

export function extractLogEntries(meta: TraceRequestMeta, events: TraceEvent[], builders: Map<string, SpanBuilder>) {
  const entries: StructuredLogEntry[] = [];
  for (const ev of events) {
    const message = ev.spanEvent?.logMessage;
    if (!message) continue;
    const spanID = hexSpanID(ev.spanID);
    const builder = builders.get(spanID);
    const entry: StructuredLogEntry = {
      timestamp: ev.eventTime.toISOString(),
      message: message.msg,
      level: logLevelName(message.level),
      trace_id: hexTraceID(ev.traceID),
      "encore.trace_id": encoreTraceID(ev.traceID),
      span_id: spanID,
      service: builder?.service || "unknown",
      endpoint: builder?.endpoint || "",
      app_id: meta.appID,
      env_id: meta.envID,
      deploy_id: meta.deployID,
      app_commit: meta.appCommit,
    };
    for (const field of message.fields) {
      entry[`field.${normalizeLogFieldName(field.key)}`] = logFieldValue(field);
    }
    if (message.stack) entry.stack = JSON.stringify(message.stack);
    entries.push(entry);
  }
  return entries;
}

export async function postOTLPLogs(entries: StructuredLogEntry[]) {
  if (entries.length === 0) return;
  const response = await fetch(signozOTLPLogsURL(), {
    method: "POST",
    body: JSON.stringify(toOTLPLogs(entries)),
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function toOTLPLogs(entries: StructuredLogEntry[]) {
  const groups = new Map<string, StructuredLogEntry[]>();
  for (const entry of entries) {
    const key = `${entry.app_id || ""}\x00${entry.env_id || ""}\x00${entry.service || "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return {
    resourceLogs: [...groups.values()].map((logs) => {
      const first = logs[0] ?? {};
      return {
        resource: {
          attributes: [
            stringAttr("service.name", stringValue(first.service, "unknown")),
            stringAttr("deployment.environment", stringValue(first.env_id, "production")),
            stringAttr("encore.app_id", stringValue(first.app_id)),
            stringAttr("encore.env_id", stringValue(first.env_id)),
            stringAttr("encore.deploy_id", stringValue(first.deploy_id)),
            stringAttr("encore.app_commit", stringValue(first.app_commit)),
          ],
        },
        scopeLogs: [{
          scope: { name: "neckdash.encore-adapter", version: "0.3.0" },
          logRecords: logs.map(toOTLPLogRecord),
        }],
      };
    }),
  };
}

function toOTLPLogRecord(entry: StructuredLogEntry) {
  const timestamp = new Date(stringValue(entry.timestamp));
  const attributes: OTLPAttribute[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (["timestamp", "message", "level", "trace_id", "span_id"].includes(key)) continue;
    attributes.push(logAttribute(key, value));
  }
  return {
    timeUnixNano: String(unixNano(Number.isFinite(timestamp.getTime()) ? timestamp : new Date())),
    severityText: stringValue(entry.level, "trace").toUpperCase(),
    severityNumber: otelSeverityNumber(stringValue(entry.level, "trace")),
    traceId: stringValue(entry.trace_id),
    spanId: stringValue(entry.span_id),
    body: { stringValue: stringValue(entry.message) },
    attributes,
  };
}

function logAttribute(key: string, value: unknown): OTLPAttribute {
  if (typeof value === "boolean") return boolAttr(key, value);
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? intAttr(key, value) : doubleAttr(key, value);
  return stringAttr(key, stringValue(value));
}

function otelSeverityNumber(level: string) {
  switch (level.toLowerCase()) {
    case "trace":
      return 1;
    case "debug":
      return 5;
    case "info":
      return 9;
    case "warn":
      return 13;
    case "error":
      return 17;
    default:
      return 1;
  }
}

function normalizeLogFieldName(key: string) {
  const normalized = key.replace(logFieldNamePattern, "_").replace(/^[_.-]+|[_.-]+$/g, "");
  return normalized || "unnamed";
}

function logFieldValue(field: LogField): unknown {
  if (field.error) return errorMessage(field.error);
  if (field.str !== undefined) return field.str;
  if (field.bool !== undefined) return field.bool;
  if (field.time) return field.time.toISOString();
  if (field.dur !== undefined) return `${field.dur}ns`;
  if (field.uuid) return field.uuid.toString("hex");
  if (field.json) return field.json.toString();
  if (field.int !== undefined) return field.int;
  if (field.uint !== undefined) return String(field.uint);
  if (field.float32 !== undefined) return field.float32;
  if (field.float64 !== undefined) return field.float64;
  return JSON.stringify(field);
}

function logLevelName(level: number) {
  switch (level) {
    case 0:
      return "debug";
    case 1:
      return "info";
    case 2:
      return "error";
    case 3:
      return "warn";
    case 4:
      return "trace";
    default:
      return "trace";
  }
}
