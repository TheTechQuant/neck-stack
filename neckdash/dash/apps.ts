import fs from "node:fs";
import path from "node:path";
import { APIError } from "encore.dev/api";
import { env, safeJSONParse, sortBy, stringValue } from "./config";
import type { DashApp } from "./types";

export interface AppCatalog {
  app: DashApp;
  metaBytes: Buffer;
  openAPIBytes: Buffer;
}

export function discoverApps(): DashApp[] {
  const seen = new Map<string, DashApp>();
  const root = env("NECKDASH_APPS_ROOT", "").trim();
  if (root) {
    for (const metaPath of findMetaFiles(root)) {
      const normalized = metaPath.split(path.sep).join("/");
      if (!normalized.endsWith("/deploy/encore/meta.json")) continue;
      const appRoot = path.resolve(path.dirname(metaPath), "..", "..");
      const openAPIPath = path.join(appRoot, "docs", "openapi.json");
      const app = dashAppFromPaths(metaPath, openAPIPath, path.basename(appRoot));
      if (app.id) seen.set(app.id, app);
    }
  }

  const metaPath = env("NECKDASH_META_PATH", "").trim();
  if (metaPath) {
    const app = dashAppFromPaths(metaPath, env("NECKDASH_OPENAPI_PATH", "").trim(), env("NECKDASH_APP_ID", "app"));
    if (app.id) seen.set(app.id, app);
  }

  return sortBy([...seen.values()], (app) => app.id);
}

export function selectedCatalog(appID = ""): AppCatalog {
  const apps = discoverApps();
  if (apps.length === 0) {
    return {
      app: { id: "", name: "", metaPath: "", openapiPath: "", hasMeta: false, hasOpenapi: false },
      metaBytes: Buffer.alloc(0),
      openAPIBytes: Buffer.alloc(0),
    };
  }

  let selected = apps[0];
  const requested = appID.trim();
  if (requested) {
    const found = apps.find((app) => app.id === requested);
    if (!found) throw APIError.notFound("unknown app");
    selected = found;
  }

  return {
    app: selected,
    metaBytes: readMaybe(selected.metaPath),
    openAPIBytes: readMaybe(selected.openapiPath),
  };
}

function findMetaFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.name === "meta.json") {
        out.push(child);
      }
    }
  }
  return out;
}

function dashAppFromPaths(metaPath: string, openAPIPath: string, fallbackID: string): DashApp {
  const id = appIDFromMeta(metaPath) || sanitizeAppID(fallbackID);
  return {
    id,
    name: id,
    metaPath,
    openapiPath: openAPIPath,
    hasMeta: fileExists(metaPath),
    hasOpenapi: fileExists(openAPIPath),
  };
}

function appIDFromMeta(metaPath: string) {
  const raw = safeJSONParse<Record<string, unknown>>(readMaybe(metaPath));
  if (!raw) return "";
  for (const key of ["app_id", "appId", "app_slug", "appSlug", "id", "slug"]) {
    const value = stringValue(raw[key], "").trim();
    if (value) return sanitizeAppID(value);
  }
  return "";
}

function sanitizeAppID(value: string) {
  const ext = path.extname(value);
  return value.trim().slice(0, ext ? -ext.length : undefined).replace(/^[._\-\s]+|[._\-\s]+$/g, "");
}

function fileExists(filePath: string) {
  if (!filePath) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readMaybe(filePath: string) {
  if (!filePath) return Buffer.alloc(0);
  try {
    return fs.readFileSync(filePath);
  } catch {
    return Buffer.alloc(0);
  }
}
