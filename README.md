# Redart

A reading ledger for engineers. Plan the articles you want to read, tick them off, and keep a short note on each one. Paste a link and Redart checks that it works, fills in the title, and estimates the read time.

You don't need an account: a guest's ledger lives in their own browser. Signing in adds:

- **Sync** across devices, and a guest's reading comes along when they sign up.
- **Following.** See what friends have finished, their current plans and their favourites. Private accounts approve each follower, and notes are never shared.
- **Feed and recommendations.** A plain, newest-first feed of what the people you follow read. You can recommend an article to all your followers or to one of them, and add anything to your plan in one click.
- **Monthly challenges.** Read a curated list with others at a *light*, *steady* or *deep* pace. Joining adds a plan to your ledger. Challenges about your favourite topics show first, and the leaderboard is opt-in.

See [CLAUDE.md](CLAUDE.md) for the full product spec and architecture, and [deploy/README.md](deploy/README.md) to run it on a server.

## Stack

TypeScript everywhere, in a pnpm monorepo:

```
apps/web         Next.js 16 (App Router, React 19), CSS Modules
apps/api         Express 5, Prisma 7, PostgreSQL 17
packages/shared  logic used by both: dates, scheduling, ledger operations, challenge paces, Zod schemas
deploy/          Dockerfiles, Compose, Caddy, server setup, deploy/backup/restore scripts
```

## Run it locally

You need Node.js 24 and pnpm 10. You don't need Docker: `db:up` runs a real PostgreSQL 17 as your own user.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # Postgres on :5544; leave it running
pnpm db:migrate   # in another terminal
pnpm db:seed      # optional: two featured monthly challenges
pnpm dev          # web on http://localhost:3000, API on :4000
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test         # unit tests, plus API tests against a throwaway Postgres
pnpm build
pnpm e2e          # Playwright on desktop and phone sizes, with a throwaway database
                  # CHROMIUM_PATH=/usr/bin/chromium uses a system browser
```

## How it works

- **Ledger operations.** Every change is a typed `LedgerOp` applied by one pure reducer (`packages/shared/src/ledger.ts`). Guests save the result to localStorage. Members send the same ops to `POST /api/ledger/ops`, which applies them in order in one transaction, and replaying an op is harmless. Unsent ops wait in localStorage, so going offline loses nothing.
- **Privacy in one place.** `apps/api/src/services/visibility.ts` decides who sees what: the owner, accepted followers of private accounts, and members viewing public ones. Guests see only profile headers. Hidden plans and blocked readers never show up anywhere, and notes never leave their owner.
- **Link checking.** `GET /api/inspect` fetches pages with strict protection against fetching private or internal addresses:
  - http/https only, on ports 80/443 only;
  - DNS is resolved first, and private addresses are refused;
  - every redirect hop is re-validated;
  - a 9 s timeout and a 3 MB cap.

  It counts the article's words at 238 wpm and caches the result for everyone. Pages built by JavaScript get "enter the read time yourself" rather than a made-up estimate.
- **Accounts.**
  - Passwords are hashed with argon2id.
  - Sessions use an httpOnly, SameSite cookie holding a random token, and only the token's hash is stored.
  - Every write checks the Origin header.
  - Rate limits cover sign-in, sign-up and other sensitive actions.
  - Sign-in and reset give the same answer whether or not an email is registered.

## License

MIT
