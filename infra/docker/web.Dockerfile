# syntax=docker/dockerfile:1.7
# Static build of one of the React apps served by nginx, which also reverse-proxies /api to the API
# so session cookies stay first-party (same origin).
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=hrms-web .
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=license-admin-web .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
ARG APP=hrms-web
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/hrms-web/package.json apps/hrms-web/
COPY apps/license-admin-web/package.json apps/license-admin-web/
COPY packages/authorization/package.json packages/authorization/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/configuration/package.json packages/configuration/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --ignore-scripts --filter "@yardhrms/${APP}..."
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN pnpm --filter "@yardhrms/${APP}" run build

FROM nginx:1.28-alpine AS web
ARG APP=hrms-web
COPY infra/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/${APP}/dist /usr/share/nginx/html
# Source maps are not shipped to browsers in production images.
RUN find /usr/share/nginx/html -name '*.map' -delete
ENV API_UPSTREAM=http://api:3000
EXPOSE 8080
