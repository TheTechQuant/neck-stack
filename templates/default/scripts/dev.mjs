#!/usr/bin/env zx
import { $ } from "zx";

$.verbose = true;

await $`pnpm api:gen`;

await Promise.all([
  $`pnpm --filter backend dev`,
  $`pnpm client:watch`,
  $`pnpm --filter frontend dev`,
]);
