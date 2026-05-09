import { APIError } from "encore.dev/api";
import { selectedCatalog } from "./apps";
import { env, stringValue } from "./config";
import type { ConfigResponse, ConfigUpdateParams, ConfigUpdateResponse, ConfigVariable } from "./types";

const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

type KomodoStack = {
  id?: string;
  _id?: { $oid?: string };
  name?: string;
  config?: Record<string, unknown> & { environment?: string };
};

type KomodoVariable = {
  name?: string;
  description?: string;
  value?: string;
  is_secret?: boolean;
};

export async function readConfig(appID = ""): Promise<ConfigResponse> {
  const catalog = selectedCatalog(appID);
  if (!catalog.app.id) {
    return { appId: "", stackName: "", komodoConfigured: false, backendSecrets: [], frontendVariables: [], stackVariables: [], requiredEnv: requiredKomodoEnv(), runtimeNote: configRuntimeNote(false) };
  }

  const response: ConfigResponse = {
    appId: catalog.app.id,
    stackName: catalog.app.id,
    komodoConfigured: komodoConfigured(),
    komodoUrl: komodoURL() || undefined,
    backendSecrets: [],
    frontendVariables: [],
    stackVariables: [],
    requiredEnv: requiredKomodoEnv(),
    runtimeNote: configRuntimeNote(komodoConfigured()),
  };
  let envVars: Record<string, string> = {};
  if (response.komodoConfigured) {
    try {
      const stack = await komodoGetStack(catalog.app.id);
      response.stackName = stack.name || catalog.app.id;
      envVars = parseStackEnvironment(stack.config?.environment || "");
    } catch {
      // The UI still shows declared secrets and frontend variable affordances.
    }
  }

  for (const name of secretNamesFromMeta(catalog.metaBytes)) {
    const envValue = envVars[name] || "";
    const reference = variableReference(envValue);
    const variableName = reference || secretVariableName(catalog.app.id, name);
    let present = Boolean(envValue && !reference);
    let source = "Encore metadata";
    const variable = response.komodoConfigured ? await komodoGetVariable(variableName).catch(() => undefined) : undefined;
    if (variable) {
      present = true;
      source = variable.is_secret ? "Komodo secret variable" : "Komodo variable";
    } else if (envValue && reference) {
      source = `Missing Komodo variable ${reference}`;
    } else if (present) {
      source = "Stack environment";
    }
    response.backendSecrets.push({
      name,
      kind: "backend_secret",
      masked: true,
      present,
      required: true,
      editable: response.komodoConfigured && envNamePattern.test(name),
      source,
      description: "Encore secret declared in backend metadata.",
    });
  }
  response.frontendVariables = frontendVariables(envVars);
  response.stackVariables = stackVariables(envVars);
  return response;
}

export async function updateConfig(params: ConfigUpdateParams): Promise<ConfigUpdateResponse> {
  if (!komodoConfigured()) throw APIError.failedPrecondition("NECK Dash Komodo API credentials are not configured");
  const appID = params.app.trim();
  if (!appID) throw APIError.invalidArgument("select an app before editing configuration");
  const name = params.name.trim();
  if (!envNamePattern.test(name)) throw APIError.invalidArgument("configuration names must be valid environment variable names");
  if (/[\r\n]/.test(params.value)) throw APIError.invalidArgument("configuration values must be single-line strings");

  const catalog = selectedCatalog(appID);
  const stack = await komodoGetStack(catalog.app.id);
  const envVars = parseStackEnvironment(stack.config?.environment || "");
  switch (params.kind.trim().toLowerCase()) {
    case "backend_secret":
      if (!secretNamesFromMeta(catalog.metaBytes).includes(name)) throw APIError.invalidArgument("secret is not declared in Encore metadata; add secret(...) and regenerate infra first");
      if (!params.value.trim()) throw APIError.invalidArgument("secret value cannot be empty");
      {
        const variableName = variableReference(envVars[name] || "") || secretVariableName(catalog.app.id, name);
        await komodoUpsertVariable(variableName, params.value, true, "Encore backend secret managed from NECK Dash");
        envVars[name] = `[[${variableName}]]`;
      }
      break;
    case "frontend_variable":
      if (!isEditableFrontendVariable(name, envVars)) throw APIError.invalidArgument("frontend variables must start with NUXT_PUBLIC_ or already exist in the frontend stack environment");
      envVars[name] = params.value;
      break;
    default:
      throw APIError.invalidArgument("kind must be backend_secret or frontend_variable");
  }
  await komodoUpdateStackEnvironment(stack, renderStackEnvironment(envVars));
  let deployed = false;
  if (params.redeploy) {
    await komodoDeployStack(catalog.app.id);
    deployed = true;
  }
  return { ok: true, message: "configuration updated", deployed };
}

function configRuntimeNote(configured: boolean) {
  return configured
    ? "Backend secrets are stored as Komodo secret variables and referenced by the app stack. Frontend variables update the app stack environment and require redeploy."
    : "Set NECKDASH_KOMODO_URL, NECKDASH_KOMODO_API_KEY, and NECKDASH_KOMODO_API_SECRET on the shared neckdash stack to enable edits.";
}

function requiredKomodoEnv() {
  return ["NECKDASH_KOMODO_URL", "NECKDASH_KOMODO_API_KEY", "NECKDASH_KOMODO_API_SECRET"];
}

function komodoConfigured() {
  return Boolean(komodoURL() && env("NECKDASH_KOMODO_API_KEY") && env("NECKDASH_KOMODO_API_SECRET"));
}

function komodoURL() {
  return env("NECKDASH_KOMODO_URL").trim().replace(/\/+$/g, "");
}

async function komodoRequest<T>(section: string, type: string, params: unknown): Promise<T> {
  const response = await fetch(`${komodoURL()}/${section}/${type}`, {
    method: "POST",
    body: JSON.stringify(params),
    headers: {
      "content-type": "application/json",
      "x-api-key": env("NECKDASH_KOMODO_API_KEY"),
      "x-api-secret": env("NECKDASH_KOMODO_API_SECRET"),
    },
  });
  if (!response.ok) throw new Error(`Komodo ${section}/${type} failed with HTTP ${response.status}: ${await response.text().catch(() => "")}`);
  return await response.json() as T;
}

function komodoGetStack(appID: string) {
  return komodoRequest<KomodoStack>("read", "GetStack", { stack: appID });
}

function komodoGetVariable(name: string) {
  return komodoRequest<KomodoVariable>("read", "GetVariable", { name });
}

async function komodoUpsertVariable(name: string, value: string, secret: boolean, description: string) {
  const existing = await komodoGetVariable(name).catch(() => undefined);
  if (existing) return komodoRequest<unknown>("write", "UpdateVariableValue", { name, value });
  return komodoRequest<unknown>("write", "CreateVariable", { name, value, description, is_secret: secret });
}

function komodoUpdateStackEnvironment(stack: KomodoStack, environment: string) {
  const id = stack.id || stack._id?.$oid || stack.name;
  return komodoRequest<unknown>("write", "UpdateStack", { id, config: { ...(stack.config ?? {}), environment } });
}

async function komodoDeployStack(stack: string) {
  const update: any = await komodoRequest("execute", "DeployStack", { stack });
  const id = update?._id?.$oid;
  if (!id || update.status === "Complete") return;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const current: any = await komodoRequest("read", "GetUpdate", { id });
    if (current.status === "Complete") return;
    if (current.status === "Err") throw new Error(`Komodo deploy failed: ${current.data?.message || "unknown error"}`);
  }
  throw new Error("Komodo deploy timed out");
}

function parseStackEnvironment(raw: string) {
  const envVars: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    if (envNamePattern.test(key)) envVars[key] = trimmed.slice(index + 1).trim();
  }
  return envVars;
}

function renderStackEnvironment(envVars: Record<string, string>) {
  return Object.keys(envVars).sort().map((key) => `${key} = ${envVars[key]}`).join("\n") + "\n";
}

function secretNamesFromMeta(data: Buffer) {
  if (data.length === 0) return [];
  let raw: any;
  try {
    raw = JSON.parse(data.toString());
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const pkg of raw.pkgs ?? []) {
    for (const secret of pkg.secrets ?? []) {
      const name = stringValue(secret).trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

function frontendVariables(envVars: Record<string, string>): ConfigVariable[] {
  return Object.keys(envVars).filter(isFrontendVariable).sort().map((key) => ({
    name: key,
    kind: "frontend_variable",
    value: envVars[key],
    masked: false,
    present: true,
    required: false,
    editable: true,
    source: "Stack environment",
    description: "Frontend runtime/build variable passed through the app stack.",
  }));
}

function stackVariables(envVars: Record<string, string>): ConfigVariable[] {
  return Object.keys(envVars)
    .filter((key) => !isFrontendVariable(key) && !envVars[key].includes("[["))
    .sort()
    .map((key) => ({
      name: key,
      kind: "stack_variable",
      value: envVars[key],
      masked: false,
      present: true,
      required: false,
      editable: false,
      source: "Stack environment",
      description: "",
    }));
}

function isFrontendVariable(name: string) {
  return name.startsWith("NUXT_PUBLIC_") || name.startsWith("NUXT_APP_") || name === "NUXT_API_INTERNAL_BASE_URL";
}

function isEditableFrontendVariable(name: string, envVars: Record<string, string>) {
  return name.startsWith("NUXT_PUBLIC_") || (isFrontendVariable(name) && envVars[name] !== undefined);
}

function variableReference(value: string) {
  const match = value.trim().match(/^\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]$/);
  return match?.[1] || "";
}

function secretVariableName(appID: string, name: string) {
  return komodoVariableName(`${appID}_${name}`);
}

function komodoVariableName(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}
