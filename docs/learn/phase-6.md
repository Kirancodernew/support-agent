# Phase 6 — Insights: how the agent is doing

## What exists now

**Insights** page (`/insights`, linked from the dashboard), for the last 7 / 30 / 90 days:

| Card / section | Meaning |
|---|---|
| Conversations | chats with a message in the period, and % change vs the previous period |
| Answered from your docs | % of answers that used at least one document passage |
| Couldn't be answered | % of answers marked unanswered (see definition below) |
| Satisfaction | 👍 / (👍 + 👎) from customers' ratings |
| First word p95 / p50 | latency percentiles of the first word of each answer |
| Questions per day | bar chart, website widget vs dashboard, days in Indian time |
| Questions the agent couldn't answer | grouped by normalised question, most asked first — "add these to your docs" |
| Most-cited documents, Actions taken | which docs carry the agent; tickets, call-backs, handoffs, order lookups |
| Conversations | filter All / Needs a human / 👎 Disliked, 20 at a time, open any transcript |

👍/👎 buttons under every answer, in the dashboard chat and the website widget.

| Route | What |
|---|---|
| `GET /insights/summary?days=` | every card in one `$facet` aggregation (+ one for the previous period) |
| `GET /insights/unanswered?days=` | unanswered answers grouped by `questionKey` |
| `GET /conversations?filter=&cursor=` / `GET /conversations/:id` | browser + transcript |
| `POST /conversations/:id/feedback`, `POST /public/feedback` | ratings (owner / visitor) |

## Concepts, in plain words

### Aggregation pipelines
The numbers are computed **inside MongoDB** in stages: `$match` (workspace + period, using the
`{workspaceId, updatedAt}` index) → `$unwind` the messages → `$facet` into several groupings at
once (totals, answers, per-day, top documents, actions). Only a small JSON result comes back,
not every conversation.

### Defining the metric before computing it
"Unanswered" first meant "no passage used and no tool succeeded". Real data from Phase 3 showed
why that's wrong: an off-topic or uncovered question often still retrieves a *related* passage
("ship to Dubai?" pulls the shipping section), so it would never be counted. Fix: the agent has
an internal tool, **`flag_unanswered`**, which it calls when the passages don't answer a
question *about the business* (not for off-topic chat). An answer is unanswered if it was
flagged, or if there was nothing to go on at all. The flag is invisible to the customer and
isn't counted as an "action".

### Recording analytics at write time
When an answer is saved it also stores the `question`, a normalised `questionKey` and the
`unanswered` flag. Reads become simple group-bys with no joins or text processing. The cost is a
few extra bytes per message — the classic analytics trade-off (denormalise for cheap reads).

### Normalising questions — and a Unicode bug
`normalizeQuestion` lowercases and strips punctuation so "Do you ship to Dubai?" and "do you
ship to dubai" group together. The first version kept only letters and digits (`\p{L}\p{N}`),
which **broke Hindi**: vowel signs like ् ा ु are combining marks (`\p{M}`), so "क्या" became
"क य". A test caught it; marks are now kept. Grouping by *meaning* (embeddings) is the next step.

### Percentiles, not averages
`$percentile` (p50, p95). An average hides the slow answers; p95 says "95% of answers started
within X" — the number real teams watch.

### Time zones
Per-day counts use `$dateToString` with `timezone: 'Asia/Kolkata'`; a test puts a chat at
10:30pm IST and another just after IST midnight and checks they land on different days. Empty
days are filled with zeros in code so the chart has no gaps.

### Cursor pagination
The conversation list pages by "older than (updatedAt, _id) of the last row", not `skip`. A test
adds a new chat between page loads and checks the second page has no repeats or gaps.

### Compute on demand vs pre-compute
At this size, aggregating on each page load (with indexes) is fast and always fresh. At millions
of messages you'd pre-compute daily rollups in the worker (it already has a scheduler) and read
those instead.

### Feedback security
`$elemMatch` on `{_id, role: 'assistant'}` so only an answer (not a customer message) can be
rated; owners are scoped by workspace, widget visitors by workspace **and** visitor id.

## Problems we hit

1. **Hindi normalisation** (above).
2. **Gemini free-tier throttling.** After three evaluation runs the whole free-tier project was
   throttled: instant empty 404s on every model, then ~18–23s replies. Model fallback can't help
   when the limit is per project. Live checks were deferred until the daily quota reset.
   Production answer: a paid tier, or a second provider behind the same `llm` interface.
3. **The "unanswered" definition** (above) — found by reasoning about real retrieval scores
   before trusting the dashboard.
4. **"Don't flag off-topic questions" made the agent answer them.** Live, "What is the capital of
   France?" got "Paris": telling the model not to *flag* trivia read as permission to *answer* it.
   The prompt now says off-topic questions get "I can only help with questions about <business>",
   neither answered nor flagged. Re-checked live.
5. **"Answered from your docs" counted retrieval, not use.** The live dashboard showed 100% from
   docs next to 33% unanswered: every answer had *retrieved* a passage, including the flagged ones
   and the off-topic refusal. Now an answer counts only if it **cites** a passage (`[1]`) and wasn't
   flagged; "most-cited documents" uses the same rule. Same lesson as #3: retrieved ≠ used.
6. **Rating an answer moved the chat to the top of the list.** Mongoose bumps `updatedAt` on every
   update, so a 👍 looked like new activity (and could move a chat into another period). Feedback
   now updates with `timestamps: false`; a test checks `updatedAt` is unchanged.

## Verified

Locally against real Gemini (throttled free tier that day: 20–55s per call, so 4 of 10 chats
hit the 30s timeout and showed the "assistant is unavailable" message — itself a check of the
failure path):

| Check | Result |
|---|---|
| "Do you have a student discount?", "Can you gift wrap my order?" | flagged unanswered, invisibly, even though a passage was retrieved |
| "What is the capital of France?" (after the fix) | "I can only help with questions about Acme Insights Test." — not answered, not flagged |
| 👍 / 👎 on answers | saved (204); rating a customer message 404, bad value 400, no login 401 |
| Insights page vs raw data | 10 chats, 6 answers, 33% from docs (2 cited), 33% unanswered, 50% satisfaction, both gaps listed, Disliked filter shows the 👎 chat |

23-case agent evaluation (20 from Phase 5 + 3 docs gaps that must call `flag_unanswered`):
not run yet — Gemini's free tier was throttled that day. Run `npm run eval -w @support-agent/api` and record the result here.

## Interview questions you can now answer

- How do you compute dashboard metrics efficiently in MongoDB? What does `$facet` do?
- How did you define "unanswered", and why was the first definition wrong?
- Why record analytics fields at write time?
- Why p95 instead of the average?
- How do you handle time zones in daily reports?
- Cursor vs offset pagination — what breaks with offset?
- When would you switch from on-demand aggregation to pre-computed rollups?
