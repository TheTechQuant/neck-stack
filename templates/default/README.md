# __APP_NAME__

NECK app: Nuxt.js frontend, Encore.ts backend, Caddy ingress, and Komodo deployment in one repo.

## Layout

- `frontend`: Nuxt UI. Frontend API access should go through the generated Encore client.
- `backend`: Encore.ts services, tests, CORS, Worker Pooling, structured logging, crons, streaming, and infrastructure declarations.
- `deploy`: Caddy, generated app Compose, shared NECK Dash Compose, Encore infra config, Komodo resources, and migration image.
- `scripts`: zx scripts for install, dev, checks, builds, API generation, migrations, and Komodo deploy.
- `docs`: generated OpenAPI plus project docs.

The repository-root `encore.app` is a symlink to `backend/encore.app` so Encore MCP and editor tooling work from the repo root. `AGENTS.md` is the canonical coding-agent rule file; Claude, Zed, Cursor, and Copilot-style rules symlink back to it.

## Quick Start

```bash
pnpm dlx zx scripts/install.mjs
pnpm check
pnpm dev
```

After dependencies exist, `pnpm install:all` runs the same install script. The initializer also writes a compact ignored `.env` next to `.env.example` for operator-editable settings like `DOMAIN` / `PROD_PLATFORM` and local secrets. Generated deploy defaults live in `deploy/*` and the zx scripts instead of being duplicated in `.env`.

`pnpm dev` starts Encore and Nuxt, generates `frontend/lib/encore-client.gen.ts` and `docs/openapi.json`, and watches backend source so client regeneration keeps frontend HMR aligned with backend API changes.

## API Rules

Frontend code should use `useEncoreClient()` and the generated client from `encore gen client`. Avoid hand-written fetch paths unless the generated client cannot express the endpoint.

The starter backend includes:

- `GET /health`, called through the generated client.
- `/realtime`, a bidirectional Encore Streaming API endpoint.
- Vitest coverage for health and realtime response logic.
- Structured logs through `encore.dev/log`.

The realtime sample avoids process-global broadcast state because Worker Pooling can run multiple Node.js isolates. For broadcast or cross-instance realtime, connect the stream to Pub/Sub or another shared event source.

## Common Commands

```bash
pnpm install:all
pnpm check
pnpm test:backend
pnpm test:backend:serial
pnpm api:gen
pnpm openapi:gen
pnpm build
pnpm docker:backend
pnpm docker:frontend
pnpm deploy:komodo
```

`pnpm check` regenerates Encore infra files, syntax-checks scripts, type-checks backend/frontend code, runs parallel `encore test --fileParallelism=true`, and regenerates API artifacts before Nuxt type-checking.

## Production

Short version:

```bash
pnpm dlx zx scripts/install.mjs
pnpm check
git push -u origin main
```

After the first `main` pipeline has pushed production images, `pnpm komodo:setup` can create the shared `neck-ingress` network/Caddy proxy, create the shared NECK Dash Resource Sync if missing, and create/update this app's Resource Sync. It asks for `KOMODO_API_KEY` and `KOMODO_API_SECRET` the first time and saves them to `.env`. Without API credentials, import `deploy/neckdash/resources.toml` once per server and this app's `deploy/komodo/resources.toml` manually. Encore Cloud credentials are optional: CI runs tests locally when they are absent, or uses `ENCORE_CLOUD_AUTH_KEY`, `ENCORE_AUTH_CONFIG`, or `ENCORE_AUTH_TOKEN` when you want Cloud-linked development secrets.

Production is driven by Encore metadata:

- Caddy serves Nuxt on `DOMAIN` and proxies `/api/*` to Encore, so the frontend and backend share one public host.
- A single shared NECK Dash stack runs once per Komodo server. This app's Caddy serves it at `/__neck_dash`, with its API at `/__neck_dash/api` and Basic Auth protecting every dashboard/API route except trace ingestion.
- Backend traces should be sent to the app Caddy at `http://caddy:8080/__neck_dash/api/trace`; Caddy preserves the Encore trace signature under `X-Neckdash-Trace-Auth` before proxying to NECK Dash, because Encore reserves `X-Encore-Auth`.
- The trace signing key is written into generated Encore infra at build time, so the backend container does not need a trace secret in its runtime environment. Shared NECK Dash validates trace ingestion with `NECKDASH_TRACE_AUTH_KEYS` entries such as `__APP_ID__=secret`.
- NECK Dash uses published `ghcr.io/thetechquant/neck-stack/neckdash` and `ghcr.io/thetechquant/neck-stack/neckdash-ui` images from the shared server stack.
- VictoriaTraces stores traces; VictoriaMetrics stores Encore runtime metrics and custom app metrics through Encore's Prometheus remote-write primitive; VictoriaLogs stores structured `encore.dev/log` events extracted from traces.
- `NECK_INGRESS_NETWORK` defaults to `neck-ingress`; it is the shared Docker network used by the server-level Caddy ingress so multiple apps can run on one host.
- `SQLDatabase` declarations add private Postgres with `encoredotdev/postgres` plus app migrations.
- `CacheCluster` declarations add private Redis.
- `Topic` and `Subscription` declarations add NSQ.
- `CronJob` declarations add Komodo scheduled actions that call the Encore cron endpoints.
- `secret(...)` declarations become required environment entries.
- `Bucket` declarations are detected but not provisioned; use external S3/R2/GCS.

`pnpm infra:encore` is the only source of generated production config. It reads `encore debug meta -f json` and writes `deploy/encore/infra.prod.json`, `deploy/encore/meta.json`, `deploy/compose.yaml`, `deploy/komodo/resources.toml`, and `deploy/neckdash/*`; there is no source-scan fallback or separate static example infra file to keep in sync.

GitLab and GitHub CI both validate the app, generate the frontend client/OpenAPI before frontend builds, and push stable `:prod` image tags. Komodo owns runtime rollout through stack image polling and `auto_update`; SQL migrations run from stack `pre_deploy` before each redeploy when SQL databases exist.

Set `PROD_PLATFORM=linux/arm64` to target ARM production hosts. The scaffolded default is written to Komodo resources and CI; backend images use Encore `--os/--arch`, while frontend and migration images use Docker `--platform`.

See [docs/deployment.md](docs/deployment.md) for CI variables, Komodo setup, dashboard access, and migration flow.

## NECK Dash

`https://DOMAIN/__neck_dash` is the default production observability UI. Import `deploy/neckdash/resources.toml` once per server, then import this app's `deploy/komodo/resources.toml`. The dashboard discovers apps from `NECKDASH_APPS_ROOT`, provides an app picker, and scopes traces/logs/metrics/Flow/catalog to the selected app.

The backend exports Encore metrics to VictoriaMetrics with the official Prometheus remote-write infra primitive and an `app_id` write label. NECK Dash queries Insights, built-in metrics, and custom metrics from VictoriaMetrics, structured logs from VictoriaLogs, and reads flow, service catalog, and OpenAPI data from `/__neck_dash/api`. Trace ingestion is routed through app Caddy at `/__neck_dash/api/trace` and relies on Encore trace signatures.

High-volume installs are expected: trace lists are time-bounded and service-fanout limited, direct trace-id searches use a direct lookup, log searches are time/row limited, and live log tailing requires a filter.

## More Docs

- [docs/development.md](docs/development.md)
- [docs/deployment.md](docs/deployment.md)
- `docs/openapi.json`, generated by `pnpm openapi:gen`

## Maintainer

The NECK stack was created and is maintained by TheTechQuant - https://t.me/TheTechQuant.
