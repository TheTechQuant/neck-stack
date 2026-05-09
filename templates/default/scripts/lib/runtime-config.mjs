import protobuf from "protobufjs";

const PROTO = `
syntax = "proto3";
package encore.runtime.v1;

message RuntimeConfig {
  Environment environment = 1;
  Infrastructure infra = 2;
  Deployment deployment = 3;
  optional EncorePlatform encore_platform = 5;
}

message Environment {
  string app_id = 1;
  string app_slug = 2;
  string env_id = 3;
  string env_name = 4;
  Type env_type = 5;
  Cloud cloud = 6;
  enum Type {
    TYPE_UNSPECIFIED = 0;
    TYPE_DEVELOPMENT = 1;
    TYPE_PRODUCTION = 2;
    TYPE_EPHEMERAL = 3;
    TYPE_TEST = 4;
  }
  enum Cloud {
    CLOUD_UNSPECIFIED = 0;
    CLOUD_LOCAL = 1;
    CLOUD_ENCORE = 2;
    CLOUD_AWS = 3;
    CLOUD_GCP = 4;
    CLOUD_AZURE = 5;
  }
}

message Deployment {
  string deploy_id = 1;
  Timestamp deployed_at = 2;
  repeated string dynamic_experiments = 3;
  repeated string hosted_gateways = 4;
  repeated HostedService hosted_services = 5;
  repeated ServiceAuth auth_methods = 6;
  Observability observability = 7;
  ServiceDiscovery service_discovery = 8;
  GracefulShutdown graceful_shutdown = 9;
  repeated Metric metrics = 10;
}

message Timestamp { int64 seconds = 1; int32 nanos = 2; }
message Duration { int64 seconds = 1; int32 nanos = 2; }
message Empty {}

message Observability {
  repeated TracingProvider tracing = 1;
  repeated MetricsProvider metrics = 2;
  repeated LogsProvider logs = 3;
}

message HostedService {
  string name = 1;
  optional int32 worker_threads = 2;
  optional string log_config = 3;
}

message ServiceAuth {
  oneof auth_method {
    NoopAuth noop = 10;
    EncoreAuth encore_auth = 11;
  }
  message NoopAuth {}
  message EncoreAuth { repeated EncoreAuthKey auth_keys = 1; }
}

message TracingProvider {
  string rid = 1;
  oneof provider { EncoreTracingProvider encore = 10; }
  message EncoreTracingProvider {
    string trace_endpoint = 1;
    optional double sampling_rate = 2;
    repeated SamplingConfig sampling_config = 3;
  }
  message SamplingConfig {
    double rate = 1;
    oneof scope {
      Empty default = 2;
      string service = 3;
      Endpoint endpoint = 4;
      string topic = 5;
      PubSubSubscription pubsub_subscription = 6;
    }
    message Endpoint { string service = 1; string endpoint = 2; }
    message PubSubSubscription { string topic = 1; string subscription = 2; }
  }
}

message MetricsProvider {
  string rid = 1;
  Duration collection_interval = 2;
  oneof provider {
    GCPCloudMonitoring encore_cloud = 10;
    GCPCloudMonitoring gcp = 11;
    AWSCloudWatch aws = 12;
    PrometheusRemoteWrite prom_remote_write = 13;
    Datadog datadog = 14;
  }
  message GCPCloudMonitoring {
    string project_id = 1;
    string monitored_resource_type = 2;
    map<string, string> monitored_resource_labels = 3;
    map<string, string> metric_names = 4;
  }
  message AWSCloudWatch { string namespace = 1; }
  message PrometheusRemoteWrite { SecretData remote_write_url = 1; }
  message Datadog { string site = 1; SecretData api_key = 2; }
}

message LogsProvider { string rid = 1; }
message EncoreAuthKey { uint32 id = 1; SecretData data = 2; }

message ServiceDiscovery {
  map<string, Location> services = 1;
  message Location {
    string base_url = 1;
    repeated ServiceAuth auth_methods = 2;
  }
}

message GracefulShutdown {
  Duration total = 1;
  Duration shutdown_hooks = 2;
  Duration handlers = 3;
}

message EncorePlatform {
  repeated EncoreAuthKey platform_signing_keys = 1;
  optional EncoreCloudProvider encore_cloud = 2;
}

message EncoreCloudProvider {
  string rid = 1;
  string server_url = 2;
  repeated EncoreAuthKey auth_keys = 3;
}

message Metric {
  string encore_name = 1;
  repeated string services = 2;
}

message Infrastructure {
  Resources resources = 1;
  Credentials credentials = 2;
  message Credentials {
    repeated ClientCert client_certs = 1;
    repeated SQLRole sql_roles = 2;
    repeated RedisRole redis_roles = 3;
  }
  message Resources {
    repeated Gateway gateways = 1;
    repeated SQLCluster sql_clusters = 2;
    repeated PubSubCluster pubsub_clusters = 3;
    repeated RedisCluster redis_clusters = 4;
    repeated AppSecret app_secrets = 5;
    repeated BucketCluster bucket_clusters = 6;
  }
}

message SQLCluster { string rid = 1; repeated SQLServer servers = 2; repeated SQLDatabase databases = 3; }
enum ServerKind {
  SERVER_KIND_UNSPECIFIED = 0;
  SERVER_KIND_PRIMARY = 1;
  SERVER_KIND_HOT_STANDBY = 2;
  SERVER_KIND_READ_REPLICA = 3;
}
message TLSConfig {
  optional string server_ca_cert = 1;
  bool disable_tls_hostname_verification = 2;
  bool disable_ca_validation = 3;
}
message SQLServer { string rid = 1; string host = 2; ServerKind kind = 3; optional TLSConfig tls_config = 4; }
message ClientCert { string rid = 1; string cert = 2; SecretData key = 3; }
message SQLRole { string rid = 1; string username = 2; SecretData password = 3; optional string client_cert_rid = 4; }
message SQLDatabase { string rid = 1; string encore_name = 2; string cloud_name = 3; repeated SQLConnectionPool conn_pools = 4; }
message SQLConnectionPool { bool is_readonly = 1; string role_rid = 2; int32 min_connections = 3; int32 max_connections = 4; }

message RedisCluster {
  string rid = 1;
  repeated RedisServer servers = 2;
  repeated RedisDatabase databases = 3;
  bool in_memory = 4;
}
message RedisServer { string rid = 1; string host = 2; ServerKind kind = 3; optional TLSConfig tls_config = 4; }
message RedisConnectionPool { bool is_readonly = 1; string role_rid = 2; int32 min_connections = 3; int32 max_connections = 4; }
message RedisRole {
  string rid = 1;
  optional string client_cert_rid = 2;
  oneof auth {
    AuthACL acl = 10;
    SecretData auth_string = 11;
  }
  message AuthACL { string username = 1; SecretData password = 2; }
}
message RedisDatabase {
  string rid = 1;
  string encore_name = 2;
  int32 database_idx = 3;
  optional string key_prefix = 4;
  repeated RedisConnectionPool conn_pools = 5;
}

message AppSecret { string rid = 1; string encore_name = 2; SecretData data = 3; }

message PubSubCluster {
  string rid = 1;
  repeated PubSubTopic topics = 2;
  repeated PubSubSubscription subscriptions = 3;
  oneof provider {
    EncoreCloud encore = 5;
    AWSSqsSns aws = 6;
    GCPPubSub gcp = 7;
    AzureServiceBus azure = 8;
    NSQ nsq = 9;
  }
  message EncoreCloud {}
  message AWSSqsSns {}
  message GCPPubSub {}
  message NSQ { repeated string hosts = 1; }
  message AzureServiceBus { string namespace = 1; }
}
message PubSubTopic {
  string rid = 1;
  string encore_name = 2;
  string cloud_name = 3;
  DeliveryGuarantee delivery_guarantee = 4;
  optional string ordering_attr = 5;
  oneof provider_config { GCPConfig gcp_config = 10; }
  message GCPConfig { string project_id = 1; }
  enum DeliveryGuarantee {
    DELIVERY_GUARANTEE_UNSPECIFIED = 0;
    DELIVERY_GUARANTEE_AT_LEAST_ONCE = 1;
    DELIVERY_GUARANTEE_EXACTLY_ONCE = 2;
  }
}
message PubSubSubscription {
  string rid = 1;
  string topic_encore_name = 2;
  string subscription_encore_name = 3;
  string topic_cloud_name = 4;
  string subscription_cloud_name = 5;
  bool push_only = 6;
  oneof provider_config { GCPConfig gcp_config = 10; }
  message GCPConfig {
    string project_id = 1;
    optional string push_service_account = 2;
    optional string push_jwt_audience = 3;
  }
}

message BucketCluster {
  string rid = 1;
  repeated Bucket buckets = 2;
  oneof provider { S3 s3 = 10; GCS gcs = 11; }
  message S3 {
    string region = 1;
    optional string endpoint = 2;
    optional string access_key_id = 3;
    optional SecretData secret_access_key = 4;
  }
  message GCS { optional string endpoint = 1; bool anonymous = 2; optional LocalSignOptions local_sign = 3; }
  message LocalSignOptions { string base_url = 1; string access_id = 2; string private_key = 3; }
}
message Bucket {
  string rid = 1;
  string encore_name = 2;
  string cloud_name = 3;
  optional string key_prefix = 4;
  optional string public_base_url = 5;
}

message Gateway {
  string rid = 1;
  string encore_name = 2;
  string base_url = 3;
  repeated string hostnames = 4;
  CORS cors = 5;
  message CORS {
    bool debug = 1;
    bool disable_credentials = 2;
    oneof allowed_origins_with_credentials {
      CORSAllowedOrigins allowed_origins = 3;
      bool unsafe_allow_all_origins_with_credentials = 4;
    }
    CORSAllowedOrigins allowed_origins_without_credentials = 5;
    repeated string extra_allowed_headers = 6;
    repeated string extra_exposed_headers = 7;
    bool allow_private_network_access = 8;
  }
  message CORSAllowedOrigins { repeated string allowed_origins = 1; }
}

message SecretData {
  oneof source {
    bytes embedded = 1;
    string env = 2;
  }
  oneof sub_path { string json_key = 10; }
  Encoding encoding = 20;
  enum Encoding {
    ENCODING_NONE = 0;
    ENCODING_BASE64 = 1;
    ENCODING_GZIP = 2;
  }
}
`;

const RuntimeConfig = protobuf.parse(PROTO).root.lookupType("encore.runtime.v1.RuntimeConfig");

const ENV_TYPES = { development: 1, production: 2, ephemeral: 3, test: 4 };
const CLOUDS = { local: 1, encore: 2, aws: 3, gcp: 4, azure: 5 };

export function encodeRuntimeConfig(infra, options = {}) {
  const nextRID = ridGenerator();
  const authMethods = authMethodsFrom(infra.auth, nextRID);
  const credentials = { clientCerts: [], sqlRoles: [], redisRoles: [] };
  const metadata = infra.metadata || {};
  const traceKey = firstAuthKey(infra.auth);
  const sampleRate = clampRate(options.traceSampleRate ?? 1);
  const observability = {
    metrics: metricsProviders(infra.metrics, nextRID),
    tracing: [{
      rid: nextRID(),
      encore: {
        traceEndpoint: options.traceEndpoint || "http://neckdash:8080/trace",
        samplingConfig: [{ rate: sampleRate, default: {} }],
      },
    }],
    logs: [],
  };

  const payload = {
    environment: {
      appId: metadata.app_id || "",
      appSlug: metadata.app_id || "",
      envId: metadata.env_name || "production",
      envName: metadata.env_name || "production",
      envType: ENV_TYPES[metadata.env_type] || 0,
      cloud: CLOUDS[metadata.cloud] || 0,
    },
    infra: {
      resources: {
        gateways: gatewaysFrom(infra, nextRID),
        sqlClusters: sqlClustersFrom(infra.sql_servers || [], credentials, nextRID),
        pubsubClusters: pubsubClustersFrom(infra.pubsub || [], nextRID),
        redisClusters: redisClustersFrom(infra.redis || {}, credentials, nextRID),
        appSecrets: appSecretsFrom(infra.secrets, nextRID),
        bucketClusters: bucketClustersFrom(infra.object_storage || [], nextRID),
      },
      credentials,
    },
    deployment: {
      deployId: "",
      dynamicExperiments: [],
      hostedGateways: [],
      hostedServices: (infra.hosted_services || []).map((name) => ({
        name,
        workerThreads: infra.worker_threads,
        logConfig: infra.log_config,
      })),
      authMethods,
      observability,
      serviceDiscovery: serviceDiscoveryFrom(infra.service_discovery || {}, authMethods),
      gracefulShutdown: durationGroup(infra.graceful_shutdown || {}),
      metrics: (infra.used_metrics || []).map((metric) => ({
        encoreName: metric.name,
        services: metric.services || [],
      })),
    },
    encorePlatform: traceKey ? {
      platformSigningKeys: [traceKey],
    } : undefined,
  };

  return RuntimeConfig.encode(RuntimeConfig.create(payload)).finish();
}

function ridGenerator() {
  let next = 0;
  return () => String(next++);
}

function clampRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

function duration(seconds) {
  return seconds === undefined ? undefined : { seconds: Number(seconds) || 0, nanos: 0 };
}

function durationGroup(group) {
  return {
    total: duration(group.total),
    shutdownHooks: duration(group.shutdown_hooks),
    handlers: duration(group.handlers),
  };
}

function secretData(value) {
  if (value && typeof value === "object" && typeof value.$env === "string") {
    return { env: value.$env, encoding: 0 };
  }
  return { embedded: Buffer.from(String(value ?? "")), encoding: 0 };
}

function firstAuthKey(auth = []) {
  const key = auth.find((entry) => entry?.type === "key");
  return key ? { id: Number(key.id) || 1, data: secretData(key.key) } : undefined;
}

function authMethodsFrom(auth = []) {
  if (!auth.length) return [{ noop: {} }];
  return auth.filter((entry) => entry?.type === "key").map((entry) => ({
    encoreAuth: {
      authKeys: [{ id: Number(entry.id) || 1, data: secretData(entry.key) }],
    },
  }));
}

function serviceDiscoveryFrom(discovery, authMethods) {
  return {
    services: Object.fromEntries(Object.entries(discovery).map(([name, config]) => [
      name,
      {
        baseUrl: config.base_url,
        authMethods: config.auth ? authMethodsFrom(config.auth) : authMethods,
      },
    ])),
  };
}

function metricsProviders(metrics, nextRID) {
  if (!metrics) return [];
  const collectionInterval = duration(metrics.collection_interval);
  if (metrics.type === "prometheus") {
    return [{
      rid: nextRID(),
      collectionInterval,
      promRemoteWrite: { remoteWriteUrl: secretData(metrics.remote_write_url) },
    }];
  }
  if (metrics.type === "datadog") {
    return [{
      rid: nextRID(),
      collectionInterval,
      datadog: { site: metrics.site, apiKey: secretData(metrics.api_key) },
    }];
  }
  if (metrics.type === "gcp_cloud_monitoring") {
    return [{
      rid: nextRID(),
      collectionInterval,
      gcp: {
        projectId: metrics.project_id,
        monitoredResourceType: metrics.monitored_resource_type,
        monitoredResourceLabels: metrics.monitored_resource_labels || {},
        metricNames: metrics.metric_names || {},
      },
    }];
  }
  if (metrics.type === "aws_cloudwatch") {
    return [{ rid: nextRID(), collectionInterval, aws: { namespace: metrics.namespace } }];
  }
  return [];
}

function tlsConfig(input) {
  if (!input) return {};
  if (input.disabled) return undefined;
  return {
    serverCaCert: input.ca,
    disableTlsHostnameVerification: Boolean(input.disable_tls_hostname_verification),
    disableCaValidation: Boolean(input.disable_ca_validation),
  };
}

function addClientCert(cert, credentials, nextRID) {
  if (!cert) return undefined;
  const rid = nextRID();
  credentials.clientCerts.push({ rid, cert: cert.cert, key: secretData(cert.key) });
  return rid;
}

function sqlClustersFrom(servers, credentials, nextRID) {
  return servers.map((server) => {
    const defaultClientCert = addClientCert(server.tls_config?.client_cert, credentials, nextRID);
    const databases = Object.entries(server.databases || {}).map(([name, db]) => {
      const roleRid = nextRID();
      credentials.sqlRoles.push({
        rid: roleRid,
        username: db.username,
        password: secretData(db.password),
        clientCertRid: addClientCert(db.client_cert, credentials, nextRID) || defaultClientCert,
      });
      return {
        rid: nextRID(),
        encoreName: name,
        cloudName: db.name || name,
        connPools: [{
          isReadonly: false,
          roleRid,
          minConnections: db.min_connections ?? 0,
          maxConnections: db.max_connections ?? 100,
        }],
      };
    });
    return {
      rid: nextRID(),
      servers: [{ rid: nextRID(), host: server.host, kind: 1, tlsConfig: tlsConfig(server.tls_config) }],
      databases,
    };
  });
}

function redisClustersFrom(redis, credentials, nextRID) {
  return Object.entries(redis).map(([name, config]) => {
    const roleRid = nextRID();
    const clientCertRid = addClientCert(config.tls_config?.client_cert, credentials, nextRID);
    credentials.redisRoles.push({
      rid: roleRid,
      clientCertRid,
      ...redisAuth(config.auth),
    });
    return {
      rid: nextRID(),
      servers: [{ rid: nextRID(), host: config.host, kind: 1, tlsConfig: tlsConfig(config.tls_config) }],
      databases: [{
        rid: nextRID(),
        encoreName: name,
        databaseIdx: config.database_index || 0,
        keyPrefix: config.key_prefix,
        connPools: [{
          isReadonly: false,
          roleRid,
          minConnections: config.min_connections ?? 0,
          maxConnections: config.max_connections ?? 100,
        }],
      }],
      inMemory: Boolean(config.in_memory),
    };
  });
}

function redisAuth(auth) {
  if (!auth) return {};
  if (auth.type === "acl") return { acl: { username: auth.username, password: secretData(auth.password) } };
  return { authString: secretData(auth.auth_string) };
}

function pubsubClustersFrom(pubsubs, nextRID) {
  return pubsubs.map((pubsub) => {
    const providerType = pubsub.type;
    const topicMap = pubsub.topics || {};
    const topics = Object.entries(topicMap).map(([name, topic]) => ({
      rid: nextRID(),
      encoreName: name,
      cloudName: topic.name || topic.arn || name,
      deliveryGuarantee: 1,
      gcpConfig: providerType === "gcp_pubsub" ? { projectId: topic.project_id || pubsub.project_id || "" } : undefined,
    }));
    const subscriptions = Object.entries(topicMap).flatMap(([topicName, topic]) => (
      Object.entries(topic.subscriptions || {}).map(([subName, sub]) => ({
        rid: nextRID(),
        topicEncoreName: topicName,
        subscriptionEncoreName: subName,
        topicCloudName: topic.name || topic.arn || topicName,
        subscriptionCloudName: sub.name || sub.url || subName,
        pushOnly: Boolean(sub.push_config),
        gcpConfig: providerType === "gcp_pubsub" ? {
          projectId: sub.project_id || pubsub.project_id || "",
          pushServiceAccount: sub.push_config?.service_account,
          pushJwtAudience: sub.push_config?.jwt_audience,
        } : undefined,
      }))
    ));
    return {
      rid: nextRID(),
      topics,
      subscriptions,
      ...pubsubProvider(pubsub),
    };
  });
}

function pubsubProvider(pubsub) {
  if (pubsub.type === "nsq") return { nsq: { hosts: String(pubsub.hosts || "").split(",").map((host) => host.trim()).filter(Boolean) } };
  if (pubsub.type === "gcp_pubsub") return { gcp: {} };
  if (pubsub.type === "aws_sns_sqs") return { aws: {} };
  if (pubsub.type === "azure_service_bus") return { azure: { namespace: pubsub.namespace || "" } };
  return {};
}

function appSecretsFrom(secrets, nextRID) {
  if (!secrets || secrets.$env) return [];
  return Object.entries(secrets).map(([name, value]) => ({
    rid: nextRID(),
    encoreName: name,
    data: secretData(value),
  }));
}

function bucketClustersFrom(storages, nextRID) {
  return storages.map((storage) => ({
    rid: nextRID(),
    buckets: Object.entries(storage.buckets || {}).map(([name, bucket]) => ({
      rid: nextRID(),
      encoreName: name,
      cloudName: bucket.name,
      keyPrefix: bucket.key_prefix,
      publicBaseUrl: bucket.public_base_url,
    })),
    ...(storage.type === "s3"
      ? { s3: { region: storage.region, endpoint: storage.endpoint, accessKeyId: storage.access_key_id, secretAccessKey: secretData(storage.secret_access_key) } }
      : { gcs: { endpoint: storage.endpoint, anonymous: false } }),
  }));
}

function gatewaysFrom(infra, nextRID) {
  return (infra.hosted_gateways || []).map((name) => ({
    rid: nextRID(),
    encoreName: name,
    baseUrl: infra.metadata?.base_url || "",
    hostnames: [],
    cors: corsFrom(infra.cors || {}),
  }));
}

function corsFrom(cors) {
  return {
    debug: Boolean(cors.debug),
    disableCredentials: false,
    allowedOriginsWithoutCredentials: cors.allow_origins_without_credentials ? { allowedOrigins: cors.allow_origins_without_credentials } : undefined,
    allowedOrigins: cors.allow_origins_with_credentials ? { allowedOrigins: cors.allow_origins_with_credentials } : undefined,
    extraAllowedHeaders: cors.allow_headers || [],
    extraExposedHeaders: cors.expose_headers || [],
    allowPrivateNetworkAccess: true,
  };
}
