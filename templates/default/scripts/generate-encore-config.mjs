#!/usr/bin/env zx
import { fs, path } from "zx";
import chalk from "chalk";
import { discoverEncoreResources } from "./lib/encore-resources.mjs";

const appId = "__APP_ID__";
const postgresUser = "__POSTGRES_USER__";
const defaultPostgresPassword = "__POSTGRES_PASSWORD_DEFAULT__";
const defaultRedisPassword = "__REDIS_PASSWORD_DEFAULT__";
const domain = process.env.DOMAIN || "__DOMAIN__";
const caddyAcmeEmail = process.env.CADDY_ACME_EMAIL || "__CADDY_ACME_EMAIL__";
const encoreDashboardDomain = process.env.ENCORE_DASHBOARD_DOMAIN || "__ENCORE_DASHBOARD_DOMAIN__";
const encoreDashboardUser = process.env.ENCORE_DASHBOARD_USER || "__ENCORE_DASHBOARD_USER__";
const encoreDashboardPasswordHash = process.env.ENCORE_DASHBOARD_PASSWORD_HASH || "__ENCORE_DASHBOARD_PASSWORD_HASH_DEFAULT__";
const encoreDashboardUrl = process.env.ENCORE_DASHBOARD_URL || "__ENCORE_DASHBOARD_URL__";
const neckDashDomain = process.env.NECK_DASH_DOMAIN || "__NECK_DASH_DOMAIN__";
const neckDashUser = process.env.NECK_DASH_USER || "__NECK_DASH_USER__";
const neckDashPasswordHash = process.env.NECK_DASH_PASSWORD_HASH || "__NECK_DASH_PASSWORD_HASH_DEFAULT__";
const defaultEncoreAuthKey = "__ENCORE_AUTH_KEY_DEFAULT__";
const registry = "__REGISTRY__";
const defaultNeckDashImage = "ghcr.io/thetechquant/neck-stack/neckdash:latest";
const defaultNeckDashUIImage = "ghcr.io/thetechquant/neck-stack/neckdash-ui:latest";
const defaultVictoriaTracesImage = "victoriametrics/victoria-traces:latest";
const defaultVictoriaMetricsImage = "victoriametrics/victoria-metrics:latest";
const defaultVictoriaLogsImage = "victoriametrics/victoria-logs:latest";
const prodPlatform = process.env.PROD_PLATFORM || "__PROD_PLATFORM__";
const komodoServer = "__KOMODO_SERVER__";
const gitProvider = "__GIT_PROVIDER__";
const gitAccount = "__GIT_ACCOUNT__";
const gitlabProject = "__GITLAB_PROJECT__";
const runDirectory = "__RUN_DIRECTORY__";

const resources = await discoverEncoreResources("backend");

function tomlString(value) {
  return JSON.stringify(value);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function composeEnv(name, fallback) {
  return "${" + `${name}:-${String(fallback).replaceAll("$", () => "$$")}` + "}";
}

function requiredComposeEnv(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Encore secret ${JSON.stringify(name)} cannot be used as a Compose environment variable name. Rename the secret to letters, numbers, or underscores.`);
  }
  return "${" + `${name}:?set ${name}` + "}";
}

function hasDatabases() {
  return resources.databases.length > 0;
}

function hasPostgres() {
  return hasDatabases();
}

function hasCache() {
  return resources.caches.length > 0;
}

function hasPubSub() {
  return resources.topics.length > 0;
}

function hasCrons() {
  return resources.crons.length > 0;
}

function renderInfraConfig() {
  const config = {
    $schema: "https://encore.dev/schemas/infra.schema.json",
    metadata: {
      app_id: appId,
      env_name: "production",
      env_type: "production",
      cloud: "local",
      base_url: `https://${domain}/api`,
    },
    graceful_shutdown: {
      total: 30,
    },
    metrics: {
      type: "prometheus",
      collection_interval: 15,
      remote_write_url: { $env: "VICTORIA_METRICS_REMOTE_WRITE_URL" },
    },
    used_metrics: resources.metrics.map((metric) => ({
      name: metric.name,
      services: metric.services,
    })),
  };

  if (resources.secrets.length > 0) {
    config.secrets = Object.fromEntries(resources.secrets.map((secret) => [
      secret,
      { $env: secret },
    ]));
  }

  if (hasDatabases()) {
    config.sql_servers = [
      {
        host: process.env.POSTGRES_HOST || "postgres:5432",
        tls_config: {
          disabled: true,
        },
        databases: Object.fromEntries(resources.databases.map((database) => [
          database.name,
          {
            username: postgresUser,
            password: { $env: "POSTGRES_PASSWORD" },
            max_connections: 30,
            min_connections: 1,
          },
        ])),
      },
    ];
  }

  if (hasCache()) {
    config.redis = Object.fromEntries(resources.caches.map((cache, index) => [
      cache.name,
      {
        host: process.env.REDIS_HOST || "redis:6379",
        database_index: index,
        auth: {
          type: "auth_string",
          auth_string: { $env: "REDIS_PASSWORD" },
        },
        key_prefix: `${appId}:${cache.name}:`,
      },
    ]));
  }

  if (hasPubSub()) {
    config.pubsub = [
      {
        type: "nsq",
        hosts: process.env.NSQ_HOSTS || "nsqd:4150",
        topics: Object.fromEntries(resources.topics.map((topic) => [
          topic.name,
          {
            name: `${appId}-${topic.name}`,
            subscriptions: Object.fromEntries(topic.subscriptions.map((subscription) => [
              subscription.name,
              { name: `${appId}-${subscription.name}` },
            ])),
          },
        ])),
      },
    ];
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

function backendEnvironment() {
  const env = [
    "      PORT: 8080",
    `      ENCORE_AUTH_KEY: ${composeEnv("ENCORE_AUTH_KEY", defaultEncoreAuthKey)}`,
    "      VICTORIA_METRICS_REMOTE_WRITE_URL: ${VICTORIA_METRICS_REMOTE_WRITE_URL:-http://victoria-metrics:8428/api/v1/write}",
  ];

  if (hasDatabases()) {
    env.push(`      POSTGRES_PASSWORD: ${composeEnv("POSTGRES_PASSWORD", defaultPostgresPassword)}`);
  }
  if (hasCache()) {
    env.push(`      REDIS_PASSWORD: ${composeEnv("REDIS_PASSWORD", defaultRedisPassword)}`);
  }
  for (const secret of resources.secrets) {
    env.push(`      ${secret}: ${requiredComposeEnv(secret)}`);
  }

  return env.join("\n");
}

function backendDependsOn() {
  const deps = [
    `      neckdash:\n        condition: service_started`,
    `      victoria-metrics:\n        condition: service_started`,
  ];
  if (hasDatabases()) {
    deps.push(`      postgres:\n        condition: service_healthy`);
  }
  if (hasCache()) {
    deps.push(`      redis:\n        condition: service_healthy`);
  }
  if (hasPubSub()) {
    deps.push(`      nsqd:\n        condition: service_started`);
  }
  if (deps.length === 0) return "";

  return `\n    depends_on:\n${deps.join("\n")}`;
}

function renderCompose() {
  const services = [
`  caddy:
    image: caddy:2.10-alpine
    restart: unless-stopped
    environment:
      DOMAIN: \${DOMAIN:-${domain}}
      CADDY_ACME_EMAIL: \${CADDY_ACME_EMAIL:-${caddyAcmeEmail}}
      ENCORE_DASHBOARD_DOMAIN: \${ENCORE_DASHBOARD_DOMAIN:-${encoreDashboardDomain}}
      ENCORE_DASHBOARD_USER: \${ENCORE_DASHBOARD_USER:-${encoreDashboardUser}}
      ENCORE_DASHBOARD_PASSWORD_HASH: ${composeEnv("ENCORE_DASHBOARD_PASSWORD_HASH", encoreDashboardPasswordHash)}
      ENCORE_DASHBOARD_URL: \${ENCORE_DASHBOARD_URL:-${encoreDashboardUrl}}
      NECK_DASH_DOMAIN: \${NECK_DASH_DOMAIN:-${neckDashDomain}}
      NECK_DASH_USER: \${NECK_DASH_USER:-${neckDashUser}}
      NECK_DASH_PASSWORD_HASH: ${composeEnv("NECK_DASH_PASSWORD_HASH", neckDashPasswordHash)}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      frontend:
        condition: service_started
      backend:
        condition: service_started
      neckdash-ui:
        condition: service_started`,
`  frontend:
    image: \${FRONTEND_IMAGE:-${registry}/frontend:prod}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_API_BASE_URL: ${composeEnv("NUXT_PUBLIC_API_BASE_URL", "/api")}
      NUXT_API_INTERNAL_BASE_URL: \${NUXT_API_INTERNAL_BASE_URL:-http://backend:8080}
      NUXT_PUBLIC_ENCORE_TOOLBAR: \${NUXT_PUBLIC_ENCORE_TOOLBAR:-true}
      NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME: \${NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME:-production}
      PORT: 3000
      HOST: 0.0.0.0
    expose:
      - "3000"
    depends_on:
      backend:
        condition: service_started`,
`  backend:
    image: \${BACKEND_IMAGE:-${registry}/backend:prod}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
${backendEnvironment()}
    expose:
      - "8080"${backendDependsOn()}
    healthcheck:
      test: ["CMD-SHELL", "node -e \\"fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\\""]
      interval: 15s
      timeout: 5s
      retries: 8`,
`  neckdash:
    image: \${NECKDASH_IMAGE:-${defaultNeckDashImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      PORT: 8080
      ENCORE_AUTH_KEY: ${composeEnv("ENCORE_AUTH_KEY", defaultEncoreAuthKey)}
      NECKDASH_REQUIRE_TRACE_AUTH: \${NECKDASH_REQUIRE_TRACE_AUTH:-true}
      NECKDASH_TRACE_SERVICE_FANOUT_LIMIT: \${NECKDASH_TRACE_SERVICE_FANOUT_LIMIT:-32}
      VICTORIA_TRACES_OTLP_URL: \${VICTORIA_TRACES_OTLP_URL:-http://victoria-traces:10428/insert/opentelemetry/v1/traces}
      VICTORIA_TRACES_QUERY_URL: \${VICTORIA_TRACES_QUERY_URL:-http://victoria-traces:10428/select/jaeger}
      VICTORIA_METRICS_QUERY_URL: \${VICTORIA_METRICS_QUERY_URL:-http://victoria-metrics:8428/api/v1/query}
      VICTORIA_LOGS_INSERT_URL: \${VICTORIA_LOGS_INSERT_URL:-http://victoria-logs:9428/insert/jsonline?_stream_fields=app_id,env_id,service,level&_time_field=timestamp&_msg_field=message}
      VICTORIA_LOGS_QUERY_URL: \${VICTORIA_LOGS_QUERY_URL:-http://victoria-logs:9428/select/logsql/query}
      NECKDASH_META_PATH: /catalog/meta.json
      NECKDASH_OPENAPI_PATH: /catalog/openapi.json
    expose:
      - "8080"
    volumes:
      - ./encore/meta.json:/catalog/meta.json:ro
      - ../docs/openapi.json:/catalog/openapi.json:ro
    depends_on:
      victoria-traces:
        condition: service_started
      victoria-metrics:
        condition: service_started
      victoria-logs:
        condition: service_started`,
`  neckdash-ui:
    image: \${NECKDASH_UI_IMAGE:-${defaultNeckDashUIImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_NECKDASH_API_BASE_URL: \${NUXT_PUBLIC_NECKDASH_API_BASE_URL:-/api}
      NUXT_NECKDASH_API_INTERNAL_BASE_URL: \${NUXT_NECKDASH_API_INTERNAL_BASE_URL:-http://neckdash:8080}
      PORT: 3000
      HOST: 0.0.0.0
    expose:
      - "3000"
    depends_on:
      neckdash:
        condition: service_started`,
`  victoria-traces:
    image: \${VICTORIA_TRACES_IMAGE:-${defaultVictoriaTracesImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    command:
      - -httpListenAddr=:10428
      - -storageDataPath=/victoria-traces-data
      - -retentionPeriod=\${VICTORIA_TRACES_RETENTION:-30d}
      - -servicegraph.enableTask=true
    volumes:
      - victoria_traces_data:/victoria-traces-data
    expose:
      - "10428"`,
`  victoria-metrics:
    image: \${VICTORIA_METRICS_IMAGE:-${defaultVictoriaMetricsImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    command:
      - -httpListenAddr=:8428
      - -storageDataPath=/victoria-metrics-data
      - -retentionPeriod=\${VICTORIA_METRICS_RETENTION:-90d}
    volumes:
      - victoria_metrics_data:/victoria-metrics-data
    expose:
      - "8428"`,
`  victoria-logs:
    image: \${VICTORIA_LOGS_IMAGE:-${defaultVictoriaLogsImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    command:
      - -httpListenAddr=:9428
      - -storageDataPath=/victoria-logs-data
      - -retentionPeriod=\${VICTORIA_LOGS_RETENTION:-30d}
    volumes:
      - victoria_logs_data:/victoria-logs-data
    expose:
      - "9428"`,
  ];

  if (hasPostgres()) {
    const postgresPassword = composeEnv("POSTGRES_PASSWORD", defaultPostgresPassword);
    services.push(
`  migrations:
    image: \${MIGRATIONS_IMAGE:-${registry}/migrations:prod}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    profiles:
      - migrate
    environment:
      DATABASE_URL: postgres://\${POSTGRES_USER:-${postgresUser}}:${postgresPassword}@postgres:5432/postgres?sslmode=disable
    depends_on:
      postgres:
        condition: service_healthy`,
`  postgres:
    image: encoredotdev/postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-${postgresUser}}
      POSTGRES_PASSWORD: ${postgresPassword}
      POSTGRES_DB: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-${postgresUser}} -d postgres"]
      interval: 10s
      timeout: 5s
      retries: 10`);
  }

  if (hasCache()) {
    const redisPassword = composeEnv("REDIS_PASSWORD", defaultRedisPassword);
    services.push(
`  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${redisPassword}", "--appendonly", "yes"]
    environment:
      REDIS_PASSWORD: ${redisPassword}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \\"$\${REDIS_PASSWORD}\\" ping | grep PONG"]
      interval: 10s
      timeout: 5s
      retries: 10`);
  }

  if (hasPubSub()) {
    services.push(
`  nsqlookupd:
    image: nsqio/nsq:v1.2.1
    restart: unless-stopped
    command: /nsqlookupd
    expose:
      - "4160"
      - "4161"`,
`  nsqd:
    image: nsqio/nsq:v1.2.1
    restart: unless-stopped
    command: /nsqd --lookupd-tcp-address=nsqlookupd:4160 --data-path=/data
    volumes:
      - nsq_data:/data
    depends_on:
      nsqlookupd:
        condition: service_started
    expose:
      - "4150"
      - "4151"`,
`  nsqadmin:
    image: nsqio/nsq:v1.2.1
    restart: unless-stopped
    command: /nsqadmin --lookupd-http-address=nsqlookupd:4161
    profiles:
      - tools
    ports:
      - "127.0.0.1:4171:4171"
    depends_on:
      nsqlookupd:
        condition: service_started`);
  }

  if (hasCrons()) {
    services.push(
`  cron-runner:
    image: curlimages/curl:8.16.0
    profiles:
      - cron
    entrypoint: ["/bin/sh", "-ec"]
    depends_on:
      backend:
        condition: service_healthy`);
  }

  const volumes = ["  caddy_data:", "  caddy_config:", "  victoria_traces_data:", "  victoria_metrics_data:", "  victoria_logs_data:"];
  if (hasPostgres()) volumes.push("  postgres_data:");
  if (hasCache()) volumes.push("  redis_data:");
  if (hasPubSub()) volumes.push("  nsq_data:");

  return `# Generated by scripts/generate-encore-config.mjs from Encore metadata.\nname: \${COMPOSE_PROJECT_NAME:-${appId}}\n\nservices:\n${services.join("\n\n")}\n\nvolumes:\n${volumes.join("\n")}\n`;
}

function komodoEnvLines() {
  const lines = [
    "APP_ENV = production",
    `DOMAIN = ${domain}`,
    `CADDY_ACME_EMAIL = ${caddyAcmeEmail}`,
    `ENCORE_DASHBOARD_DOMAIN = ${encoreDashboardDomain}`,
    `ENCORE_DASHBOARD_USER = ${encoreDashboardUser}`,
    `ENCORE_DASHBOARD_PASSWORD_HASH = ${encoreDashboardPasswordHash}`,
    `ENCORE_DASHBOARD_URL = ${encoreDashboardUrl}`,
    `NECK_DASH_DOMAIN = ${neckDashDomain}`,
    `NECK_DASH_USER = ${neckDashUser}`,
    `NECK_DASH_PASSWORD_HASH = ${neckDashPasswordHash}`,
    `ENCORE_AUTH_KEY = ${defaultEncoreAuthKey}`,
    "NECKDASH_REQUIRE_TRACE_AUTH = true",
    "NECKDASH_TRACE_SERVICE_FANOUT_LIMIT = 32",
    "NUXT_PUBLIC_ENCORE_TOOLBAR = true",
    "NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME = production",
    "NUXT_PUBLIC_API_BASE_URL = /api",
    "NUXT_API_INTERNAL_BASE_URL = http://backend:8080",
    "NUXT_PUBLIC_NECKDASH_API_BASE_URL = /api",
    "NUXT_NECKDASH_API_INTERNAL_BASE_URL = http://neckdash:8080",
    "VICTORIA_TRACES_OTLP_URL = http://victoria-traces:10428/insert/opentelemetry/v1/traces",
    "VICTORIA_TRACES_QUERY_URL = http://victoria-traces:10428/select/jaeger",
    "VICTORIA_TRACES_RETENTION = 30d",
    "VICTORIA_METRICS_QUERY_URL = http://victoria-metrics:8428/api/v1/query",
    "VICTORIA_METRICS_REMOTE_WRITE_URL = http://victoria-metrics:8428/api/v1/write",
    "VICTORIA_METRICS_RETENTION = 90d",
    "VICTORIA_LOGS_INSERT_URL = http://victoria-logs:9428/insert/jsonline?_stream_fields=app_id,env_id,service,level&_time_field=timestamp&_msg_field=message",
    "VICTORIA_LOGS_QUERY_URL = http://victoria-logs:9428/select/logsql/query",
    "VICTORIA_LOGS_RETENTION = 30d",
    `PROD_PLATFORM = ${prodPlatform}`,
    "",
  ];

  if (hasPostgres()) {
    lines.push(`POSTGRES_USER = ${postgresUser}`);
  }
  for (const secret of resources.secrets) {
    lines.push(`${secret} = [[${secret}]]`);
  }
  if (hasPostgres() || hasCache() || resources.secrets.length > 0) {
    lines.push("");
  }

  lines.push(`BACKEND_IMAGE = ${registry}/backend:prod`);
  lines.push(`FRONTEND_IMAGE = ${registry}/frontend:prod`);
  lines.push(`NECKDASH_IMAGE = ${defaultNeckDashImage}`);
  lines.push(`NECKDASH_UI_IMAGE = ${defaultNeckDashUIImage}`);
  lines.push(`VICTORIA_TRACES_IMAGE = ${defaultVictoriaTracesImage}`);
  lines.push(`VICTORIA_METRICS_IMAGE = ${defaultVictoriaMetricsImage}`);
  lines.push(`VICTORIA_LOGS_IMAGE = ${defaultVictoriaLogsImage}`);
  if (hasPostgres()) {
    lines.push(`MIGRATIONS_IMAGE = ${registry}/migrations:prod`);
  }

  return lines.join("\n");
}

function komodoSchedule(cron) {
  const schedule = cron.normalizedSchedule || {};
  if (schedule.kind === "every") {
    const minutes = Number(schedule.minutes || schedule.value);
    return {
      format: "English",
      value: Number.isFinite(minutes) && minutes > 0
        ? `Every ${minutes} minute${minutes === 1 ? "" : "s"}`
        : `Every ${schedule.value}`,
    };
  }

  const fields = String(schedule.value || cron.schedule || "").replace(/^schedule:/, "").trim().split(/\s+/);
  if (fields.length === 5) {
    return {
      format: "Cron",
      value: `0 ${fields.join(" ")}`,
    };
  }

  return {
    format: "Cron",
    value: String(schedule.value || cron.schedule || ""),
  };
}

function renderCronAction(cron) {
  const endpoint = cron.endpoint || {};
  const method = endpoint.method || "POST";
  const targetPath = endpoint.path || `/${endpoint.service}.${endpoint.name}`;
  const schedule = komodoSchedule(cron);
  const curl = [
    "curl -fsS",
    `-X ${method}`,
    `-H ${shellQuote("X-Encore-Cron-Trigger: scheduled")}`,
    `-H ${shellQuote(`X-Encore-Cron-Execution: ${cron.name}-$(date -u +%Y%m%dT%H%M%SZ)`)}`,
    shellQuote(`http://backend:8080${targetPath}`),
  ].join(" ");
  const command = `cd ${runDirectory} && docker compose -f deploy/compose.yaml run --rm cron-runner ${shellQuote(curl)}`;

  const fileContents = `const command = ${JSON.stringify(command)};\nlet exitCode = 0;\n\nawait komodo.execute_server_terminal({\n  server: ${JSON.stringify(komodoServer)},\n  command,\n  init: { command: \"bash\" },\n}, {\n  onLine: (line) => console.log(line),\n  onFinish: (code) => { exitCode = code; },\n});\n\nif (exitCode !== 0) {\n  throw new Error(${JSON.stringify(`Encore cron ${cron.name} failed with exit code `)} + exitCode);\n}\n`;

  return `
[[action]]
name = ${tomlString(`${appId}-cron-${cron.name}`)}
description = ${tomlString(`Calls Encore CronJob ${cron.name} (${method} ${targetPath})`)}
tags = ["neck", "cron", ${tomlString(appId)}]

[action.config]
schedule_format = ${tomlString(schedule.format)}
schedule = ${tomlString(schedule.value)}
schedule_enabled = true
schedule_timezone = "UTC"
schedule_alert = true
failure_alert = true
file_contents = '''${fileContents}'''`;
}

function renderMigrationAction() {
  const command = `cd ${runDirectory} && docker compose -f deploy/compose.yaml pull migrations && docker compose -f deploy/compose.yaml run --rm migrations`;
  const fileContents = `const command = ${JSON.stringify(command)};\nlet exitCode = 0;\n\nawait komodo.execute_server_terminal({\n  server: ${JSON.stringify(komodoServer)},\n  command,\n  init: { command: \"bash\" },\n}, {\n  onLine: (line) => console.log(line),\n  onFinish: (code) => { exitCode = code; },\n});\n\nif (exitCode !== 0) {\n  throw new Error(${JSON.stringify("Encore migrations failed with exit code ")} + exitCode);\n}\n`;

  return `
[[action]]
name = ${tomlString(`${appId}-migrate`)}
description = ${tomlString("Runs Encore SQL migrations with golang-migrate before deploying the stack")}
tags = ["neck", "migrations", ${tomlString(appId)}]

[action.config]
schedule_enabled = false
failure_alert = true
file_contents = '''${fileContents}'''`;
}

function renderKomodoResources() {
  const ignoreServices = [];
  if (hasPostgres()) ignoreServices.push("migrations");
  if (hasCrons()) ignoreServices.push("cron-runner");
  const ignoreServicesLine = ignoreServices.length > 0
    ? `ignore_services = [${ignoreServices.map(tomlString).join(", ")}]\n`
    : "";

  const stack = `# Generated by scripts/generate-encore-config.mjs from Encore metadata.
[[stack]]
name = ${tomlString(appId)}
description = ${tomlString(`NECK production stack for __APP_NAME__`)}
tags = ["neck", "production"]
deploy = true

[stack.config]
server = ${tomlString(komodoServer)}
project_name = ${tomlString(appId)}
run_directory = ${tomlString(runDirectory)}
file_paths = ["deploy/compose.yaml"]
git_provider = ${tomlString(gitProvider)}
git_account = ${tomlString(gitAccount)}
repo = ${tomlString(gitlabProject)}
branch = "main"
${ignoreServicesLine}environment = """\n${komodoEnvLines()}\n"""
`;

  const actions = [
    hasPostgres() ? renderMigrationAction() : "",
    ...resources.crons.map(renderCronAction),
  ].filter(Boolean);

  return `${stack}${actions.join("\n")}\n`;
}

async function writeGeneratedFile(outputPath, contents) {
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, contents);
  console.log(`${chalk.green("wrote")} ${path.relative(process.cwd(), outputPath)}`);
}

await writeGeneratedFile(path.resolve("deploy/encore/infra.prod.json"), renderInfraConfig());
await writeGeneratedFile(path.resolve("deploy/encore/meta.json"), `${JSON.stringify(resources.metadata, null, 2)}\n`);
await writeGeneratedFile(path.resolve("deploy/compose.yaml"), renderCompose());
await writeGeneratedFile(path.resolve("deploy/komodo/resources.toml"), renderKomodoResources());

console.log(chalk.dim(`source=${resources.source}`));
console.log(chalk.dim(`services=${resources.services.length} databases=${resources.databases.length} caches=${resources.caches.length} topics=${resources.topics.length} buckets=${resources.buckets.length} crons=${resources.crons.length} secrets=${resources.secrets.length}`));

if (resources.buckets.length > 0) {
  console.warn(chalk.yellow("Bucket resources were detected. NECK does not provision S3/MinIO; configure external S3/R2/GCS object_storage in deploy/encore/infra.prod.json."));
}
