# Support Agent

An embeddable AI support agent. A business uploads its docs and adds a chat widget to its
site; the agent answers from those docs (RAG) and takes actions like creating tickets
through tool calling.

**Stack:** Next.js · Node.js / Express · MongoDB Atlas (Vector Search) · Redis + BullMQ ·
Gemini API · AWS S3 · TypeScript

> Work in progress — built in phases. See [docs/plan.md](docs/plan.md).

## Run locally

Needs Node 22+ and Docker.

```bash
cp .env.example .env      # then fill in the values (see docs/setup/accounts.md)
npm install
npm run redis:up          # local Redis in Docker
npm run dev               # api :4000 · worker · web :3000
```

Check the job queue end to end:

```bash
npm run ping -w @support-agent/worker
```

## Repo layout

| Path | What |
|---|---|
| `apps/api` | Express REST API |
| `apps/worker` | BullMQ background worker |
| `apps/web` | Next.js dashboard (and later the chat widget) |
| `packages/config` | Shared env loading and validation |
| `docs/` | Plan, architecture, setup, and per-phase learning notes |
