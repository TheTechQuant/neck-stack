#!/usr/bin/env zx
import { $, fs, path } from "zx";

$.verbose = false;

const backendDir = path.resolve("backend");
const pollIntervalMs = 700;
const debounceMs = 500;
const retryDelayMs = 1500;
const watchedExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]);
const ignoredDirs = new Set(["node_modules", ".encore", "encore.gen", "dist", "build"]);

let lastSignature = await sourceSignature();
let pendingSignature = "";
let generationInFlight = false;

console.log("watching backend source; Encore client and OpenAPI spec regenerate after API metadata changes");

while (true) {
  await sleep(pollIntervalMs);
  const nextSignature = await sourceSignature();
  if (nextSignature === lastSignature) continue;

  lastSignature = nextSignature;
  pendingSignature = nextSignature;
  void regenerateWhenStable(nextSignature);
}

async function regenerateWhenStable(signature) {
  await sleep(debounceMs);
  if (pendingSignature !== signature || generationInFlight) return;

  generationInFlight = true;
  while (pendingSignature === signature) {
    try {
      await $`pnpm api:gen`;
      pendingSignature = "";
      break;
    } catch (error) {
      console.error(`API artifact generation failed; retrying after Encore recompiles: ${error instanceof Error ? error.message : error}`);
      await sleep(retryDelayMs);
    }
  }
  generationInFlight = false;

  if (pendingSignature) {
    void regenerateWhenStable(pendingSignature);
  }
}

async function sourceSignature() {
  const files = await walk(backendDir);
  const stats = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file);
    return `${path.relative(backendDir, file)}:${stat.mtimeMs}:${stat.size}`;
  }));

  return stats.sort().join("|");
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...await walk(fullPath));
      }
      continue;
    }

    if (watchedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
