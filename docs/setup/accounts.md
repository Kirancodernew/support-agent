# Accounts and Keys

Set these up one at a time. Paste every key into `.env` yourself (copy `.env.example` to
`.env` first). Never paste a key into chat, a commit, or a screenshot.

| # | Service | Needed for | Env var(s) | Status |
|---|---|---|---|---|
| 1 | MongoDB Atlas (free M0) | Phase 1 | `MONGODB_URI` | ✅ connected, read/write verified |
| 2 | GitHub repo | Phase 0 | — | ✅ github.com/Kirancodernew/support-agent, linked as `origin` |
| 3 | Google Gemini API (free tier) | Phase 2 | `GEMINI_API_KEY` | ✅ key valid; chat + embeddings verified |
| 4 | Redis Cloud (free 30 MB) | Phase 2 | `REDIS_CLOUD_URL` | ✅ connected, read/write ok, eviction `noeviction` |
| 5 | AWS S3 bucket + IAM user | Phase 2 | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` | ✅ put/get/delete ok; list denied (least privilege verified) |
| 6 | Vercel | Phase 0 deploy | — (GitHub login) | ☐ sign up at the end of Phase 0 |
| 7 | Railway (or Render free) | Phase 0 deploy | — (GitHub login) | ☐ sign up at the end of Phase 0 |

Local Redis runs in Docker, so Redis Cloud is only needed for the deploy.

## 1. MongoDB Atlas

1. Sign up at https://www.mongodb.com/cloud/atlas/register (Google or GitHub login is fine).
2. Create a project named `support-agent`.
3. Create a cluster: **M0 Free**, provider **AWS**, region **Mumbai (ap-south-1)**, name `support-agent`.
4. **Database Access** → add a database user, e.g. `app`, with a generated password.
   Role: *Read and write to any database*. Save the password in your password manager.
5. **Network Access** → add your current IP. (For Railway later: `0.0.0.0/0`, protected
   by the strong password.)
6. **Connect → Drivers → Node.js** → copy the connection string. Replace `<db_password>`
   with the password and add the database name before `?`:
   `mongodb+srv://app:<password>@support-agent.xxxxx.mongodb.net/support_agent?retryWrites=true&w=majority`
7. Put it in `.env` as `MONGODB_URI=...`.

**Interview angle:** what M0 limits are (shared, 512 MB), why IP allow-listing matters, why
the app user isn't an admin (least privilege).

## 2. GitHub repo

1. Go to https://github.com/new while logged in.
2. Name: `support-agent`. Visibility: **Public** (recruiters need to see it).
3. Do **not** add a README, .gitignore or license; the local repo already has them.
4. Create it and share only the repo URL (it has no secret in it).

Pushing happens after Phase 0 code exists.

**Interview angle:** why `.env` is git-ignored, what to do if a secret is ever committed
(rotate it first; deleting the commit is not enough because history and forks keep it).

## 3. Google Gemini API

1. Go to https://aistudio.google.com and sign in with your Google account.
2. Click **Get API key** → **Create API key**. Pick (or let it create) a Google Cloud
   project named `support-agent`. No card needed for the free tier.
3. Paste it into `.env` as `GEMINI_API_KEY=...`. Not into chat.

One key covers chat, tool calling and embeddings.

**Free-tier notes:** requests per minute and per day are capped (fine for a demo), and on
the free tier Google may use prompts to improve its products, so only demo data goes in.

**Verified setup (Oct 2026):**

| Setting | Value | Why |
|---|---|---|
| Chat model | `gemini-3.8-flash` | Older models (`gemini-2.5-flash` etc.) return 404 "no longer available to new users". |
| Thinking level | `low` | Default thinking took ~40s for a one-word reply; `low` took ~9s. `minimal` isn't supported on this model. Phase 3 measures real latency. |
| Embedding model | `gemini-embedding-001`, `outputDimensionality: 768` | 768 dims keeps vectors small for Atlas M0; must match the vector index dims. |
| Errors | Instant empty-body 404s after ~10 rapid calls | Free-tier throttling. The `llm` layer retries with backoff and surfaces a clear error. |

If chat latency stays too high in Phase 3, a fallback is Groq's free tier for chat only
(embeddings stay on Gemini) — just another provider in the `llm` layer.

**Interview angle:** keys stay server-side only (never in the browser bundle); the app
talks to the model through a small `llm` interface (`chat`, `embed`), so switching to
Claude in production is one new provider file plus `LLM_PROVIDER=claude`.

## 4. Redis Cloud

Local development uses Redis in Docker (`REDIS_URL=redis://localhost:6379`). Redis Cloud is
the hosted Redis the deployed API and worker use.

1. Sign up at https://redis.io/try-free (Google or GitHub login is fine).
2. Create a database: **Free (30 MB)**, cloud **AWS**, region **ap-south-1 (Mumbai)** if
   offered, name `support-agent`.
3. In the database's **Configuration**, set **Data eviction policy** to **noeviction**.
   BullMQ requires it; with eviction on, Redis can silently delete queued jobs.
4. **Connect** → copy the public endpoint (`host:port`) and the `default` user password.
5. Put it in `.env` as `REDIS_CLOUD_URL=redis://default:<password>@<host>:<port>`.
   Not into chat.

**Interview angle:** what Redis is used for here (job queue, rate-limit counters), why
`noeviction` matters for a queue, and why the same app uses a different Redis per
environment via one env var.

## 5. AWS S3

New AWS accounts need a card and start on the Free plan (credits that last a few months);
S3 for a demo costs paise even after that. If you'd rather avoid a card, Cloudflare R2 is
S3-compatible with a free 10 GB tier and works with the same AWS SDK code.

1. Sign up at https://aws.amazon.com (choose the **Free** plan). Do the card step yourself.
2. Turn on **MFA** for the root user (account menu → Security credentials).
3. Billing: on the **Free plan** AWS can't charge you. Usage comes out of the free credits
   ($100, valid until Apr 19, 2027), and when they run out or expire the account pauses
   unless you click **Upgrade**. So no budget alert is needed. Don't upgrade for this project.
4. **S3 → Create bucket**: General purpose, *Account Regional namespace*, prefix
   `support-agent`. Region used: **ap-southeast-2 (Sydney)** (the console default; fine,
   since S3 is only touched on upload/ingest, not per chat message), keep **Block all public access** ON, default encryption ON.
5. **IAM → Users → Create user** `support-agent-app`, *no* console access. Attach an
   inline policy that only allows this bucket (replace `BUCKET`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
       "Resource": "arn:aws:s3:::BUCKET/*"
     }]
   }
   ```
6. Open the user → **Security credentials → Create access key** → use case
   *Application running outside AWS* → copy both values (the secret is shown once).
7. In `.env`: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` (bucket name).
   `AWS_REGION=ap-south-1` is already set. Not into chat.

**Gotcha hit during setup:** the first test got `AccessDenied ... no identity-based policy
allows s3:PutObject`. The key was fine (AWS named the user — authentication passed); the
inline policy's `Resource` named the wrong bucket (authorization failed).

**Interview angle:** never use root keys in an app; least privilege (one user, one bucket,
three actions); why the bucket stays private and the browser gets short-lived pre-signed
URLs instead; what a zero-spend budget protects against.

Remaining services get their steps here as we reach them.
