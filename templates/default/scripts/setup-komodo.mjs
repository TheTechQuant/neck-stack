#!/usr/bin/env zx
import { fs } from "zx";
import { parse } from "@bomb.sh/args";
import { cancel, isCancel, password, text } from "@clack/prompts";
import chalk from "chalk";
import { loadDotEnv, upsertDotEnv } from "./lib/env.mjs";

await loadDotEnv();

const args = parse(process.argv.slice(3).filter((arg) => arg !== "--"), {
  alias: { h: "help" },
  boolean: ["dry-run", "help", "skip-ingress", "skip-shared", "update-shared"],
});

const allowedArgs = new Set(["_", "dry-run", "help", "skip-ingress", "skip-shared", "update-shared"]);
const unknownArgs = Object.keys(args).filter((key) => !allowedArgs.has(key));
if (unknownArgs.length > 0) {
  throw new Error(`Unknown option${unknownArgs.length === 1 ? "" : "s"}: ${unknownArgs.map((key) => `--${key}`).join(", ")}`);
}

if (args.help) {
  console.log(`
Usage:
  pnpm komodo:setup [options]

Options:
  --skip-ingress    Do not create the shared neck-ingress network/Caddy proxy
  --skip-shared     Do not create the shared NECK Dash Resource Sync
  --update-shared   Update the shared NECK Dash Resource Sync if it already exists
  --dry-run         Print planned Komodo actions without applying them
  -h, --help        Show help
`.trim());
  process.exit(0);
}

const dryRun = args["dry-run"] === true;
const skipIngress = args["skip-ingress"] === true;
const skipShared = args["skip-shared"] === true;
const updateShared = args["update-shared"] === true;

function envOrDefault(name, fallback) {
  const value = String(process.env[name] || fallback || "").trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env or export it before running pnpm komodo:setup.`);
  }
  return value;
}

async function promptEnv(name, message, { fallback = "", secret = false } = {}) {
  const current = String(process.env[name] || "").trim();
  if (current) return current;
  if (fallback) return fallback;
  if (!process.stdin.isTTY) {
    return envOrDefault(name, "");
  }

  const answer = secret
    ? await password({ message })
    : await text({ defaultValue: fallback || undefined, message, placeholder: fallback || undefined });
  if (isCancel(answer)) {
    cancel("Cancelled.");
    process.exit(0);
  }

  const value = String(answer || fallback || "").trim();
  if (!value) throw new Error(`Missing ${name}.`);
  process.env[name] = value;
  await upsertDotEnv({ [name]: value });
  return value;
}

const komodoUrl = (await promptEnv("KOMODO_URL", "Komodo Core URL", { fallback: "__KOMODO_URL__" })).replace(/\/+$/g, "");
const komodoApiKey = await promptEnv("KOMODO_API_KEY", "Komodo API key");
const komodoApiSecret = await promptEnv("KOMODO_API_SECRET", "Komodo API secret", { secret: true });
const komodoServer = await promptEnv("KOMODO_SERVER", "Komodo server", { fallback: "__KOMODO_SERVER__" });
await upsertDotEnv({
  KOMODO_API_KEY: komodoApiKey,
  KOMODO_API_SECRET: komodoApiSecret,
});
const appID = String(process.env.APP_ID || "__APP_ID__").trim();
const traceAuthKey = String(process.env.NECKDASH_TRACE_AUTH_KEY || "__TRACE_AUTH_KEY_DEFAULT__").trim();
const ingressNetwork = String(process.env.NECK_INGRESS_NETWORK || "neck-ingress").trim();
const sharedStackName = String(process.env.NECKDASH_STACK_NAME || "neckdash").trim();
const sharedSyncName = String(process.env.NECKDASH_SYNC_NAME || "neckdash-sync").trim();
const appSyncName = String(process.env.KOMODO_RESOURCE_SYNC_NAME || `${appID}-sync`).trim();

async function komodoRequest(section, type, params) {
  const response = await fetch(`${komodoUrl}/${section}/${type}`, {
    method: "POST",
    body: JSON.stringify(params),
    headers: {
      "content-type": "application/json",
      "x-api-key": komodoApiKey,
      "x-api-secret": komodoApiSecret,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Komodo ${section}/${type} failed: HTTP ${response.status}${body ? `\n${body}` : ""}`);
  }
  return response.json();
}

const komodoRead = (type, params) => komodoRequest("read", type, params);
const komodoWrite = (type, params) => komodoRequest("write", type, params);
const komodoExecute = (type, params) => komodoRequest("execute", type, params);

async function komodoExecuteAndPoll(type, params) {
  const update = await komodoExecute(type, params);
  if (Array.isArray(update)) {
    return Promise.all(update.map((item) => item.status === "Err" ? item : pollUpdate(item.data?._id?.$oid)));
  }
  if (update.status === "Complete" || !update._id?.$oid) return update;
  return pollUpdate(update._id.$oid);
}

async function pollUpdate(id) {
  if (!id) return { status: "Complete" };
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const update = await komodoRead("GetUpdate", { id });
    if (update.status === "Complete" || update.status === "Err") return update;
  }
}

async function executeServerTerminal({ server, command, init }, { onLine, onFinish } = {}) {
  const response = await fetch(`${komodoUrl}/terminal/execute`, {
    method: "POST",
    body: JSON.stringify({
      target: { type: "Server", params: { server } },
      command,
      init,
    }),
    headers: {
      "content-type": "application/json",
      "x-api-key": komodoApiKey,
      "x-api-secret": komodoApiSecret,
    },
  });
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new Error(`Komodo terminal execute failed: HTTP ${response.status}${body ? `\n${body}` : ""}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tail += decoder.decode(value, { stream: true });
    const lines = tail.split(/\r?\n/);
    tail = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("__KOMODO_EXIT_CODE")) {
        await onFinish?.(line.split(":")[1]);
        return;
      }
      await onLine?.(line);
    }
  }
  if (tail) await onLine?.(tail);
  await onFinish?.("Early exit without code");
}

async function readFile(path) {
  if (!(await fs.pathExists(path))) {
    throw new Error(`Missing ${path}. Run pnpm neck infra first.`);
  }
  return fs.readFile(path, "utf8");
}

function syncConfig(contents) {
  return {
    git_provider: String(process.env.GIT_PROVIDER || "__GIT_PROVIDER__"),
    git_https: true,
    branch: "main",
    webhook_enabled: false,
    include_resources: true,
    include_variables: false,
    include_user_groups: false,
    pending_alert: true,
    delete: false,
    managed: false,
    file_contents: contents,
  };
}

async function getResourceSync(name) {
  try {
    return await komodoRead("GetResourceSync", { sync: name });
  } catch {
    return null;
  }
}

async function getStack(name) {
  try {
    return await komodoRead("GetStack", { stack: name });
  } catch {
    return null;
  }
}

async function getVariable(name) {
  try {
    return await komodoRead("GetVariable", { name });
  } catch {
    return null;
  }
}

function resourceId(resource) {
  return resource?.id || resource?._id?.$oid;
}

async function upsertVariable(name, value, { secret = false, description = "" } = {}) {
  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] create/update Komodo variable ${name}`));
    return;
  }

  const existing = await getVariable(name);
  if (existing) {
    await komodoWrite("UpdateVariableValue", { name, value });
    console.log(chalk.green(`Updated Komodo variable ${name}`));
    return;
  }

  await komodoWrite("CreateVariable", {
    name,
    value,
    description,
    is_secret: secret,
  });
  console.log(chalk.green(`Created Komodo variable ${name}`));
}

async function upsertSync(name, contents, { updateExisting = true } = {}) {
  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] create/update Resource Sync ${name}`));
    return true;
  }

  const existing = await getResourceSync(name);
  if (existing && !updateExisting) {
    console.log(chalk.dim(`Resource Sync ${name} already exists; leaving it unchanged.`));
    return false;
  }

  if (existing) {
    await komodoWrite("UpdateResourceSync", {
      id: resourceId(existing),
      config: syncConfig(contents),
    });
    console.log(chalk.green(`Updated Resource Sync ${name}`));
  } else {
    await komodoWrite("CreateResourceSync", {
      name,
      config: syncConfig(contents),
    });
    console.log(chalk.green(`Created Resource Sync ${name}`));
  }
  return true;
}

function parseEnvironment(raw) {
  const values = {};
  for (const line of String(raw || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) values[key] = trimmed.slice(index + 1).trim();
  }
  return values;
}

function renderEnvironment(values) {
  return Object.keys(values).sort().map((key) => `${key} = ${values[key]}`).join("\n") + "\n";
}

function parseTraceAuthKeys(raw) {
  const keys = new Map();
  for (const entry of String(raw || "").split(/[,\n]/g)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const index = trimmed.includes("=") ? trimmed.indexOf("=") : trimmed.indexOf(":");
    if (index === -1) continue;
    const app = trimmed.slice(0, index).trim();
    const key = trimmed.slice(index + 1).trim();
    if (app && key) keys.set(app, key);
  }
  return keys;
}

async function ensureSharedTraceAuthKey() {
  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] ensure ${appID} trace key is present on ${sharedStackName}`));
    return;
  }

  const stack = await getStack(sharedStackName);
  if (!stack) throw new Error(`Shared stack ${sharedStackName} was not found after Resource Sync.`);
  const envVars = parseEnvironment(stack.config?.environment || "");
  const keys = parseTraceAuthKeys(envVars.NECKDASH_TRACE_AUTH_KEYS || "");
  if (keys.get(appID) === traceAuthKey) return;

  keys.set(appID, traceAuthKey);
  envVars.NECKDASH_TRACE_AUTH_KEYS = [...keys.entries()].map(([app, key]) => `${app}=${key}`).join(",");
  await komodoWrite("UpdateStack", {
    id: resourceId(stack),
    config: { ...(stack.config ?? {}), environment: renderEnvironment(envVars) },
  });
  console.log(chalk.green(`Added ${appID} trace auth key to shared ${sharedStackName} stack`));
}

async function runSync(name, changed) {
  if (!changed) return;
  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] run Resource Sync ${name}`));
    return;
  }

  console.log(chalk.dim(`Running Resource Sync ${name}`));
  const update = await komodoExecuteAndPoll("RunSync", { sync: name });
  if (Array.isArray(update)) return;
  if (update.status === "Err") {
    throw new Error(`Resource Sync ${name} failed: ${update.data?.message || "unknown error"}`);
  }
}

async function ensureIngress() {
  if (skipIngress) return;
  const command = [
    `docker network inspect ${shell(ingressNetwork)} >/dev/null 2>&1 || docker network create ${shell(ingressNetwork)}`,
    "docker inspect neck-ingress-caddy >/dev/null 2>&1 || docker run -d --name neck-ingress-caddy --restart unless-stopped " +
      `--network ${shell(ingressNetwork)} ` +
      "-p 80:80 -p 443:443 " +
      `-e CADDY_INGRESS_NETWORKS=${shell(ingressNetwork)} ` +
      "-v /var/run/docker.sock:/var/run/docker.sock:ro " +
      "-v neck_ingress_caddy_data:/data " +
      "-v neck_ingress_caddy_config:/config " +
      "lucaslorentz/caddy-docker-proxy:2.10-alpine",
  ].join("\n");

  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] ensure ${ingressNetwork} and neck-ingress-caddy on ${komodoServer}`));
    return;
  }

  let exitCode = 0;
  await executeServerTerminal({
    server: komodoServer,
    command,
    init: { command: "bash" },
  }, {
    onLine: (line) => console.log(chalk.dim(line)),
    onFinish: (code) => { exitCode = code; },
  });
  if (exitCode !== 0) {
    throw new Error(`Ingress setup failed with exit code ${exitCode}`);
  }
}

function shell(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

console.log(`\n${chalk.bold.cyan("Set up Komodo resources")}`);
await ensureIngress();

if (!skipShared) {
  const sharedContents = await readFile("deploy/neckdash/resources.toml");
  const changed = await upsertSync(sharedSyncName, sharedContents, { updateExisting: updateShared });
  await runSync(sharedSyncName, changed);
  await ensureSharedTraceAuthKey();
}

const appContents = await readFile("deploy/komodo/resources.toml");
const appChanged = await upsertSync(appSyncName, appContents);
await runSync(appSyncName, appChanged);

console.log(`\n${chalk.green("✓ Komodo resources are set up")}`);
