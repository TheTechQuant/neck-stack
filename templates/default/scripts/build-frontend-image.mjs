#!/usr/bin/env zx
import { $ } from "zx";
import chalk from "chalk";
import { loadDotEnv } from "./lib/env.mjs";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";

$.verbose = true;
await loadDotEnv();

const image = process.env.FRONTEND_IMAGE || "__REGISTRY__/frontend:local";
const { platform } = resolveProdPlatform();

console.log(chalk.cyan(`Building frontend image for ${platform}`));
await $`pnpm api:gen`;
await $`docker build --platform ${platform} -f frontend/Dockerfile --build-arg ${`NUXT_PUBLIC_API_BASE_URL=${process.env.NUXT_PUBLIC_API_BASE_URL || "/api"}`} --build-arg ${`NUXT_API_INTERNAL_BASE_URL=${process.env.NUXT_API_INTERNAL_BASE_URL || "http://backend:8080"}`} -t ${image} .`;
console.log(chalk.green(`✓ frontend image built: ${image}`));
