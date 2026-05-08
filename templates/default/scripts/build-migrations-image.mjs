#!/usr/bin/env zx
import { $ } from "zx";
import chalk from "chalk";
import { discoverEncoreResources } from "./lib/encore-resources.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";

$.verbose = true;
await loadDotEnv();

const resources = await discoverEncoreResources("backend");
if (resources.databases.length === 0) {
  console.log(chalk.dim("No SQLDatabase resources detected; skipping migration image."));
  process.exit(0);
}

const image = process.env.MIGRATIONS_IMAGE || "__REGISTRY__/migrations:local";
const { platform } = resolveProdPlatform();

console.log(chalk.cyan(`Building migration image for ${platform}`));
await $`docker build --platform ${platform} -f deploy/migrations/Dockerfile -t ${image} .`;
console.log(chalk.green(`✓ migration image built: ${image}`));
