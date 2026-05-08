FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY neckdash-ui neckdash-ui
RUN pnpm install --filter ./neckdash-ui... --frozen-lockfile

ARG NUXT_PUBLIC_NECKDASH_API_BASE_URL
ARG NUXT_NECKDASH_API_INTERNAL_BASE_URL
ENV NUXT_PUBLIC_NECKDASH_API_BASE_URL=$NUXT_PUBLIC_NECKDASH_API_BASE_URL
ENV NUXT_NECKDASH_API_INTERNAL_BASE_URL=$NUXT_NECKDASH_API_INTERNAL_BASE_URL
RUN pnpm --filter neckdash-ui build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/neckdash-ui/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
