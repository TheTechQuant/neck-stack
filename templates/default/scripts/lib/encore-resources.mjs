import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set(["node_modules", ".encore", "dist", "build", ".output", ".nuxt"]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        files.push(...await walk(path.join(dir, entry.name)));
      }
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function pushUnique(list, item, key) {
  if (!list.some((entry) => entry[key] === item[key])) {
    list.push(item);
  }
}

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

function parseApiDefinitions(filesByPath, root, source, relFile) {
  const apiVars = new Map();
  for (const match of source.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*api\s*\(\s*\{([\s\S]*?)\}\s*,/g)) {
    const opts = match[2];
    const pathMatch = opts.match(/path\s*:\s*["'`]([^"'`]+)["'`]/);
    const methodMatch = opts.match(/method\s*:\s*["'`]([^"'`]+)["'`]/);
    apiVars.set(match[1], {
      name: match[1],
      path: pathMatch?.[1] || `/${path.dirname(relFile)}.${match[1]}`,
      method: methodMatch?.[1] || "POST",
      service: relFile.split("/")[0],
      declaredIn: relFile,
    });
  }
  filesByPath.set(relFile, apiVars);
}

export async function discoverEncoreResources(backendDir = process.env.BACKEND_DIR || "backend") {
  const root = path.resolve(backendDir);
  try {
    return resourcesFromMetadata(await loadEncoreMetadata(root), root);
  } catch (error) {
    if (process.env.NECK_STRICT_ENCORE_METADATA === "1") {
      throw error;
    }
    console.warn(`Encore metadata unavailable, falling back to source scan: ${error instanceof Error ? error.message : error}`);
  }

  const files = await walk(root);
  const databases = [];
  const caches = [];
  const buckets = [];
  const topics = [];
  const crons = [];
  const secrets = [];
  const topicVars = new Map();
  const apiVarsByFile = new Map();
  const servicesByName = new Map();

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const relFile = slash(path.relative(root, file));
    const fileDir = path.dirname(file);
    parseApiDefinitions(apiVarsByFile, root, source, relFile);
    const serviceName = relFile.split("/")[0];
    if (!servicesByName.has(serviceName)) {
      servicesByName.set(serviceName, {
        name: serviceName,
        relPath: serviceName,
        endpoints: [],
        metrics: [],
        declaredIn: "source scan",
      });
    }

    for (const match of source.matchAll(/new\s+SQLDatabase\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
      const migrationsMatch = match[2].match(/migrations\s*:\s*["'`]([^"'`]+)["'`]/);
      const migrationPath = migrationsMatch ? migrationsMatch[1] : "./migrations";
      const resolvedMigrations = path.resolve(fileDir, migrationPath);
      pushUnique(databases, {
        name: match[1],
        migrations: slash(path.relative(root, resolvedMigrations)),
        declaredIn: relFile,
      }, "name");
    }

    for (const match of source.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Topic(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      topicVars.set(match[1], match[2]);
      pushUnique(topics, {
        name: match[2],
        variable: match[1],
        subscriptions: [],
        declaredIn: relFile,
      }, "name");
    }

    for (const match of source.matchAll(/new\s+CacheCluster\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      pushUnique(caches, { name: match[1], declaredIn: relFile }, "name");
    }

    for (const match of source.matchAll(/new\s+Bucket\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
      pushUnique(buckets, { name: match[1], declaredIn: relFile }, "name");
    }

    for (const match of source.matchAll(/new\s+CronJob\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
      const config = match[2];
      const endpointVar = config.match(/endpoint\s*:\s*([A-Za-z_$][\w$]*)/)?.[1];
      const apiInfo = endpointVar ? apiVarsByFile.get(relFile)?.get(endpointVar) : null;
      const title = config.match(/title\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] || match[1];
      const schedule = config.match(/schedule\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
      const every = config.match(/every\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];

      pushUnique(crons, {
        name: match[1],
        title,
        schedule: schedule ? `schedule:${schedule}` : `every:${every || ""}`,
        normalizedSchedule: schedule
          ? { kind: "schedule", value: schedule }
          : { kind: "every", value: every || "", minutes: durationToMinutes(every || "") },
        endpoint: apiInfo || {
          service: relFile.split("/")[0],
          name: endpointVar || match[1],
          path: endpointVar ? `/${relFile.split("/")[0]}.${endpointVar}` : `/${match[1]}`,
          method: "POST",
          exposed: false,
          allowUnauthenticated: false,
        },
        declaredIn: relFile,
      }, "name");
    }
  }

  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const relFile = slash(path.relative(root, file));

    for (const match of source.matchAll(/new\s+Subscription\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*["'`]([^"'`]+)["'`]/g)) {
      const topicName = topicVars.get(match[1]);
      if (!topicName) continue;
      const topic = topics.find((entry) => entry.name === topicName);
      if (!topic) continue;
      if (!topic.subscriptions.some((sub) => sub.name === match[2])) {
        topic.subscriptions.push({ name: match[2], declaredIn: relFile });
      }
    }
  }

  for (const apiVars of apiVarsByFile.values()) {
    for (const apiInfo of apiVars.values()) {
      const service = servicesByName.get(apiInfo.service);
      if (service && !service.endpoints.some((endpoint) => endpoint.name === apiInfo.name)) {
        service.endpoints.push({
          service: apiInfo.service,
          name: apiInfo.name,
          path: apiInfo.path,
          method: apiInfo.method,
          exposed: true,
          allowUnauthenticated: true,
          streamingRequest: false,
          streamingResponse: false,
          declaredIn: apiInfo.declaredIn,
        });
      }
    }
  }

  const services = [...servicesByName.values()]
    .filter((service) => service.endpoints.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    backendDir: root,
    source: "source-scan",
    metadata: {
      app_revision: "",
      svcs: services.map((service) => ({
        name: service.name,
        rel_path: service.relPath,
        rpcs: service.endpoints.map((endpoint) => ({
          name: endpoint.name,
          doc: "",
          service_name: service.name,
          http_methods: [endpoint.method],
          allow_unauthenticated: endpoint.allowUnauthenticated,
          expose: endpoint.exposed ? { "api-gateway": {} } : {},
          streaming_request: endpoint.streamingRequest,
          streaming_response: endpoint.streamingResponse,
        })),
        metrics: [],
      })),
      gateways: [{ encore_name: "api-gateway" }],
      pkgs: services.map((service) => ({ name: service.name, rel_path: service.relPath, secrets: [] })),
      pubsub_topics: topics,
      cache_clusters: caches,
      sql_databases: databases.map((database) => ({ name: database.name, migration_rel_path: database.migrations })),
      cron_jobs: crons,
      buckets,
      metrics: [],
    },
    services,
    databases,
    caches,
    buckets,
    topics,
    crons,
    secrets,
    metrics: [],
  };
}

function durationToMinutes(value) {
  const match = value.match(/^(\d+)(m|h)$/);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  return match[2] === "h" ? amount * 60 : amount;
}
