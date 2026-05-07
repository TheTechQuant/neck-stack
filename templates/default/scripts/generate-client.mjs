#!/usr/bin/env zx
import { $, fs, path } from "zx";

$.verbose = true;

const appId = process.env.ENCORE_APP_ID || "";
const envName = process.env.ENCORE_CLIENT_ENV || "local";
const backendDir = path.resolve("backend");
const outputPath = path.resolve("frontend/lib/encore-client.gen.ts");

await fs.ensureDir(path.dirname(outputPath));
if (appId) {
  await $({ cwd: backendDir })`encore gen client ${appId} --env=${envName} --output=${outputPath}`;
} else {
  await $({ cwd: backendDir })`encore gen client --env=${envName} --output=${outputPath}`;
}
