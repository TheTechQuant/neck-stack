# create-neck-stack

Initializer for NECK apps: Nuxt.js, Encore.ts, Caddy, and Komodo in one repo.

NECK is a meta-stack for building full-stack products with strong defaults. It gives you a Nuxt frontend, an Encore.ts backend, self-hosted SigNoz observability through a small NECK Dash ingestion adapter, Caddy ingress, Komodo deployment resources, GitLab CI, GitHub Actions, pnpm workspaces, zx scripts, generated Encore clients, OpenAPI output, migrations, and production infra generation.

## Why NECK

In the AI era it is increasingly easy to generate code that works locally but uses the wrong abstraction, splits logic in the wrong place, or invents a style that does not match the rest of the system. NECK solves that by composing opinionated stacks whose defaults push code into the right shape.

Nuxt and Vue are opinionated about frontend code: routing, composables, server/client boundaries, data flow, hydration, and build output all have a normal Nuxt way to be done. Encore.ts is opinionated about backend code: services, APIs, auth, databases, Pub/Sub, cache, secrets, crons, streaming, tracing, logs, and generated clients are first-class primitives instead of ad hoc libraries.

The result is an opinionated setup in which things that you can get wrong are minimized and there is usually 1 right way to do X.

## What It Generates

- `frontend`: Nuxt app with `@nuxt/scripts`, dev-only Encore Toolbar support, and generated Encore client usage.
- `backend`: Encore.ts app with Worker Pooling, CORS, structured logging, tests, OpenAPI docs, and a starter Streaming API.
- `deploy`: generated app Compose, shared NECK Dash Compose, Caddy config, Encore self-hosted infra config, migrations image, and Komodo resources.
- `scripts`: zx scripts for dev, checks, API generation, deployment, infra generation, and migrations.
- `.gitlab-ci.yml`: GitLab pipeline for validate, image build, migration, and Komodo deploy. (NECK is optimized for gitlab repos)
- `.github/workflows/ci.yml`: GitHub Actions version of the same flow.
- `AGENTS.md`: canonical agent rules, symlinked into Claude, Zed, Cursor, and Copilot-style rule files.

This repository also contains the NECK Dash adapter source at root-level `neckdash`. Generated apps consume the published adapter image instead of copying that source into every application repo.

## Quick Start

Use the published package:

```bash
pnpm create neck-stack my-app
```

Omit the app name to launch the interactive wizard:

```bash
pnpm create neck-stack
```

For a mostly configured run:

```bash
pnpm create neck-stack my-app \
  --domain app.example.com \
  --gitlab-project my-group/my-app \
  --registry registry.gitlab.com/my-group/my-app \
  --prod-platform linux/arm64 \
  --komodo-server server-prod
```

Add `--komodo-api-key <key> --komodo-api-secret <secret> --komodo-auto-setup` to run Komodo setup from the initializer. It creates the shared ingress, creates the shared observability Resource Sync if missing, merges this app's trace auth key into it, and creates/updates the app Resource Sync. Without API credentials, or without `--komodo-auto-setup`, the generated app still includes `pnpm komodo:setup` so you can run it later.

By default the initializer attempts to register the existing backend template with Encore Cloud using `encore app init <app-id>`, then links the generated backend without scaffolding over it. If Encore Cloud auth is unavailable, the scaffold still finishes and writes the requested local app id into `backend/encore.app`; use `encore app link <app-id>` later if you want Cloud linking. CI works without Encore Cloud credentials by temporarily running backend tests as a local-only Encore app. If you want CI to fetch Encore Cloud development secrets, set one masked secret: `ENCORE_CLOUD_AUTH_KEY`, `ENCORE_AUTH_CONFIG`, or `ENCORE_AUTH_TOKEN`.

## Production Shape

The generated app uses one public domain. Caddy serves Nuxt on `DOMAIN`, proxies `/api/*` to Encore, serves the real SigNoz UI at `/__signoz`, and keeps `/__neck_dash/api/trace` available for trace ingestion with Encore trace signatures. The production backend is built with Encore's normal self-hosted Docker path using `deploy/encore/infra.prod.json`, and runs with generated `deploy/encore/runtime.prod.pb` so tracing is explicitly enabled for self-hosted production.

Production hosting is multi-app by default: a single server-level Caddy Docker Proxy binds `80/443`, while each app stack attaches an internal Caddy service to the shared `neck-ingress` Docker network. That keeps per-app Compose projects isolated and lets several NECK apps share one Komodo server.

The observability stack is also one per server. Import `deploy/neckdash/resources.toml` once on a Komodo server, then import each app's `deploy/komodo/resources.toml` separately. The shared NECK Dash adapter validates Encore trace signatures and forwards traces, structured logs, and remote-write metrics to SigNoz. SigNoz is exposed at `/__signoz` so high-volume traces, logs, metrics, dashboards, and alerts use the real SigNoz UI directly.

The shared observability stack runs the NECK Dash ingestion adapter, SigNoz, the SigNoz OTel collector, and ClickHouse. The generated Encore infra config uses Encore's Prometheus remote-write metrics primitive, sending metrics to a tiny per-app OTel bridge that adds stable app labels before forwarding to SigNoz. Encore trace streams are validated by NECK Dash, transformed to OTLP, and sent to SigNoz; structured `encore.dev/log` events inside those traces are emitted as OTLP logs with `trace_id` and `span_id` preserved. App-level Postgres databases, Redis, NSQ, and cron runner actions are generated only when Encore metadata reports matching backend resources. Backend secrets are stored as app-prefixed Komodo variables so multiple apps can reuse normal secret names on the same server. Object storage is deliberately external: use S3, Cloudflare R2, GCS, or another managed storage provider instead of adding MinIO to the default Komodo stack.

The generated trace signing key is written into generated Encore infra/runtime config at build time, so the backend container does not need a trace secret in its runtime environment. The shared NECK Dash adapter validates trace ingestion with `NECKDASH_TRACE_AUTH_KEYS`, a comma/newline-separated `app_id=key` list. `ENCORE_CLOUD_AUTH_KEY` is separate and is only for CI login to Encore Cloud.

Encore SQL migrations are run with `golang-migrate/migrate` after images are built and before the stack restarts. Postgres and Redis stay private to the Compose network. Generated passwords let the first stack boot without manual secret work, and every generated password can be overridden in Komodo or server `.env` before volumes are initialized.

Production image architecture is a first-class setting. Use `--prod-platform linux/arm64` at scaffold time, or override `PROD_PLATFORM` in CI/Komodo later; backend builds map it to Encore `--os/--arch`, and frontend/migration images use Docker `--platform`.

The production observability entrypoint is the actual SigNoz app at `https://DOMAIN/__signoz` for traces, logs, request metrics, runtime metrics, custom metrics, dashboards, and alerts. SigNoz is protected by its own root user configuration (`SIGNOZ_USER_ROOT_*`). Backend trace ingestion uses the private `neck-ingress` network and posts directly to `http://neckdash:8080/trace`; the public `/__neck_dash/api/trace` route remains available for single-domain deployments and preserves the same Encore signature validation.

High-volume installs are treated as the normal case: NECK Dash avoids custom hot-path query fanout and leaves trace, log, and metric exploration to SigNoz/ClickHouse. The only per-app runtime sidecar is the small OTel collector bridge required to label Encore Prometheus remote-write metrics before they enter the shared SigNoz collector.

Generated deployment config has one source of truth: `pnpm infra:encore` writes `deploy/encore/infra.prod.json`, `deploy/encore/runtime.prod.pb`, `deploy/encore/meta.json`, `deploy/compose.yaml`, `deploy/komodo/resources.toml`, and the shared `deploy/neckdash/*` files from `encore debug meta -f json`. There is no source-scan fallback; invalid Encore metadata should fail loudly.

CI stays focused on validation and image publishing. Komodo owns runtime rollout: the generated stack enables image polling and auto-update, while the shared `neck-auto-update` procedure runs `GlobalAutoUpdate` every five minutes. SQL migrations run from stack `pre_deploy`, so they still happen after images are built and before containers restart.

The NECK Dash adapter image is published from this repo as `ghcr.io/thetechquant/neck-stack/neckdash:latest`.

## Generated Commands

Inside a generated app:

```bash
pnpm dlx zx scripts/install.mjs
pnpm check
pnpm dev
pnpm build
```

`pnpm dev` regenerates the Encore client and OpenAPI spec first, then keeps watching backend source so frontend HMR sees backend API changes through the generated client.

## Deploy Generated App

Short path:

1. Push the generated repo to GitLab/GitHub.
2. Run the `main` pipeline so `:prod` images exist.
3. Run `pnpm komodo:setup` if you have Komodo API credentials, or import `deploy/neckdash/resources.toml` once per server and `deploy/komodo/resources.toml` for the app manually.

CI builds images and pushes stable `:prod` tags. Komodo deploys the first stack from the imported resources and then polls for future image updates. The app is served at `https://DOMAIN`; SigNoz is at `https://DOMAIN/__signoz`.

## Created By

The NECK stack was created and is maintained by TheTechQuant - https://t.me/TheTechQuant.
