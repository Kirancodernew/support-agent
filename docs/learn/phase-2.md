# Phase 2 — Upload documents and make them searchable

## What exists now

```
Browser ──1. POST /documents {filename,size}──► API ─► record (uploading) + one-time S3 upload form
   └──2. POST file straight to S3 (never through our servers)
   ──3. POST /documents/:id/complete ──► API checks S3 has it ─► status queued ─► job in Redis
Worker ◄─ job: download → extract text → chunk → Gemini embeddings → save chunks → ready
Search: question → Gemini query embedding → Atlas $vectorSearch (filtered by workspace) → passages
```

| Route | What it does |
|---|---|
| `POST /documents` | validates name/size, creates the record, returns a pre-signed S3 upload form |
| `POST /documents/:id/complete` | verifies the file is in S3, flips status to `queued`, enqueues the job (once) |
| `GET /documents` | this workspace's documents with live status |
| `DELETE /documents/:id` | removes record, chunks and the S3 file |
| `POST /search` | the passages closest in meaning to a question |

Shared packages: `db` (models, transactions, vector index, retriever), `queue` (queue names,
job settings), `storage` (S3), `llm` (Gemini embeddings behind an `Llm` interface).

## Concepts, in plain words

### Pre-signed uploads
The API never touches the file. It signs a short-lived (5 min) form that lets the browser
upload **one** object, at **one** key we chose, of **one** content type, up to 10 MB — S3
enforces all four. Big files can't tie up our servers, and the AWS secret never leaves the API.
The key is built from ids (`workspaces/<wid>/documents/<docId>.pdf`), never from the filename,
so `../../` tricks go nowhere.

### Two-step "complete"
After uploading, the browser calls `complete`. The API checks the object really exists
(`HeadObject`) before queuing. Without `s3:ListBucket`, S3 answers 403 (not 404) for a missing
object — least privilege changes the error you get. A conditional update
(`status: uploading → queued`) means two racing calls enqueue only once.

### Queue + worker, retries, and final failure
The worker processes one document at a time (free-tier friendly). Ordinary errors (network,
rate limits) retry 3 times with 5s / 10s / 20s backoff. Errors that retrying can't fix
(no text, damaged PDF, too long) throw `UnrecoverableError` and fail immediately with a message
the user understands. Internal error details are never shown to users.

### Idempotent jobs
A job can run twice (crash mid-way, retry). Before saving, the worker deletes that document's
old chunks, so a second run replaces rather than duplicates. The job id is the document id,
so enqueueing twice is a no-op. If the user deletes the document mid-processing, the worker
notices on its final update and removes the chunks it just wrote.

### Where files live, and how long
A file belongs to the **workspace**, not the login session: logging out and back in changes
nothing. It stays (S3 file + record + chunks) until someone clicks Delete.

**Abandoned uploads** (tab closed mid-upload) would otherwise stay "uploading" forever, count
toward the 20-document limit, and maybe leave a file in S3. A cleanup job removes "uploading"
records older than an hour, plus their S3 file. An hour is safe: upload links expire after 5
minutes, so such an upload can never finish. The delete is conditional on still being
"uploading", so an upload completed at the last second is left alone.

It runs every 15 minutes through a **BullMQ job scheduler stored in Redis**, not `setInterval`:
with several worker copies, `setInterval` would run it once per copy; the scheduler runs it once
in total, and `upsert` makes registering it on every boot safe.

### Chunking
~1,000-character chunks, packed by paragraph, falling back to sentences, then words. Each
chunk starts with the last ~150 characters of the previous one, so a sentence on a boundary
is still whole somewhere. Small enough to be precise, big enough to carry meaning.

### Embeddings and vector search
Gemini turns text into 768 numbers; similar meaning → nearby vectors. Documents and questions
use different task types (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`). Atlas Vector Search finds
the nearest chunks by cosine similarity, approximately (it checks `numCandidates`, returns the
best `limit`). `workspaceId` is a **filter field inside the index**, so other tenants' chunks
are never even candidates. Proof from the live test: "I forgot my login" matched the
"Resetting your password" section with almost no shared words.

### Dependency injection
`createApp({ storage, ingestQueue, llm, retriever })`. Production passes S3/BullMQ/Gemini/Atlas;
tests pass in-memory fakes, so 27 API tests run in seconds with no network. The fake retriever
honours the same workspace filter, so isolation is still tested.

### Shared packages instead of copies
API and worker both need the models, queue names, S3 and Gemini. One package each, imported by
both, so a producer and consumer can't drift apart.

## Problems we hit

1. **TypeScript 7 stopped auto-loading Node's types.** `packages/db` (which imports no Node
   module) got incomplete TLS types from the MongoDB driver. Fix: `"types": ["node"]` in the
   shared base tsconfig.
2. **Overlap of 0 produced oversized chunks.** `text.slice(-0)` is `text.slice(0)` — the whole
   string. Caught by a test; `tail()` now returns `''` for n ≤ 0.
3. **Session cookies were written to request logs.** pino-http logs headers by default. Anyone
   reading production logs could have replayed a session. Now `cookie`, `authorization`,
   `x-api-key` and `set-cookie` are redacted; a test fails if they ever leak again.
4. **Search returned nothing right after "Ready".** Atlas indexes new chunks a few seconds after
   they're written (eventual consistency). The UI now says so.

5. **Worker crashed on Railway: `TypeError: Invalid URL` in ioredis.** The pasted `REDIS_URL`
   had a stray `"` at the end. Our check only tested `startsWith('redis')`, so ioredis failed
   instead — and its error printed the whole URL, password included, into the logs. Now
   `REDIS_URL` is parsed as a real URL at startup, and the error never echoes the value.

## Interview questions you can now answer

- Why upload directly to S3 with a pre-signed URL instead of through the API?
- How do you make a background job safe to retry?
- Which errors should be retried, and which should fail immediately?
- What is an embedding? Why cosine similarity? What's approximate nearest neighbour search?
- How does chunk size affect retrieval quality? Why overlap?
- How do you stop one tenant's search from returning another tenant's data?
- What's dependency injection and how does it make tests fast?
- What should never appear in logs?
