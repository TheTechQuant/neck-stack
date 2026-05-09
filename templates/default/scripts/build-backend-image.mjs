#!/usr/bin/env zx
import { $, fs, path } from "zx";
import { tmpdir } from "node:os";
import { constants } from "node:fs";
import chalk from "chalk";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";
import { loadDotEnv } from "./lib/env.mjs";

$.verbose = true;
await loadDotEnv();

const image = process.env.BACKEND_IMAGE || "__REGISTRY__/backend:local";
const { platform, os, arch } = resolveProdPlatform();
const infraConfig = path.resolve("deploy/encore/infra.prod.json");

console.log(chalk.cyan(`Building backend image for ${platform}`));

async function writableTempRoot() {
  for (const candidate of [process.env.NECK_TMPDIR, path.resolve(".neck-tmp"), tmpdir()].filter(Boolean)) {
    try {
      await fs.ensureDir(candidate);
      await fs.access(candidate, constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("No writable temp directory found. Set NECK_TMPDIR to a writable path.");
}

const tmpRoot = await fs.mkdtemp(path.join(await writableTempRoot(), "neck-backend-"));
const deployDir = path.join(tmpRoot, "backend");
try {
  await $`pnpm --filter backend deploy --legacy ${deployDir}`;
  await $({ cwd: deployDir })`encore build docker --os ${os} --arch ${arch} --config ${infraConfig} ${image}`;
} finally {
  await fs.rm(tmpRoot, { recursive: true, force: true });
}

console.log(chalk.green(`✓ backend image built: ${image}`));
