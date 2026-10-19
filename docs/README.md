# Support Agent — Knowledge Base

An embeddable AI support agent SaaS. A business signs up, uploads its docs, and drops a
chat widget on its site. The agent answers from those docs (RAG) and takes actions
(create ticket, check order, book a slot) through tool calling.

## Docs

| File | What |
|---|---|
| [plan.md](plan.md) | Phase-by-phase build plan. Each phase ends deployed. |
| [architecture.md](architecture.md) | How the pieces fit together and why each was picked. |
| [setup/accounts.md](setup/accounts.md) | Accounts and keys needed, with a status checklist. |
| `learn/` | One note per phase: concepts, decisions, and interview questions. Written as each phase is built. |

## Stack

Next.js · Node.js / Express · MongoDB Atlas (+ Vector Search) · Redis + BullMQ ·
Gemini API (chat + embeddings, swappable `llm` layer) · AWS S3 · Docker · Vercel + Railway

## Rules for this repo

- Secrets live only in `.env` (never committed). `.env.example` lists the names.
- Every phase ends with a working deploy and a `learn/phase-N.md` note.
- If you can't explain a piece of code in an interview, it isn't done.
