# Development

## Install

The install path is a zx command:

```bash
pnpm dlx zx scripts/neck.mjs install
```

After the first install, this is equivalent:

```bash
pnpm deps
```

Pass normal pnpm install flags through the script:

```bash
pnpm dlx zx scripts/neck.mjs install --frozen-lockfile
```

## Dev Server

```bash
pnpm dev
```

This runs:

- `pnpm neck api` before anything starts.
- `encore run --listen 0.0.0.0:4000`.
- `pnpm neck watch-api`, which regenerates the Encore TypeScript client and OpenAPI spec when backend source changes.
- `nuxt dev --host 0.0.0.0`.

Do not start Nuxt directly when validating backend API changes. The generated client is the contract between frontend and backend, so let `pnpm dev`, `pnpm check`, or `pnpm build` regenerate it.

## Generated Client

Frontend code should call `useEncoreClient()`:

```ts
const client = useEncoreClient();
const health = await client.core.health();
const stream = await client.core.realtime();
```

This keeps REST and Streaming APIs type-safe and aligned with Encore metadata.

## Testing

```bash
pnpm test
```

Backend tests run through `encore test --fileParallelism=true`, so Encore provisions declared test infrastructure automatically. The backend package `test` script runs Vitest directly because Encore invokes it internally.

For VS Code Vitest extension compatibility:

```bash
cd backend && encore test
```

## Debugging

```bash
pnpm neck debug
pnpm neck debug break
```

Attach to `127.0.0.1:9229` from VS Code or Zed using the checked-in debug configs.

Encore MCP is configured for both editors:

- `.vscode/mcp.json`
- `.zed/settings.json`

The root `encore.app` symlink points to `backend/encore.app` so MCP works from the repo root.
