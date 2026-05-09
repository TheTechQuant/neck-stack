FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY frontend frontend
RUN pnpm install --filter ./frontend... --frozen-lockfile=false

ARG NUXT_PUBLIC_API_BASE_URL
ARG NUXT_API_INTERNAL_BASE_URL
ENV NUXT_PUBLIC_API_BASE_URL=$NUXT_PUBLIC_API_BASE_URL
ENV NUXT_API_INTERNAL_BASE_URL=$NUXT_API_INTERNAL_BASE_URL
RUN pnpm --filter frontend build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build /app/frontend/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
