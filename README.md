# Redart

A reading ledger for engineers. Plan the articles you want to read, tick them off, and keep a short note on each one. Paste a link and Redart checks that it works, fills in the title, and estimates the read time.

You don't need an account: a guest's ledger lives in their own browser. Signing in syncs the ledger across devices (a guest's reading comes along), and opens up the social side: following readers, sharing favourites and recommendations, and monthly reading challenges at your own pace.

See [CLAUDE.md](CLAUDE.md) for the full product spec, architecture and build phases.

## Stack

TypeScript everywhere, in a pnpm monorepo:

```
apps/web         Next.js 16 (App Router, React 19), CSS Modules
apps/api         Express 5: link checker, and later the whole data API (Prisma + PostgreSQL)
packages/shared  pure logic used by both: dates, scheduling, URL keys, ledger operations
```

## Run it locally

You need Node.js 24 and pnpm 10.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # Postgres 17 on :5544, no Docker needed (leave it running)
pnpm db:migrate   # in another terminal
pnpm dev          # web on http://localhost:3000, API on :4000
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test         # unit + API tests against a throwaway Postgres (Vitest, Supertest)
pnpm build
pnpm e2e          # Playwright against the production build; CHROMIUM_PATH=/usr/bin/chromium to use a system browser
```

## How it works

- **Ledger operations.** Every change (add an article, tick it, move a plan's start date…) is a typed `LedgerOp` applied by one pure reducer in `packages/shared/src/ledger.ts`. Guests save the result to localStorage. Members send the same ops to `POST /api/ledger/ops`, which applies them in a transaction. Unsent ops wait in localStorage, so going offline loses nothing.
- **Accounts.** Argon2id passwords, httpOnly SameSite cookies holding a random token (only its hash is stored), Origin checks on every write, and email-enumeration-safe sign-in and reset.
- **Link checking.** `GET /api/inspect?url=` fetches the page with strict SSRF protection: http/https only, ports 80/443 only, DNS resolved and private addresses refused, every redirect hop re-validated, a 9 s timeout and a 3 MB cap. It then counts the words in the article body at 238 wpm. Pages built by JavaScript get "enter the read time yourself" rather than a made-up estimate.
- **Security headers.** A per-request CSP nonce (`apps/web/src/proxy.ts`), plus `helmet` on the API and rate limits on link checks.
- **Your data stays yours.** Stored data and pasted backups are validated and repaired on load. A corrupted save is set aside, never overwritten. Backups from earlier versions still restore.

## License

MIT
