#!/usr/bin/env node
import { $, fs, path } from "zx";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { input } from "@inquirer/prompts";
import bcrypt from "bcryptjs";
import chalk from "chalk";
import { Command } from "commander";

$.verbose = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const templateDir = path.join(rootDir, "templates", "default");

function createProgram() {
  return new Command()
    .name("create-neck-stack")
    .description("Create a NECK app: Nuxt.js, Encore.ts, Caddy, and Komodo.")
    .argument("[app-name]", "target directory or app name")
    .option("--name <name>", "package/app display name when target path differs")
    .option("--domain <domain>", "public frontend domain")
    .option("--dashboard-domain <domain>", "basic-auth protected Encore dashboard redirect domain")
    .option("--dashboard-user <user>", "basic-auth user for Encore dashboard redirect")
    .option("--dashboard-url <url>", "target URL for the protected Encore dashboard redirect")
    .option("--dashboard-password <value>", "basic-auth password for Encore dashboard redirect")
    .option("--neckdash-domain <domain>", "basic-auth protected self-hosted NECK Dash domain")
    .option("--neckdash-user <user>", "basic-auth user for NECK Dash")
    .option("--neckdash-password <value>", "basic-auth password for NECK Dash")
    .option("--caddy-email <email>", "ACME email for Caddy certificates")
    .option("--gitlab-project <path>", "GitLab project path, e.g. group/app")
    .option("--registry <registry>", "container image registry/repository")
    .option("--prod-platform <platform>", "production image target platform, e.g. linux/amd64 or linux/arm64")
    .option("--komodo-server <name>", "Komodo server resource name")
    .option("--komodo-deploy-webhook-url <url>", "optional Komodo stack deploy webhook written to generated .env")
    .option("--komodo-migrate-webhook-url <url>", "optional Komodo migration webhook written to generated .env")
    .option("--git-provider <domain>", "Git provider domain for Komodo", "gitlab.com")
    .option("--git-account <name>", "Komodo git account for private repos", "gitlab")
    .option("--run-directory <path>", "Komodo stack checkout/run directory")
    .option("--encore-app-id <slug>", "Encore app id to register/link")
    .option("--encore-auth-key <key>", "Encore auth key for non-browser app registration")
    .option("--encore-platform", "register backend with Encore Cloud")
    .option("--no-encore-platform", "skip Encore Cloud registration")
    .option("--yes", "use defaults for missing values")
    .option("--force", "allow writing into a non-empty target directory")
    .option("--install", "run pnpm install after generation")
    .option("--no-install", "skip pnpm install after generation")
    .option("--git", "initialize git repo after generation")
    .option("--no-git", "skip git initialization")
    .showHelpAfterError();
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
  console.log(`\n${chalk.bold.cyan(label)}`);
}

function step(label) {
  console.log(chalk.dim(`  • ${label}`));
}

function success(label) {
  console.log(chalk.green(`✓ ${label}`));
}

async function promptValue(label, fallback, yes) {
  if (yes) return fallback;
  const answer = await input({
    message: chalk.cyan(label),
    default: fallback,
  });
  return answer.trim() || fallback;
}

async function promptOptional(label, fallback, yes) {
  if (yes) return fallback;
  const answer = await input({
    message: chalk.cyan(label),
    default: fallback || undefined,
  });
  return answer.trim() || fallback;
}

async function promptRequired(label) {
  const answer = await input({
    message: chalk.cyan(label),
    validate: (value) => value.trim().length > 0 || `${label} is required`,
  });
  return answer.trim();
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
  const program = createProgram();
  program.parse(process.argv);
  const options = program.opts();
  const [positionalName] = program.args;

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
  const domain = await promptValue("Frontend domain", options.domain || defaultDomain, yes);
  const dashboardDomain = await promptValue("Encore dashboard domain", options.dashboardDomain || `encore.${domain}`, yes);
  const neckDashDomain = await promptValue("NECK Dash domain", options.neckdashDomain || `dash.${domain}`, yes);
  const caddyAcmeEmail = await promptValue("Caddy ACME email", options.caddyEmail || `admin@${domain}`, yes);
  const dashboardUser = await promptValue("Encore dashboard user", options.dashboardUser || "admin", yes);
  const dashboardUrl = await promptValue("Encore dashboard redirect URL", options.dashboardUrl || `https://app.encore.cloud/${appSlug}`, yes);
  const neckDashUser = await promptValue("NECK Dash user", options.neckdashUser || "admin", yes);

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
  const dashboardPassword = options.dashboardPassword || secretToken();
  const dashboardPasswordHash = bcrypt.hashSync(dashboardPassword, 12);
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
    ENCORE_DASHBOARD_PASSWORD_DEFAULT: dashboardPassword,
    ENCORE_DASHBOARD_PASSWORD_HASH_DEFAULT: dashboardPasswordHash,
    ENCORE_DASHBOARD_PASSWORD_HASH_COMPOSE_DEFAULT: dashboardPasswordHash.replaceAll("$", () => "$$"),
    ENCORE_DASHBOARD_DOMAIN: dashboardDomain,
    ENCORE_DASHBOARD_USER: dashboardUser,
    ENCORE_DASHBOARD_URL: dashboardUrl,
    NECK_DASH_PASSWORD_DEFAULT: neckDashPassword,
    NECK_DASH_PASSWORD_HASH_DEFAULT: neckDashPasswordHash,
    NECK_DASH_DOMAIN: neckDashDomain,
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
  console.log(chalk.dim("\nDashboard password and deploy defaults were written to .env."));
}

main().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : err));
  process.exit(1);
});
