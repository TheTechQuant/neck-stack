#!/usr/bin/env zx
import { $, fs } from "zx";
import { createHmac } from "node:crypto";
import { parse } from "@bomb.sh/args";
import chalk from "chalk";
import { loadDotEnv } from "./lib/env.mjs";

$.verbose = true;

await loadDotEnv();
console.log(`\n${chalk.bold.cyan("Deploy with Komodo")}`);

const args = parse(process.argv.slice(3).filter((arg) => arg !== "--"), {
  alias: { h: "help" },
  boolean: ["deploy-only", "dry-run", "help", "migrate-only", "skip-infra", "skip-migrations"],
});

const allowedArgs = new Set(["_", "deploy-only", "dry-run", "help", "migrate-only", "skip-infra", "skip-migrations"]);
const unknownArgs = Object.keys(args).filter((key) => !allowedArgs.has(key));
if (unknownArgs.length > 0) {
  throw new Error(`Unknown option${unknownArgs.length === 1 ? "" : "s"}: ${unknownArgs.map((key) => `--${key}`).join(", ")}`);
}

if (args.help) {
  console.log(`
Usage:
  pnpm deploy:komodo [options]

Options:
  --skip-infra         Do not regenerate deploy/encore/infra.prod.json
  --skip-migrations    Skip the migration webhook
  --migrate-only       Run only the migration webhook
  --deploy-only        Run only the stack deploy webhook
  --dry-run            Print webhook calls without sending them
  -h, --help           Show help
`.trim());
  process.exit(0);
}

const skipInfra = args["skip-infra"] === true;
const skipMigrations = args["skip-migrations"] === true;
const migrateOnly = args["migrate-only"] === true;
const deployOnly = args["deploy-only"] === true;
const dryRun = args["dry-run"] === true;

if (migrateOnly && deployOnly) {
  throw new Error("Use either --migrate-only or --deploy-only, not both.");
}

if (!skipInfra) {
  console.log(chalk.dim("Generating Encore infrastructure config"));
  await $`pnpm infra:encore`;
}

function webhookEnv(name) {
  const value = process.env[name] || derivedWebhookUrl(name);
  if (!value && dryRun) return `<${name}>`;
  if (!value) throw new Error(`Missing ${name}. Set it to the Komodo webhook URL or set KOMODO_URL so it can be derived.`);
  return value;
}

function normalizedBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/g, "");
}

function webhookProvider() {
  const value = String(process.env.KOMODO_WEBHOOK_PROVIDER || "gitlab").toLowerCase();
  return value.includes("github") ? "github" : "gitlab";
}

function appId() {
  return process.env.APP_ID || "__APP_ID__";
}

function derivedWebhookUrl(name) {
  const baseUrl = normalizedBaseUrl(process.env.KOMODO_URL || "__KOMODO_URL__");
  if (!baseUrl) return "";

  const provider = webhookProvider();
  if (name === "KOMODO_DEPLOY_WEBHOOK_URL") {
    return `${baseUrl}/listener/${provider}/stack/${encodeURIComponent(appId())}/deploy`;
  }
  if (name === "KOMODO_MIGRATE_WEBHOOK_URL") {
    return `${baseUrl}/listener/${provider}/action/${encodeURIComponent(`${appId()}-migrate`)}/main`;
  }
  return "";
}

async function hasGeneratedSQLDatabases() {
  try {
    const raw = await fs.readFile("deploy/encore/infra.prod.json", "utf8");
    const infra = JSON.parse(raw);
    return Array.isArray(infra.sql_servers) && infra.sql_servers.some((server) => Object.keys(server.databases || {}).length > 0);
  } catch {
    return false;
  }
}

function webhookPayload() {
  const branch = process.env.CI_COMMIT_BRANCH || process.env.GITHUB_REF_NAME || "main";
  const sha = process.env.CI_COMMIT_SHA || process.env.GITHUB_SHA || "";
  return JSON.stringify({
    object_kind: "push",
    ref: `refs/heads/${branch}`,
    checkout_sha: sha,
    after: sha,
  });
}

function webhookHeaders(body) {
  const secret = process.env.KOMODO_WEBHOOK_SECRET || "";
  const provider = webhookProvider();
  const headers = {
    "content-type": "application/json",
  };

  if (provider === "github") {
    headers["x-github-event"] = "push";
    if (secret) {
      headers["x-hub-signature-256"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    }
  } else {
    headers["x-gitlab-event"] = "Push Hook";
    if (secret) headers["x-gitlab-token"] = secret;
  }

  return headers;
}

async function postWebhook(name, url) {
  const body = webhookPayload();
  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] would call ${name}: ${url}`));
    return;
  }

  console.log(chalk.dim(`Calling ${name}`));
  const response = await fetch(url, {
    method: "POST",
    headers: webhookHeaders(body),
    body,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${name} failed: HTTP ${response.status}${body ? `\n${body}` : ""}`);
  }
}

const hasSQLDatabases = await hasGeneratedSQLDatabases();

if (!deployOnly && !skipMigrations && hasSQLDatabases) {
  await postWebhook("Komodo migration action", webhookEnv("KOMODO_MIGRATE_WEBHOOK_URL"));
} else if (!deployOnly && !skipMigrations && !hasSQLDatabases) {
  console.log(chalk.dim("Skipping migrations because no SQLDatabase resources were detected."));
} else if (!deployOnly && skipMigrations) {
  console.log(chalk.yellow("Skipping migrations because --skip-migrations was provided."));
}

if (!migrateOnly) {
  await postWebhook("Komodo stack deploy", webhookEnv("KOMODO_DEPLOY_WEBHOOK_URL"));
}

console.log(`\n${chalk.green("✓ Komodo deploy flow complete")}`);
