#!/usr/bin/env zx
import { $, fs } from "zx";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";

$.verbose = true;

const requireAuth = process.argv.includes("--require");
const authKey = String(process.env.ENCORE_CLOUD_AUTH_KEY || "").trim();
const authConfig = String(process.env.ENCORE_AUTH_CONFIG || "").trim();
const authToken = String(process.env.ENCORE_AUTH_TOKEN || "").trim();
const configDir = process.env.ENCORE_CONFIG_DIR || path.join(os.homedir(), ".config", "encore");
const configPath = path.join(configDir, ".auth_token");

if (authKey) {
  await $`encore auth login --auth-key=${authKey}`;
  console.log(chalk.green("✓ Encore authenticated with ENCORE_CLOUD_AUTH_KEY"));
  process.exit(0);
}

const rawConfig = authConfig || authToken;
if (rawConfig) {
  const config = rawConfig.startsWith("{")
    ? JSON.parse(rawConfig)
    : {
        access_token: rawConfig,
        token_type: "Bearer",
      };

  if (!config.access_token) {
    throw new Error("Encore auth config is missing access_token.");
  }
  if (!config.token_type) {
    config.token_type = "Bearer";
  }

  await fs.ensureDir(configDir);
  await fs.writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await fs.chmod(configPath, 0o600);
  console.log(chalk.green("✓ Encore auth config written from CI secret"));
  process.exit(0);
}

if (requireAuth) {
  throw new Error("Set ENCORE_CLOUD_AUTH_KEY, ENCORE_AUTH_CONFIG, or ENCORE_AUTH_TOKEN for this CI job.");
}

console.log(chalk.yellow("Encore Cloud credentials are not configured; linked-app tests can run in local-only mode."));
