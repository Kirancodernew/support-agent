# Phase 4 — The website widget

## What exists now

A business pastes one line into its site:

```html
<script src="https://support-agent-cyan-chi.vercel.app/widget.js" data-key="pk_live_…" async></script>
```

```
customer site ──widget.js──► chat bubble ──click──► <iframe src="our-site/widget?key=pk_live_…">
                                                       │  proxy.ts sets CSP frame-ancestors (allowed sites only)
                                                       └─ POST /api/public/chat {key, visitorId, pageOrigin, message}
                                                             → limits → same RAG answer as the dashboard (streamAnswer)
```

| Route | Who | What |
|---|---|---|
| `GET/PUT /widget-settings`, `POST /widget-settings/rotate-key` | owner (logged in) | publishable key, allowed websites, new key |
| `GET /public/widget-config?key=` | widget page's server | business name + allowed sites (for the CSP header) |
| `POST /public/chat` | visitors (no login) | streamed answer for that workspace |

Dashboard: a **Website widget** section with the snippet, allowed sites, "New key", and a live preview.

## Concepts, in plain words

### Publishable key vs secret key
`sk_live_…` keys are secrets for servers (stored hashed). The widget runs in visitors' browsers,
where anyone can read the page source, so it gets a separate **publishable** key `pk_live_…`. It
can only start widget chats for its own workspace — nothing else. Same model as Stripe. If it's
abused, "New key" rotates it and the old snippet stops working at once.

### iframe isolation
The loader script only draws a button. The chat runs in an iframe from **our** origin, so the
host page's CSS can't break it and the host page's scripts (or anything injected into them)
can't read the visitor's conversation (same-origin policy). The iframe is created on first click,
so the widget costs the host page nothing until it's used. The close button talks to the loader
with `postMessage`, and the loader only accepts messages from our origin.

### CSP `frame-ancestors` — the browser enforces the allowed-sites list
`proxy.ts` (Next.js 16's request middleware) looks up the key and sends
`Content-Security-Policy: frame-ancestors 'self' https://acme.com` with the widget page. A
copycat site that pastes Acme's snippet gets an empty box and the browser logs "violates the
following Content Security Policy directive… blocked" — verified on a test page served from a
port that wasn't on the list. JavaScript on the copycat site can't override it. Unknown key or
API unreachable → `'none'` (fail closed). `'self'` lets the dashboard preview work.

### Defence in depth, and the honest limit
The widget also sends the page's origin (`location.ancestorOrigins` / `document.referrer`) and
the API refuses sites not on the list (403). That's a speed bump, not a lock: outside a browser
anyone can send any header. Because the key is public, the real protection against abuse is
**rate limiting**: 10 messages/min per visitor, 60/min per workspace, 500/day per workspace.

### Sliding-window rate limiting (Redis sorted set + Lua)
Per key, a sorted set of timestamps: drop entries older than the window, count, refuse if full
(and report when the oldest entry leaves), otherwise add this hit. It runs as **one Lua script**,
so concurrent requests can't both take the last slot, and refused hits aren't recorded. Unlike
Phase 3's fixed window there's no double burst at a minute boundary. Tested against real Redis.

### Anonymous visitors
Visitors don't log in. The widget keeps a random `visitorId` in localStorage (inside our iframe),
so follow-ups continue their conversation, and conversations are looked up by
`{_id, workspaceId, visitorId}` — one visitor can't open another's chat. The id isn't
authentication (a client picks it), so it only groups chats.

### One answer path for two channels
The dashboard chat and the widget call the same `streamAnswer()` (retrieve → stream → save).
Extracted first as a pure refactor, proven by the unchanged Phase 3 tests passing.

## How it's tested

- `widget.test.ts`: key created once and kept; origins normalized (`https://acme.com/help?x` →
  `https://acme.com`), unsafe ones rejected (`javascript:`, plain `http://` except localhost);
  rotated key stops working; unknown/secret keys refused; disallowed site 403 but dashboard
  preview allowed; visitor isolation; a key only reaches its own workspace (a planted
  cross-tenant leak made this fail); per-visitor limit while other visitors still get through.
- `rate-limit.test.ts`: the Lua sliding window against real Redis (limit, retry time, a slot
  frees exactly when the oldest hit leaves, refused hits not stored). Skips if Redis is absent.
- Manual: a plain "Acme Shop" HTML page on `:5500` (allowed) answered from the docs with a source;
  the same page on `:5501` (not allowed) was blocked by the browser's CSP.

## Interview questions you can now answer

- How do you let a third-party site embed your product safely?
- Publishable vs secret API keys — what can each do, and why?
- What does `frame-ancestors` do, and why is it stronger than checking `document.referrer`?
- How do iframes isolate an embedded widget from the host page?
- How does `postMessage` work, and how do you validate messages?
- Fixed vs sliding window rate limiting; why use a Lua script in Redis?
- A public key can be copied — what actually stops abuse?
