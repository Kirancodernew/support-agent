# Build context is the repo root, so workspace packages and the lockfile are available.

# ---- build: install all deps (incl. dev tools like tsup), then bundle ----
FROM node:22-alpine AS build
WORKDIR /app
# Manifests first: this layer (npm ci) is cached until a package.json or the lockfile changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
RUN npm ci -w @support-agent/worker --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN npm run build -w @support-agent/worker

# ---- runtime: production deps only + the built bundle ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
RUN npm ci -w @support-agent/worker --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/apps/worker/dist apps/worker/dist
# Don't run as root inside the container.
USER node
CMD ["node", "apps/worker/dist/index.js"]
