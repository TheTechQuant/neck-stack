#!/usr/bin/env zx
import { $, fs, path } from "zx";
import chalk from "chalk";

$.verbose = true;

await $`pnpm exec zx scripts/encore-ci-auth.mjs`;

const hasEncoreAuth = Boolean(
  String(process.env.ENCORE_CLOUD_AUTH_KEY || "").trim()
  || String(process.env.ENCORE_AUTH_CONFIG || "").trim()
  || String(process.env.ENCORE_AUTH_TOKEN || "").trim(),
);

const appFile = path.resolve("backend/encore.app");
const originalAppFile = await fs.readFile(appFile, "utf8");
let restored = false;

async function restoreAppFile() {
  if (!restored) {
    restored = true;
    await fs.writeFile(appFile, originalAppFile);
  }
}

try {
  if (!hasEncoreAuth) {
    const appConfig = JSON.parse(originalAppFile);
    if (appConfig.id) {
      appConfig.id = "";
      await fs.writeFile(appFile, `${JSON.stringify(appConfig, null, "\t")}\n`);
      console.log(chalk.yellow("Running Encore tests with a local-only app id because CI has no Encore Cloud credentials."));
    }
  }

  await $({ cwd: "backend" })`encore test --fileParallelism=true`;
} finally {
  await restoreAppFile();
}
