# __APP_NAME__

NECK app: Nuxt.js frontend, Encore.ts backend, Caddy ingress, and Komodo deployment in one repo.

## Layout

- `frontend`: Nuxt UI. Frontend API access should go through the generated Encore client.
- `backend`: Encore.ts services, tests, CORS, Worker Pooling, structured logging, crons, streaming, and infrastructure declarations.
- `deploy`: Caddy, generated Compose, Encore infra config, Komodo resources, and migration image.
- `scripts`: zx scripts for install, dev, checks, builds, API generation, migrations, and Komodo deploy.
- `docs`: generated OpenAPI plus project docs.

The repository-root `encore.app` is a symlink to `backend/encore.app` so Encore MCP and editor tooling work from the repo root. `AGENTS.md` is the canonical coding-agent rule file; Claude, Zed, Cursor, and Copilot-style rules symlink back to it.

## Quick Start

```bash
pnpm dlx zx scripts/install.mjs
pnpm check
pnpm dev
```

After dependencies exist, `pnpm install:all` runs the same install script. The initializer also writes an ignored `.env` next to `.env.example` with the deploy values it already knows, including dashboard auth and optional Komodo webhook URLs.

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

Production is driven by Encore metadata:

- Caddy serves Nuxt on `DOMAIN` and proxies `/api/*` to Encore, so the frontend and backend share one public host.
- NECK Dash is served at `/__neck_dash` on the same `DOMAIN`, with its API at `/__neck_dash/api` and Basic Auth protecting every dashboard/API route except trace ingestion.
- Backend traces are received at `http://neckdash:8080/trace` inside Compose; the equivalent single-domain ingestion path is `https://DOMAIN/__neck_dash/api/trace` and is protected by Encore trace auth, not Basic Auth.
- `ENCORE_AUTH_KEY` is declared in the generated Encore infra config and shared with NECK Dash, so service auth and trace ingestion use the same generated deployment secret.
- NECK Dash uses published `ghcr.io/thetechquant/neck-stack/neckdash` and `ghcr.io/thetechquant/neck-stack/neckdash-ui` images.
- VictoriaTraces is included for trace storage; VictoriaMetrics stores Encore runtime metrics and custom app metrics through Encore's Prometheus remote-write primitive; VictoriaLogs stores structured `encore.dev/log` events extracted from traces.
- `SQLDatabase` declarations add private Postgres with `encoredotdev/postgres` plus app migrations.
- `CacheCluster` declarations add private Redis.
- `Topic` and `Subscription` declarations add NSQ.
- `CronJob` declarations add Komodo scheduled actions that call the Encore cron endpoints.
- `secret(...)` declarations become required environment entries.
- `Bucket` declarations are detected but not provisioned; use external S3/R2/GCS.

`pnpm infra:encore` is the only source of generated production config. It reads `encore debug meta -f json` and writes `deploy/encore/infra.prod.json`, `deploy/encore/meta.json`, `deploy/compose.yaml`, and `deploy/komodo/resources.toml`; there is no source-scan fallback or separate static example infra file to keep in sync.

GitLab and GitHub CI both run validate, image build, migration, and Komodo deploy stages. They generate the frontend client/OpenAPI before frontend builds and trigger migrations after images are built but before the Komodo stack deploy webhook.

Set `PROD_PLATFORM=linux/arm64` to target ARM production hosts. The scaffolded default is written to `.env`, Komodo resources, and CI; backend images use Encore `--os/--arch`, while frontend and migration images use Docker `--platform`.

See [docs/deployment.md](docs/deployment.md) for CI variables, Komodo setup, dashboard access, and migration flow.

## NECK Dash

`https://DOMAIN/__neck_dash` is the default production observability UI. The backend exports Encore metrics to VictoriaMetrics with the official Prometheus remote-write infra primitive. NECK Dash queries Insights, built-in metrics, and custom metrics from VictoriaMetrics, structured logs from VictoriaLogs, and reads flow, service catalog, and OpenAPI data from `/__neck_dash/api`. Trace ingestion is available privately at `http://neckdash:8080/trace` and publicly at `/__neck_dash/api/trace`; both paths rely on Encore trace signatures.

High-volume installs are expected: trace lists are time-bounded and service-fanout limited, direct trace-id searches use a direct lookup, log searches are time/row limited, and live log tailing requires a filter.

## More Docs

- [docs/development.md](docs/development.md)
- [docs/deployment.md](docs/deployment.md)
- `docs/openapi.json`, generated by `pnpm openapi:gen`

## Maintainer

The NECK stack was created and is maintained by TheTechQuant - https://t.me/TheTechQuant.
