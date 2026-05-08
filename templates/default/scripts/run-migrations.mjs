#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { discoverEncoreResources } from "./lib/encore-resources.mjs";

const backendDir = process.env.BACKEND_DIR || "backend";
const databaseUrl = process.env.DATABASE_URL;

function quoteIdent(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseUrlFor(dbName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });
}

function output(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: process.env,
  }).trim();
}

function ensureDatabase(dbName) {
  const exists = output("psql", [
    databaseUrl,
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(dbName)}`,
  ]);

  if (exists === "1") return;

  console.log(`creating database ${dbName}`);
  run("psql", [
    databaseUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE ${quoteIdent(dbName)}`,
  ]);
}

const resources = await discoverEncoreResources(backendDir);

if (resources.databases.length === 0) {
  console.log("no application SQLDatabase declarations found");
  process.exit(0);
}

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Use an admin database URL, for example postgres://user:pass@host:5432/postgres?sslmode=disable");
  process.exit(1);
}

async function migrateDatabase(dbName, migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`migrations directory not found for ${dbName}: ${migrationsDir}`);
  }

  ensureDatabase(dbName);

  console.log(`migrating ${dbName} from ${path.relative(process.cwd(), migrationsDir)}`);
  try {
    run("migrate", [
      "-source",
      `file://${migrationsDir}`,
      "-database",
      databaseUrlFor(dbName),
      "up",
    ]);
  } catch (error) {
    if (String(error?.stderr || error?.message || "").toLowerCase().includes("no change")) {
      console.log(`${dbName}: no migration changes`);
      return;
    }
    throw error;
  }
}

for (const database of resources.databases) {
  await migrateDatabase(database.name, path.resolve(resources.backendDir, database.migrations));
}
