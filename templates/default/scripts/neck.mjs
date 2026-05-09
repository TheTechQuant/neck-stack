#!/usr/bin/env zx
import { constants } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import { loadDotEnv } from "./lib/env.mjs";
import { discoverEncoreResources } from "./lib/encore-resources.mjs";
import { resolveProdPlatform } from "./lib/prod-platform.mjs";

$.verbose = true;

const args = process.argv.slice(3);
const command = args.shift() || "help";

async function main() {
  switch (command) {
    case "install":
    case "deps":
      return install(args);
    case "dev":
      return dev();
    case "build":
      return build();
    case "check":
      return check();
    case "test":
      return test(args[0]);
    case "api":
      return api(args[0]);
    case "watch-api":
      return watchAPI();
    case "infra":
      return infra();
    case "docker":
      return docker(args[0] || "all");
    case "migrate":
      return $`node scripts/run-migrations.mjs`;
    case "komodo:setup":
      return $`zx scripts/setup-komodo.mjs ${args}`;
    case "ci-auth":
      return encoreCIAuth(args);
    case "mcp":
      return encoreMCP(args[0] || "run");
    case "debug":
      return backendDebug(args[0]);
    case "help":
    case "-h":
    case "--help":
      return help();
    default:
      throw new Error(`Unknown NECK command: ${command}. Run pnpm neck help.`);
  }
}

async function install(pnpmArgs) {
  console.log(`\n${chalk.bold.cyan("Install workspace dependencies")}`);
  await $`corepack enable`;
  await $`pnpm install ${pnpmArgs}`;
  console.log(`\n${chalk.green("✓ dependencies installed")}`);
}

async function dev() {
  await api();
  await Promise.all([
    $`pnpm --filter backend dev`,
    watchAPI(),
    $`pnpm --filter frontend dev`,
  ]);
}

async function build() {
  await runStep("Generate Encore infrastructure", infra);
  await runStep("Typecheck backend", () => $`pnpm --filter backend typecheck`);
  await runStep("Generate API artifacts", api);
  await runStep("Build frontend", () => $`pnpm --filter frontend build`);
  console.log(`\n${chalk.green("✓ build complete")}`);
}

async function check() {
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

  await runStep("Generate Encore infrastructure", infra);
  await runStep("Check scripts", async () => {
    await $`node --check scripts/neck.mjs`;
    await $`node --check scripts/generate-encore-config.mjs`;
    await $`node --check scripts/run-migrations.mjs`;
    await $`node --check scripts/setup-komodo.mjs`;
    for (const file of [
      "scripts/lib/encore-resources.mjs",
      "scripts/lib/env.mjs",
      "scripts/lib/prod-platform.mjs",
      "scripts/lib/runtime-config.mjs",
      "scripts/lib/signoz-config.mjs",
    ]) {
      await $`node --check ${file}`;
    }
  });
  await runStep("Typecheck backend", () => $`pnpm --filter backend typecheck`);
  await runStep("Test backend", () => test(process.env.CI ? "ci" : ""));
  await runStep("Generate API artifacts", api);
  await runStep("Typecheck frontend", () => $`pnpm --filter frontend typecheck`);
  console.log(`\n${chalk.green("✓ checks passed")}`);
}

async function test(mode = "") {
  if (mode === "ci") return testBackendCI();
  return $({ cwd: "backend" })`encore test --fileParallelism=true`;
}

async function api(target = "") {
  if (!target || target === "all") {
    await generateClient();
    await generateOpenAPI();
    return;
  }
  if (target === "client") return generateClient();
  if (target === "openapi") return generateOpenAPI();
  throw new Error("Usage: pnpm neck api [client|openapi]");
}

async function generateClient() {
  await loadDotEnv();
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
}

async function generateOpenAPI() {
  await loadDotEnv();
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
}

async function watchAPI() {
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
        await api();
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
}

async function infra() {
  await $`zx scripts/generate-encore-config.mjs`;
}

async function docker(target) {
  await loadDotEnv();
  if (target === "all") {
    await infra();
    await buildImage("backend");
    await buildImage("frontend");
    await buildImage("migrations");
    return;
  }
  if (!["backend", "frontend", "migrations"].includes(target)) {
    throw new Error("Usage: pnpm neck docker [backend|frontend|migrations|all]");
  }
  await buildImage(target);
}

async function buildImage(target) {
  const { platform, os: targetOS, arch } = resolveProdPlatform();
  if (target === "backend") {
    const image = process.env.BACKEND_IMAGE || "__REGISTRY__/backend:local";
    const infraConfig = path.resolve("deploy/encore/infra.prod.json");
    console.log(chalk.cyan(`Building backend image for ${platform}`));

    const tmpRoot = await fs.mkdtemp(path.join(await writableTempRoot(), "neck-backend-"));
    const deployDir = path.join(tmpRoot, "backend");
    try {
      await $`pnpm --filter backend deploy --legacy ${deployDir}`;
      await $({ cwd: deployDir })`encore build docker --os ${targetOS} --arch ${arch} --config ${infraConfig} ${image}`;
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }

    console.log(chalk.green(`✓ backend image built: ${image}`));
    return;
  }

  if (target === "frontend") {
    const image = process.env.FRONTEND_IMAGE || "__REGISTRY__/frontend:local";
    console.log(chalk.cyan(`Building frontend image for ${platform}`));
    await api();
    await $`docker build --platform ${platform} -f frontend/Dockerfile --build-arg ${`NUXT_PUBLIC_API_BASE_URL=${process.env.NUXT_PUBLIC_API_BASE_URL || "/api"}`} --build-arg ${`NUXT_API_INTERNAL_BASE_URL=${process.env.NUXT_API_INTERNAL_BASE_URL || "http://backend:8080"}`} -t ${image} .`;
    console.log(chalk.green(`✓ frontend image built: ${image}`));
    return;
  }

  const resources = await discoverEncoreResources("backend");
  if (resources.databases.length === 0) {
    console.log(chalk.dim("No SQLDatabase resources detected; skipping migration image."));
    return;
  }

  const image = process.env.MIGRATIONS_IMAGE || "__REGISTRY__/migrations:local";
  console.log(chalk.cyan(`Building migration image for ${platform}`));
  await $`docker build --platform ${platform} -f deploy/migrations/Dockerfile -t ${image} .`;
  console.log(chalk.green(`✓ migration image built: ${image}`));
}

async function writableTempRoot() {
  for (const candidate of [process.env.NECK_TMPDIR, path.resolve(".neck-tmp"), tmpdir()].filter(Boolean)) {
    try {
      await fs.ensureDir(candidate);
      await fs.access(candidate, constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("No writable temp directory found. Set NECK_TMPDIR to a writable path.");
}

async function encoreCIAuth(authArgs) {
  $.verbose = false;
  const requireAuth = authArgs.includes("--require");
  const authKey = String(process.env.ENCORE_CLOUD_AUTH_KEY || "").trim();
  const authConfig = String(process.env.ENCORE_AUTH_CONFIG || "").trim();
  const authToken = String(process.env.ENCORE_AUTH_TOKEN || "").trim();
  const configDir = process.env.ENCORE_CONFIG_DIR || path.join(os.homedir(), ".config", "encore");
  const configPath = path.join(configDir, ".auth_token");

  if (authKey) {
    await $`encore auth login --auth-key=${authKey}`;
    console.log(chalk.green("✓ Encore authenticated with ENCORE_CLOUD_AUTH_KEY"));
    return;
  }

  const rawConfig = authConfig || authToken;
  if (rawConfig) {
    const config = rawConfig.startsWith("{")
      ? JSON.parse(rawConfig)
      : {
          access_token: rawConfig,
          token_type: "Bearer",
        };

    if (!config.access_token) {
      throw new Error("Encore auth config is missing access_token.");
    }
    if (!config.token_type) {
      config.token_type = "Bearer";
    }

    await fs.ensureDir(configDir);
    await fs.writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await fs.chmod(configPath, 0o600);
    console.log(chalk.green("✓ Encore auth config written from CI secret"));
    return;
  }

  if (requireAuth) {
    throw new Error("Set ENCORE_CLOUD_AUTH_KEY, ENCORE_AUTH_CONFIG, or ENCORE_AUTH_TOKEN for this CI job.");
  }

  console.log(chalk.yellow("Encore Cloud credentials are not configured; linked-app tests can run in local-only mode."));
}

async function testBackendCI() {
  await encoreCIAuth([]);

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
}

async function encoreMCP(mode) {
  if (mode === "start") return $`encore mcp start --app=__APP_ID__`;
  if (mode === "run") return $`encore mcp run --app=__APP_ID__`;
  throw new Error("Usage: pnpm neck mcp [run|start]");
}

async function backendDebug(mode) {
  if (mode === "break") return $`pnpm --filter backend debug:break`;
  return $`pnpm --filter backend debug`;
}

async function runStep(label, task) {
  console.log(`\n${chalk.bold.cyan(label)}`);
  await task();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function help() {
  console.log(`
NECK commands:
  pnpm neck install [pnpm args]      install workspace dependencies
  pnpm neck dev                      run backend, frontend, and API watcher
  pnpm neck check                    regenerate infra and validate the app
  pnpm neck build                    build generated API artifacts and frontend
  pnpm neck test [ci]                run backend tests
  pnpm neck api [client|openapi]     regenerate generated client/OpenAPI
  pnpm neck infra                    regenerate deploy/* from Encore metadata
  pnpm neck docker [target|all]      build production images
  pnpm neck komodo:setup [options]   create/update Komodo resources
  pnpm neck mcp [run|start]          run Encore MCP
  pnpm neck debug [break]            attachable Encore backend debug run
`.trim());
}

await main();
