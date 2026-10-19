# Build Plan

Each phase is small, ends deployed, and gets a `learn/phase-N.md` note before moving on.
Phases 0–3 are enough for the resume; 4–7 make it stand out.

| Phase | Status |
|---|---|
| 0. Setup | ✅ Done — web on Vercel, api + worker on Railway |
| 1. Auth + workspaces | ✅ Done — live on Vercel + Railway |
| 2. Doc ingestion | ✅ Done — live: upload → S3 → worker → Gemini → Atlas search |
| 3. RAG chat | Built, verified locally (real Gemini/Atlas); deploy pending |
| 4. Embeddable widget | Not started |
| 5. Agent tools | Not started |
| 6. Dashboard | Not started |
| 7. Polish | Not started |

---

## Phase 0 — Setup

**Build:** monorepo with `apps/web` (Next.js), `apps/api` (Express), `apps/worker` (BullMQ
worker), shared TypeScript config, ESLint, Docker Compose for local Redis.
**Done when:** a hello page is live on Vercel and `GET /health` is live on Railway, both
reading config from env.
**Learn:** monorepo vs polyrepo, why TypeScript, env-based config, what Docker Compose does.

## Phase 1 — Auth + workspaces

**Build:** signup / login (bcrypt + JWT in an httpOnly cookie), a workspace per business,
generate and revoke API keys (store only a hash).
**Done when:** a business can sign up, log in, and create an API key.
**Learn:** hashing vs encryption, JWT vs sessions, cookie flags, why API keys are hashed,
multi-tenancy (every query filtered by `workspaceId`).

## Phase 2 — Doc ingestion

**Build:** upload PDF / URL → store file in S3 → enqueue a BullMQ job → worker extracts
text, splits it into chunks, creates embeddings (Gemini, via the `llm` layer), saves chunks to MongoDB with a vector index.
**Done when:** an uploaded PDF shows status `ready` and its chunks are searchable.
**Learn:** provider interface pattern, why a queue (slow work off the request path), retries and idempotency,
chunk size and overlap, what an embedding is, cosine similarity, vector index.

## Phase 3 — RAG chat

**Build:** embed the question → vector search top-k chunks for this workspace → prompt
Gemini with the chunks → stream the answer (SSE) with source citations.
**Done when:** chat answers from uploaded docs, word by word, with sources, and says
"I don't know" when the docs don't cover it.
**Learn:** RAG flow end to end, prompt design for grounding, streaming (SSE vs WebSocket),
hallucination control, measuring latency.

## Phase 4 — Embeddable widget

**Build:** a `<script>` snippet that injects the chat (iframe) into any site using the
workspace's public key; CORS / allowed domains; per-workspace rate limiting in Redis.
**Done when:** the widget works on a plain test HTML page on another origin.
**Learn:** iframe isolation, CORS, public vs secret keys, rate limiting algorithms
(fixed window, sliding window, token bucket).

## Phase 5 — Agent tools

**Build:** tool calling with `createTicket`, `getOrderStatus` (mock store), `bookSlot`,
and `handoffToHuman` when confidence is low. Agent loop with a max-steps guard.
**Done when:** "where is my order 1234?" calls the tool and answers with the result.
**Learn:** how tool calling works, the agent loop, guarding against loops and bad tool
input, when to hand off to a human.

## Phase 6 — Dashboard

**Build:** conversation list and transcript view, unanswered-questions report,
thumbs up / down feedback on answers.
**Done when:** an admin can see which questions the agent fails on.
**Learn:** MongoDB aggregation, pagination (cursor vs offset), indexes for queries.

## Phase 7 — Polish

**Build:** tests for the API and the RAG pipeline, README with an architecture diagram,
seeded demo account, p95 latency measured and logged, and **delete workspace** (removes every
file, chunk, key and user — needed for privacy laws like GDPR / India's DPDP Act).
**Done when:** a recruiter can open the live link, log in to the demo, and try it.
**Learn:** what to test and why, how to present the project in 2 minutes.
