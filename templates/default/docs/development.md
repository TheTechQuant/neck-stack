# Development

## Install

The install script is a zx script:

```bash
pnpm dlx zx scripts/install.mjs
```

After the first install, this is equivalent:

```bash
pnpm install:all
```

Pass normal pnpm install flags through the script:

```bash
pnpm dlx zx scripts/install.mjs --frozen-lockfile
```

## Dev Server

```bash
pnpm dev
```

This runs:

- `pnpm api:gen` before anything starts.
- `encore run --listen 0.0.0.0:4000`.
- `pnpm client:watch`, which regenerates the Encore TypeScript client and OpenAPI spec when backend source changes.
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
pnpm test:backend
```

Backend tests run through `encore test --fileParallelism=true`, so Encore provisions declared test infrastructure automatically. The backend package `test` script runs Vitest directly because Encore invokes it internally.

For VS Code Vitest extension compatibility:

```bash
pnpm test:backend:serial
```

## Debugging

```bash
pnpm debug:backend
pnpm debug:backend:break
```

Attach to `127.0.0.1:9229` from VS Code or Zed using the checked-in debug configs.

Encore MCP is configured for both editors:

- `.vscode/mcp.json`
- `.zed/settings.json`

The root `encore.app` symlink points to `backend/encore.app` so MCP works from the repo root.
