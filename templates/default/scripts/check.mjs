#!/usr/bin/env zx
import { $, fs } from "zx";
import chalk from "chalk";

$.verbose = true;

async function runStep(label, task) {
  console.log(`\n${chalk.bold.cyan(label)}`);
  await task();
}

const jsonFiles = [
  ".vscode/launch.json",
  ".vscode/tasks.json",
  ".vscode/mcp.json",
  ".vscode/settings.json",
  ".vscode/extensions.json",
  ".zed/settings.json",
  ".zed/debug.json",
  ".zed/tasks.json",
];

for (const file of jsonFiles) {
  JSON.parse(await fs.readFile(file, "utf8"));
}

await runStep("Generate Encore infrastructure", () => $`pnpm infra:encore`);
await runStep("Check scripts", async () => {
  await $`node --check scripts/lib/encore-resources.mjs`;
  await $`node --check scripts/lib/env.mjs`;
  await $`node --check scripts/lib/prod-platform.mjs`;
  await $`node --check scripts/lib/runtime-config.mjs`;
  await $`node --check scripts/lib/signoz-config.mjs`;
  await $`node --check scripts/generate-encore-config.mjs`;
  await $`node --check scripts/build-backend-image.mjs`;
  await $`node --check scripts/build-frontend-image.mjs`;
  await $`node --check scripts/build-migrations-image.mjs`;
  await $`node --check scripts/run-migrations.mjs`;
  await $`node --check scripts/install.mjs`;
  await $`node --check scripts/setup-komodo.mjs`;
  await $`node --check scripts/deploy-komodo.mjs`;
  await $`node --check scripts/encore-ci-auth.mjs`;
  await $`node --check scripts/test-backend-ci.mjs`;
  await $`node --check scripts/generate-client.mjs`;
  await $`node --check scripts/generate-openapi.mjs`;
  await $`node --check scripts/watch-client.mjs`;
});
await runStep("Typecheck backend", () => $`pnpm --filter backend typecheck`);
await runStep("Test backend", () => $`pnpm ${process.env.CI ? "test:backend:ci" : "test:backend"}`);
await runStep("Generate API artifacts", () => $`pnpm api:gen`);
await runStep("Typecheck frontend", () => $`pnpm --filter frontend typecheck`);

console.log(`\n${chalk.green("✓ checks passed")}`);
