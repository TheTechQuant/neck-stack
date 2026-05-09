import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { env, signozOTLPTracesURL, stringValue, valueOr } from "./config";
import { extractLogEntries, postOTLPLogs } from "./logs";
import { parseEncoreEvents, parseTimeAnchor } from "./traceParser";
import type { OTLPAttribute, OTLPEvent, OTLPRequest, SpanBuilder, SpanEvent, TraceEvent, TraceRequestMeta } from "./traceTypes";
import {
  boolAttr,
  doubleAttr,
  errorMessage,
  firstSQLVerb,
  hexSpanID,
  hexTraceID,
  httpHost,
  httpPath,
  intAttr,
  status,
  stringAttr,
  syntheticSpanID,
  unixNano,
} from "./traceUtil";

export async function handleTrace(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }
  try {
    validateTraceAuth(req);
    const { meta, version, anchor } = parseTraceRequest(req);
    const events = parseEncoreEvents(await readBody(req), anchor, version);
    const { otlp, builders } = convertToOTLP(meta, events);
    await postOTLP(otlp);
    await postOTLPLogs(extractLogEntries(meta, events, builders));
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = message.includes("signature") || message.includes("auth") ? 401 : 400;
    res.writeHead(statusCode, { "content-type": "text/plain" });
    res.end(message);
  }
}

function parseTraceRequest(req: IncomingMessage) {
  const meta: TraceRequestMeta = {
    appID: header(req, "x-encore-app-id"),
    envID: header(req, "x-encore-env-id") || "production",
    deployID: header(req, "x-encore-deploy-id"),
    appCommit: header(req, "x-encore-app-commit"),
  };
  if (!meta.appID) throw new Error("missing X-Encore-App-ID");
  const version = Number(header(req, "x-encore-trace-version"));
  if (!Number.isFinite(version) || version <= 0) throw new Error("bad X-Encore-Trace-Version");
  return { meta, version, anchor: parseTimeAnchor(header(req, "x-encore-trace-timeanchor")) };
}

function validateTraceAuth(req: IncomingMessage) {
  if (env("NECKDASH_REQUIRE_TRACE_AUTH", "").toLowerCase() === "false") return;
  const key = traceAuthKeyForApp(header(req, "x-encore-app-id"));
  if (!key) throw new Error("trace auth key is not configured");
  const dateHeader = header(req, "date");
  const requestDate = Date.parse(dateHeader);
  if (!Number.isFinite(requestDate) || Math.abs(Date.now() - requestDate) > 15 * 60_000) {
    throw new Error("invalid Date header");
  }
  const authHeader = header(req, "x-neckdash-trace-auth") || header(req, "x-encore-auth");
  const raw = Buffer.from(authHeader, "base64url");
  if (raw.length < 4 + 32 || raw.readUInt32BE(0) !== 1) throw new Error("invalid X-Encore-Auth");
  const got = raw.subarray(4);
  for (const path of ["/trace", "/__neck_dash/api/trace"]) {
    const mac = crypto.createHmac("sha256", key).update(`${dateHeader}\x00${path}`).digest();
    if (crypto.timingSafeEqual(mac, got)) return;
  }
  throw new Error("invalid trace signature");
}

function traceAuthKeyForApp(appID: string) {
  for (const entry of env("NECKDASH_TRACE_AUTH_KEYS", "").split(/[,\n]/g)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const index = trimmed.includes("=") ? trimmed.indexOf("=") : trimmed.indexOf(":");
    if (index === -1) continue;
    if (trimmed.slice(0, index).trim() === appID.trim()) return trimmed.slice(index + 1).trim();
  }
  return "";
}

function convertToOTLP(meta: TraceRequestMeta, events: TraceEvent[]) {
  const builders = new Map<string, SpanBuilder>();
  for (const ev of events) {
    const spanID = hexSpanID(ev.spanID);
    let builder = builders.get(spanID);
    if (!builder) {
      builder = {
        traceID: hexTraceID(ev.traceID),
        spanID,
        parentSpanID: "",
        name: "",
        service: "",
        endpoint: "",
        topic: "",
        subscription: "",
        kind: 1,
        start: ev.eventTime,
        end: ev.eventTime,
        statusCode: 0,
        error: "",
        synthetic: false,
        attributes: [],
        events: [],
      };
      builders.set(spanID, builder);
    }
    if (ev.spanStart) {
      applySpanStart(builder, ev, meta);
    } else if (ev.spanEnd) {
      applySpanEnd(builder, ev);
    } else if (ev.spanEvent) {
      builder.events.push(convertSpanEvent(ev.spanEvent, ev.eventTime));
    }
  }

  const spans = [...builders.values(), ...buildSyntheticSpans(events, builders)].map((span) => {
    span.name ||= "encore.span";
    span.service ||= "unknown";
    if (span.end.getTime() <= span.start.getTime()) span.end = new Date(span.start.getTime() + 1);
    span.attributes.push(
      stringAttr("encore.app_id", meta.appID),
      stringAttr("encore.env_id", meta.envID),
      stringAttr("encore.deploy_id", meta.deployID),
      stringAttr("encore.app_commit", meta.appCommit),
    );
    return span;
  }).sort((a, b) => a.start.getTime() - b.start.getTime());

  const otlp: OTLPRequest = { resourceSpans: spans.map((span) => ({
    resource: {
      attributes: [
        stringAttr("service.name", span.service || "unknown"),
        stringAttr("encore.app_id", meta.appID),
        stringAttr("encore.env_id", meta.envID),
      ],
    },
    scopeSpans: [{
      scope: { name: "neckdash.encore-adapter", version: "0.2.0" },
      spans: [{
        traceId: span.traceID,
        spanId: span.spanID,
        parentSpanId: span.parentSpanID || undefined,
        name: span.name,
        kind: span.kind,
        startTimeUnixNano: String(unixNano(span.start)),
        endTimeUnixNano: String(unixNano(span.end)),
        attributes: span.attributes,
        events: span.events,
        status: status(span),
      }],
    }],
  })) };
  return { otlp, builders };
}

function applySpanStart(builder: SpanBuilder, ev: TraceEvent, meta: TraceRequestMeta) {
  const start = ev.spanStart!;
  builder.start = ev.eventTime;
  if (start.parentSpanID) builder.parentSpanID = hexSpanID(start.parentSpanID);
  if (start.request) {
    builder.service = start.request.serviceName;
    builder.endpoint = start.request.endpointName;
    builder.name = start.request.endpointName;
    builder.kind = 2;
    builder.attributes.push(
      stringAttr("http.request.method", start.request.httpMethod),
      stringAttr("url.path", start.request.path),
      stringAttr("encore.endpoint", start.request.endpointName),
    );
  } else if (start.auth) {
    builder.service = start.auth.serviceName;
    builder.endpoint = start.auth.endpointName;
    builder.name = `auth.${start.auth.endpointName}`;
    builder.kind = 2;
  } else if (start.pubsubMessage) {
    builder.service = start.pubsubMessage.serviceName;
    builder.topic = start.pubsubMessage.topicName;
    builder.subscription = start.pubsubMessage.subscriptionName;
    builder.name = `${start.pubsubMessage.topicName}/${start.pubsubMessage.subscriptionName}`;
    builder.kind = 5;
    builder.attributes.push(
      stringAttr("messaging.system", "nsq"),
      stringAttr("messaging.destination.name", start.pubsubMessage.topicName),
      stringAttr("messaging.operation.name", "process"),
    );
  } else if (start.test) {
    builder.service = start.test.serviceName;
    builder.name = start.test.testName;
  }
  builder.attributes.push(stringAttr("encore.app_id", meta.appID));
}

function applySpanEnd(builder: SpanBuilder, ev: TraceEvent) {
  const end = ev.spanEnd!;
  builder.end = ev.eventTime;
  builder.statusCode = end.statusCode;
  if (end.parentSpanID && !builder.parentSpanID) builder.parentSpanID = hexSpanID(end.parentSpanID);
  if (end.error) {
    builder.error = end.error.msg;
    builder.attributes.push(boolAttr("error", true), stringAttr("exception.message", end.error.msg));
  }
  if (end.request) {
    builder.service = valueOr(builder.service, end.request.serviceName);
    builder.endpoint = valueOr(builder.endpoint, end.request.endpointName);
    builder.attributes.push(intAttr("http.response.status_code", end.request.httpStatusCode));
  } else if (end.auth) {
    builder.service = valueOr(builder.service, end.auth.serviceName);
    builder.endpoint = valueOr(builder.endpoint, end.auth.endpointName);
  } else if (end.pubsubMessage) {
    builder.service = valueOr(builder.service, end.pubsubMessage.serviceName);
  }
  if (end.durationNanos > 0n) {
    builder.start = new Date(ev.eventTime.getTime() - Number(end.durationNanos) / 1_000_000);
  }
}

function buildSyntheticSpans(events: TraceEvent[], parents: Map<string, SpanBuilder>) {
  const open = new Map<string, SpanBuilder[]>();
  const out: SpanBuilder[] = [];
  for (let index = 0; index < events.length; index++) {
    const ev = events[index];
    if (!ev.spanEvent) continue;
    const parentID = hexSpanID(ev.spanID);
    const parent = parents.get(parentID);
    const started = syntheticStart(ev, parent, parentID, ev.spanEvent, index);
    if (started) {
      open.set(started.key, [...(open.get(started.key) ?? []), started.span]);
      continue;
    }
    const ended = syntheticEnd(parentID, ev.spanEvent);
    if (!ended) continue;
    const queue = open.get(ended.key) ?? [];
    const span = queue.shift();
    if (!span) continue;
    open.set(ended.key, queue);
    span.end = ev.eventTime;
    span.statusCode = ended.statusCode;
    span.attributes.push(...ended.attributes);
    if (ended.error) {
      span.error = ended.error;
      span.attributes.push(boolAttr("error", true), stringAttr("exception.message", ended.error));
    }
    if (span.end.getTime() <= span.start.getTime()) span.end = new Date(span.start.getTime() + 1);
    out.push(span);
  }
  for (const queue of open.values()) out.push(...queue);
  return out;
}

function syntheticStart(ev: TraceEvent, parent: SpanBuilder | undefined, parentID: string, spanEvent: SpanEvent, index: number) {
  const base = (name: string, key: string, kind: number): SpanBuilder => ({
    traceID: parent?.traceID || hexTraceID(ev.traceID),
    spanID: syntheticSpanID(parentID, index),
    parentSpanID: parentID,
    name,
    service: parent?.service || "unknown",
    endpoint: "",
    topic: "",
    subscription: "",
    kind,
    start: ev.eventTime,
    end: new Date(ev.eventTime.getTime() + 1),
    statusCode: 0,
    error: "",
    synthetic: true,
    attributes: [boolAttr("encore.synthetic", true), stringAttr("encore.synthetic.kind", key)],
    events: [],
  });
  if (spanEvent.rpcCallStart) {
    const target = spanEvent.rpcCallStart;
    const name = `${target.targetServiceName}.${target.targetEndpointName}`.replace(/^\.+|\.+$/g, "") || "encore.rpc";
    const span = base(name, "rpc", 3);
    span.endpoint = target.targetEndpointName;
    span.attributes.push(stringAttr("rpc.system", "encore"), stringAttr("rpc.service", target.targetServiceName), stringAttr("rpc.method", target.targetEndpointName), stringAttr("peer.service", target.targetServiceName));
    return { key: `${parentID}|rpc`, span };
  }
  if (spanEvent.dbQueryStart) {
    const verb = firstSQLVerb(spanEvent.dbQueryStart.query);
    const span = base(verb ? `SQL ${verb}` : "SQL query", "db.query", 3);
    span.attributes.push(stringAttr("db.system", "postgresql"), stringAttr("db.operation.name", verb), stringAttr("db.statement", spanEvent.dbQueryStart.query), stringAttr("peer.service", "postgres"));
    return { key: `${parentID}|db.query`, span };
  }
  if (spanEvent.dbTransactionStart) {
    const span = base("SQL transaction", "db.tx", 3);
    span.attributes.push(stringAttr("db.system", "postgresql"), stringAttr("peer.service", "postgres"));
    return { key: `${parentID}|db.tx`, span };
  }
  if (spanEvent.httpCallStart) {
    const call = spanEvent.httpCallStart;
    const span = base(`${call.method} ${httpPath(call.url)}`.trim() || "HTTP call", "http", 3);
    span.attributes.push(stringAttr("http.request.method", call.method), stringAttr("url.full", call.url), stringAttr("server.address", httpHost(call.url)));
    return { key: `${parentID}|http`, span };
  }
  if (spanEvent.pubsubPublishStart) {
    const span = base(`publish ${spanEvent.pubsubPublishStart.topic}`, "pubsub", 4);
    span.topic = spanEvent.pubsubPublishStart.topic;
    span.attributes.push(stringAttr("messaging.system", "nsq"), stringAttr("messaging.destination.name", span.topic), stringAttr("messaging.operation.name", "publish"), stringAttr("peer.service", span.topic));
    return { key: `${parentID}|pubsub`, span };
  }
  if (spanEvent.cacheCallStart) {
    const cache = spanEvent.cacheCallStart;
    const span = base(`cache.${cache.operation}`, "cache", 3);
    span.attributes.push(stringAttr("db.system", "redis"), stringAttr("db.operation.name", cache.operation), intAttr("db.redis.key_count", cache.keys.length), boolAttr("encore.cache.write", cache.write), stringAttr("peer.service", "redis"));
    return { key: `${parentID}|cache`, span };
  }
  return undefined;
}

function syntheticEnd(parentID: string, event: SpanEvent): { key: string; error: string; statusCode: number; attributes: OTLPAttribute[] } | undefined {
  if (event.rpcCallEnd) return { key: `${parentID}|rpc`, error: errorMessage(event.rpcCallEnd.err), statusCode: 0, attributes: [] };
  if (event.dbQueryEnd) return { key: `${parentID}|db.query`, error: errorMessage(event.dbQueryEnd.err), statusCode: 0, attributes: [] };
  if (event.dbTransactionEnd) return { key: `${parentID}|db.tx`, error: errorMessage(event.dbTransactionEnd.err), statusCode: 0, attributes: [stringAttr("db.transaction.completion", event.dbTransactionEnd.completion)] };
  if (event.httpCallEnd) {
    const code = event.httpCallEnd.statusCode || 0;
    const error = errorMessage(event.httpCallEnd.err) || (code >= 500 ? `HTTP ${code}` : "");
    return { key: `${parentID}|http`, error, statusCode: code, attributes: code > 0 ? [intAttr("http.response.status_code", code)] : [] };
  }
  if (event.pubsubPublishEnd) return { key: `${parentID}|pubsub`, error: errorMessage(event.pubsubPublishEnd.err), statusCode: 0, attributes: event.pubsubPublishEnd.messageId ? [stringAttr("messaging.message.id", event.pubsubPublishEnd.messageId)] : [] };
  if (event.cacheCallEnd) return { key: `${parentID}|cache`, error: errorMessage(event.cacheCallEnd.err), statusCode: 0, attributes: [stringAttr("encore.cache.result", event.cacheCallEnd.result)] };
  return undefined;
}

function convertSpanEvent(event: SpanEvent, t: Date): OTLPEvent {
  const out: OTLPEvent = { timeUnixNano: String(unixNano(t)), name: traceEventName(event), attributes: [] };
  if (event.logMessage) {
    out.attributes!.push(stringAttr("log.message", event.logMessage.msg), stringAttr("log.level", logLevelName(event.logMessage.level)));
    for (const field of event.logMessage.fields) {
      if (field.str !== undefined) out.attributes!.push(stringAttr(`log.field.${field.key}`, field.str));
      else if (field.bool !== undefined) out.attributes!.push(boolAttr(`log.field.${field.key}`, field.bool));
      else if (field.int !== undefined) out.attributes!.push(intAttr(`log.field.${field.key}`, field.int));
      else if (field.uint !== undefined) out.attributes!.push(stringAttr(`log.field.${field.key}`, String(field.uint)));
      else if (field.float64 !== undefined) out.attributes!.push(doubleAttr(`log.field.${field.key}`, field.float64));
      else if (field.float32 !== undefined) out.attributes!.push(doubleAttr(`log.field.${field.key}`, field.float32));
      else if (field.error) out.attributes!.push(stringAttr(`log.field.${field.key}`, field.error.msg));
    }
  } else {
    out.attributes!.push(stringAttr("encore.event_json", JSON.stringify(event)));
  }
  return out;
}

function traceEventName(event: SpanEvent) {
  if (event.logMessage) return "log";
  if (event.rpcCallStart) return "rpc.start";
  if (event.rpcCallEnd) return "rpc.end";
  if (event.dbQueryStart) return "db.query.start";
  if (event.dbQueryEnd) return "db.query.end";
  if (event.dbTransactionStart) return "db.transaction.start";
  if (event.dbTransactionEnd) return "db.transaction.end";
  if (event.pubsubPublishStart) return "pubsub.publish.start";
  if (event.pubsubPublishEnd) return "pubsub.publish.end";
  if (event.cacheCallStart) return "cache.start";
  if (event.cacheCallEnd) return "cache.end";
  if (event.httpCallStart) return "http.client.start";
  if (event.httpCallEnd) return "http.client.end";
  return "encore.event";
}

async function postOTLP(payload: OTLPRequest) {
  const response = await fetch(signozOTLPTracesURL(), {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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

function logLevelName(level: number) {
  return ["debug", "info", "error", "warn", "trace"][level] || "trace";
}
