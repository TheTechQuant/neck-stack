#!/usr/bin/env zx
import { $, fs, path } from "zx";

$.verbose = true;

const appId = process.env.ENCORE_APP_ID || "";
const envName = process.env.ENCORE_OPENAPI_ENV || process.env.ENCORE_CLIENT_ENV || "local";
const backendDir = path.resolve("backend");
const outputPath = path.resolve(process.env.OPENAPI_OUTPUT || "docs/openapi.json");

await fs.ensureDir(path.dirname(outputPath));
if (appId) {
  await $({ cwd: backendDir })`encore gen client ${appId} --lang=openapi --env=${envName} --output=${outputPath}`;
} else {
  await $({ cwd: backendDir })`encore gen client --lang=openapi --env=${envName} --output=${outputPath}`;
}
