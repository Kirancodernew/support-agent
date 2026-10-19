# Phase 0 — Setup: what we built and why

## What exists now

```
support-agent/
├── apps/
│   ├── api/       Express API — GET /health, JSON logs, graceful shutdown
│   ├── worker/    BullMQ worker — listens on the "system" queue, answers "ping" jobs
│   └── web/       Next.js — home page that shows the API's live status
├── packages/
│   └── config/    loadEnv(): loads .env, validates env vars with zod, exits if invalid
├── docker-compose.yml   local Redis (noeviction)
├── eslint.config.js     one lint config for the whole repo
└── tsconfig.base.json   one strict TS config every app extends
```

Run it: `npm run redis:up` once, then `npm run dev` (starts api :4000, worker, web :3000).
Check the queue: `npm run ping -w @support-agent/worker` → `worker replied: { pong: true, latencyMs: 5 }`.

## Concepts, in plain words

### Monorepo with npm workspaces
One git repo, several apps. `"workspaces": ["apps/*", "packages/*"]` in the root
`package.json` makes npm install everything once and link our own packages, so
`import { loadEnv } from '@support-agent/config'` works in every app.
**Why:** the API and worker share code (config now; queue names and types later) and change
together in one commit. **Trade-off:** one big install; tools like Turborepo add caching when
the repo grows — not needed yet.

### Why three processes (api, worker, web)
- **api** answers requests and must stay fast.
- **worker** does slow work (embedding PDFs in Phase 2). If it ran inside the API, one big
  upload would slow every user's request. Separate processes also scale separately.
- **web** is the UI; deployed on Vercel, which is built for Next.js.

### Validate env vars at boot (fail fast)
`loadEnv(z.object({...}))` checks every variable when the app starts. A missing
`REDIS_URL` prints `REDIS_URL: Invalid string: must start with "redis"` and exits.
**Why:** a broken deploy fails in seconds with a clear message, instead of crashing on the
first real request at 2 a.m. Zod also gives typed values (`env.PORT` is a number).

### `app.ts` vs `index.ts`
`createApp()` builds the Express app; `index.ts` only starts listening. Tests (Phase 7) can
call `createApp()` with supertest without opening a port.

### Liveness health check
`GET /health` → `{ status: 'ok', uptimeSeconds }`. The host pings it and restarts the
service if it stops answering. It deliberately does **not** check MongoDB/Redis: if the DB
blips, restarting the API wouldn't fix it. (A separate *readiness* check that tests
dependencies can come later.)

### Structured logging (pino)
Logs are JSON in production (`{"level":30,"service":"api","msg":...}`) so the host can
search and filter them; pretty colours locally. Every request gets a log line with a
request id; `/health` is skipped so the host's pings don't flood the logs.

### Graceful shutdown
On redeploy the host sends `SIGTERM`. The API stops accepting new connections and lets
in-flight requests finish; the worker finishes its current job. A 10s timer forces exit if
something hangs.

### BullMQ basics
- **Queue** (producer) adds jobs to Redis. **Worker** (consumer) takes jobs and runs a
  function. **QueueEvents** listens for "completed"/"failed" events.
- Redis connections for workers need `maxRetriesPerRequest: null`, because they block
  while waiting for jobs.
- Redis must use `noeviction`, or it may delete queued jobs when memory is full.

### Build: tsx in dev, tsup for production
- `tsx watch` runs TypeScript directly and restarts on save — fast for development.
- `tsup` (esbuild) bundles each app into one `dist/index.js` for production. npm packages
  stay external (installed on the server); our own workspace packages are bundled in,
  because they're TypeScript source. Side effect: `zod` (a dependency of `config`) gets
  bundled too — the bundle is ~750 KB, which is fine for a server.

## Bugs we hit (good interview stories)

1. **Ping script never exited.** The job round-trip worked in 5 ms, but the process hung.
   Cause: BullMQ never closes Redis connections you pass in, and `QueueEvents` had its own
   connection we didn't close, so Node's event loop stayed alive. Fix: keep a reference to
   each connection and `quit()` both. Lesson: **whoever creates a resource closes it.**
2. **ESLint flagged `_next` as unused** in the Express error handler. Express only treats a
   middleware as an error handler if it has exactly 4 parameters, so it must stay. Fix:
   allow `_`-prefixed unused args — the convention for "intentionally unused".

## Interview questions you can now answer

- Why a separate worker process instead of doing the work in the API?
- What's the difference between a liveness and a readiness check?
- What happens to in-flight requests when you redeploy? How do you handle `SIGTERM`?
- Why validate environment variables at startup?
- Why does BullMQ need `maxRetriesPerRequest: null` and `noeviction`?
- Monorepo vs separate repos — when would you pick each?
- What does bundling do, and why keep npm packages external on a server?

## Deploy bug: "you're trying to use TypeScript but do not have the required package(s)"

The first Vercel build failed. `typescript` and `@types/node` were listed only in the
**root** `package.json`. Locally that worked, because a full install puts everything in the
root `node_modules`. Vercel installs **only the app being deployed** (`apps/web`), so the
root-only tools were missing.

Fix: each app lists every tool it uses in its own `devDependencies` (web: `typescript`,
`@types/node`; api/worker: also `tsx`, `tsup`). Verified by simulating the host — clean
copy, `npm ci -w <app> --include-workspace-root=false`, then build — which reproduced the
failure on the old commit and passed on the fix.

Lesson: **"works on my machine" often means "my machine has something the server
doesn't."** Reproduce the server's install, not just its build.

## Docker: how the API and worker are packaged

Each of `apps/api` and `apps/worker` has a **multi-stage Dockerfile** (build context = repo root):

1. **build stage** — copy only `package.json` files + lockfile, `npm ci` (with dev tools),
   then copy source and run `tsup`. Copying manifests first means the slow `npm ci` layer
   is cached until dependencies change, not on every code edit.
2. **runtime stage** — fresh `node:22-alpine`, `npm ci --omit=dev` (no TypeScript, tsup,
   pino-pretty), copy only `dist/` from the build stage, run as the non-root `node` user.

Result: a small image with no build tools or source in it, and the same artifact runs on
my Mac and on Railway.

## Bug caught before deploy: "Dynamic require of "fs" is not supported"

Both containers crashed at startup. `npm run dev` never showed it, because `tsx` runs the
TypeScript source; only the **bundled** `dist/` was broken. tsup had bundled `dotenv` (a
CommonJS library, used by our config package) into our ESM output, and its `require('fs')`
can't run inside ESM.

Fix: bundle only our own workspace code; keep every npm package external (the tsup config
reads the config package's dependencies and marks them external). Bonus: the bundle went
from 758 KB to 2.4 KB.

Lesson: **test the artifact you ship** (`node dist/index.js`, or the Docker image), not just
the dev server.

## Deploy: what's live and the gotchas we hit

| Piece | Host | URL / check |
|---|---|---|
| web | Vercel (root dir `apps/web`) | https://support-agent-cyan-chi.vercel.app — shows "● online" |
| api | Railway (Dockerfile) | https://support-agentapi-production.up.railway.app/health |
| worker | Railway (Dockerfile, no public URL) | `REDIS_URL=<cloud url> npm run ping -w @support-agent/worker` |

1. **Redeploy rebuilds the same commit.** Vercel's "Redeploy" reused the old, broken commit;
   the fixed commit had already deployed fine. Check *which commit* a failed build used.
2. **Railway guessed the build.** It auto-detected the monorepo and ran `npm start` with its
   own builder, ignoring our Dockerfile. Tell-tale sign: `npm warn` lines in the deploy log.
   Fix: `RAILWAY_DOCKERFILE_PATH` + clear the custom build/start commands.
3. **Worker crashed: `REDIS_URL ... received undefined`.** The env check from Phase 0 caught
   the missing variable at boot, with a clear message, instead of failing on the first job.
4. **New env var, page unchanged.** A deployment is a snapshot of code *and* settings, so
   `API_URL` only applied after a redeploy. That snapshot is also what makes rollback safe.
5. **Region matters.** Railway defaulted to US East while Redis Cloud is in Asia, so every
   queue call crossed the world (~350–575 ms ping). Keep compute next to its data.
