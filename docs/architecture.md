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

## Data model (first draft)

| Collection | Key fields |
|---|---|
| `users` | email, passwordHash, workspaceId |
| `workspaces` | name, allowedDomains, plan |
| `apiKeys` | workspaceId, keyHash, prefix, revokedAt |
| `documents` | workspaceId, s3Key, status (`queued` / `processing` / `ready` / `failed`) |
| `chunks` | workspaceId, documentId, text, embedding (vector) |
| `conversations` | workspaceId, messages[], feedback |
| `tickets` | workspaceId, conversationId, summary, status |

Every query filters by `workspaceId`, so one business never sees another's data.
