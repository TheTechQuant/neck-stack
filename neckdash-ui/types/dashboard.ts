import type { dash } from "~/lib/neckdash-client.gen";

export type DashboardView = "overview" | "catalog" | "flow" | "settings";
export type LoadState = "idle" | "loading" | "ready" | "error";

export type DashApp = dash.DashApp;
export type CatalogEndpoint = dash.CatalogEndpoint;
export type CatalogService = dash.CatalogService;
export type ConfigResponse = dash.ConfigResponse;
export type ConfigVariable = dash.ConfigVariable;
export type ConfigUpdateResponse = dash.ConfigUpdateResponse;
export type FlowEdge = dash.FlowEdge;
export type FlowNode = dash.FlowNode;
export type SamplingResponse = dash.SamplingResponse;
