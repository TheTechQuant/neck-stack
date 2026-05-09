#!/usr/bin/env zx
import { fs, path } from "zx";
import chalk from "chalk";
import { discoverEncoreResources } from "./lib/encore-resources.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import {
  renderClickHouseClusterXML,
  renderClickHouseCustomFunctionXML,
  renderSignozCollectorConfig,
  renderSignozCollectorOpampConfig,
  renderSignozPromBridgeConfig,
} from "./lib/signoz-config.mjs";
import { encodeRuntimeConfig } from "./lib/runtime-config.mjs";

await loadDotEnv();

const appId = "__APP_ID__";
const postgresUser = "__POSTGRES_USER__";
const defaultPostgresPassword = "__POSTGRES_PASSWORD_DEFAULT__";
const defaultRedisPassword = "__REDIS_PASSWORD_DEFAULT__";
const domain = process.env.DOMAIN || "__DOMAIN__";
const neckDashUser = process.env.NECK_DASH_USER || "__NECK_DASH_USER__";
const neckDashPasswordHash = process.env.NECK_DASH_PASSWORD_HASH || "__NECK_DASH_PASSWORD_HASH_DEFAULT__";
const defaultTraceAuthKey = "__TRACE_AUTH_KEY_DEFAULT__";
const registry = "__REGISTRY__";
const defaultNeckDashImage = "ghcr.io/thetechquant/neck-stack/neckdash:latest";
const defaultNeckDashUIImage = "ghcr.io/thetechquant/neck-stack/neckdash-ui:latest";
const defaultSignozImage = "signoz/signoz:v0.122.0";
const defaultSignozCollectorImage = "signoz/signoz-otel-collector:v0.144.3";
const defaultSignozClickHouseImage = "clickhouse/clickhouse-server:25.5.6";
const defaultSignozZookeeperImage = "signoz/zookeeper:3.7.1";
const defaultOtelCollectorImage = "otel/opentelemetry-collector-contrib:0.140.1";
const defaultSignozJWTSecret = "__SIGNOZ_JWT_SECRET_DEFAULT__";
const prodPlatform = process.env.PROD_PLATFORM || "__PROD_PLATFORM__";
const traceEndpoint = process.env.NECK_TRACE_ENDPOINT || "http://neckdash:8080/trace";
const traceSampleRate = process.env.NECK_TRACE_SAMPLE_RATE || "1";
const komodoServer = "__KOMODO_SERVER__";
const gitProvider = "__GIT_PROVIDER__";
const gitAccount = "__GIT_ACCOUNT__";
const gitlabProject = "__GITLAB_PROJECT__";
const runDirectory = "__RUN_DIRECTORY__";
const defaultNeckDashAppsRoot = process.env.NECKDASH_APPS_ROOT || runDirectoryParent(runDirectory);

const resources = await discoverEncoreResources("backend");

function tomlString(value) {
  return JSON.stringify(value);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function runDirectoryParent(value) {
  const parent = path.posix.dirname(String(value || ""));
  return parent && parent !== "." ? parent : "/opt/stacks";
}

function composeEnv(name, fallback) {
  return "${" + `${name}:-${String(fallback).replaceAll("$", () => "$$")}` + "}";
}

function neckDashPasswordHashComposeFallback() {
  if (process.env.NECK_DASH_PASSWORD_HASH) return process.env.NECK_DASH_PASSWORD_HASH;
  if (neckDashPasswordHash === "__NECK_DASH_PASSWORD_HASH_DEFAULT__") return "__NECK_DASH_PASSWORD_HASH_DEFAULT_COMPOSE__";
  return neckDashPasswordHash;
}

function requiredComposeEnv(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Encore secret ${JSON.stringify(name)} cannot be used as a Compose environment variable name. Rename the secret to letters, numbers, or underscores.`);
  }
  return "${" + `${name}:?set ${name}` + "}";
}

function komodoVariableName(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function secretKomodoVariableName(secret) {
  return komodoVariableName(`${appId}_${secret}`);
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
      cloud: "gcp",
      base_url: `https://${domain}/api`,
    },
    graceful_shutdown: {
      total: 30,
    },
    auth: [
      {
        type: "key",
        id: 1,
        key: defaultTraceAuthKey,
      },
    ],
    metrics: {
      type: "prometheus",
      collection_interval: 15,
      remote_write_url: { $env: "SIGNOZ_PROM_REMOTE_WRITE_URL" },
    },
    used_metrics: resources.metrics.map((metric) => ({
      name: metric.name,
      services: metric.services,
    })),
    hosted_services: resources.services.map((service) => service.name),
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
    "      ENCORE_RUNTIME_CONFIG_PATH: /encore/runtime.prod.pb",
    `      K_SERVICE: \${K_SERVICE:-${appId}-backend}`,
    `      K_REVISION: \${K_REVISION:-${appId}-production}`,
    `      SIGNOZ_PROM_REMOTE_WRITE_URL: \${SIGNOZ_PROM_REMOTE_WRITE_URL:-http://signoz-prom-bridge:19291/api/v1/write}`,
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
  const deps = [];
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
    labels:
      caddy: \${DOMAIN:-${domain}}
      caddy.reverse_proxy: "{{upstreams 8080}}"
    environment:
      DOMAIN: \${DOMAIN:-${domain}}
      NECK_DASH_USER: \${NECK_DASH_USER:-${neckDashUser}}
      NECK_DASH_PASSWORD_HASH: ${composeEnv("NECK_DASH_PASSWORD_HASH", neckDashPasswordHashComposeFallback())}
    expose:
      - "8080"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
    networks:
      - default
      - neck-ingress
    depends_on:
      frontend:
        condition: service_started
      backend:
        condition: service_started`,
`  frontend:
    image: \${FRONTEND_IMAGE:-${registry}/frontend:prod}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      NUXT_PUBLIC_API_BASE_URL: ${composeEnv("NUXT_PUBLIC_API_BASE_URL", "/api")}
      NUXT_API_INTERNAL_BASE_URL: \${NUXT_API_INTERNAL_BASE_URL:-http://backend:8080}
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
    entrypoint:
      - /bin/sh
      - -c
      - export K_POD="\${K_POD:-\$(hostname)}"; unset ENCORE_INFRA_CONFIG_PATH; exec node --enable-source-maps /workspace/.encore/build/combined/combined/main.mjs
    environment:
${backendEnvironment()}
    expose:
      - "8080"
    volumes:
      - ./encore/runtime.prod.pb:/encore/runtime.prod.pb:ro
    networks:
      - default
      - neck-ingress${backendDependsOn()}
    healthcheck:
      test: ["CMD-SHELL", "node -e \\"fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\\""]
      interval: 15s
      timeout: 5s
      retries: 8`,
`  signoz-prom-bridge:
    image: \${OTEL_COLLECTOR_IMAGE:-${defaultOtelCollectorImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    command: ["--config=/etc/otel/config.yaml"]
    environment:
      APP_ID: ${appId}
      APP_ENV: production
      SIGNOZ_OTLP_HTTP_ENDPOINT: \${SIGNOZ_OTLP_HTTP_ENDPOINT:-http://signoz-otel-collector:4318}
    expose:
      - "19291"
    volumes:
      - ./signoz/prom-bridge.yaml:/etc/otel/config.yaml:ro
    networks:
      - default
      - neck-ingress`,
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

  const volumes = [];
  if (hasPostgres()) volumes.push("  postgres_data:");
  if (hasCache()) volumes.push("  redis_data:");
  if (hasPubSub()) volumes.push("  nsq_data:");

  const volumeBlock = volumes.length > 0 ? `\n\nvolumes:\n${volumes.join("\n")}` : "";
  return `# Generated by scripts/generate-encore-config.mjs from Encore metadata.\nname: \${COMPOSE_PROJECT_NAME:-${appId}}\n\nservices:\n${services.join("\n\n")}${volumeBlock}\n\nnetworks:\n  neck-ingress:\n    external: true\n    name: \${NECK_INGRESS_NETWORK:-neck-ingress}\n`;
}

function renderNeckDashCompose() {
  return `# Shared per-server NECK Dash and SigNoz stack. Deploy this once per Komodo server.
name: neckdash

services:
  neckdash:
    image: \${NECKDASH_IMAGE:-${defaultNeckDashImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      PORT: 8080
      NECKDASH_TRACE_AUTH_KEYS: \${NECKDASH_TRACE_AUTH_KEYS:-${appId}=${defaultTraceAuthKey}}
      NECKDASH_REQUIRE_TRACE_AUTH: \${NECKDASH_REQUIRE_TRACE_AUTH:-true}
      NECKDASH_APPS_ROOT: /apps
      SIGNOZ_OTLP_TRACES_URL: \${SIGNOZ_OTLP_TRACES_URL:-http://signoz-otel-collector:4318/v1/traces}
      SIGNOZ_OTLP_LOGS_URL: \${SIGNOZ_OTLP_LOGS_URL:-http://signoz-otel-collector:4318/v1/logs}
      SIGNOZ_BASE_URL: \${SIGNOZ_BASE_URL:-/__neck_dash/signoz}
      NECKDASH_KOMODO_URL: \${NECKDASH_KOMODO_URL:-}
      NECKDASH_KOMODO_API_KEY: \${NECKDASH_KOMODO_API_KEY:-}
      NECKDASH_KOMODO_API_SECRET: \${NECKDASH_KOMODO_API_SECRET:-}
    expose:
      - "8080"
    volumes:
      - \${NECKDASH_APPS_ROOT:-${defaultNeckDashAppsRoot}}:/apps:ro
    networks:
      - neck-ingress
    depends_on:
      signoz-otel-collector:
        condition: service_started

  neckdash-ui:
    image: \${NECKDASH_UI_IMAGE:-${defaultNeckDashUIImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      NUXT_APP_BASE_URL: \${NUXT_APP_BASE_URL:-/__neck_dash/}
      NUXT_PUBLIC_NECKDASH_API_BASE_URL: \${NUXT_PUBLIC_NECKDASH_API_BASE_URL:-/__neck_dash/api}
      NUXT_PUBLIC_SIGNOZ_BASE_URL: \${NUXT_PUBLIC_SIGNOZ_BASE_URL:-/__neck_dash/signoz}
      NUXT_NECKDASH_API_INTERNAL_BASE_URL: \${NUXT_NECKDASH_API_INTERNAL_BASE_URL:-http://neckdash:8080}
      PORT: 3000
      HOST: 0.0.0.0
    expose:
      - "3000"
    networks:
      - neck-ingress
    depends_on:
      neckdash:
        condition: service_started

  signoz:
    image: \${SIGNOZ_IMAGE:-${defaultSignozImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    environment:
      SIGNOZ_ALERTMANAGER_PROVIDER: signoz
      SIGNOZ_GLOBAL_EXTERNAL__URL: \${SIGNOZ_EXTERNAL_URL:-https://${domain}/__neck_dash/signoz}
      SIGNOZ_TELEMETRYSTORE_CLICKHOUSE_DSN: tcp://clickhouse:9000
      SIGNOZ_SQLSTORE_SQLITE_PATH: /var/lib/signoz/signoz.db
      SIGNOZ_TOKENIZER_JWT_SECRET: \${SIGNOZ_TOKENIZER_JWT_SECRET:-${defaultSignozJWTSecret}}
    volumes:
      - signoz_sqlite:/var/lib/signoz
    expose:
      - "8080"
    networks:
      - neck-ingress
    depends_on:
      clickhouse:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://127.0.0.1:8080/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 5

  signoz-otel-collector:
    image: \${SIGNOZ_COLLECTOR_IMAGE:-${defaultSignozCollectorImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    entrypoint: ["/bin/sh", "-c"]
    command:
      - /signoz-otel-collector migrate sync check && /signoz-otel-collector --config=/etc/otel-collector-config.yaml --manager-config=/etc/otel-collector-opamp-config.yaml --copy-path=/var/tmp/collector-config.yaml
    environment:
      OTEL_RESOURCE_ATTRIBUTES: host.name=neckdash,os.type=linux
      LOW_CARDINAL_EXCEPTION_GROUPING: "false"
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_DSN: tcp://clickhouse:9000
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_CLUSTER: cluster
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_REPLICATION: "true"
      SIGNOZ_OTEL_COLLECTOR_TIMEOUT: 10m
    volumes:
      - ./neckdash/signoz-otel-collector.yaml:/etc/otel-collector-config.yaml:ro
      - ./neckdash/signoz-otel-collector-opamp.yaml:/etc/otel-collector-opamp-config.yaml:ro
    expose:
      - "4317"
      - "4318"
    networks:
      - neck-ingress
    depends_on:
      signoz-telemetrystore-migrator:
        condition: service_completed_successfully
      clickhouse:
        condition: service_healthy

  signoz-telemetrystore-migrator:
    image: \${SIGNOZ_COLLECTOR_IMAGE:-${defaultSignozCollectorImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: on-failure
    entrypoint: ["/bin/sh", "-c"]
    command:
      - /signoz-otel-collector migrate bootstrap && /signoz-otel-collector migrate sync up && /signoz-otel-collector migrate async up
    environment:
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_DSN: tcp://clickhouse:9000
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_CLUSTER: cluster
      SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_REPLICATION: "true"
      SIGNOZ_OTEL_COLLECTOR_TIMEOUT: 10m
    networks:
      - neck-ingress
    depends_on:
      clickhouse:
        condition: service_healthy

  signoz-init-clickhouse:
    image: \${SIGNOZ_CLICKHOUSE_IMAGE:-${defaultSignozClickHouseImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: on-failure
    command:
      - bash
      - -c
      - |
        version="v0.0.1"
        node_os=$$(uname -s | tr '[:upper:]' '[:lower:]')
        node_arch=$$(uname -m | sed s/aarch64/arm64/ | sed s/x86_64/amd64/)
        cd /tmp
        wget -O histogram-quantile.tar.gz "https://github.com/SigNoz/signoz/releases/download/histogram-quantile%2F$\${version}/histogram-quantile_$\${node_os}_$\${node_arch}.tar.gz"
        tar -xzf histogram-quantile.tar.gz
        mv histogram-quantile /var/lib/clickhouse/user_scripts/histogramQuantile
    volumes:
      - signoz_clickhouse_scripts:/var/lib/clickhouse/user_scripts
    networks:
      - neck-ingress

  zookeeper-1:
    image: \${SIGNOZ_ZOOKEEPER_IMAGE:-${defaultSignozZookeeperImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    user: root
    restart: unless-stopped
    environment:
      ZOO_SERVER_ID: 1
      ALLOW_ANONYMOUS_LOGIN: "yes"
      ZOO_AUTOPURGE_INTERVAL: 1
      ZOO_ENABLE_PROMETHEUS_METRICS: "yes"
      ZOO_PROMETHEUS_METRICS_PORT_NUMBER: 9141
    volumes:
      - signoz_zookeeper:/bitnami/zookeeper
    expose:
      - "2181"
    networks:
      - neck-ingress
    healthcheck:
      test: ["CMD-SHELL", "curl -s -m 2 http://localhost:8080/commands/ruok | grep error | grep null"]
      interval: 30s
      timeout: 5s
      retries: 5

  clickhouse:
    image: \${SIGNOZ_CLICKHOUSE_IMAGE:-${defaultSignozClickHouseImage}}
    platform: ${composeEnv("PROD_PLATFORM", prodPlatform)}
    restart: unless-stopped
    tty: true
    environment:
      CLICKHOUSE_SKIP_USER_SETUP: 1
    volumes:
      - ./neckdash/clickhouse-cluster.xml:/etc/clickhouse-server/config.d/cluster.xml:ro
      - ./neckdash/clickhouse-custom-function.xml:/etc/clickhouse-server/custom-function.xml:ro
      - signoz_clickhouse_scripts:/var/lib/clickhouse/user_scripts
      - signoz_clickhouse:/var/lib/clickhouse
    expose:
      - "8123"
      - "9000"
    networks:
      - neck-ingress
    depends_on:
      signoz-init-clickhouse:
        condition: service_completed_successfully
      zookeeper-1:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget --spider -q http://127.0.0.1:8123/ping"]
      interval: 30s
      timeout: 5s
      retries: 5

volumes:
  signoz_clickhouse:
  signoz_clickhouse_scripts:
  signoz_sqlite:
  signoz_zookeeper:

networks:
  neck-ingress:
    external: true
    name: \${NECK_INGRESS_NETWORK:-neck-ingress}
`;
}

function komodoEnvLines() {
  const lines = [
    "APP_ENV = production",
    `DOMAIN = ${domain}`,
    "NECK_INGRESS_NETWORK = neck-ingress",
    `NECK_DASH_USER = ${neckDashUser}`,
    `NECK_DASH_PASSWORD_HASH = ${neckDashPasswordHash}`,
    "NUXT_PUBLIC_API_BASE_URL = /api",
    "NUXT_API_INTERNAL_BASE_URL = http://backend:8080",
    "SIGNOZ_PROM_REMOTE_WRITE_URL = http://signoz-prom-bridge:19291/api/v1/write",
    `PROD_PLATFORM = ${prodPlatform}`,
    "",
  ];

  if (hasPostgres()) {
    lines.push(`POSTGRES_USER = ${postgresUser}`);
  }
  for (const secret of resources.secrets) {
    lines.push(`${secret} = [[${secretKomodoVariableName(secret)}]]`);
  }
  if (hasPostgres() || hasCache() || resources.secrets.length > 0) {
    lines.push("");
  }

  lines.push(`BACKEND_IMAGE = ${registry}/backend:prod`);
  lines.push(`FRONTEND_IMAGE = ${registry}/frontend:prod`);
  lines.push(`OTEL_COLLECTOR_IMAGE = ${defaultOtelCollectorImage}`);
  if (hasPostgres()) {
    lines.push(`MIGRATIONS_IMAGE = ${registry}/migrations:prod`);
  }

  return lines.join("\n");
}

function neckDashKomodoEnvLines() {
  return [
    "NECK_INGRESS_NETWORK = neck-ingress",
    `NECKDASH_APPS_ROOT = ${defaultNeckDashAppsRoot}`,
    `NECKDASH_TRACE_AUTH_KEYS = ${appId}=${defaultTraceAuthKey}`,
    "NECKDASH_REQUIRE_TRACE_AUTH = true",
    "NUXT_APP_BASE_URL = /__neck_dash/",
    "NUXT_PUBLIC_NECKDASH_API_BASE_URL = /__neck_dash/api",
    "NUXT_PUBLIC_SIGNOZ_BASE_URL = /__neck_dash/signoz",
    "NUXT_NECKDASH_API_INTERNAL_BASE_URL = http://neckdash:8080",
    "SIGNOZ_BASE_URL = /__neck_dash/signoz",
    `SIGNOZ_EXTERNAL_URL = https://${domain}/__neck_dash/signoz`,
    "SIGNOZ_OTLP_TRACES_URL = http://signoz-otel-collector:4318/v1/traces",
    "SIGNOZ_OTLP_LOGS_URL = http://signoz-otel-collector:4318/v1/logs",
    `SIGNOZ_TOKENIZER_JWT_SECRET = ${defaultSignozJWTSecret}`,
    "NECKDASH_KOMODO_URL = [[NECKDASH_KOMODO_URL]]",
    "NECKDASH_KOMODO_API_KEY = [[NECKDASH_KOMODO_API_KEY]]",
    "NECKDASH_KOMODO_API_SECRET = [[NECKDASH_KOMODO_API_SECRET]]",
    `PROD_PLATFORM = ${prodPlatform}`,
    "",
    `NECKDASH_IMAGE = ${defaultNeckDashImage}`,
    `NECKDASH_UI_IMAGE = ${defaultNeckDashUIImage}`,
    `SIGNOZ_IMAGE = ${defaultSignozImage}`,
    `SIGNOZ_COLLECTOR_IMAGE = ${defaultSignozCollectorImage}`,
    `SIGNOZ_CLICKHOUSE_IMAGE = ${defaultSignozClickHouseImage}`,
    `SIGNOZ_ZOOKEEPER_IMAGE = ${defaultSignozZookeeperImage}`,
  ].join("\n");
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

function renderMigrationPreDeploy() {
  if (!hasPostgres()) return "";
  const command = "docker compose -f deploy/compose.yaml pull migrations && docker compose -f deploy/compose.yaml run --rm migrations";
  return `
[stack.config.pre_deploy]
path = ${tomlString(runDirectory)}
command = ${tomlString(command)}
`;
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
auto_pull = true
auto_update = true
auto_update_all_services = true
run_directory = ${tomlString(runDirectory)}
file_paths = ["deploy/compose.yaml"]
git_provider = ${tomlString(gitProvider)}
git_account = ${tomlString(gitAccount)}
repo = ${tomlString(gitlabProject)}
branch = "main"
${ignoreServicesLine}environment = """\n${komodoEnvLines()}\n"""
${renderMigrationPreDeploy()}
`;

  const actions = [
    ...resources.crons.map(renderCronAction),
  ].filter(Boolean);

  return `${stack.trimEnd()}${actions.length > 0 ? `\n${actions.join("\n")}` : ""}\n`;
}

function renderNeckDashKomodoResources() {
  return `# Shared NECK Dash Komodo stack. Import once per server, not once per app.
[[stack]]
name = "neckdash"
description = "Shared per-server NECK Dash and SigNoz observability stack"
tags = ["neck", "observability"]
deploy = true

[stack.config]
server = ${tomlString(komodoServer)}
project_name = "neckdash"
run_directory = ${tomlString(runDirectory)}
file_paths = ["deploy/neckdash/compose.yaml"]
git_provider = ${tomlString(gitProvider)}
git_account = ${tomlString(gitAccount)}
repo = ${tomlString(gitlabProject)}
branch = "main"
environment = """\n${neckDashKomodoEnvLines()}\n"""

[[procedure]]
name = "neck-auto-update"
description = "Polls NECK stacks for new production images and redeploys stacks with auto_update enabled"
tags = ["neck", "system"]

[procedure.config]
schedule_format = "English"
schedule = "Every 5 minutes"
schedule_enabled = true
schedule_timezone = "UTC"
schedule_alert = false
failure_alert = true

[[procedure.config.stage]]
name = "Poll stack images"
enabled = true
executions = [
  { execution.type = "GlobalAutoUpdate", execution.params = {}, enabled = true },
]
`;
}

function renderMetaJSON() {
  return `${JSON.stringify({
    ...resources.metadata,
    app_id: appId,
  }, null, 2)}\n`;
}

async function writeGeneratedFile(outputPath, contents) {
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, contents);
  console.log(`${chalk.green("wrote")} ${path.relative(process.cwd(), outputPath)}`);
}

const infraConfigText = renderInfraConfig();
const infraConfig = JSON.parse(infraConfigText);

await writeGeneratedFile(path.resolve("deploy/encore/infra.prod.json"), infraConfigText);
await writeGeneratedFile(path.resolve("deploy/encore/runtime.prod.pb"), encodeRuntimeConfig(infraConfig, {
  traceEndpoint,
  traceSampleRate,
}));
await writeGeneratedFile(path.resolve("deploy/encore/meta.json"), renderMetaJSON());
await writeGeneratedFile(path.resolve("deploy/compose.yaml"), renderCompose());
await writeGeneratedFile(path.resolve("deploy/signoz/prom-bridge.yaml"), renderSignozPromBridgeConfig());
await writeGeneratedFile(path.resolve("deploy/komodo/resources.toml"), renderKomodoResources());
await writeGeneratedFile(path.resolve("deploy/neckdash/compose.yaml"), renderNeckDashCompose());
await writeGeneratedFile(path.resolve("deploy/neckdash/signoz-otel-collector.yaml"), renderSignozCollectorConfig());
await writeGeneratedFile(path.resolve("deploy/neckdash/signoz-otel-collector-opamp.yaml"), renderSignozCollectorOpampConfig());
await writeGeneratedFile(path.resolve("deploy/neckdash/clickhouse-cluster.xml"), renderClickHouseClusterXML());
await writeGeneratedFile(path.resolve("deploy/neckdash/clickhouse-custom-function.xml"), renderClickHouseCustomFunctionXML());
await writeGeneratedFile(path.resolve("deploy/neckdash/resources.toml"), renderNeckDashKomodoResources());

console.log(chalk.dim(`source=${resources.source}`));
console.log(chalk.dim(`services=${resources.services.length} databases=${resources.databases.length} caches=${resources.caches.length} topics=${resources.topics.length} buckets=${resources.buckets.length} crons=${resources.crons.length} secrets=${resources.secrets.length}`));

if (resources.buckets.length > 0) {
  console.warn(chalk.yellow("Bucket resources were detected. NECK does not provision S3/MinIO; configure external S3/R2/GCS object_storage in deploy/encore/infra.prod.json."));
}
