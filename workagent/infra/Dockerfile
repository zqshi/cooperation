ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@11.4.0 --activate
WORKDIR /app
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm build
FROM base AS runtime
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/channel ./apps/channel
COPY scripts ./scripts
RUN pnpm install --prod --frozen-lockfile && mkdir -p /app/data/artifacts && chown -R node:node /app/data
ENV NODE_ENV=production
USER node
CMD ["pnpm","--filter","@workagent/api","start"]
FROM ${NODE_IMAGE} AS console
WORKDIR /app
COPY --from=build /app/apps/console/dist ./public
COPY infra/static-server.mjs ./static-server.mjs
USER node
CMD ["node","static-server.mjs"]
FROM ${NODE_IMAGE} AS portal
WORKDIR /app
COPY --from=build /app/apps/user-portal/dist ./public
COPY infra/static-server.mjs ./static-server.mjs
USER node
CMD ["node","static-server.mjs"]
