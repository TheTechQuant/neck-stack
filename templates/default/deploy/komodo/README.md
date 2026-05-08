# Komodo

`resources.toml` declares the production stack and any generated Encore migration/cron `Action` resources. Import it with a Komodo Resource Sync or paste the resources into Komodo directly.

Run `pnpm infra:encore` after backend infrastructure changes. That regenerates this file from Encore metadata, so Postgres, Redis, NSQ, migrations, and cron-runner resources are present only when the backend declares matching Encore resources.

`deploy/encore/infra.prod.json`, `deploy/compose.yaml`, and this file are generated together. There is no static Encore infra example file; generated output is the source of truth.

NECK Dash is always included through published images. VictoriaMetrics stores Encore remote-write runtime metrics and custom app metrics. VictoriaTraces stores traces, and VictoriaLogs stores structured `encore.dev/log` events extracted from those traces. App Postgres remains optional and is not used for observability storage.

When SQL databases exist, the migration action is intentionally separate from stack deploy. Point `KOMODO_MIGRATE_WEBHOOK_URL` at the generated `__APP_ID__-migrate` action and `KOMODO_DEPLOY_WEBHOOK_URL` at the stack deploy webhook so GitLab runs migrations after image build and before restart. Without SQL databases, GitLab skips that migration step.

When used, Postgres is not published on the host. Compose uses generated internal password defaults unless you set `POSTGRES_PASSWORD` or `REDIS_PASSWORD` in the Komodo stack environment or the server `.env` before first boot.

The stack does not include MinIO/S3. Keep file storage external unless you intentionally want to operate object storage yourself.

The generated GitLab CI expects `KOMODO_DEPLOY_WEBHOOK_URL`. It only needs `KOMODO_MIGRATE_WEBHOOK_URL` after the backend declares SQL databases.

GitHub Actions uses the same deploy script and expects equivalent repository secrets. See `docs/deployment.md`.

The Caddy service uses a single public host from `DOMAIN`: Nuxt at `/`, Encore at `/api`, and NECK Dash at `/__neck_dash` with its API at `/__neck_dash/api`. Only `/__neck_dash/api/trace` bypasses dashboard Basic Auth so backend trace exporters can post there; NECK Dash still validates Encore trace auth. Override `NECK_DASH_PASSWORD_HASH` before deploy if you do not want to use the scaffolded first password.
