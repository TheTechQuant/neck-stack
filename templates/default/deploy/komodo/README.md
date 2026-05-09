# Komodo

`resources.toml` declares this app's production stack and any generated Encore migration/cron `Action` resources. Import it with a Komodo Resource Sync or paste the resources into Komodo directly.

Run `pnpm neck infra` after backend infrastructure changes. That regenerates this file from Encore metadata, so Postgres, Redis, NSQ, migrations, and cron-runner resources are present only when the backend declares matching Encore resources.

`deploy/encore/infra.prod.json`, `deploy/encore/runtime.prod.pb`, `deploy/compose.yaml`, and this file are generated together. There is no static Encore infra example file; generated output is the source of truth.

The app stack expects a shared server ingress named `neck-ingress`. Run one Caddy Docker Proxy on the server and create the network once with `docker network create neck-ingress`. Each app then contributes only Docker labels and an internal Caddy service, so multiple NECK apps can share the same server and ports `80/443`.

NECK Dash is a separate shared ingestion stack. Import `deploy/neckdash/resources.toml` once per server; do not import one observability stack for every app. It runs the published NECK Dash adapter image plus SigNoz, the SigNoz OTel collector, and ClickHouse. This app routes `/__signoz` to SigNoz over `neck-ingress` and uses a small app-local OTel bridge to label Encore metrics before forwarding them to SigNoz.

When SQL databases exist, migrations run through the stack `pre_deploy` command. That keeps the deploy path single: CI pushes images, Komodo detects changed `:prod` image digests, then migrations run before the stack restarts.

When used, Postgres is not published on the host. Compose uses generated internal password defaults unless you set `POSTGRES_PASSWORD` or `REDIS_PASSWORD` in the Komodo stack environment or the server `.env` before first boot.

The stack does not include MinIO/S3. Keep file storage external unless you intentionally want to operate object storage yourself.

The generated GitLab CI and GitHub Actions workflows do not need Komodo listener webhooks. They only build and push images; the shared `neck-auto-update` procedure handles polling-based redeploys. See `docs/deployment.md`.

The internal Caddy service uses a single public host from `DOMAIN`: Nuxt at `/`, Encore at `/api`, the real SigNoz UI at `/__signoz`, and only the trace-ingestion compatibility endpoint at `/__neck_dash/api/trace`. NECK Dash validates Encore trace auth before forwarding data to SigNoz. SigNoz uses its own generated root user. `pnpm komodo:setup` merges this app's `app_id=trace_key` pair into the shared stack's `NECKDASH_TRACE_AUTH_KEYS`. Override `SIGNOZ_USER_ROOT_PASSWORD` before deploy if you do not want to use the scaffolded password.
