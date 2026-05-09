import { getJSON, sortBy, stringValue, valueOr, victoriaTracesQueryURL } from "./config";
import type { FlowEdge, FlowNode } from "./types";

type EdgeAccumulator = { edge: FlowEdge };

export async function buildFlow(metaBytes: Buffer): Promise<{ nodes: FlowNode[]; edges: FlowEdge[] }> {
  const { nodes, edgeMap, services } = catalogFlow(metaBytes);
  const seenNodes = new Set(nodes.map((node) => node.id));

  for (const observed of await observedFlowEdges()) {
    if (services.size > 0 && (!services.has(observed.source) || !services.has(observed.target))) continue;
    const sourceID = flowServiceID(observed.source);
    const targetID = flowServiceID(observed.target);
    if (!seenNodes.has(sourceID)) {
      nodes.push({ id: sourceID, kind: "service", name: observed.source });
      seenNodes.add(sourceID);
    }
    if (!seenNodes.has(targetID)) {
      nodes.push({ id: targetID, kind: "service", name: observed.target });
      seenNodes.add(targetID);
    }
    mergeFlowEdge(edgeMap, {
      source: sourceID,
      target: targetID,
      kind: "rpc",
      observed: true,
      observedCount: observed.count,
      count: observed.count,
    });
  }

  const edges = [...edgeMap.values()].map((acc) => {
    const edge = acc.edge;
    edge.count ||= edge.observedCount || edge.staticCount || 0;
    return edge;
  });

  return {
    nodes: sortBy(nodes, (node) => `${node.kind}\x00${node.name}`),
    edges: sortBy(edges, (edge) => `${edge.source}\x00${edge.target}\x00${edge.kind}`),
  };
}

async function observedFlowEdges() {
  const end = Date.now();
  const endpoint = `${victoriaTracesQueryURL()}/api/dependencies?endTs=${end}&lookback=${60 * 60 * 1000}`;
  try {
    const raw = await getJSON<{ data?: Array<{ parent?: string; child?: string; callCount?: number }> }>(endpoint);
    return (raw.data ?? [])
      .filter((item) => item.parent && item.child)
      .map((item) => ({ source: item.parent!, target: item.child!, count: item.callCount || 0 }));
  } catch {
    return [];
  }
}

function catalogFlow(data: Buffer) {
  if (data.length === 0) {
    return { nodes: [] as FlowNode[], edgeMap: new Map<string, EdgeAccumulator>(), services: new Set<string>() };
  }
  let meta: any;
  try {
    meta = JSON.parse(data.toString());
  } catch {
    return { nodes: [] as FlowNode[], edgeMap: new Map<string, EdgeAccumulator>(), services: new Set<string>() };
  }

  const packageToService = new Map<string, string>();
  const serviceToPackages = new Map<string, string[]>();
  const serviceDocs = new Map<string, string>();
  for (const pkg of meta.pkgs ?? []) {
    if (!pkg.service_name) continue;
    packageToService.set(pkg.rel_path, pkg.service_name);
    serviceToPackages.set(pkg.service_name, [...(serviceToPackages.get(pkg.service_name) ?? []), pkg.rel_path]);
    if (pkg.doc && !serviceDocs.has(pkg.service_name)) serviceDocs.set(pkg.service_name, pkg.doc);
  }

  const seenNodes = new Set<string>();
  const nodes: FlowNode[] = [];
  const services = new Set<string>();
  const addNode = (node: FlowNode) => {
    if (!node.id || seenNodes.has(node.id)) return;
    seenNodes.add(node.id);
    nodes.push(node);
  };

  for (const svc of meta.svcs ?? []) {
    const name = stringValue(svc.name);
    services.add(name);
    const counts = flowEndpointCounts(svc.rpcs ?? []);
    addNode({
      id: flowServiceID(name),
      kind: "service",
      name,
      doc: serviceDocs.get(name) || "",
      publicEndpoints: counts.public,
      authEndpoints: counts.auth,
      privateEndpoints: counts.private,
      databases: copyStrings(svc.databases),
      cronJobs: flowServiceCronTitles(meta.cron_jobs ?? [], serviceToPackages.get(name) ?? []),
    });
  }

  for (const topic of meta.pubsub_topics ?? []) {
    addNode({ id: flowTopicID(topic.name), kind: "topic", name: stringValue(topic.name), doc: stringValue(topic.doc) });
  }

  const edgeMap = new Map<string, EdgeAccumulator>();
  for (const pkg of meta.pkgs ?? []) {
    const sourceService = packageToService.get(pkg.rel_path);
    if (!sourceService) continue;
    for (const rpc of pkg.rpc_calls ?? []) {
      const targetService = packageToService.get(rpc.pkg);
      if (!targetService || targetService === sourceService) continue;
      mergeFlowEdge(edgeMap, {
        source: flowServiceID(sourceService),
        target: flowServiceID(targetService),
        kind: "rpc",
        static: true,
        staticCount: 1,
        count: 1,
        details: [valueOr(rpc.name, rpc.pkg)],
      });
    }
  }

  for (const svc of meta.svcs ?? []) {
    for (const database of svc.databases ?? []) {
      if (database === svc.name || !services.has(database)) continue;
      mergeFlowEdge(edgeMap, {
        source: flowServiceID(svc.name),
        target: flowServiceID(database),
        kind: "database",
        static: true,
        staticCount: 1,
        count: 1,
        details: [database],
      });
    }
  }

  for (const topic of meta.pubsub_topics ?? []) {
    const topicID = flowTopicID(topic.name);
    for (const publisher of topic.publishers ?? []) {
      if (!publisher.service_name) continue;
      mergeFlowEdge(edgeMap, {
        source: flowServiceID(publisher.service_name),
        target: topicID,
        kind: "publish",
        static: true,
        staticCount: 1,
        count: 1,
        details: [topic.name],
      });
    }
    for (const subscription of topic.subscriptions ?? []) {
      if (!subscription.service_name) continue;
      mergeFlowEdge(edgeMap, {
        source: topicID,
        target: flowServiceID(subscription.service_name),
        kind: "subscription",
        static: true,
        staticCount: 1,
        count: 1,
        details: [subscription.name || topic.name],
      });
    }
  }

  return { nodes, edgeMap, services };
}

function mergeFlowEdge(edges: Map<string, EdgeAccumulator>, edge: FlowEdge) {
  const key = `${edge.source}\x00${edge.target}\x00${edge.kind}`;
  const acc = edges.get(key);
  if (!acc) {
    if (!edge.staticCount && edge.static) edge.staticCount = 1;
    if (!edge.observedCount && edge.observed) edge.observedCount = edge.count;
    edges.set(key, { edge });
    return;
  }
  acc.edge.static = Boolean(acc.edge.static || edge.static);
  acc.edge.observed = Boolean(acc.edge.observed || edge.observed);
  acc.edge.staticCount = (acc.edge.staticCount || 0) + (edge.staticCount || 0);
  acc.edge.observedCount = (acc.edge.observedCount || 0) + (edge.observedCount || 0);
  acc.edge.count = (acc.edge.count || 0) + (edge.count || 0);
  acc.edge.details = [...(acc.edge.details ?? []), ...(edge.details ?? [])];
}

function flowEndpointCounts(rpcs: any[]) {
  const counts = { public: 0, auth: 0, private: 0 };
  for (const rpc of rpcs) {
    const access = flowAccessType(rpc.access_type);
    counts[access as keyof typeof counts]++;
  }
  return counts;
}

function flowAccessType(raw: unknown): "public" | "auth" | "private" {
  const value = String(raw).toLowerCase();
  if (value.includes("public") || value === "1") return "public";
  if (value.includes("auth") || value === "2") return "auth";
  return "private";
}

function flowServiceCronTitles(crons: any[], packages: string[]) {
  const owned = new Set(packages);
  return sortBy(crons.filter((cron) => owned.has(cron.endpoint?.pkg)).map((cron) => stringValue(cron.title, cron.id)), (title) => title);
}

function flowServiceID(name: string) {
  return name.startsWith("service:") ? name : `service:${name}`;
}

function flowTopicID(name: string) {
  return name.startsWith("topic:") ? name : `topic:${name}`;
}

function copyStrings(values: unknown): string[] {
  return Array.isArray(values) ? values.map((value) => String(value)) : [];
}
