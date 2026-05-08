import path from "node:path";
import { execFileSync } from "node:child_process";

function pathToString(routePath) {
  if (!routePath?.segments?.length) return "/";

  return `/${routePath.segments.map((segment) => {
    switch (segment.type) {
      case "PARAM":
        return `:${segment.value}`;
      case "WILDCARD":
      case "FALLBACK":
        return `*${segment.value || "path"}`;
      case "LITERAL":
      default:
        return segment.value;
    }
  }).join("/")}`;
}

function normalizeMetadataSchedule(schedule) {
  if (schedule?.startsWith("schedule:")) {
    return {
      kind: "schedule",
      value: schedule.slice("schedule:".length),
    };
  }

  if (schedule?.startsWith("every:")) {
    return {
      kind: "every",
      minutes: Number(schedule.slice("every:".length)),
      value: schedule.slice("every:".length),
    };
  }

  return {
    kind: "schedule",
    value: schedule || "",
  };
}

function metadataEndpoint(meta, qualifiedName) {
  if (!qualifiedName) return null;

  for (const service of meta.svcs || []) {
    if (service.rel_path !== qualifiedName.pkg && service.name !== qualifiedName.pkg) continue;

    const rpc = (service.rpcs || []).find((entry) => entry.name === qualifiedName.name);
    if (!rpc) continue;

    return {
      service: service.name,
      name: rpc.name,
      path: pathToString(rpc.path),
      method: rpc.http_methods?.[0] || "POST",
      exposed: Boolean(rpc.expose && Object.keys(rpc.expose).length > 0),
      allowUnauthenticated: Boolean(rpc.allow_unauthenticated),
    };
  }

  return {
    service: qualifiedName.pkg,
    name: qualifiedName.name,
    path: `/${qualifiedName.pkg}.${qualifiedName.name}`,
    method: "POST",
    exposed: false,
    allowUnauthenticated: false,
  };
}

function resourcesFromMetadata(meta, backendDir) {
  const services = (meta.svcs || []).map((service) => ({
    name: service.name,
    relPath: service.rel_path || service.name,
    endpoints: (service.rpcs || []).map((rpc) => ({
      service: service.name,
      name: rpc.name,
      doc: rpc.doc || "",
      path: pathToString(rpc.path),
      method: rpc.http_methods?.[0] || "POST",
      exposed: Boolean(rpc.expose && Object.keys(rpc.expose).length > 0),
      allowUnauthenticated: Boolean(rpc.allow_unauthenticated),
      streamingRequest: Boolean(rpc.streaming_request),
      streamingResponse: Boolean(rpc.streaming_response),
    })),
    metrics: service.metrics || [],
    declaredIn: "encore metadata",
  }));

  const metricServices = new Map();
  for (const service of services) {
    for (const metric of service.metrics) {
      const list = metricServices.get(metric) || [];
      list.push(service.name);
      metricServices.set(metric, list);
    }
  }

  const metrics = (meta.metrics || []).map((metric) => ({
    name: metric.name,
    kind: String(metric.kind || "counter").toLowerCase(),
    doc: metric.doc || "",
    serviceName: metric.service_name || "",
    services: metric.service_name ? [metric.service_name] : (metricServices.get(metric.name) || []),
    labels: (metric.labels || []).map((label) => ({
      key: label.key,
      doc: label.doc || "",
    })),
    declaredIn: "encore metadata",
  }));

  const databases = (meta.sql_databases || []).map((database) => ({
    name: database.name,
    migrations: database.migration_rel_path || "",
    declaredIn: "encore metadata",
  }));

  const caches = (meta.cache_clusters || []).map((cache) => ({
    name: cache.name,
    evictionPolicy: cache.eviction_policy || "allkeys-lru",
    declaredIn: "encore metadata",
  }));

  const topics = (meta.pubsub_topics || []).map((topic) => ({
    name: topic.name,
    subscriptions: (topic.subscriptions || []).map((subscription) => ({
      name: subscription.name,
      service: subscription.service_name,
      declaredIn: "encore metadata",
    })),
    declaredIn: "encore metadata",
  }));

  const buckets = (meta.buckets || []).map((bucket) => ({
    name: bucket.name,
    public: Boolean(bucket.public),
    versioned: Boolean(bucket.versioned),
    declaredIn: "encore metadata",
  }));

  const secrets = [...new Set((meta.pkgs || []).flatMap((pkg) => pkg.secrets || []))].sort();

  const crons = (meta.cron_jobs || []).map((cron) => ({
    name: cron.id,
    title: cron.title || cron.id,
    schedule: cron.schedule,
    normalizedSchedule: normalizeMetadataSchedule(cron.schedule),
    endpoint: metadataEndpoint(meta, cron.endpoint),
    declaredIn: "encore metadata",
  }));

  return {
    backendDir,
    source: "encore-metadata",
    metadata: meta,
    services,
    databases,
    caches,
    buckets,
    topics,
    crons,
    secrets,
    metrics,
  };
}

async function loadEncoreMetadata(root) {
  const output = execFileSync("encore", ["debug", "meta", "-f", "json"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return JSON.parse(output);
}

export async function discoverEncoreResources(backendDir = process.env.BACKEND_DIR || "backend") {
  const root = path.resolve(backendDir);
  return resourcesFromMetadata(await loadEncoreMetadata(root), root);
}
