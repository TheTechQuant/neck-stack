import type { Query } from "encore.dev/api";

export interface HealthResponse {
  ok: boolean;
}

export interface AppParams {
  app?: Query<string>;
}

export interface TraceListParams {
  app?: Query<string>;
  service?: Query<string>;
  search?: Query<string>;
  limit?: Query<number>;
  hours?: Query<number>;
}

export interface DashApp {
  id: string;
  name: string;
  metaPath: string;
  openapiPath: string;
  hasMeta: boolean;
  hasOpenapi: boolean;
}

export interface AppsResponse {
  apps: DashApp[];
  defaultApp: string;
}

export interface TraceSummary {
  traceId: string;
  service: string;
  endpoint: string;
  startedAt: string;
  durationMs: number;
  spanCount: number;
  error: boolean;
  statusCode: number;
  environment: string;
}

export interface TraceListResponse {
  traces: TraceSummary[];
}

export interface TraceServicesResponse {
  services: string[];
}

export interface TraceDetailParams {
  traceID: string;
}

export interface TraceDetailResponse {
  traceId: string;
  rawJson: string;
}

export interface LogListParams {
  app?: Query<string>;
  query?: Query<string>;
  service?: Query<string>;
  level?: Query<string>;
  traceId?: Query<string>;
  limit?: Query<number>;
  hours?: Query<number>;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  level: string;
  service: string;
  endpoint: string;
  traceId: string;
  spanId: string;
  fields: Record<string, string>;
}

export interface LogListResponse {
  query: string;
  logs: LogEntry[];
}

export interface MetricsParams {
  hours?: Query<number>;
  app?: Query<string>;
}

export interface InsightsParams {
  range?: Query<string>;
  app?: Query<string>;
}

export interface InsightsPoint {
  timestamp: string;
  value: number;
}

export interface InsightsSeries {
  service: string;
  points: InsightsPoint[];
}

export interface InsightsService {
  service: string;
  requests: number;
  errors: number;
  errorRate: number;
  rate: number;
}

export interface InsightsResponse {
  range: string;
  windowSeconds: number;
  requests: number;
  errors: number;
  errorRate: number;
  requestRate: InsightsSeries[];
  services: InsightsService[];
}

export interface ServiceMetric {
  service: string;
  endpoint: string;
  traceCount: number;
  errorCount: number;
}

export interface MetricsResponse {
  windowHours: number;
  services: ServiceMetric[];
  runtime: MetricSample[];
}

export interface MetricLabel {
  key: string;
  doc: string;
}

export interface MetricDefinition {
  name: string;
  kind: string;
  doc: string;
  serviceName: string;
  labels: MetricLabel[];
}

export interface MetricSample {
  name: string;
  kind: string;
  serviceName: string;
  labels: Record<string, string>;
  value: number;
  windowValue: number;
  timestamp: string;
}

export interface CustomMetricsResponse {
  windowHours: number;
  definitions: MetricDefinition[];
  samples: MetricSample[];
}

export interface FlowNode {
  id: string;
  kind: string;
  name: string;
  doc?: string;
  publicEndpoints?: number;
  authEndpoints?: number;
  privateEndpoints?: number;
  databases?: string[];
  cronJobs?: string[];
}

export interface FlowEdge {
  source: string;
  target: string;
  kind: string;
  count: number;
  static?: boolean;
  observed?: boolean;
  staticCount?: number;
  observedCount?: number;
  details?: string[];
}

export interface FlowResponse {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface CatalogResponse {
  appId: string;
  metaJson: string;
  openapiJson: string;
  services: CatalogService[];
}

export interface CatalogService {
  name: string;
  relPath: string;
  doc: string;
  databases: string[];
  metrics: string[];
  buckets: CatalogBucket[];
  endpoints: CatalogEndpoint[];
  publicCount: number;
  privateCount: number;
  streamingCount: number;
}

export interface CatalogBucket {
  name: string;
  operations: string[];
}

export interface CatalogEndpoint {
  serviceName: string;
  name: string;
  method: string;
  path: string;
  access: string;
  protocol: string;
  doc: string;
  summary: string;
  description: string;
  exposed: boolean;
  authRequired: boolean;
  allowUnauthenticated: boolean;
  streaming: boolean;
  tags: string[];
  requestSchemaJson: string;
  responseSchemaJson: string;
}

export interface SamplingResponse {
  rules: SamplingRule[];
  runtimeNote: string;
}

export interface SamplingRule {
  scopeType: string;
  scopeValue: string;
  rate: number;
}

export interface ConfigVariable {
  name: string;
  kind: string;
  value?: string;
  masked: boolean;
  present: boolean;
  required: boolean;
  editable: boolean;
  source: string;
  description: string;
}

export interface ConfigResponse {
  appId: string;
  stackName: string;
  komodoConfigured: boolean;
  komodoUrl?: string;
  backendSecrets: ConfigVariable[];
  frontendVariables: ConfigVariable[];
  stackVariables: ConfigVariable[];
  requiredEnv: string[];
  runtimeNote: string;
}

export interface ConfigUpdateParams {
  app: string;
  kind: string;
  name: string;
  value: string;
  redeploy: boolean;
}

export interface ConfigUpdateResponse {
  ok: boolean;
  message: string;
  deployed: boolean;
}

export interface LiveEvent {
  type: string;
  time: string;
}
