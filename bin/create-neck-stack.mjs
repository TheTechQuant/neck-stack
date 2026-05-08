#!/usr/bin/env node
import { $, fs, path } from "zx";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse } from "@bomb.sh/args";
import { cancel, intro, isCancel, log, outro, text } from "@clack/prompts";
import bcrypt from "bcryptjs";
import chalk from "chalk";

$.verbose = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const templateDir = path.join(rootDir, "templates", "default");

const stringOptions = [
  "name",
  "domain",
  "neckdash-user",
  "neckdash-password",
  "caddy-email",
  "gitlab-project",
  "registry",
  "prod-platform",
  "komodo-server",
  "komodo-deploy-webhook-url",
  "komodo-migrate-webhook-url",
  "git-provider",
  "git-account",
  "run-directory",
  "encore-app-id",
  "encore-auth-key",
];

const booleanOptions = [
  "encore-platform",
  "yes",
  "force",
  "install",
  "git",
  "help",
  "version",
];

function helpText() {
  return `
Create a NECK app: Nuxt.js, Encore.ts, Caddy, and Komodo.

Usage:
  create-neck-stack [app-name] [options]

Options:
  --name <name>                         Package/app display name when target path differs
  --domain <domain>                     Public app domain; /api and /__neck_dash are routed on this host
  --neckdash-user <user>                Basic-auth user for NECK Dash
  --neckdash-password <value>           Basic-auth password for NECK Dash
  --caddy-email <email>                 ACME email for Caddy certificates
  --gitlab-project <path>               GitLab project path, e.g. group/app
  --registry <registry>                 Container image registry/repository
  --prod-platform <platform>            linux/amd64, linux/arm64, amd64, or arm64
  --komodo-server <name>                Komodo server resource name
  --komodo-deploy-webhook-url <url>     Optional Komodo stack deploy webhook
  --komodo-migrate-webhook-url <url>    Optional Komodo migration webhook
  --git-provider <domain>               Git provider domain for Komodo
  --git-account <name>                  Komodo git account for private repos
  --run-directory <path>                Komodo stack checkout/run directory
  --encore-app-id <slug>                Encore app id to register/link
  --encore-auth-key <key>               Encore auth key for non-browser app registration
  --encore-platform / --no-encore-platform
  --install / --no-install
  --git / --no-git
  --yes                                 Use defaults for missing values
  --force                               Allow writing into a non-empty target directory
  -h, --help                            Show help
  -v, --version                         Show package version
`.trim();
}

async function packageVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  return pkg.version;
}

function parseCliArgs(argv) {
  const parsed = parse(argv, {
    alias: { h: "help", v: "version" },
    boolean: booleanOptions,
    default: {
      "encore-platform": true,
      git: true,
      install: true,
    },
    string: stringOptions,
  });

  const allowedKeys = new Set(["_", ...booleanOptions, ...stringOptions]);
  const unknown = Object.keys(parsed).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.map((key) => `--${key}`).join(", ")}`);
  }

  const positional = Array.isArray(parsed._) ? parsed._.map(String) : [];
  if (positional.length > 1) {
    throw new Error(`Expected at most one app name, got: ${positional.join(" ")}`);
  }

  return {
    positionalName: positional[0],
    options: {
      caddyEmail: parsed["caddy-email"],
      domain: parsed.domain,
      encoreAppId: parsed["encore-app-id"],
      encoreAuthKey: parsed["encore-auth-key"],
      encorePlatform: parsed["encore-platform"],
      force: parsed.force === true,
      git: parsed.git,
      gitAccount: parsed["git-account"],
      gitProvider: parsed["git-provider"],
      gitlabProject: parsed["gitlab-project"],
      help: parsed.help === true,
      install: parsed.install,
      komodoDeployWebhookUrl: parsed["komodo-deploy-webhook-url"],
      komodoMigrateWebhookUrl: parsed["komodo-migrate-webhook-url"],
      komodoServer: parsed["komodo-server"],
      name: parsed.name,
      neckdashPassword: parsed["neckdash-password"],
      neckdashUser: parsed["neckdash-user"],
      prodPlatform: parsed["prod-platform"],
      registry: parsed.registry,
      runDirectory: parsed["run-directory"],
      version: parsed.version === true,
      yes: parsed.yes === true,
    },
  };
}

function slugify(input) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function postgresIdent(input) {
  const ident = input.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return ident || "neck_app";
}

function normalizeProdPlatform(input) {
  const value = String(input || "linux/amd64").trim().toLowerCase();
  const aliases = {
    amd64: "linux/amd64",
    x64: "linux/amd64",
    x86_64: "linux/amd64",
    arm: "linux/arm64",
    arm64: "linux/arm64",
    aarch64: "linux/arm64",
  };
  const platform = aliases[value] || value;

  if (!/^linux\/(amd64|arm64)$/.test(platform)) {
    throw new Error(`Invalid production platform ${JSON.stringify(input)}. Use linux/amd64, linux/arm64, amd64, or arm64.`);
  }

  return platform;
}

function secretToken() {
  return randomBytes(24).toString("base64url");
}

function section(label) {
  log.info(label);
}

function step(label) {
  log.step(label);
}

function success(label) {
  log.success(label);
}

function readPromptResult(value) {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }

  return String(value).trim();
}

async function promptValue(label, fallback, yes) {
  if (yes) return fallback;
  const answer = await text({
    defaultValue: fallback,
    message: label,
    placeholder: fallback,
  });
  return readPromptResult(answer) || fallback;
}

async function promptOptional(label, fallback, yes) {
  if (yes) return fallback;
  const answer = await text({
    defaultValue: fallback || undefined,
    message: label,
    placeholder: fallback || undefined,
  });
  return readPromptResult(answer) || fallback;
}

async function promptRequired(label) {
  const answer = await text({
    message: label,
    validate: (value) => value.trim().length > 0 ? undefined : `${label} is required`,
  });
  return readPromptResult(answer);
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function assertWritableTarget(target, force) {
  if (!(await pathExists(target))) return;
  const entries = await fs.readdir(target);
  if (entries.length > 0 && !force) {
    throw new Error(`${target} is not empty. Re-run with --force or choose another directory.`);
  }
}

function render(content, vars) {
  return Object.entries(vars).reduce(
    (next, [key, value]) => next.replaceAll(`__${key}__`, () => value),
    content,
  );
}

function outputName(templateName) {
  if (templateName.startsWith("_")) return `.${templateName.slice(1)}`;
  return templateName;
}

async function copyTemplate(srcDir, destDir, vars) {
  await fs.ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, outputName(entry.name));

    if (entry.isDirectory()) {
      await copyTemplate(src, dest, vars);
      continue;
    }

    const raw = await fs.readFile(src, "utf8");
    await fs.writeFile(dest, render(raw, vars), { mode: entry.name.endsWith(".mjs") ? 0o755 : 0o644 });
  }
}

async function replaceSymlink(linkPath, targetPath) {
  await fs.ensureDir(path.dirname(linkPath));

  try {
    const stat = await fs.lstat(linkPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new Error(`Cannot replace existing directory with symlink: ${linkPath}`);
    }
    await fs.rm(linkPath, { force: true });
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }

  await fs.symlink(targetPath, linkPath);
}

async function createWorkspaceLinks(target) {
  const links = [
    ["encore.app", "backend/encore.app"],
    ["CLAUDE.md", "AGENTS.md"],
    ["claude.md", "AGENTS.md"],
    [".zed/rules", "../AGENTS.md"],
    [".cursor/rules/agents.md", "../../AGENTS.md"],
    [".github/copilot-instructions.md", "../AGENTS.md"],
  ];

  for (const [linkName, targetPath] of links) {
    await replaceSymlink(path.join(target, linkName), targetPath);
  }
}

async function initEncorePlatform(backendDir, appId, authKey) {
  if (authKey) {
    await $`encore auth login --auth-key=${authKey}`;
  }

  try {
    await $({ cwd: backendDir })`encore app init ${appId} --lang=ts`;
  } catch (error) {
    throw new Error(
      [
        `Encore app registration failed for ${appId}.`,
        "Run `encore auth login` first, pass `--encore-auth-key`, choose a different `--encore-app-id`,",
        "or regenerate with `--no-encore-platform` for an unlinked local-only app.",
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
    );
  }
}

async function main() {
  const { positionalName, options } = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    console.log(helpText());
    return;
  }

  if (options.version) {
    console.log(await packageVersion());
    return;
  }

  intro("create-neck-stack");

  const yes = options.yes === true;
  if (!yes) {
    section("Project");
  }

  const targetArg = positionalName || options.name || (yes ? "my-neck-app" : await promptRequired("App name"));
  const rawName = options.name
    || (targetArg === "." ? path.basename(process.cwd()) : path.basename(path.resolve(process.cwd(), targetArg)));
  const appSlug = slugify(rawName);
  if (!appSlug) throw new Error("App name must contain at least one alphanumeric character.");

  const target = path.resolve(process.cwd(), targetArg === "." ? "." : targetArg);
  const packageName = appSlug;
  const defaultDomain = `${appSlug}.example.com`;
  if (!yes) {
    section("Domains");
  }
  const domain = await promptValue("App domain", options.domain || defaultDomain, yes);
  const caddyAcmeEmail = await promptValue("Caddy ACME email", options.caddyEmail || `admin@${domain}`, yes);
  const neckDashUser = await promptValue("NECK Dash user for /__neck_dash", options.neckdashUser || "admin", yes);

  if (!yes) {
    section("Deployment");
  }
  const gitlabProject = await promptValue("GitLab project path", options.gitlabProject || `your-group/${appSlug}`, yes);
  const registry = await promptValue("Image registry/repository", options.registry || `registry.gitlab.com/${gitlabProject}`, yes);
  const prodPlatformInput = await promptValue("Production image platform", options.prodPlatform || "linux/amd64", yes);
  const prodPlatform = normalizeProdPlatform(prodPlatformInput);
  const komodoServer = await promptValue("Komodo server", options.komodoServer || "server-prod", yes);
  const komodoDeployWebhookUrl = await promptOptional(
    "Komodo deploy webhook URL",
    options.komodoDeployWebhookUrl || "",
    yes,
  );
  const komodoMigrateWebhookUrl = await promptOptional(
    "Komodo migration webhook URL",
    options.komodoMigrateWebhookUrl || "",
    yes,
  );
  const gitProvider = options.gitProvider || "gitlab.com";
  const gitAccount = options.gitAccount || "gitlab";
  const runDirectory = options.runDirectory || `/opt/stacks/${appSlug}`;
  const useEncorePlatform = options.encorePlatform !== false;
  const encoreAppId = options.encoreAppId || appSlug;
  const encoreAuthKey = options.encoreAuthKey || process.env.ENCORE_AUTH_KEY || "";
  const shouldInstall = options.install !== false;
  const shouldGit = options.git !== false;
  const force = options.force === true;
  const neckDashPassword = options.neckdashPassword || secretToken();
  const neckDashPasswordHash = bcrypt.hashSync(neckDashPassword, 12);

  section("Scaffolding");
  step(`Target: ${target}`);
  await assertWritableTarget(target, force);
  await fs.ensureDir(target);

  const vars = {
    APP_NAME: rawName === "." ? appSlug : rawName,
    APP_ID: appSlug,
    PACKAGE_NAME: packageName,
    POSTGRES_USER: postgresIdent(appSlug),
    POSTGRES_PASSWORD_DEFAULT: secretToken(),
    REDIS_PASSWORD_DEFAULT: secretToken(),
    NECK_DASH_PASSWORD_DEFAULT: neckDashPassword,
    NECK_DASH_PASSWORD_HASH_DEFAULT: neckDashPasswordHash,
    NECK_DASH_PASSWORD_HASH_DEFAULT_COMPOSE: neckDashPasswordHash.replaceAll("$", "$$$$"),
    NECK_DASH_USER: neckDashUser,
    ENCORE_AUTH_KEY_DEFAULT: secretToken(),
    CADDY_ACME_EMAIL: caddyAcmeEmail,
    DOMAIN: domain,
    REGISTRY: registry.replace(/\/+$/g, ""),
    PROD_PLATFORM: prodPlatform,
    GITLAB_PROJECT: gitlabProject,
    GIT_PROVIDER: gitProvider,
    GIT_ACCOUNT: gitAccount,
    KOMODO_SERVER: komodoServer,
    KOMODO_DEPLOY_WEBHOOK_URL: komodoDeployWebhookUrl,
    KOMODO_MIGRATE_WEBHOOK_URL: komodoMigrateWebhookUrl,
    RUN_DIRECTORY: runDirectory,
    CURRENT_DATE: new Date().toISOString().slice(0, 10),
    ENCORE_APP_CONFIG_ID: "",
  };

  step("Copying template");
  await copyTemplate(templateDir, target, vars);
  step("Creating workspace symlinks");
  await createWorkspaceLinks(target);

  if (shouldGit) {
    step("Initializing git repository");
    await $({ cwd: target })`git init`;
  }

  if (useEncorePlatform) {
    step(`Registering Encore app ${encoreAppId}`);
    await initEncorePlatform(path.join(target, "backend"), encoreAppId, encoreAuthKey);
  }

  if (shouldInstall) {
    step("Installing dependencies");
    await $({ cwd: target })`pnpm install`;
    step("Generating Encore infra config");
    await $({ cwd: target })`pnpm infra:encore`;
    step("Generating API client and OpenAPI");
    await $({ cwd: target })`pnpm api:gen`;
  }

  success(`Created ${appSlug} in ${target}`);
  console.log(`\n${chalk.bold("Next")}`);
  if (!shouldInstall) console.log(`  ${chalk.cyan("pnpm dlx zx scripts/install.mjs")}`);
  console.log(`  ${chalk.cyan("pnpm check")}`);
  console.log(`  ${chalk.cyan("pnpm dev")}`);
  outro("NECK Dash password and deploy defaults were written to .env.");
}

main().catch((err) => {
  cancel(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
