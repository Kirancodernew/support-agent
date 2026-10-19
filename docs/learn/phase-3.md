# Phase 3 — RAG chat that answers from your documents

## What exists now

```
POST /chat {message, conversationId?}
  ├─ rate limit: 20 messages / minute / workspace (Redis)
  ├─ load or create the conversation (this workspace's only)
  ├─ retrieve: embed (previous question + this one) → Atlas top 5 → drop weak matches
  ├─ none left? → fixed "I don't know" reply, no model call
  └─ stream: Gemini writes from the numbered passages → SSE to the browser
        events: meta {conversationId, sources} → token… → done {firstTokenMs, totalMs}
        (or error {message} if the model fails mid-answer)
```

The dashboard's Chat panel streams the answer, shows source chips (`[1] acme-help.md`) and the
time to first word. Conversations (with sources and timings per answer) are saved for Phase 6.

## Concepts, in plain words

### RAG = Retrieval-Augmented Generation
Instead of asking a model what it remembers, we **retrieve** the relevant passages from the
customer's own documents and give them to the model to **generate** an answer from. This keeps
answers specific to the business, current (re-upload a doc and answers change), and checkable
(every claim cites a passage).

### Grounding and citations
The system prompt says: answer only from the numbered sources, cite them like `[1]`, and say
you don't know otherwise. Low temperature (0.2) keeps the model close to the text.

### "I don't know", in two layers — and what we learned calibrating it
1. **Score floor:** passages below `CHAT_MIN_SCORE` are dropped; with none left we reply with a
   fixed message and never call the model.
2. **Instructions:** the model is told to refuse when the sources don't answer.

Calibrating with real data showed layer 1 is weak: on a one-chunk help page, answerable
questions scored 0.80–0.82 and unanswerable ones 0.76–0.80 (Atlas maps cosine to 0–1 as
`(1+cos)/2`, which squeezes differences). A cut-off can't separate them, so the floor (0.75)
only catches the clearly unrelated, and **layer 2 does the real work** — verified live:
"who is your CEO?" and "capital of France?" were refused; real questions were answered with
citations. Smaller chunks would widen the score gap.

### Streaming with Server-Sent Events
The answer is sent as it's written (`text/event-stream`, one `event:`/`data:` block per piece).
SSE is one-way server→browser over plain HTTP, so it works through the Vercel/Next proxy with
no extra setup (WebSockets would be needed only for two-way traffic). `X-Accel-Buffering: no`
and `Cache-Control: no-transform` stop proxies from buffering the stream. The browser's
`EventSource` only does GET, so the client parses the `fetch` body stream itself, buffering
partial events across network chunks.

Once streaming starts the status (200) is already sent, so a failure mid-answer becomes an
`error` event, not an HTTP error. If the user leaves, the request's abort signal stops the
model call so we don't pay for words nobody reads.

### Conversation memory and follow-ups
The last 6 messages go into the prompt. Retrieval searches with the **previous question plus
the new one**, so "And express?" after a shipping question still finds the shipping passage —
verified in the browser.

### Prompt injection
Documents are written by third parties and could contain "ignore your rules". Passages go in a
marked `<sources>` block that the rules call data, never instructions, and any `</sources>` tag
inside a document is stripped so it can't close the block early. A test proves it.

### Rate limiting (fixed window)
`INCR ratelimit:chat:<workspace>:<minute>` with a 60s expiry; over 20 → 429 with `Retry-After`.
Shared across API instances because it lives in Redis. Weakness: up to 2× the limit across a
window boundary — Phase 4 moves to a sliding window.

### Measuring latency
Every answer logs and stores `firstTokenMs` and `totalMs`. Live numbers after tuning:
**~0.8s to first word from the model, ~1.4–1.6s end to end** (embedding + vector search +
proxy included).

## Problems we hit

1. **4–6s to first word.** The trace showed the app calling `gemini-3.8-flash`: a value set in
   `.env` during setup silently overrode the new default (`gemini-3.5-flash-lite`). Benchmarking
   the real prompt: 3.5-flash-lite ~0.8s vs 3.8-flash ~3.5s (and 3.8 sent everything at once,
   so streaming couldn't help). Lesson: **measure, then trace each hop** — the fix was config.
2. **A chat request hung 30s.** Passing our abort signal to `fetch` replaced the 30s timeout, so
   a stalled Gemini call hung until the proxy gave up. Now both apply (`AbortSignal.any`).
3. **React crashed the chat panel on Chrome 152.** `useEffect(() => el.scrollIntoView())`
   returned scrollIntoView's new Promise; effects may only return a cleanup function. Braces fixed it.
4. **Score threshold can't separate relevant from irrelevant** (see above) — documented, with
   the prompt as the real guard.

## Interview questions you can now answer

- What is RAG and why use it instead of fine-tuning?
- How do you reduce hallucinations? How do you make the model say "I don't know"?
- Why can't a similarity threshold alone decide relevance?
- SSE vs WebSockets vs polling — when would you pick each?
- What happens to an in-progress LLM call when the user closes the tab?
- How do you handle follow-up questions in retrieval?
- What is prompt injection, and how do you defend a RAG system against it?
- Fixed-window vs sliding-window rate limiting?
- How did you find and fix a latency problem?
