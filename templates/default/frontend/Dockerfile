FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY frontend frontend
RUN pnpm install --filter ./frontend... --frozen-lockfile=false

ARG NUXT_PUBLIC_API_BASE_URL
ARG NUXT_PUBLIC_ENCORE_TOOLBAR=true
ARG NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME=production
ARG NUXT_PUBLIC_ENCORE_TOOLBAR_SRC
ENV NUXT_PUBLIC_API_BASE_URL=$NUXT_PUBLIC_API_BASE_URL
ENV NUXT_PUBLIC_ENCORE_TOOLBAR=$NUXT_PUBLIC_ENCORE_TOOLBAR
ENV NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME=$NUXT_PUBLIC_ENCORE_TOOLBAR_ENV_NAME
ENV NUXT_PUBLIC_ENCORE_TOOLBAR_SRC=$NUXT_PUBLIC_ENCORE_TOOLBAR_SRC
RUN pnpm --filter frontend build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/frontend/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
