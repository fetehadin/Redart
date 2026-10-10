# CLAUDE.md — Redart

Redart is a reading ledger for engineers. You plan articles to read, tick them off and keep notes. Paste a link and Redart checks it, fills in the title and estimates the read time.

**Where it's going:** accounts stay **optional**. Guests use the full ledger with data kept in the browser. Readers who sign in also get the social layer: following, shared progress, favourites, recommendations and monthly reading challenges with pace tracks.

Read this file before every task. If a request conflicts with it, say so before writing code. Update it when an architectural decision changes.

---

## 1. Product rules (don't break these)

1. **Guest mode is first-class.** Without an account you can plan, check links, estimate read times, keep notes, favourite articles, back up and restore, and use the app offline. Signing in is never required to read.
2. **Signing in never loses data.** On first sign-in, offer to import the local ledger into the account. Merge by `articleKey` and never overwrite. Keep the local copy until the server confirms the import.
3. **Notes are private, always.** Notes never appear on profiles, feeds or in API responses to anyone but the owner. No setting changes this.
4. **Privacy is explicit.** Each account is `PUBLIC` (anyone can follow and see shared activity) or `PRIVATE` (the user approves follow requests). Users can hide individual plans from followers. Blocking a user removes the follow both ways and hides each user from the other everywhere.
5. **Social features are for logged-in users only:** follow, see a followed user's progress (what they've read, current plans and pace), see their favourites, send and receive recommendations, join challenges.
6. **Honest numbers.** No invented read times. When a page can't be measured (built with JavaScript, behind a login, blocked), say "link works, enter the read time yourself".
7. **No dark patterns.** No streak-shaming, no notification spam, no public "X is behind" labels. Pace is shown only to its owner, unless they opt in to a challenge leaderboard.

## 2. Features

### 2.1 Ledger (guests and members)
Everything the current version does carries over. The behaviour is specified in `README.md` and the existing tests:
- Plans: a start date plus a number of days (1–365, default 30). New plans can start empty, carry over unread articles, use your favourites, or load the starter list.
- Articles: url, title, minutes, topic, due date, done, notes, order. Add by pasting a link, which runs inspect.
- Link status: `OK | BROKEN | UNREACHABLE | BLOCKED | UNCHECKED`, automatically rechecked after 7 days.
- Favourites live outside plans; deleting a plan never loses them.
- Tools: inline edit, reorder, search, filters (All / To read / Done / Favourites), "Spread dates", undo for removing an article or deleting a plan.
- Progress: articles read, minutes read, which day of the plan you're on, and ahead/behind with a marker for where you should be today. Articles due today don't count against pace.
- Duplicate detection via `urlKey` (http vs https, `www`, trailing slash, tracking params).
- Guests can back up and restore as one JSON blob. Backups from v1 and v2 still restore.

### 2.2 Accounts
- Sign up with email, password (min 10 characters), `@handle` (`^[a-z0-9_]{3,20}$`, unique, case-insensitive) and display name. Bio (≤160) is optional. Avatars are initials on a muted colour derived from the handle; no uploads in v1.
- Sessions use a random 32-byte token in an httpOnly, `Secure`, `SameSite=Lax` cookie. Only the sha256 of the token is stored in the DB. Sessions last 30 days and slide on use. "Sign out everywhere" is available.
- Password reset by email uses SMTP. If `SMTP_*` isn't configured, the feature is hidden; don't fake it.
- Settings: profile, visibility, preferred topics, change password, delete account. Deletion is immediate and cascades every owned row.

### 2.3 Social
- **Follow:** an asymmetric follow, like Twitter. Following a `PRIVATE` account creates a `PENDING` request that the owner accepts or declines. You can remove a follower.
- **Profile `/u/[handle]`:** display name, bio, follower and following counts, articles read and minutes read (all time and this month), current visible plans with progress bars, favourites, challenges joined, and recent finished articles. A private account shows only the header to non-followers. Guests (not signed in) see only the header of any profile. Hidden plans (`plan.setShared`) and everything finished in them never count or show for others.
- **People `/people`:** search by name or @handle, and pending follow requests to accept or decline.
- **Feed `/feed`:** what the people you follow have finished, favourited, recommended, joined (challenges) and started (plans). Strictly newest first, cursor-paginated (20 per page). No ranking algorithm.
- **Recommend:** share an article (link + an optional message ≤280) either to all followers (it shows in the feed) or directly to one user who follows you (it shows in `/inbox`). One click adds a recommendation to any of your plans.
- **Notifications** (`/inbox`, unread count in the nav): new follower, follow request, follow accepted, direct recommendation. Shown in-app only; no email in v1.

### 2.4 Challenges (monthly plans by pace and preference)
- A **challenge** is a themed reading period, e.g. "October: Distributed Systems". It has a title, description, start date, number of days, topic tags, an optional curated article list, and one or more **tracks**. Default tracks:
  - `LIGHT`: about 2 articles/week
  - `STEADY`: about 1 article every 2 days
  - `DEEP`: 1 or more articles/day

  Each track stores `targetArticles` and/or `targetMinutes`.
- **Joining** creates a normal plan in the user's ledger, linked to the challenge and track and seeded from the curated list. Due dates are spread to match the track's pace with `spread()` / `nextDueDate()` from `@redart/shared`. Users can add their own articles too.
- **Switching tracks** mid-challenge re-spreads the unread articles from today. **Leaving** keeps the plan but unlinks it.
- **Preferences:** the topics a user picks in settings put matching challenges first on `/challenges` (a simple tag match, not ML). Each listing shows "This month", "Upcoming" and "Past".
- **Who creates challenges:** admins (`isAdmin`) create `featured` official monthly challenges. Any member can create a challenge, either `PUBLIC` or `INVITE` (joined via a secret invite link).
- **Challenge page `/challenges/[slug]`:** description, tracks, curated list, participant count, and an **opt-in** leaderboard ranked by articles finished, then minutes.

## 3. Tech stack

| Layer | Choice |
|---|---|
| Language | **TypeScript 6.0** everywhere (`strict`, `noUncheckedIndexedAccess`); no `any` without a comment explaining why. Stay on 6.x until typescript-eslint supports 7. |
| Frontend | **Next.js 16 (App Router) + React 19**, in `apps/web` |
| Styling | **CSS Modules + global CSS variables** ported from the current `styles.css` (no Tailwind, no UI kit) |
| API | **Express 5**, in `apps/api` |
| Database | **PostgreSQL 17** |
| ORM | **Prisma 7** (`prisma.config.ts`, `@prisma/adapter-pg`, generated client output in `apps/api/src/generated/prisma`). Check the installed version's docs before using an API. |
| Validation | **Zod** schemas in `packages/shared`, used by both the web forms and the API |
| Passwords | `argon2` (argon2id) |
| Rate limiting | `express-rate-limit` |
| Security headers | `helmet` on the API; CSP set in `next.config.ts` for the web |
| Logging | `pino` + `pino-http` (redact cookies, passwords, notes) |
| Tests | **Vitest** (unit, both apps), **Supertest** against a real Postgres test DB (API), **Playwright** for a few end-to-end flows |
| Local Postgres | **embedded-postgres** (real PostgreSQL 17 binaries run as your own user; no Docker or sudo). `pnpm db:up` for dev; tests and e2e start a throwaway one. Set `TEST_DATABASE_URL` to use an external DB instead. |
| Monorepo | **pnpm workspaces** |
| Node | **24 LTS** |
| Hosting | **Contabo VPS** with Docker Compose: `caddy`, `web`, `api`, `db`. See §8. |

Next.js renders pages and Express owns all data. Don't use Next.js route handlers or server actions for business logic or DB access, and Next.js never imports Prisma. Server components may call the API (see §6.3).

Keep dependencies few. Before adding a package, check whether a built-in or ~20 lines of code would do. Anything beyond the list above needs a reason in the commit message.

## 4. Repository layout

```
apps/
  web/                         Next.js frontend
    src/app/
      layout.tsx               nav, theme, fonts
      page.tsx                 the ledger (home)
      feed/page.tsx
      inbox/page.tsx
      u/[handle]/page.tsx      public profile (server-rendered)
      challenges/page.tsx
      challenges/[slug]/page.tsx
      challenges/new/page.tsx
      settings/page.tsx
      signin/page.tsx  signup/page.tsx  reset/page.tsx
    src/components/            Ledger, ArticleRow, PlanSummary, ProgressBar, Avatar, FollowButton, …
    src/lib/
      api.ts                   typed fetch client (browser + server variants)
      store/                   LedgerStore interface, LocalStore (guest), RemoteStore (member)
      session.ts               current user (server: read cookie → GET /api/me)
    src/styles/tokens.css, globals.css
    next.config.ts             output: "standalone", CSP headers
  api/                         Express API
    prisma/schema.prisma
    prisma/migrations/
    prisma/seed.ts             starter list + one sample featured challenge
    prisma.config.ts
    src/
      index.ts                 starts server
      app.ts                   builds the Express app (imported by tests)
      env.ts                   Zod-validated env vars; crash on missing
      db.ts                    Prisma client singleton
      middleware/              auth (session → req.user), requireUser, requireAdmin,
                               csrf (Origin check), validate(zodSchema), errors, rateLimits
      routes/                  auth, me, users, follows, plans, articles, favorites,
                               feed, recommendations, notifications, challenges, inspect
      services/                visibility.ts (canSee), activity.ts, challenges.ts, links.ts
      lib/net.ts, lib/extract.ts   SSRF-safe fetch + read-time extraction (ported from api/_lib)
    test/
packages/
  shared/                      @redart/shared — pure TS, no DOM, no Node-only APIs
    src/core.ts                dates, urlKey, articleKey, spread, nextDueDate, pace (ported from core.js)
    src/schemas.ts             Zod schemas + LIMITS
    src/types.ts               API DTO types
    test/
deploy/
  docker-compose.yml           production
  Caddyfile
  web.Dockerfile  api.Dockerfile
  backup.sh  deploy.sh
.env.example
pnpm-workspace.yaml
tsconfig.base.json
```

The old `public/`, `api/`, `scripts/` and `vercel.json` are removed once their logic and tests have been ported. Port the tests first and keep them green.

## 5. Data model (Prisma)

All ids are `String @id @default(uuid())`. Calendar dates (`start`, `due`) are `@db.Date` and handled as `"YYYY-MM-DD"` strings at the edges. Never convert them through a JS `Date` in UTC; use the helpers in `@redart/shared`. Every relation to a user has `onDelete: Cascade`.

```prisma
enum Visibility      { PUBLIC PRIVATE }
enum FollowStatus    { PENDING ACCEPTED }
enum LinkStatus      { OK BROKEN UNREACHABLE BLOCKED UNCHECKED }
enum ActivityKind    { FINISHED FAVORITED RECOMMENDED JOINED_CHALLENGE STARTED_PLAN }
enum ChallengeAccess { PUBLIC INVITE }
enum NotificationKind { NEW_FOLLOWER FOLLOW_REQUEST FOLLOW_ACCEPTED RECOMMENDATION }

model User {
  id           String     @id @default(uuid())
  email        String     @unique            // stored lowercased
  handle       String     @unique            // stored lowercased
  displayName  String
  bio          String?
  passwordHash String
  visibility   Visibility @default(PUBLIC)
  topics       String[]
  isAdmin      Boolean    @default(false)
  createdAt    DateTime   @default(now())
  // relations: sessions, plans, favorites, followers, following, blocks, activity, …
}

model Session       { id, userId, tokenHash @unique, expiresAt, createdAt, lastUsedAt }
model PasswordReset { id, userId, tokenHash @unique, expiresAt, usedAt? }
model Follow        { followerId, followeeId, status FollowStatus, createdAt   @@id([followerId, followeeId]) @@index([followeeId, status]) }
model Block         { blockerId, blockedId, createdAt                         @@id([blockerId, blockedId]) }

model Link          { urlKey @id, url, title?, minutes?, status LinkStatus, checkedAt }   // shared inspect cache

model Plan {
  id, userId, name, start @db.Date, days Int,
  visibleToFollowers Boolean @default(true),
  challengeId?, trackId?, createdAt, updatedAt
  @@index([userId])
}
model Article {
  id, planId, url?, urlKey?, title, minutes?, topic?, due @db.Date,
  doneAt DateTime?, notes String @default(""), position Int,
  linkStatus LinkStatus @default(UNCHECKED), checkedAt DateTime?
  @@index([planId, position])
}
model Favorite      { id, userId, articleKey, url?, title, minutes?, topic?, createdAt   @@unique([userId, articleKey]) }

model Recommendation { id, fromUserId, toUserId?, url, title, minutes?, message?, createdAt   @@index([toUserId, createdAt]) }
model Notification   { id, userId, kind NotificationKind, actorId, recommendationId?, readAt?, createdAt   @@index([userId, readAt]) }

model Challenge {
  id, slug @unique, title, description, start @db.Date, days Int, topics String[],
  createdById, access ChallengeAccess @default(PUBLIC), inviteCode String? @unique,
  featured Boolean @default(false), createdAt
}
model ChallengeTrack       { id, challengeId, key String, name, targetArticles Int?, targetMinutes Int?   @@unique([challengeId, key]) }
model ChallengeArticle     { id, challengeId, position Int, url, title, minutes? }
model ChallengeParticipant { challengeId, userId, trackId, planId @unique, showOnLeaderboard Boolean @default(false), joinedAt   @@id([challengeId, userId]) }

model Activity {
  id, userId, kind ActivityKind,
  payload Json,            // url, title, minutes, challenge slug… NEVER notes
  planId String?,          // so hiding a plan hides its activity
  createdAt DateTime @default(now())
  @@index([userId, createdAt(sort: Desc)])
}
```

This is the authoritative shape. Write the real `schema.prisma` from it with proper relation fields. Schema changes go through `prisma migrate dev --name <change>`; never edit an applied migration.

## 6. API

### 6.1 Conventions
- All routes live under `/api`. Requests and responses are JSON, and request bodies are validated with the Zod schemas from `@redart/shared`.
- Errors look like `{ error: { code: "NOT_FOUND" | "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL", message, fields? } }`. Never return stack traces or Prisma messages.
- Pagination: `?cursor=<id>&limit=20` returns `{ items, nextCursor }`.
- Dates are `"YYYY-MM-DD"` and timestamps are ISO strings.
- Responses go through DTO mappers. Never `res.json(prismaRow)`; mappers are where `notes` and `passwordHash` get stripped.

### 6.2 Endpoints

| Area | Endpoints |
|---|---|
| auth | `POST /auth/signup`, `POST /auth/signin`, `POST /auth/signout`, `POST /auth/signout-all`, `POST /auth/reset/request`, `POST /auth/reset/confirm` |
| me | `GET /me`, `PATCH /me`, `PATCH /me/password`, `DELETE /me`, `POST /me/import` (guest ledger → account, idempotent merge) |
| ledger | `GET /ledger?today=` (the member's whole LedgerState; creates the starter plan on first load), `POST /ledger/ops?today=` `{ ops: LedgerOp[] }` (1–200 ops, applied in order in one transaction; replaying an op is harmless). Plans, articles and favourites are only changed through ops. |
| users | `GET /users/:handle` (header for everyone; stats only when `canSeeReading`), `GET /users/:handle/plans`, `GET /users/:handle/finished`, `GET /users/:handle/favorites`, `GET /users/:handle/followers`, `GET /users/:handle/following`, `GET /users/search?q=` (members) |
| follows | `POST /users/:handle/follow`, `DELETE /users/:handle/follow`, `GET /follow-requests`, `POST /follow-requests/:handle/accept`, `POST /follow-requests/:handle/decline`, `DELETE /followers/:handle` |
| blocks | `POST /users/:handle/block`, `DELETE /users/:handle/block`, `GET /blocks` |
| feed | `GET /feed` |
| recommendations | `POST /recommendations`, `GET /inbox/recommendations` |
| notifications | `GET /notifications`, `POST /notifications/read` |
| challenges | `GET /challenges?when=current\|upcoming\|past`, `POST /challenges`, `GET /challenges/:slug`, `PATCH /challenges/:slug`, `POST /challenges/:slug/join` `{ trackId, inviteCode? }`, `POST /challenges/:slug/track`, `DELETE /challenges/:slug/join`, `GET /challenges/:slug/leaderboard`, `PATCH /challenges/:slug/me` `{ showOnLeaderboard }` |
| inspect | `GET /inspect?url=` (open to guests; reads and writes the `Link` cache, 12 h for OK results) |
| health | `GET /health` (DB ping, used by Docker healthcheck) |

### 6.3 How the web app talks to the API
- In production, Caddy serves both on **one domain**: `/api/*` goes to `api:4000` and everything else to `web:3000`. Same origin, so there's no CORS, and cookies just work.
- Browser components call `fetch("/api/...", { credentials: "include" })` through `lib/api.ts`.
- Server components (profiles, challenge pages) call `INTERNAL_API_URL` (`http://api:4000`) and forward the incoming `cookie` header. Use `cache: "no-store"` for anything user-specific.
- In dev and e2e runs, `src/proxy.ts` forwards `/api/*` to `API_ORIGIN` (read at request time; `next.config` rewrites are fixed at build time, so don't use them for this).

### 6.4 Ledger store
`LedgerStore` is one interface with two implementations:
- `LocalStore`: localStorage, the current behaviour including corrupt-save quarantine and migration from `redart:v1`/`redart:v2` keys.
- `RemoteStore`: the API, with optimistic updates (roll back and toast on failure) and a read cache in localStorage. When offline, the ledger is read-only with a clear banner.

The UI only talks to the interface. Don't build separate guest and member UIs.

Every ledger change is a typed `LedgerOp` (`packages/shared/src/ledger.ts`) applied by the pure `applyOp` reducer. The UI dispatches ops through `LedgerProvider`. `LocalStore` saves the resulting state, and `RemoteStore` maps each op to its API call. New ledger features add an op and a reducer case with tests first.

## 7. Security checklist (every PR)

- **CSRF:** mutating requests must have an `Origin` that matches `APP_ORIGIN`, otherwise 403, on top of `SameSite=Lax` cookies.
- **Authorisation:** every query for another user's data goes through `services/visibility.ts` (`canSee(viewerId, ownerId)`, which handles blocks, private accounts and hidden plans). Every route has a test proving another user gets 403/404.
- **Validation:** every input is validated with Zod; limits come from `LIMITS` (`title 200`, `topic 40`, `notes 5000`, `planName 60`, minutes 1–600, days 1–365).
- **Rate limits:** signin 10/min/IP, signup 5/h/IP, reset 5/h/IP, inspect 40/min/IP, recommendations 30/h/user, follows 60/h/user. `RATE_LIMIT_SCALE` multiplies all of them; only the e2e run sets it.
- **Inspect SSRF rules stay exactly as strict:** http/https on ports 80/443 only, no credentials in URLs, resolve DNS and refuse private/loopback/link-local/CGNAT/metadata addresses, revalidate each redirect (max 5), 9 s timeout, 3 MB cap. Port the existing tests.
- Use the same email-enumeration-safe response for "user not found" and "wrong password", and for reset requests.
- Keep the strict CSP: no inline scripts except Next's nonce, `frame-ancestors 'none'`, `nosniff`, a strict referrer policy and a locked-down permissions policy.
- Logs redact `cookie`, `authorization`, `password`, `notes`, `token`.
- Secrets live only in `.env` files, which are git-ignored. `.env.example` lists every variable.

## 8. Hosting on Contabo

**Server:** Contabo VPS running Ubuntu 24.04 LTS. `DEPLOY_HOST`, `DEPLOY_USER` and `DOMAIN` live in the local `.env.deploy`, never in the repo.

**One-time server setup** (document it in `deploy/README.md` and do it with the user):
1. Create a non-root `deploy` user with sudo, set up SSH key login, and disable root and password SSH login.
2. `ufw allow OpenSSH, 80, 443`, then `ufw enable`. Install `fail2ban` and unattended-upgrades.
3. Install Docker Engine + Compose plugin and add `deploy` to the `docker` group.
4. Point the domain's A (and AAAA) record at the VPS IP.
5. Run `git clone` into `/srv/redart` and create `/srv/redart/.env` from `.env.example`.

**Production compose (`deploy/docker-compose.yml`):**
- `caddy`: ports 80/443, automatic Let's Encrypt for `$DOMAIN`, `/api/*` to `api:4000` and everything else to `web:3000`, zstd/gzip, volumes for certificates
- `web`: Next.js `standalone` build (the Dockerfile sets `NEXT_OUTPUT=standalone`; copy `.next/static` and `public` next to `server.js`), non-root, `INTERNAL_API_URL=http://api:4000`
- `api`: runs `prisma migrate deploy` on start, then `node dist/index.js`; non-root; healthcheck on `/api/health`
- `db`: `postgres:17-alpine`, named volume, **no published ports**, healthcheck
- Every service has `restart: unless-stopped` and log rotation (`max-size: 10m`, `max-file: 3`).

**Deploy (`deploy/deploy.sh`):** `ssh` in, `git pull`, `docker compose up -d --build`, `docker image prune -f`, then curl `/api/health`. GitHub Actions CI comes later: build images, push to GHCR, pull on the server.

**Backups (`deploy/backup.sh`):** a nightly cron runs `pg_dump -Fc` to `/srv/backups`, keeps 14 days, and is meant to be copied offsite. Test a restore once.

**Rules for Claude on the server:** confirm with the user before **any** SSH command or deploy. Never run destructive commands (`docker volume rm`, `docker system prune -a`, `DROP`, `prisma migrate reset`, deleting backups) on the server without explicit approval of that specific command.

### Environment variables
```
# api
DATABASE_URL=postgresql://redart:***@db:5432/redart
APP_ORIGIN=https://<domain>
SESSION_COOKIE_NAME=redart_session
SMTP_HOST= SMTP_PORT= SMTP_USER= SMTP_PASS= SMTP_FROM=      # optional
ADMIN_EMAILS=                                              # comma list, made admin on signup
# web
INTERNAL_API_URL=http://api:4000
NEXT_PUBLIC_APP_NAME=Redart
# db
POSTGRES_USER=redart POSTGRES_PASSWORD=*** POSTGRES_DB=redart
```

## 9. UI: make it feel natural

- Keep today's calm, classic look: port the colour tokens, type scale and spacing from the current `styles.css`, with a paper-like light theme and a soft dark theme (`prefers-color-scheme` + manual toggle).
- Write like a person: "You finished 3 articles this week" rather than "Activity metrics updated". Use sentence case. No emoji in UI chrome. Use relative times ("2 days ago").
- No gradients, glassmorphism, floating blobs, oversized hero sections or shimmer skeletons everywhere. Use a quiet "Loading…" where needed.
- The ledger stays the home screen, and social features stay secondary to it. Nav: Ledger · Feed · Challenges · (avatar menu: Profile, Inbox, Settings, Sign out). Guests see Ledger · Challenges (read-only) · Sign in.
- Empty states say what to do next ("Follow a few readers to see what they're reading here").
- Accessibility: works at 360px with a 16px gutter, every control keyboard-reachable, visible focus rings, `prefers-reduced-motion` respected, real `<label>`s, colour contrast AA.
- Prefer server components for read-only pages (profile, challenge) and client components only where there's interaction (ledger, forms, buttons).

## 10. Working rules for Claude

**Build phases.** Make one reviewable commit per phase. `pnpm typecheck && pnpm lint && pnpm test` must pass before each commit.
1. **Scaffold:** pnpm monorepo, `packages/shared` (port `core.js` + tests to TS), `apps/api` (Express, port inspect + tests), `apps/web` (Next.js ledger in guest mode with `LocalStore`, at parity with today). Remove the old files.
2. **Database + accounts:** Prisma schema and first migration, signup/signin/sessions, `/me`, `RemoteStore`, guest→account import, settings.
3. **Social graph:** follows, requests, blocks, profiles, visibility rules, user search.
4. **Activity:** feed, favourites on profiles, recommendations, notifications/inbox.
5. **Challenges:** create, list, join, tracks, switch track, preferences, leaderboard, seed featured challenge.
6. **Production:** Dockerfiles, compose, Caddy, Contabo setup, deploy and backup scripts, README rewrite.

**Code style:**
- Keep functions small and pure where possible. Business rules belong in `packages/shared` or `apps/api/src/services`, not in route handlers or components.
- Name things for what they are (`spreadDueDates`, not `handleData`). Write short comments only where the *why* isn't obvious.
- No default exports except where Next.js requires them (pages, layouts).
- Use Prisma transactions for multi-row writes (join challenge = participant + plan + articles + activity).

**Tests:**
- Every pure function gets a Vitest unit test. Every route gets a Supertest test, including the unauthenticated and other-user cases.
- Playwright covers: guest adds an article; sign up → import → ledger; follow → feed shows a finished article; join challenge → plan created.

**Git:** don't commit or push unless asked. Commit messages are short and imperative.

## Commands

```bash
pnpm install
pnpm db:up            # local Postgres 17 on :5544 (embedded-postgres, data in apps/api/.data)
pnpm db:migrate       # prisma migrate dev
pnpm db:seed
pnpm dev              # web :3000 + api :4000
pnpm test             # all workspaces
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e              # Playwright on prod builds with a throwaway DB; CHROMIUM_PATH=/usr/bin/chromium uses the system browser
```
