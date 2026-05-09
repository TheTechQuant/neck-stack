#!/usr/bin/env zx
import { $, fs, path } from "zx";
import { tmpdir } from "node:os";
import { constants } from "node:fs";
import chalk from "chalk";
import { discoverEncoreResources } from "./lib/encore-resources.mjs";
import { loadDotEnv } from "./lib/env.mjs";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";

$.verbose = true;
await loadDotEnv();

const target = process.argv[2];
const { platform, os, arch } = resolveProdPlatform();

if (!["backend", "frontend", "migrations"].includes(target)) {
  throw new Error("Usage: zx scripts/build-image.mjs <backend|frontend|migrations>");
}

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

async function buildBackend() {
  const image = process.env.BACKEND_IMAGE || "__REGISTRY__/backend:local";
  const infraConfig = path.resolve("deploy/encore/infra.prod.json");
  console.log(chalk.cyan(`Building backend image for ${platform}`));

  const tmpRoot = await fs.mkdtemp(path.join(await writableTempRoot(), "neck-backend-"));
  const deployDir = path.join(tmpRoot, "backend");
  try {
    await $`pnpm --filter backend deploy --legacy ${deployDir}`;
    await $({ cwd: deployDir })`encore build docker --os ${os} --arch ${arch} --config ${infraConfig} ${image}`;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  console.log(chalk.green(`✓ backend image built: ${image}`));
}

async function buildFrontend() {
  const image = process.env.FRONTEND_IMAGE || "__REGISTRY__/frontend:local";
  console.log(chalk.cyan(`Building frontend image for ${platform}`));
  await $`pnpm api:gen`;
  await $`docker build --platform ${platform} -f frontend/Dockerfile --build-arg ${`NUXT_PUBLIC_API_BASE_URL=${process.env.NUXT_PUBLIC_API_BASE_URL || "/api"}`} --build-arg ${`NUXT_API_INTERNAL_BASE_URL=${process.env.NUXT_API_INTERNAL_BASE_URL || "http://backend:8080"}`} -t ${image} .`;
  console.log(chalk.green(`✓ frontend image built: ${image}`));
}

async function buildMigrations() {
  const resources = await discoverEncoreResources("backend");
  if (resources.databases.length === 0) {
    console.log(chalk.dim("No SQLDatabase resources detected; skipping migration image."));
    return;
  }

  const image = process.env.MIGRATIONS_IMAGE || "__REGISTRY__/migrations:local";
  console.log(chalk.cyan(`Building migration image for ${platform}`));
  await $`docker build --platform ${platform} -f deploy/migrations/Dockerfile -t ${image} .`;
  console.log(chalk.green(`✓ migration image built: ${image}`));
}

if (target === "backend") await buildBackend();
if (target === "frontend") await buildFrontend();
if (target === "migrations") await buildMigrations();
