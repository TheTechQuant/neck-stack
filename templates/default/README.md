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
```

`pnpm check` regenerates Encore infra files, syntax-checks scripts, type-checks backend/frontend code, runs parallel `encore test --fileParallelism=true`, and regenerates API artifacts before Nuxt type-checking.

## Production

Short version:

```bash
pnpm dlx zx scripts/install.mjs
pnpm check
git push -u origin main
```

After the first `main` pipeline has pushed production images, `pnpm komodo:setup` can create the shared `neck-ingress` network/Caddy proxy, create the shared observability Resource Sync if missing, and create/update this app's Resource Sync. It asks for `KOMODO_API_KEY` and `KOMODO_API_SECRET` the first time and saves them to `.env`. Without API credentials, import `deploy/neckdash/resources.toml` once per server and this app's `deploy/komodo/resources.toml` manually. Encore Cloud credentials are optional: CI runs tests locally when they are absent, or uses `ENCORE_CLOUD_AUTH_KEY`, `ENCORE_AUTH_CONFIG`, or `ENCORE_AUTH_TOKEN` when you want Cloud-linked development secrets.

Production is driven by Encore metadata:

- Caddy serves Nuxt on `DOMAIN` and proxies `/api/*` to Encore, so the frontend and backend share one public host.
- A single shared observability stack runs once per Komodo server. This app's Caddy serves the real SigNoz UI at `/__signoz`; `/__neck_dash/api/trace` remains as the trace-ingestion compatibility route.
- Backend traces are configured in generated `deploy/encore/runtime.prod.pb` and are sent over the private Compose network to `http://neckdash:8080/trace`. The public `/__neck_dash/api/trace` route still exists for single-domain ingestion and preserves the Encore trace signature under `X-Neckdash-Trace-Auth`.
- The trace signing key is written into generated Encore infra/runtime config at build time, so the backend container does not need a trace secret in its runtime environment. Shared NECK Dash validates trace ingestion with `NECKDASH_TRACE_AUTH_KEYS` entries such as `__APP_ID__=secret`.
- NECK Dash uses the published `ghcr.io/thetechquant/neck-stack/neckdash` adapter image from the shared server stack.
- SigNoz stores traces, logs, Encore runtime metrics, and custom app metrics. The app stack only runs a small OTel bridge so Encore's Prometheus remote-write metrics get stable `encore.app_id` labels before reaching the shared SigNoz collector.
- `NECK_INGRESS_NETWORK` defaults to `neck-ingress`; it is the shared Docker network used by the server-level Caddy ingress so multiple apps can run on one host.
- `SQLDatabase` declarations add private Postgres with `encoredotdev/postgres` plus app migrations.
- `CacheCluster` declarations add private Redis.
- `Topic` and `Subscription` declarations add NSQ.
- `CronJob` declarations add Komodo scheduled actions that call the Encore cron endpoints.
- `secret(...)` declarations become required environment entries backed by app-prefixed Komodo variables, so common names like `StripeAPIKey` do not collide across apps on one server.
- `Bucket` declarations are detected but not provisioned; use external S3/R2/GCS.

`pnpm infra:encore` is the only source of generated production config. It reads `encore debug meta -f json` and writes `deploy/encore/infra.prod.json`, `deploy/encore/runtime.prod.pb`, `deploy/encore/meta.json`, `deploy/compose.yaml`, `deploy/komodo/resources.toml`, and `deploy/neckdash/*`; there is no source-scan fallback or separate static example infra file to keep in sync.

GitLab and GitHub CI both validate the app, generate the frontend client/OpenAPI before frontend builds, and push stable `:prod` image tags. Komodo owns runtime rollout through stack image polling and `auto_update`; SQL migrations run from stack `pre_deploy` before each redeploy when SQL databases exist.

Set `PROD_PLATFORM=linux/arm64` to target ARM production hosts. The scaffolded default is written to Komodo resources and CI; backend images use Encore `--os/--arch`, while frontend and migration images use Docker `--platform`.

See [docs/deployment.md](docs/deployment.md) for CI variables, Komodo setup, SigNoz access, and migration flow.

## Observability

`https://DOMAIN/__signoz` is the default production observability UI. Import `deploy/neckdash/resources.toml` once per server, then import this app's `deploy/komodo/resources.toml`.

Trace, log, request-metric, runtime-metric, custom-metric, dashboard, and alert exploration lives in the real SigNoz UI at `https://DOMAIN/__signoz`. SigNoz uses its own root user (`SIGNOZ_USER_ROOT_EMAIL` / `SIGNOZ_USER_ROOT_PASSWORD`). NECK Dash validates Encore trace signatures, transforms trace payloads to OTLP, extracts structured `encore.dev/log` entries as OTLP logs, and forwards everything to SigNoz.

High-volume installs are expected: NECK Dash stays out of heavy trace/log/metric querying, while SigNoz and ClickHouse own those paths. The only per-app observability sidecar is the OTel bridge used to label Encore remote-write metrics.

## More Docs

- [docs/development.md](docs/development.md)
- [docs/deployment.md](docs/deployment.md)
- `docs/openapi.json`, generated by `pnpm openapi:gen`

## Maintainer

The NECK stack was created and is maintained by TheTechQuant - https://t.me/TheTechQuant.
