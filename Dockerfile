FROM node:24.14.1-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY config ./config
COPY supabase/migrations ./supabase/migrations
RUN pnpm install --frozen-lockfile && pnpm --filter @sadeeman/contracts build && pnpm --filter @sadeeman/api build
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/main.js"]
