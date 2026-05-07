#!/usr/bin/env zx

$.verbose = true;

const pnpmArgs = process.argv.slice(3);

console.log(`\n${chalk.bold.cyan("Install workspace dependencies")}`);
await $`corepack enable`;
await $`pnpm install ${pnpmArgs}`;
console.log(`\n${chalk.green("✓ dependencies installed")}`);
