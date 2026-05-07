FROM migrate/migrate:v4.19.1 AS migrate

FROM node:24-alpine AS runtime
RUN apk add --no-cache postgresql-client
WORKDIR /workspace
COPY --from=migrate /usr/local/bin/migrate /usr/local/bin/migrate
COPY backend ./backend
COPY scripts ./scripts
ENV BACKEND_DIR=/workspace/backend
CMD ["node", "scripts/run-migrations.mjs"]
