# Redart

A reading ledger for engineers. Plan the articles you want to read, tick them off, and keep a short note on each one.

Paste a link and Redart checks that it works, fills in the title, and estimates the read time.

No account and no database. Each reader's ledger lives in their own browser, so you can share one link with a whole Telegram channel and everyone gets their own private tracker.

## Features

- **Plans of any length.** A plan is a start date plus a number of days (30 by default), so it works for every month. New plans can start empty, carry over unread articles, use your favourites, or load the starter list.
- **Paste a link, get a read time.** The server reads the page, counts the words in the article body (skipping menus and footers), and estimates minutes at 238 words per minute plus a little time per image.
- **Link checking.** Every link is labelled *works*, *broken* (404/410 or bad redirects), *site not responding* (timeouts, 5xx) or *site blocked the check* (401/403/429, common with Cloudflare or Medium). Links are rechecked automatically after 7 days, or on demand.
- **Favourites.** Star any article. Favourites are kept outside plans, so deleting a plan never loses them, and you can add a favourite back to any plan.
- **Ledger tools.** Checkboxes, editable due dates, notes, inline editing, reordering, search, filters (All / To read / Done / Favourites), and "Spread dates" to space due dates evenly.
- **Progress.** Articles read, minutes read, which day of the plan you're on, and whether you're ahead or behind, with a marker on the progress bar showing where you should be today.
- **Backup and restore.** One text blob you can paste into Telegram "Saved Messages" and restore on any device.
- **Classic, accessible UI.** Light and dark themes, works at phone width, keyboard friendly, installable on a phone home screen.

## Project layout

```
api/
  inspect.js        GET /api/inspect?url=…  (Vercel serverless function)
  _lib/net.js       URL validation and private-network (SSRF) protection
  _lib/extract.js   title, word count and read-time extraction
public/             the static website (no build step)
  index.html
  assets/app.js     UI
  assets/core.js    pure logic: dates, scheduling, validation (unit tested)
  assets/starter.js the starter reading list
  assets/styles.css
scripts/dev.mjs     local server that runs the site and the API together
test/               node:test suites
vercel.json         output directory, function limits, security headers
```

## Run it locally

You need Node.js 20 or newer. There are no dependencies to install.

```bash
npm run dev     # http://localhost:3000
npm test        # 26 tests
```

## Deploy on Vercel

1. Push this repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Leave the settings as they are. `vercel.json` already sets the framework to *Other*, no build command, and `public` as the output directory. The `api/` folder becomes the serverless function automatically.
4. Click **Deploy**. Your site will be live at `https://<project>.vercel.app`.

Every push to `main` redeploys automatically.

## Engineering decisions

**Why a server function at all?** Browsers can't read other websites' pages because of CORS, so checking a link or counting words has to happen on a server. One small function handles both.

**Safety of the link checker.** It fetches URLs that anyone can type, so it is locked down against server-side request forgery:
- only `http`/`https` on ports 80 and 443
- no usernames or passwords in links
- the domain is resolved first, and private, loopback, link-local, carrier-grade NAT and cloud-metadata addresses are refused
- every redirect hop is validated again (at most 5 hops)
- 9-second overall timeout and a 3 MB read limit

**Cost and speed.** Successful results are cached at Vercel's edge for 12 hours, so the starter articles are fetched once and then shared by every visitor. A best-effort rate limit of 40 checks per minute per IP stops abuse.

**Honest estimates.** When a page builds its text with JavaScript or sits behind a login, there are too few words to trust. Redart says "link works, enter the read time yourself" instead of showing a wrong number. Publishers' declared `wordCount` (JSON-LD) is used when it's larger than what's visible. Word counting uses `Intl.Segmenter`, so Amharic, Arabic and CJK text count correctly.

**Your data stays yours.** Plans, notes and favourites live only in `localStorage`, and nothing is sent to the server except the link being checked. Stored data and pasted backups are validated and repaired on load, and backups from the first Redart version still restore. A corrupted save is set aside instead of being overwritten.

**Edge cases handled.**
- Duplicate links are detected even when written differently (http vs https, `www`, trailing slash, `utm_` tracking).
- Due dates use local calendar days, so there's no timezone drift.
- Moving a plan's start date moves its due dates with it.
- Articles due today don't count against your pace.
- Removing an article or deleting a plan can be undone. The last plan can't be deleted.
- Background checks never steal focus while you type a note.
- Changes in another tab are picked up, statuses refresh when you return the next day, and offline use works with checks resuming when you reconnect.
- The page warns you when the browser blocks storage or storage is full.

**Security headers.** A strict Content-Security-Policy (no inline scripts or styles), `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a locked-down permissions policy.

## License

MIT
