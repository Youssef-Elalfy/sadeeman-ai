# SADEEMAN AI — one container, one Railway service.
# Next.js listens on Railway's public PORT; Fastify runs on 127.0.0.1:4000
# inside the container and is reached only through the web server's /api/*
# proxy. Started and supervised by tools/start-production.mjs.
FROM node:24.14.1-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY brand ./brand
COPY config ./config
COPY supabase/migrations ./supabase/migrations
COPY tools/start-production.mjs ./tools/start-production.mjs
# The internal API address is baked into the Next.js /api rewrite at build.
ENV API_INTERNAL_PORT=4000 \
    API_ORIGIN=http://127.0.0.1:4000 \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @sadeeman/contracts build \
 && pnpm --filter @sadeeman/api build \
 && pnpm --filter @sadeeman/web build \
 && chown -R node:node /app/apps/web/.next
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "tools/start-production.mjs"]
