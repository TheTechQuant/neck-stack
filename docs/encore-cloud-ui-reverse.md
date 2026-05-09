# Encore Cloud UI Reverse Notes

Captured from the public Encore Cloud SPA on 2026-05-09.

## Captured Assets

- Page: `https://app.encore.cloud/`
- JavaScript: `https://app.encore.cloud/assets/index-DCZskOS3.js`
- CSS: `https://app.encore.cloud/assets/index-mHUbzQBJ.css`
- JavaScript size: `11,785,555` bytes
- JavaScript SHA-256: `8f579b55b26ed6401e5621e38ddaa5b58c9412295a67419cda8eb1677f18a1b3`
- CSS size: `247,727` bytes
- CSS SHA-256: `a7221d7dcde8aaf01369c7762b5b7ecde7a9ca12c3b4aac06eed137cdc9d77f5`

The JavaScript bundle references `index-DCZskOS3.js.map`, but the map URL currently returns the app shell HTML instead of a source map. Treat the minified bundle as the available source of truth.

## App Shell

The bundle contains both Encore Cloud and local dashboard shells. Runtime routing selects the Cloud shell for `app.encore.cloud` and local dashboard shell otherwise. The Cloud shell is a React app using React Router, Clerk auth, SWR, a GraphQL provider, a theme provider, PostHog, React Flow, ECharts, Radix-style primitives, and lucide icons.

Top-level Cloud routes are app/env centric:

- `/:appSlug`
- `/:appSlug/envs`
- `/:appSlug/secrets`
- `/:appSlug/envs/:envSlug`
- `/:appSlug/envs/:envSlug/trace-explorer`
- `/:appSlug/envs/:envSlug/traces/:traceID`
- `/:appSlug/envs/:envSlug/traces/:traceID/:spanID`
- `/:appSlug/envs/:envSlug/metrics`
- `/:appSlug/envs/:envSlug/api`
- `/:appSlug/envs/:envSlug/api/:serviceSlug`
- `/:appSlug/envs/:envSlug/api/:serviceSlug/:rpcSlug`
- `/:appSlug/envs/:envSlug/flow`
- `/:appSlug/envs/:envSlug/flow/:nodeSlug`
- `/:appSlug/envs/:envSlug/infra`
- `/:appSlug/envs/:envSlug/pubsub`
- `/:appSlug/envs/:envSlug/cron`
- `/:appSlug/envs/:envSlug/src`
- `/:appSlug/envs/:envSlug/cost`

Primary navigation is split into top app items, environment items, observability items, and secondary help/search items:

- App: Home, Environments, Secrets, Settings.
- Environment: Overview, Deploys, Infrastructure, Service Catalog, Code, Flow, Cost Analytics, Configuration.
- Observability: Trace Explorer, legacy Traces, Metrics, Pub/Sub, Cron Jobs.
- Secondary: Search, What's New, Feature Request, Help.

## Visual System

The public app uses a compact dark dashboard aesthetic with Tailwind-style utility classes and tokenized CSS variables. Useful extracted tokens:

- `--encr-black: #111`
- `--background: var(--encr-black)`
- `--foreground: var(--neutral-50)`
- `--card: var(--neutral-900)`
- `--secondary: var(--neutral-800)`
- `--muted-foreground: var(--neutral-400)`
- `--success-green: #afe401`
- `--radius: .625rem`
- Borders are low-contrast translucent white.

Fonts linked from the shell include Suisse Intl, Suisse Intl Mono, Beausite Classic, Fira Code, and Inter.

## Trace Explorer Target

The Trace Explorer page has a dense toolbar and two chart panels above a paginated table.

Toolbar:

- Refresh button.
- Time range popover.
- "Open trace" dialog.
- "Compare to previous period" toggle.
- Add-filter button with query builder.
- Copy selected trace IDs.
- Group-by selector.

Charts:

- `Requests & Errors` time series panel with collapsible header, total span count, brush selection, rollout markers, optional error distribution, and a small hint that the chart can be dragged to select a time range.
- `Latency Distribution` histogram panel with collapsible header, total span count, brush selection, and percentile selector with `p50`, `p75`, `p90`, `p95`, `p99`.

Tables:

- Default trace table columns include selection, Trace ID, Service, Endpoint, Duration, End Time, and Status.
- Row click navigates to the trace detail route; cmd/ctrl click opens a new tab.
- Group mode supports Service, Endpoint, Status Code, User ID, Deployment, PubSub Topic, and PubSub Subscription.
- Group detail view has a "Back to groups" control and badges for the active grouping values.
- Page sizes are `10`, `20`, `50`, and `100`.

Trace query requests use time-bounded POST bodies with `start_time`, `end_time`, `filters`, `order_by`, `limit`, `page`, and optional `highlight`. Observed filter keys include `duration`, `endpoint`, `service`, `status_code`, `rollout`, `pubsub_topic`, `pubsub_subscription`, `pubsub_message_id`, `user_id`, `x_request_id`, and `x_correlation_id`.

Observed Cloud endpoints:

- `POST /apps/{app}/envs/{env}/observability/time-series`
- `POST /apps/{app}/envs/{env}/observability/latency-histogram`
- SSE `POST /apps/{app}/envs/{env}/observability/spans`
- SSE `POST /apps/{app}/envs/{env}/observability/group-stats`

## Trace Detail Target

Trace detail is a split view:

- Header shows `Trace Details`, env badge, copyable trace ID, duration, recorded time, optional parent trace, and optional user ID.
- Left pane is the timeline and span list.
- Right pane is the selected span detail.
- Back navigation returns to browser history when possible, otherwise the trace explorer.

The trace detail page fetches a protobuf event stream from `/apps/{app}/envs/{env}/traces3/{traceID}` and constructs span/timeline state client-side.

Important event detail affordances to mirror:

- Clicking a DB segment opens a `DB Query` detail card with duration, SQL syntax highlighting, and completion/error status.
- API call segments show request, response, and error sections.
- HTTP call segments show method, host, URL, status, and timing.
- Request/response cards expose expandable headers and payload bodies.
- Structured logs remain embedded in the selected span detail and preserve `trace_id` / `span_id` correlation.

## Service Catalog Target

The Service Catalog route renders API docs from the Encore application model. It has app/env context, service-level navigation, endpoint-level pages, and generated type/schema documentation. If there is no deployed model, the empty state prompts the operator to deploy the app before using the catalog.

For NECK Dash, the catalog should continue to use generated Encore metadata and OpenAPI output as the single path. Avoid adding a hand-written documentation model.

## Flow Target

Flow uses React Flow-style nodes and edges with app/env routing. Services and PubSub topics are nodes. Edges represent service-to-service calls, database/cache/object-storage usage, publications, and subscriptions. Hovering or selecting a node should highlight direct dependencies and dependents.

Cloud Flow updates after deploys. NECK Dash should derive Flow from the latest uploaded/generated Encore metadata for each app and refresh the selected app view over the live updates stream.

## Metrics And Insights Target

The metrics page splits system and custom metrics, uses a 24 hour default time span, and exposes timezone controls. Custom metrics come from Encore metric declarations and VictoriaMetrics time series in NECK Dash.

Overview/Insights data is aggregate-first:

- requests in the last 24 hours
- errors in the last 24 hours
- error rate
- current request rate
- top requests and errors
- cron job executions
- service and endpoint counts

For high-volume deployments, keep these as aggregate VictoriaMetrics/VictoriaLogs/VictoriaTraces queries rather than deriving them by loading raw trace rows.
