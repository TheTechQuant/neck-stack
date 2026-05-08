#!/usr/bin/env zx
import { $, fs } from "zx";
import chalk from "chalk";

$.verbose = true;

async function loadDotEnv(file = ".env") {
  if (!(await fs.pathExists(file))) return;

  const source = await fs.readFile(file, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])([\s\S]*)\1$/, "$2");
  }
}

await loadDotEnv();
console.log(`\n${chalk.bold.cyan("Deploy with Komodo")}`);

const args = new Set(process.argv.slice(3));
const skipInfra = args.has("--skip-infra");
const skipMigrations = args.has("--skip-migrations");
const migrateOnly = args.has("--migrate-only");
const deployOnly = args.has("--deploy-only");
const dryRun = args.has("--dry-run");

if (migrateOnly && deployOnly) {
  throw new Error("Use either --migrate-only or --deploy-only, not both.");
}

if (!skipInfra) {
  console.log(chalk.dim("Generating Encore infrastructure config"));
  await $`pnpm infra:encore`;
}

function webhookEnv(name) {
  const value = process.env[name];
  if (!value && dryRun) return `<${name}>`;
  if (!value) throw new Error(`Missing ${name}. Set it to the Komodo webhook URL.`);
  return value;
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

async function postWebhook(name, url) {
  if (dryRun) {
    console.log(chalk.yellow(`[dry-run] would call ${name}: ${url}`));
    return;
  }

  console.log(chalk.dim(`Calling ${name}`));
  const response = await fetch(url, { method: "POST" });
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
