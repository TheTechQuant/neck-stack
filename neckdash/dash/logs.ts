import type { IncomingMessage, ServerResponse } from "node:http";
import { stringValue, victoriaLogsInsertURL, victoriaLogsQueryURL, victoriaLogsTailURL } from "./config";
import type { LogEntry, LogListParams } from "./types";
import type { TraceEvent, TraceRequestMeta, SpanBuilder, LogField } from "./traceTypes";
import { errorMessage, hexSpanID, hexTraceID } from "./traceUtil";

type VictoriaLogEntry = Record<string, unknown>;

const logFieldNamePattern = /[^A-Za-z0-9_.-]+/g;

export async function listLogEntries(params: LogListParams) {
  const limit = normalizeLimit(params.limit, 200, 500);
  const query = buildLogQuery(params, false);
  const values = new URLSearchParams({ query, limit: String(limit) });
  const response = await fetch(victoriaLogsQueryURL(), {
    method: "POST",
    body: values,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (!response.ok) throw new Error(`VictoriaLogs query failed with HTTP ${response.status}`);
  const logs = decodeVictoriaLogRows(await response.text()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { query, logs };
}

export async function tailLogs(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const params: LogListParams = {
    app: url.searchParams.get("app") || "",
    query: url.searchParams.get("query") || "",
    service: url.searchParams.get("service") || "",
    level: url.searchParams.get("level") || "",
    traceId: url.searchParams.get("traceId") || "",
  };
  if (!hasLogFilter(params)) {
    res.writeHead(400);
    res.end("provide query, service, level, or traceId before live tailing logs");
    return;
  }

  const values = new URLSearchParams({ query: buildLogQuery(params, true) });
  for (const key of ["start_offset", "refresh_interval"]) {
    const value = url.searchParams.get(key);
    if (value) values.set(key, value);
  }
  const upstream = await fetch(victoriaLogsTailURL(), {
    method: "POST",
    body: values,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (!upstream.ok || !upstream.body) {
    res.writeHead(502);
    res.end(`VictoriaLogs tail failed with HTTP ${upstream.status}`);
    return;
  }
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  for await (const chunk of upstream.body as any) {
    res.write(chunk);
  }
  res.end();
}

export function extractLogEntries(meta: TraceRequestMeta, events: TraceEvent[], builders: Map<string, SpanBuilder>) {
  const entries: VictoriaLogEntry[] = [];
  for (const ev of events) {
    const message = ev.spanEvent?.logMessage;
    if (!message) continue;
    const spanID = hexSpanID(ev.spanID);
    const builder = builders.get(spanID);
    const entry: VictoriaLogEntry = {
      timestamp: ev.eventTime.toISOString(),
      message: message.msg,
      level: logLevelName(message.level),
      trace_id: hexTraceID(ev.traceID),
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

export async function postVictoriaLogs(entries: VictoriaLogEntry[]) {
  if (entries.length === 0) return;
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  const response = await fetch(victoriaLogsInsertURL(), {
    method: "POST",
    body,
    headers: { "content-type": "application/stream+json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function decodeVictoriaLogRows(text: string): LogEntry[] {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => victoriaRowToLogEntry(JSON.parse(line)));
}

function victoriaRowToLogEntry(row: Record<string, unknown>): LogEntry {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (["_time", "_msg", "_stream", "timestamp", "message", "level", "service", "endpoint", "trace_id", "span_id"].includes(key)) continue;
    fields[key] = stringValue(value);
  }
  return {
    timestamp: stringValue(row._time, stringValue(row.timestamp)),
    message: stringValue(row._msg, stringValue(row.message)),
    level: stringValue(row.level),
    service: stringValue(row.service),
    endpoint: stringValue(row.endpoint),
    traceId: stringValue(row.trace_id),
    spanId: stringValue(row.span_id),
    fields,
  };
}

export function buildLogQuery(params: LogListParams, tail: boolean) {
  const hours = normalizeLimit(params.hours, 1, 720);
  const parts: string[] = [];
  if (!tail) parts.push(`_time:${hours}h`);
  if (String(params.query || "").trim()) parts.push(quoteLogsQLString(String(params.query).trim()));
  if (String(params.service || "").trim()) parts.push(logsQLExact("service", String(params.service).trim()));
  if (String(params.level || "").trim()) parts.push(logsQLExact("level", String(params.level).trim().toLowerCase()));
  if (String(params.traceId || "").trim()) parts.push(logsQLExact("trace_id", String(params.traceId).trim()));
  if (String(params.app || "").trim()) parts.push(logsQLExact("app_id", String(params.app).trim()));
  return parts.length > 0 ? parts.join(" AND ") : "*";
}

function hasLogFilter(params: LogListParams) {
  return Boolean(params.app || params.query || params.service || params.level || params.traceId);
}

function logsQLExact(field: string, value: string) {
  return `${logsQLField(field)}:=${quoteLogsQLString(value)}`;
}

function logsQLField(field: string) {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(field) ? field : quoteLogsQLString(field);
}

function quoteLogsQLString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t")}"`;
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

function normalizeLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? Math.floor(parsed) : fallback;
}
