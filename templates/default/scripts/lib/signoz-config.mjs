export function renderSignozPromBridgeConfig() {
  return `receivers:
  prometheusremotewrite:
    endpoint: 0.0.0.0:19291
    path: /api/v1/write

processors:
  resource/neck:
    attributes:
      - key: encore.app_id
        value: \${env:APP_ID}
        action: upsert
      - key: deployment.environment
        value: \${env:APP_ENV}
        action: upsert
  batch:
    timeout: 5s
    send_batch_size: 10000

exporters:
  otlphttp/signoz:
    endpoint: \${env:SIGNOZ_OTLP_HTTP_ENDPOINT}

service:
  telemetry:
    logs:
      level: warn
  pipelines:
    metrics:
      receivers: [prometheusremotewrite]
      processors: [resource/neck, batch]
      exporters: [otlphttp/signoz]
`;
}

export function renderSignozCollectorConfig() {
  return `connectors:
  signozmeter:
    metrics_flush_interval: 1h
    dimensions:
      - name: service.name
      - name: deployment.environment
      - name: encore.app_id

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
  prometheus:
    config:
      global:
        scrape_interval: 60s
      scrape_configs:
        - job_name: signoz-otel-collector
          static_configs:
            - targets: ["localhost:8888"]

processors:
  batch:
    send_batch_size: 10000
    send_batch_max_size: 11000
    timeout: 10s
  batch/meter:
    send_batch_max_size: 25000
    send_batch_size: 20000
    timeout: 1s
  resourcedetection:
    detectors: [env, system]
    timeout: 2s
  signozspanmetrics/delta:
    metrics_exporter: signozclickhousemetrics
    metrics_flush_interval: 60s
    latency_histogram_buckets: [100us, 1ms, 2ms, 6ms, 10ms, 50ms, 100ms, 250ms, 500ms, 1000ms, 1400ms, 2000ms, 5s, 10s, 20s, 40s, 60s]
    dimensions_cache_size: 100000
    aggregation_temporality: AGGREGATION_TEMPORALITY_DELTA
    enable_exp_histogram: true
    dimensions:
      - name: service.namespace
        default: default
      - name: deployment.environment
        default: production
      - name: encore.app_id
        default: unknown
      - name: service.version
      - name: host.name
      - name: container.name

extensions:
  health_check:
    endpoint: 0.0.0.0:13133

exporters:
  clickhousetraces:
    datasource: tcp://clickhouse:9000/signoz_traces
    low_cardinal_exception_grouping: \${env:LOW_CARDINAL_EXCEPTION_GROUPING}
    use_new_schema: true
  signozclickhousemetrics:
    dsn: tcp://clickhouse:9000/signoz_metrics
  clickhouselogsexporter:
    dsn: tcp://clickhouse:9000/signoz_logs
    timeout: 10s
    use_new_schema: true
  signozclickhousemeter:
    dsn: tcp://clickhouse:9000/signoz_meter
    timeout: 45s
    sending_queue:
      enabled: false
  metadataexporter:
    cache:
      provider: in_memory
    dsn: tcp://clickhouse:9000/signoz_metadata
    enabled: true
    timeout: 45s

service:
  telemetry:
    logs:
      encoding: json
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [signozspanmetrics/delta, batch]
      exporters: [clickhousetraces, metadataexporter, signozmeter]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [signozclickhousemetrics, metadataexporter, signozmeter]
    metrics/prometheus:
      receivers: [prometheus]
      processors: [batch]
      exporters: [signozclickhousemetrics, metadataexporter, signozmeter]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [clickhouselogsexporter, metadataexporter, signozmeter]
    metrics/meter:
      receivers: [signozmeter]
      processors: [batch/meter]
      exporters: [signozclickhousemeter]
`;
}

export function renderSignozCollectorOpampConfig() {
  return `server_endpoint: ws://signoz:4320/v1/opamp
`;
}

export function renderClickHouseClusterXML() {
  return `<?xml version="1.0"?>
<clickhouse>
  <zookeeper>
    <node index="1">
      <host>zookeeper-1</host>
      <port>2181</port>
    </node>
  </zookeeper>
  <remote_servers>
    <cluster>
      <shard>
        <replica>
          <host>clickhouse</host>
          <port>9000</port>
        </replica>
      </shard>
    </cluster>
  </remote_servers>
</clickhouse>
`;
}

export function renderClickHouseCustomFunctionXML() {
  return `<functions>
  <function>
    <type>executable</type>
    <name>histogramQuantile</name>
    <return_type>Float64</return_type>
    <argument>
      <type>Array(Float64)</type>
      <name>buckets</name>
    </argument>
    <argument>
      <type>Array(Float64)</type>
      <name>counts</name>
    </argument>
    <argument>
      <type>Float64</type>
      <name>quantile</name>
    </argument>
    <format>CSV</format>
    <command>./histogramQuantile</command>
  </function>
</functions>
`;
}
