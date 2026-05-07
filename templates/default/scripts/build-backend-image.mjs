#!/usr/bin/env zx
import { $, path } from "zx";
import chalk from "chalk";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";

$.verbose = true;

const image = process.env.BACKEND_IMAGE || "__REGISTRY__/backend:local";
const { platform, os, arch } = resolveProdPlatform();

console.log(chalk.cyan(`Building backend image for ${platform}`));

await $({ cwd: path.resolve("backend") })`encore build docker --os ${os} --arch ${arch} --config ../deploy/encore/infra.prod.json ${image}`;

console.log(chalk.green(`✓ backend image built: ${image}`));
