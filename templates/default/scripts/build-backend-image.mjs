#!/usr/bin/env zx
import { $, fs, path } from "zx";
import { tmpdir } from "node:os";
import chalk from "chalk";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";
import { loadDotEnv } from "./lib/env.mjs";

$.verbose = true;
await loadDotEnv();

const image = process.env.BACKEND_IMAGE || "__REGISTRY__/backend:local";
const { platform, os, arch } = resolveProdPlatform();
const infraConfig = path.resolve("deploy/encore/infra.prod.json");

console.log(chalk.cyan(`Building backend image for ${platform}`));

const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "neck-backend-"));
const deployDir = path.join(tmpRoot, "backend");
try {
  await $`pnpm --filter backend deploy --legacy ${deployDir}`;
  await $({ cwd: deployDir })`encore build docker --os ${os} --arch ${arch} --config ${infraConfig} ${image}`;
} finally {
  await fs.rm(tmpRoot, { recursive: true, force: true });
}

console.log(chalk.green(`✓ backend image built: ${image}`));
