# Phase 1 — Accounts, workspaces and API keys

## What exists now

| Route | What it does |
|---|---|
| `POST /auth/signup` | email + password + company name → creates a workspace and its first user, logs them in |
| `POST /auth/login` | email + password → sets the session cookie |
| `POST /auth/logout` | clears the session cookie |
| `GET /auth/me` | who am I + my workspace (401 if not logged in) |
| `GET /api-keys` | my workspace's active keys (never the secret) |
| `POST /api-keys` | creates a key, returns the full secret **once** |
| `DELETE /api-keys/:id` | revokes a key in my workspace |

Web pages: `/signup`, `/login`, `/dashboard`. The browser calls `/api/*` on the web
domain; Next.js forwards it to the API (see "BFF proxy" below).

Code map (`apps/api/src`): `routes/` (HTTP), `auth/` (passwords, sessions, guard),
`models/` (Mongoose schemas), `lib/` (errors, validation, key generation).

## Concepts, in plain words

### Hashing passwords (bcrypt) vs hashing API keys (SHA-256)
- **Passwords** are short and guessable, so we use **bcrypt** with cost 12 (~250 ms per
  hash). Slow on purpose: fine for one login, but makes guessing billions of passwords from
  a leaked database impractical. Each hash has its own random **salt**, so two users with
  the same password get different hashes.
- **API keys** are 192 random bits, so nobody can guess them. A fast **SHA-256** is enough,
  and it lets us look a key up by its hash in one indexed query (Phase 4).
- Either way, the database never holds anything you could log in with.
- **bcrypt only reads the first 72 bytes** of a password, so signup rejects longer ones
  instead of silently ignoring the end.

### Sessions: JWT in an httpOnly cookie
After login the API signs a **JWT** (`sub` = user id, `wid` = workspace id, 7-day expiry)
with `JWT_SECRET` and puts it in a cookie:

| Cookie flag | Protects against |
|---|---|
| `HttpOnly` | page JavaScript can't read it, so an XSS bug can't steal the session |
| `Secure` (production) | only sent over HTTPS |
| `SameSite=Lax` | not sent on cross-site POSTs, which blocks CSRF |

Verification pins the algorithm (`HS256`), so a forged token can't switch to `none`.
**Trade-off:** a JWT can't be revoked before it expires; logout only deletes the cookie.
Real revocation needs a server-side session store or a token blocklist (e.g. in Redis).

### Multi-tenancy: every query carries `workspaceId`
The workspace id comes from the **signed token**, never from the request body or URL, and
every key query filters by it. A test proves Bob can't see or revoke Alice's key, and
"not yours" returns the same 404 as "doesn't exist", so ids can't be probed.

### Signup in a transaction
Workspace and user are created inside one MongoDB **transaction**: both or neither. Without
it, a failure after creating the workspace would leave an orphan with no owner.
Transactions need a replica set; Atlas always is one, and tests start a 1-node replica set.

### Unique email, enforced by the database
A unique index on `email` (stored lowercased) means two signups racing each other can't both
win. Checking "does this email exist?" in code first would have a race window.

### Login doesn't reveal which emails exist
"Wrong password" and "no such account" return the identical 401. When the email doesn't
exist we still run bcrypt against a dummy hash, so the response **time** is the same too.

### Validation at the edge (zod)
Every body is parsed by a zod schema before use. Bad input → 400 listing every invalid field,
which the form shows next to each input. Malformed JSON → 400, never 500.

### One error shape
Routes throw `HttpError(status, code, message)`; one error handler turns it into
`{ error, message, details? }`. Unknown errors are logged and return a generic 500, so stack
traces and database errors never reach the client.

### BFF proxy (why `/api/*` goes through Next.js)
The web app is on `vercel.app`, the API on `railway.app`. A cookie set by the API would be
**third-party** to the web page, and browsers increasingly block those. With a Next.js
rewrite, the browser only talks to its own domain and Next forwards `/api/*` to the API, so
the session cookie is first-party and no CORS setup is needed.

## How it's tested

`npm test -w @support-agent/api` → 15 tests in ~5 s against a **real MongoDB in memory**
(no mocks): signup, duplicate email, validation, malformed JSON, login, same-error-for-unknown-
email, logout, tampered cookie, key shown once and stored hashed, revoke, cross-workspace
isolation, invalid id, key limit.

We proved the tests catch real bugs by planting one: removing `workspaceId` from the revoke
query made the isolation test fail.

## Problems we hit

1. **Test MongoDB download race.** Both test files downloaded the MongoDB binary at once on
   the first run and collided. It's cached after one run.
2. **Atlas "can't connect".** Looked like an IP allow-list problem, but the free cluster had
   **auto-paused** from inactivity, and a paused cluster shows its access entries as
   *Inactive*. Fix: Resume. Also the setup-created `0.0.0.0/0` entry was temporary; replaced
   with a permanent one. Atlas rejects a non-allowed client with
   `tlsv1 alert internal error` (TCP connects, TLS is refused).

## Interview questions you can now answer

- Why bcrypt for passwords but SHA-256 for API keys?
- What do `HttpOnly`, `Secure` and `SameSite` each protect against?
- JWT vs server sessions: how do you log someone out everywhere with JWTs?
- How do you stop one tenant from reading another tenant's data? How do you test it?
- Why enforce unique email with an index instead of checking first in code?
- How can a login endpoint leak which emails are registered, and how do you prevent it?
- Why proxy API calls through the frontend's domain?
- Why does signup need a transaction?
