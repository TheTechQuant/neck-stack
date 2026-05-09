#!/usr/bin/env zx
import { $ } from "zx";
import { parse } from "@bomb.sh/args";
import chalk from "chalk";
import { loadDotEnv } from "./lib/env.mjs";

$.verbose = true;

await loadDotEnv();
console.log(`\n${chalk.bold.cyan("Deploy with Komodo")}`);

const args = parse(process.argv.slice(3).filter((arg) => arg !== "--"), {
  alias: { h: "help" },
  boolean: ["dry-run", "force", "help", "skip-infra"],
});

const allowedArgs = new Set(["_", "dry-run", "force", "help", "skip-infra"]);
const unknownArgs = Object.keys(args).filter((key) => !allowedArgs.has(key));
if (unknownArgs.length > 0) {
  throw new Error(`Unknown option${unknownArgs.length === 1 ? "" : "s"}: ${unknownArgs.map((key) => `--${key}`).join(", ")}`);
}

if (args.help) {
  console.log(`
Usage:
  pnpm deploy:komodo [options]

Options:
  --skip-infra    Do not regenerate deploy/encore/infra.prod.json
  --force         Run DeployStack instead of DeployStackIfChanged
  --dry-run       Print the Komodo API action without sending it
  -h, --help      Show help
`.trim());
  process.exit(0);
}

const skipInfra = args["skip-infra"] === true;
const forceDeploy = args.force === true;
const dryRun = args["dry-run"] === true;

if (!skipInfra) {
  console.log(chalk.dim("Generating Encore infrastructure config"));
  await $`pnpm infra:encore`;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing ${name}. Run pnpm komodo:setup once or set it in .env.`);
  }
  return value;
}

function normalizedBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/g, "");
}

const appId = String(process.env.APP_ID || "__APP_ID__").trim();
const action = forceDeploy ? "DeployStack" : "DeployStackIfChanged";

if (dryRun) {
  console.log(chalk.yellow(`[dry-run] would execute ${action} for stack ${appId}`));
  process.exit(0);
}

const komodoUrl = normalizedBaseUrl(requiredEnv("KOMODO_URL"));
const komodoApiKey = requiredEnv("KOMODO_API_KEY");
const komodoApiSecret = requiredEnv("KOMODO_API_SECRET");

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
const komodoExecute = (type, params) => komodoRequest("execute", type, params);

async function pollUpdate(id) {
  if (!id) return { status: "Complete" };
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const update = await komodoRead("GetUpdate", { id });
    if (update.status === "Complete" || update.status === "Err") return update;
  }
}

console.log(chalk.dim(`Executing ${action} for stack ${appId}`));
const update = await komodoExecute(action, { stack: appId });
const done = await pollUpdate(update?._id?.$oid);
if (done.status === "Err") {
  throw new Error(`Komodo deploy failed: ${done.data?.message || "unknown error"}`);
}

console.log(`\n${chalk.green("✓ Komodo deploy complete")}`);
