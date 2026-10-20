# Phase 7 — Polish: delete workspace, a public demo, resilience, README

## What exists now

| Piece | What |
|---|---|
| **Delete workspace** | Dashboard → type the workspace name + your password. Access ends at once; the worker removes S3 files, chunks, documents, chats, Inbox, keys and users. |
| **Try the live demo** | One click on the home or login page → a shared sample shop ("Acme Home Store") with 2 docs, 22 chats over two weeks, an Inbox and Insights. Chat is live but capped; everything else is read-only. |
| **Nightly demo reset** | The worker restores the demo's chats, Inbox and settings at 3am IST and on every deploy. |
| **"Busy" handling** | When Gemini is overloaded or too slow, the customer sees "very busy, try again in a minute", logged as a warning, not a crash. |
| **README** | Live demo link, features, Mermaid architecture + chat sequence diagrams, highlights, how to run. |

| Route | What |
|---|---|
| `POST /workspace/delete` | `{ password, confirmName }` → 202; users removed + workspace marked in one transaction, purge job queued |
| `POST /auth/demo` | session for the demo workspace (no password), with its own session id |

## Concepts, in plain words

### Deleting across three systems (and failing half-way)
A workspace's data lives in MongoDB, S3 and Redis. There's no transaction across them, so the
deletion is designed to be **safe to re-run**:
1. The API (one Mongo transaction): mark the workspace `deletingAt`, delete its users, remove the
   widget key. From this moment nobody can use it.
2. A queued job: delete the S3 files, then chunks, documents, chats, Inbox, keys, and the workspace
   **last**. Each step deletes "whatever is left", so a retry after a crash just continues.
3. A **sweep** every 15 minutes finishes any workspace still marked (job never queued, Redis down,
   retries used up).

Order matters: the worker's IAM user can't list the bucket (least privilege), so our document
records are the only list of files. They are deleted *after* the files.

### Revoking a stateless JWT
A JWT is valid until it expires (7 days), even if the account is gone. So `requireAuth` now also
checks the user still exists: one indexed lookup per request. That's the trade-off: stateless
tokens are cheap, revocation needs state. (At larger scale: short-lived tokens + refresh tokens, or
a Redis deny-list.)

### A public demo that strangers can't break
Everyone shares one demo workspace, so anything that changes it for the next visitor is blocked
(`403 demo_read_only`): uploads, deletes, widget/integration settings, keys, deleting the workspace.
Abuse cases thought through:
- **Quota drain:** chat is capped at 5 messages per demo session per hour **and** 100 per day for all
  visitors (sliding-window limiter). Per-IP limits were avoided: behind Vercel's proxy the IP is
  easy to get wrong.
- **Email spam:** the demo never sends email, otherwise a visitor could aim ticket emails at a stranger.
- **Secret exposure:** the demo shop's signing secret is never returned to visitors (found while
  testing the demo in the browser: the Integrations panel showed it).

The demo is a session claim (`demo: true` in the signed JWT), not something the browser can set.

### Seed data and idempotent setup
The worker creates the demo itself: `ensureDemo` creates what's missing (workspace, owner,
documents through the normal S3 → ingest path) and does nothing on later runs. `resetDemo` replaces
chats and Inbox with sample ones **dated relative to now**, so "last 7 days" is never empty.
Documents are kept: they can't change in the demo, and re-embedding nightly would waste quota.

### Scheduled jobs in a queue
`upsertJobScheduler` stores the schedule in Redis (`every 15 min`, or cron `0 3 * * *` in
Asia/Kolkata). With several worker copies, each run still happens once, unlike `setInterval`.

### Retry, backoff, jitter, and "busy"
Already in place since Phase 2: retry 429/5xx up to 4 times, waiting 1s, 2s, 4s (+ random jitter
so many clients don't retry in sync), only before the first word streams. Phase 7 adds a typed
`LlmBusyError` for "still throttled after retries" and "no reply in 30s", so the app can tell an
overloaded provider apart from a bug. Timeouts aren't retried: someone is waiting.

## Problems we hit

1. **BullMQ rejects `:` in job ids.** The first live deletion failed to enqueue
   (`Custom Id cannot contain :`); the unit test passed because the fake queue accepted anything.
   The safety net worked as designed: access ended and the sweep finished the deletion later.
   Fixed to `delete-workspace-<id>`.
2. **Demo leaked the signing secret** (above). Now hidden for demo sessions, with a test.
3. **Gemini free tier slow for a day** (20–35s per call): not quota exhaustion (that's an instant
   429) but queueing. Led to the busy message above.
4. **A Railway variable reference pointed at a service that doesn't exist.** The worker's
   `DEMO_SHOP_SECRET` was set to `${{api.DEMO_SHOP_SECRET}}`, but the service is called
   `@support-agent/api`, so it resolved to an empty string. The worker's env validation
   (`min(16)`) refused to start: a crash loop with a clear message, instead of a worker that runs
   half-configured. Fixed by picking the reference from Railway's autocomplete. Lesson: validate
   config at startup and fail loudly; it turned a silent bug into a one-line log.
5. **Local and production shared one database.** The local `.env` pointed at the same Atlas
   database as production, so the local worker created the demo with `localhost` settings, and
   local test accounts and evaluation chats landed in production data. The production reset fixed
   the demo; the real fix is a separate database for development (`support_agent_dev` on the same
   cluster). Lesson: dev and prod need separate data, even on a free tier.

## Verified

- Locally, end to end with real services: a new account uploaded a file to the real S3 bucket, it
  was ingested, then the workspace was deleted. **3.2s later** the S3 file, chunks, documents and
  users were gone, the old session got 401, login 401, and the widget key 404.
- The first (failed-enqueue) deletion was finished by the 15-minute sweep.
- Demo in the browser: one click from the home page; banner, Inbox T-0002…T-0004, both documents
  ready, Insights with 15 conversations / 78% satisfaction / "student discount" asked 3×; a live
  question answered from the demo's own documents with a citation.
- **Live, in production** (Vercel → Railway, through the public site): one-click demo login;
  both documents ready; Insights with 15 conversations, 40% from docs, 78% satisfaction, p95 first
  word 1.4s; Inbox T-0002…T-0004; widget allowed only on the Vercel site; the signing secret shown
  as "hidden in the demo"; uploads, workspace delete and API keys refused with 403; and the
  Integrations "Test" looked up order 1001 through the **signed webhook** to the Vercel demo shop
  ("Shipped, arrives 21 Oct"), which proves API, worker and web share the secret. Worker log:
  `demo reset … conversations: 22, inboxItems: 4`.
- Tests: delete (API + worker, including failure part-way and retry), demo (read-only routes, chat
  caps, no email, hidden secret, seed + reset), busy message.

## Interview questions you can now answer

- How do you delete a user's data across a database, object storage and a queue? What if it fails half-way?
- How do you revoke a JWT? What does it cost?
- How would you put a public demo of a paid product online without it being abused?
- What makes a job idempotent? Why does the order of deletes matter?
- `setInterval` vs a scheduler stored in Redis with several worker copies?
- Exponential backoff with jitter: what problem does jitter solve? Why not retry a timeout?
- Why did your unit test miss the job-id bug, and what do you do about fakes in general?
- Why validate configuration at startup? What happened when a secret resolved to empty?
- Why keep development and production data apart?
