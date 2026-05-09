import type { Query } from "encore.dev/api";

export interface HealthResponse {
  ok: boolean;
}

export interface AppParams {
  app?: Query<string>;
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
