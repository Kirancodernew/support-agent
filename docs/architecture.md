# Architecture

```
 Customer's website                     Business admin
 ┌───────────────┐                      ┌────────────────┐
 │ chat widget   │                      │ Next.js        │
 │ (iframe)      │                      │ dashboard      │
 └──────┬────────┘                      └───────┬────────┘
        │ HTTPS + SSE                           │ HTTPS (JWT cookie)
        ▼                                       ▼
 ┌──────────────────────────────────────────────────────┐
 │ Express API                                          │
 │  auth · workspaces · upload · chat · agent tools     │
 └──┬──────────────┬───────────────┬─────────────┬──────┘
    │              │               │             │
    ▼              ▼               ▼             ▼
 MongoDB Atlas   Redis           AWS S3        Gemini API
 (data + vector  (BullMQ queue,  (uploaded     (chat + tool
  search)         rate limits)    files)        calling)
    ▲              │
    │              ▼
 ┌──┴───────────────────┐
 │ Worker (BullMQ)      │──► Gemini embeddings
 │ extract → chunk →    │
 │ embed → save         │
 └──────────────────────┘
```

## Why each piece

| Piece | Why |
|---|---|
| MongoDB Atlas | Keeps the stack MERN; Atlas Vector Search stores embeddings next to the data, so no separate vector DB. |
| Redis + BullMQ | Embedding a PDF takes seconds to minutes; a queue keeps the upload request fast and retries failures. |
| Separate worker | Heavy jobs don't slow down the API; each can scale on its own. |
| S3 | Files don't belong in the database; S3 is cheap and durable. |
| Gemini API | Free tier covers chat, tool calling and embeddings with one key. |
| `llm` provider layer | App code calls `llm.chat()` / `llm.embed()`, never a vendor SDK directly. Swapping to Claude (or OpenAI) is a new provider file and `LLM_PROVIDER`. Note: changing the embedding model means re-embedding all chunks, since vectors from different models aren't comparable. |
| SSE for chat | One-way server → client streaming is all chat needs; simpler than WebSockets. |

## Data model

| Collection | Key fields |
|---|---|
| `users` | email (unique), passwordHash, workspaceId |
| `workspaces` | name, publishableKey, allowedOrigins, orderWebhookUrl, webhookSecret, notifyEmail, isDemo, deletingAt |
| `apikeys` | workspaceId, keyHash (SHA-256), prefix, revokedAt |
| `documents` | workspaceId, filename, s3Key, status (`uploading` / `queued` / `processing` / `ready` / `failed`) |
| `chunks` | workspaceId, documentId, position, text, embedding (768-d, Atlas Vector Search index) |
| `conversations` | workspaceId, channel, visitorId, needsHuman, pendingAction, messages[] (sources, actions, latency, question, questionKey, unanswered, feedback) |
| `inboxitems` | workspaceId, conversationId, number, kind (ticket / callback / handoff), status, idempotencyKey (unique) |
| `counters` | per-workspace sequences (Inbox numbers), incremented atomically |

Every query filters by `workspaceId`, so one business never sees another's data.

## Background jobs (worker)

| Job | When | What |
|---|---|---|
| `ingest` | after each upload | download from S3 → extract → chunk → embed → save → wait until searchable; 3 tries with backoff |
| `cleanup-stale-uploads` | every 15 min | removes uploads abandoned before finishing |
| `delete-workspace` | when an owner deletes | removes S3 files, then chunks, documents, chats, Inbox, keys, users, and the workspace last |
| `purge-deleted-workspaces` | every 15 min | safety net: finishes deletions whose job never ran or ran out of retries |
| `reset-demo` | 3am IST and on deploy | creates the demo workspace if missing; restores its sample chats, Inbox and settings |

Schedules live in Redis (BullMQ job schedulers), so with several worker copies each job still runs once.
