# create-neck-stack

Initializer for NECK apps: Nuxt.js, Encore.ts, Caddy, and Komodo in one repo.

NECK is a meta-stack for building full-stack products with strong defaults. It gives you a Nuxt frontend, an Encore.ts backend, self-hosted NECK Dash observability, Caddy ingress, Komodo deployment resources, GitLab CI, GitHub Actions, pnpm workspaces, zx scripts, generated Encore clients, OpenAPI output, migrations, and production infra generation.

## Why NECK

In the AI era it is increasingly easy to generate code that works locally but uses the wrong abstraction, splits logic in the wrong place, or invents a style that does not match the rest of the system. NECK solves that by composing opinionated stacks whose defaults push code into the right shape.

Nuxt and Vue are opinionated about frontend code: routing, composables, server/client boundaries, data flow, hydration, and build output all have a normal Nuxt way to be done. Encore.ts is opinionated about backend code: services, APIs, auth, databases, Pub/Sub, cache, secrets, crons, streaming, tracing, logs, and generated clients are first-class primitives instead of ad hoc libraries.

The result is an opinionated setup in which things that you can get wrong are minimized and there is usually 1 right way to do X.

## What It Generates

- `frontend`: Nuxt app with `@nuxt/scripts`, Encore Toolbar support, and generated Encore client usage.
- `backend`: Encore.ts app with Worker Pooling, CORS, structured logging, tests, OpenAPI docs, and a starter Streaming API.
- `deploy`: generated Docker Compose, Caddy config, Encore self-hosted infra config, migrations image, and Komodo resources.
- `scripts`: zx scripts for dev, checks, API generation, deployment, infra generation, and migrations.
- `.gitlab-ci.yml`: GitLab pipeline for validate, image build, migration, and Komodo deploy. (NECK is optimized for gitlab repos)
- `.github/workflows/ci.yml`: GitHub Actions version of the same flow.
- `AGENTS.md`: canonical agent rules, symlinked into Claude, Zed, Cursor, and Copilot-style rule files.

This repository also contains the NECK Dash source at root-level `neckdash` and `neckdash-ui`. Generated apps consume published Docker images instead of copying that source into every application repo.

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
  --dashboard-domain encore.app.example.com \
  --neckdash-domain dash.app.example.com \
  --caddy-email ops@example.com \
  --dashboard-user ops \
  --gitlab-project my-group/my-app \
  --registry registry.gitlab.com/my-group/my-app \
  --prod-platform linux/arm64 \
  --komodo-server server-prod
```

By default the initializer registers the existing backend template with Encore Cloud using `encore app init <app-id>`, not `encore app create`, so it links the repo without scaffolding over the backend. Use `--no-encore-platform` for offline/local-only scaffolds. CI can authenticate with a masked `ENCORE_AUTH_KEY`.

## Production Shape

The generated app serves Nuxt on `DOMAIN` and proxies `/api/*` to Encore, so there is no separate API domain to configure. NECK Dash is exposed on `NECK_DASH_DOMAIN` behind Caddy Basic Auth. The production backend is built with Encore's normal self-hosted Docker path using `deploy/encore/infra.prod.json`.

NECK Dash stores observability data in VictoriaTraces and VictoriaMetrics. The generated Encore infra config uses the official Prometheus remote-write metrics primitive, so Encore's built-in metrics and app-defined custom metrics flow through the runtime exporter. App-level Postgres databases, Redis, NSQ, and cron runner actions are generated only when Encore metadata reports matching backend resources. Object storage is deliberately external: use S3, Cloudflare R2, GCS, or another managed storage provider instead of adding MinIO to the default Komodo stack.

Encore SQL migrations are run with `golang-migrate/migrate` after images are built and before the stack restarts. Postgres and Redis stay private to the Compose network. Generated passwords let the first stack boot without manual secret work, and every generated password can be overridden in Komodo or server `.env` before volumes are initialized.

Production image architecture is a first-class setting. Use `--prod-platform linux/arm64` at scaffold time, or override `PROD_PLATFORM` in CI/Komodo later; backend builds map it to Encore `--os/--arch`, and frontend/migration images use Docker `--platform`.

The production observability entrypoint is `NECK_DASH_DOMAIN`. It receives official Encore metrics through VictoriaMetrics remote write and shows request metrics, custom metrics, runtime metrics, Flow-style dependencies, the service catalog, and OpenAPI docs. The NECK Dash sidecar also includes an Encore trace ingestion adapter for deployments that explicitly configure Encore trace export. `ENCORE_DASHBOARD_DOMAIN` is kept as an optional protected redirect to Encore Cloud for teams that use it.

Generated deployment config has one source of truth: `pnpm infra:encore` writes `deploy/encore/infra.prod.json`, `deploy/encore/meta.json`, `deploy/compose.yaml`, and `deploy/komodo/resources.toml` from Encore metadata.

NECK Dash images are published from this repo as `ghcr.io/thetechquant/neck-stack/neckdash:latest` and `ghcr.io/thetechquant/neck-stack/neckdash-ui:latest`.

## Generated Commands

Inside a generated app:

```bash
pnpm dlx zx scripts/install.mjs
pnpm check
pnpm dev
pnpm build
pnpm deploy:komodo
```

`pnpm dev` regenerates the Encore client and OpenAPI spec first, then keeps watching backend source so frontend HMR sees backend API changes through the generated client.

## Created By

The NECK stack was created and is maintained by TheTechQuant - https://t.me/TheTechQuant.
