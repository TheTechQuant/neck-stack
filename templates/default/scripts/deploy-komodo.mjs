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

const infra = JSON.parse(await fs.readFile("deploy/encore/infra.prod.json", "utf8"));
const hasDatabases = Boolean(infra.sql_servers?.length);

function webhookEnv(name) {
  const value = process.env[name];
  if (!value && dryRun) return `<${name}>`;
  if (!value) throw new Error(`Missing ${name}. Set it to the Komodo webhook URL.`);
  return value;
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

if (!deployOnly && hasDatabases && !skipMigrations) {
  await postWebhook("Komodo migration action", webhookEnv("KOMODO_MIGRATE_WEBHOOK_URL"));
} else if (!deployOnly && hasDatabases && skipMigrations) {
  console.log(chalk.yellow("Skipping migrations because --skip-migrations was provided."));
} else if (!deployOnly) {
  console.log(chalk.dim("No Encore SQLDatabase declarations; skipping migration action."));
}

if (!migrateOnly) {
  await postWebhook("Komodo stack deploy", webhookEnv("KOMODO_DEPLOY_WEBHOOK_URL"));
}

console.log(`\n${chalk.green("✓ Komodo deploy flow complete")}`);
