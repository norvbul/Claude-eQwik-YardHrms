# syntax=docker/dockerfile:1.7
# Builds the API, worker and migration images from the pnpm monorepo.
#   docker build -f infra/docker/node.Dockerfile --target api .
#   docker build -f infra/docker/node.Dockerfile --target worker .
#   docker build -f infra/docker/node.Dockerfile --target migrate .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# openssl is required by the Prisma query engine
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/hrms-web/package.json apps/hrms-web/
COPY apps/license-admin-web/package.json apps/license-admin-web/
COPY packages/authorization/package.json packages/authorization/
COPY packages/types/package.json packages/types/
COPY packages/payroll-engine/package.json packages/payroll-engine/
COPY packages/ui/package.json packages/ui/
COPY packages/configuration/package.json packages/configuration/
COPY prisma prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm run build:packages \
  && pnpm --filter @yardhrms/api run build \
  && pnpm --filter @yardhrms/worker run build

# Runtime images run as the unprivileged "node" user. The full workspace node_modules is kept so the
# generated Prisma client and native modules (argon2) match the build exactly.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.storage && chown node:node /app/.storage
USER node

FROM runtime AS api
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime AS worker
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

# One-shot: apply migrations (and optionally seed the initial platform admin / demo data).
FROM runtime AS migrate
WORKDIR /app
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && if [ \"$RUN_SEED\" = \"true\" ]; then node apps/api/dist/seed/seed.js; fi"]
