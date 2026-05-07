#!/usr/bin/env zx
import { $ } from "zx";
import chalk from "chalk";

$.verbose = true;

async function runStep(label, task) {
  console.log(`\n${chalk.bold.cyan(label)}`);
  await task();
}

await runStep("Generate Encore infrastructure", () => $`pnpm infra:encore`);
await runStep("Typecheck backend", () => $`pnpm --filter backend typecheck`);
await runStep("Generate API artifacts", () => $`pnpm api:gen`);
await runStep("Build frontend", () => $`pnpm --filter frontend build`);

console.log(`\n${chalk.green("✓ build complete")}`);
