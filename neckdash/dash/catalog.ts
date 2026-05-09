import { sortBy, stringValue, valueOr } from "./config";
import type { CatalogBucket, CatalogEndpoint, CatalogService } from "./types";

type CatalogPath = {
  segments?: Array<{ type?: string; value?: string }>;
};

type CatalogTag = {
  type?: unknown;
  value?: string;
};

type OpenAPIOperation = {
  summary: string;
  description: string;
  tags: string[];
  requestSchemaJson: string;
  responseSchemaJson: string;
};

export function buildCatalog(metaBytes: Buffer, openAPIBytes: Buffer): CatalogService[] {
  if (metaBytes.length === 0) return [];
  let meta: any;
  try {
    meta = JSON.parse(metaBytes.toString());
  } catch {
    return [];
  }

  const serviceDocs = new Map<string, string>();
  for (const pkg of meta.pkgs ?? []) {
    if (!pkg.doc) continue;
    if (pkg.service_name) serviceDocs.set(pkg.service_name, pkg.doc);
    if (pkg.rel_path) serviceDocs.set(pkg.rel_path, pkg.doc);
  }
  const openapiOps = parseOpenAPIOperations(openAPIBytes);

  const services: CatalogService[] = [];
  for (const svc of meta.svcs ?? []) {
    const service: CatalogService = {
      name: stringValue(svc.name),
      relPath: stringValue(svc.rel_path),
      doc: valueOr(serviceDocs.get(svc.name), serviceDocs.get(svc.rel_path) || ""),
      databases: copyStrings(svc.databases),
      metrics: copyStrings(svc.metrics),
      buckets: [],
      endpoints: [],
      publicCount: 0,
      privateCount: 0,
      streamingCount: 0,
    };

    for (const bucket of svc.buckets ?? []) {
      service.buckets.push({
        name: stringValue(bucket.bucket),
        operations: copyStrings(bucket.operations),
      });
    }

    for (const rpc of svc.rpcs ?? []) {
      const method = String((rpc.http_methods ?? [])[0] || "POST").toUpperCase();
      const route = catalogPathString(rpc.path ?? {});
      const operation = openapiOps.get(`${method} ${normalizeOpenAPIPath(route)}`) ?? emptyOpenAPIOperation();
      const [docSummary, docDescription] = splitDoc(stringValue(rpc.doc));
      const access = catalogAccess(rpc.access_type, Object.keys(rpc.expose ?? {}).length > 0, Boolean(rpc.allow_unauthenticated));
      const tags = catalogTags(rpc.tags ?? []);
      const endpoint: CatalogEndpoint = {
        serviceName: valueOr(stringValue(rpc.service_name), service.name),
        name: stringValue(rpc.name),
        method,
        path: route,
        access,
        protocol: catalogProtocol(rpc.proto),
        doc: stringValue(rpc.doc),
        summary: docSummary || operation.summary,
        description: docDescription || operation.description,
        exposed: Object.keys(rpc.expose ?? {}).length > 0,
        authRequired: access === "auth",
        allowUnauthenticated: Boolean(rpc.allow_unauthenticated),
        streaming: Boolean(rpc.streaming_request || rpc.streaming_response),
        tags: tags.length > 0 ? tags : operation.tags,
        requestSchemaJson: operation.requestSchemaJson,
        responseSchemaJson: operation.responseSchemaJson,
      };
      if (endpoint.exposed) service.publicCount++;
      else service.privateCount++;
      if (endpoint.streaming) service.streamingCount++;
      service.endpoints.push(endpoint);
    }
    sortBy(service.endpoints, (endpoint) => `${endpoint.path}\x00${endpoint.method}`);
    services.push(service);
  }
  return sortBy(services, (service) => service.name);
}

function copyStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map((value) => String(value)) : [];
}

function catalogPathString(path: CatalogPath) {
  const segments = path.segments ?? [];
  if (segments.length === 0) return "/";
  const parts = segments.map((segment) => {
    switch (String(segment.type || "").toUpperCase()) {
      case "PARAM":
        return `:${segment.value || ""}`;
      case "WILDCARD":
      case "FALLBACK":
        return `*${segment.value || "path"}`;
      default:
        return segment.value || "";
    }
  });
  return `/${parts.join("/")}`;
}

function parseOpenAPIOperations(data: Buffer) {
  const operations = new Map<string, OpenAPIOperation>();
  if (data.length === 0) return operations;
  let spec: any;
  try {
    spec = JSON.parse(data.toString());
  } catch {
    return operations;
  }
  for (const [route, methods] of Object.entries<Record<string, any>>(spec.paths ?? {})) {
    for (const [method, op] of Object.entries<any>(methods ?? {})) {
      operations.set(`${method.toUpperCase()} ${normalizeOpenAPIPath(route)}`, {
        summary: stringValue(op.summary),
        description: stringValue(op.description),
        tags: copyStrings(op.tags),
        requestSchemaJson: schemaJSON(op.requestBody?.content),
        responseSchemaJson: responseSchemaJSON(op.responses),
      });
    }
  }
  return operations;
}

function emptyOpenAPIOperation(): OpenAPIOperation {
  return { summary: "", description: "", tags: [], requestSchemaJson: "", responseSchemaJson: "" };
}

function schemaJSON(content: any) {
  if (!content) return "";
  const schema = content["application/json"]?.schema ?? Object.values<any>(content)[0]?.schema;
  return marshalPrettyJSON(schema);
}

function responseSchemaJSON(responses: any) {
  for (const [code, response] of Object.entries<any>(responses ?? {})) {
    if (code.startsWith("2")) {
      const schema = schemaJSON(response.content);
      if (schema) return schema;
    }
  }
  return schemaJSON(responses?.default?.content);
}

function marshalPrettyJSON(value: unknown) {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function splitDoc(doc: string): [string, string] {
  const lines = doc.trim().split(/\r?\n/);
  const summary = (lines[0] || "").trim();
  return [summary, lines.length > 1 ? lines.slice(1).join("\n").trim() : ""];
}

function catalogAccess(raw: unknown, exposed: boolean, allowUnauthenticated: boolean) {
  switch (String(raw).toUpperCase()) {
    case "2":
    case "AUTH":
    case "RPC_ACCESS_TYPE_AUTH":
      return "auth";
    case "1":
    case "PUBLIC":
    case "RPC_ACCESS_TYPE_PUBLIC":
      return "public";
    default:
      if (exposed && !allowUnauthenticated) return "auth";
      if (exposed) return "public";
      return "private";
  }
}

function catalogProtocol(raw: unknown) {
  switch (String(raw).toUpperCase()) {
    case "1":
    case "RAW":
    case "RPC_PROTOCOL_RAW":
      return "raw";
    default:
      return "regular";
  }
}

function catalogTags(tags: CatalogTag[]) {
  return sortBy(tags.map((tag) => tag.value || "").filter(Boolean), (tag) => tag);
}

function normalizeOpenAPIPath(path: string) {
  return path.split("/").map((part) => part.startsWith("{") && part.endsWith("}") ? `:${part.slice(1, -1)}` : part).join("/");
}
