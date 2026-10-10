# Deploying Redart to a Contabo VPS

The production setup is four containers on one server, managed by Docker Compose:

| Service | What it does |
|---|---|
| `caddy` | HTTPS (automatic Let's Encrypt certificates). Sends `/api/*` to `api` and everything else to `web`. |
| `web` | The Next.js app (standalone server). |
| `api` | The Express API. Applies database migrations on start, and won't start if one fails. |
| `db` | PostgreSQL 17. Its data lives in the `redart_pgdata` volume. Its port isn't reachable from outside. |

Releases are plain folders on the server (`/srv/redart/releases/<time>-<commit>`), with `/srv/redart/current` pointing at the live one. Secrets live only in `/srv/redart/.env`.

## 1. Before you start

- A Contabo VPS running **Ubuntu 24.04**. 4 GB RAM or more is comfortable; the setup adds swap on smaller machines.
- A **domain name**. Point an `A` record (and `AAAA` for IPv6) at the server's IP. Optionally add a `www` record too; it redirects to the bare domain.
- An **SSH key** on your machine (`~/.ssh/id_ed25519.pub`).

## 2. One-time server setup

Copy your key to the server, then run the setup script as root:

```bash
ssh-copy-id root@SERVER_IP
scp deploy/server-setup.sh root@SERVER_IP:/root/
ssh root@SERVER_IP 'bash /root/server-setup.sh'
```

The script:
- installs security updates, unattended upgrades, Docker, fail2ban, and swap if the server has less than 6 GB of RAM;
- creates a `deploy` user with your SSH key;
- opens only ports 22, 80 and 443;
- turns off root and password logins (only after key login for `deploy` is in place);
- creates `/srv/redart/.env` with a generated database password;
- schedules a nightly backup.

After it runs, log in as `deploy`:

```bash
ssh deploy@SERVER_IP
nano /srv/redart/.env      # set DOMAIN, and ADMIN_EMAILS / SMTP_* if you want them
```

## 3. Deploy

On your machine, from the repo root:

```bash
cp .env.deploy.example .env.deploy    # set DEPLOY_HOST to the server IP
deploy/deploy.sh
```

The script:
- ships the **committed** code with `git archive`, so the server never needs access to GitHub;
- builds the images;
- starts everything and waits for the health checks;
- switches `current` to the new release;
- checks `https://DOMAIN/api/health`.

The first build takes a few minutes. The certificate is issued on the first request after DNS points at the server.

**Admins and challenges.** Accounts whose email is in `ADMIN_EMAILS` become admins when they sign up. Admins can mark a challenge as a "Redart pick" in the "Start a challenge" form.

## Everyday operations

All commands below run on the server as `deploy`:

```bash
cd /srv/redart/current
alias dc='docker compose --env-file /srv/redart/.env -f deploy/docker-compose.yml'

dc ps                       # status
dc logs -f --tail 100 api   # follow API logs (also: web, caddy, db)
dc restart api
```

**Roll back.** Point `current` at an earlier release and bring it up:

```bash
ls -1dt /srv/redart/releases/*
cd /srv/redart/releases/<previous> && docker compose --env-file /srv/redart/.env -f deploy/docker-compose.yml up -d --build
ln -sfn "$PWD" /srv/redart/current
```

Database migrations only move forward. Rolling back the code doesn't undo a migration, so check a release's migrations before rolling back past it.

**Backups.** A cron job runs `deploy/backup.sh` at 03:15 every night. It writes `pg_dump` files to `/srv/backups/redart` and keeps 14 days of them. Copy them off the server regularly, because a backup on the same disk doesn't survive losing that disk. For example, from your machine:

```bash
rsync -av deploy@SERVER_IP:/srv/backups/redart/ ~/redart-backups/
```

**Restore.** This replaces the live database, and the script asks you to confirm:

```bash
/srv/redart/current/deploy/restore.sh /srv/backups/redart/redart-YYYYMMDD-HHMMSS.dump
```

Test a restore once after launch, so you know it works before you need it.

## Sharing a server with another app (how the Contabo VPS is set up)

On the current VPS, another app (TajStore, in `/opt/tajstore`) already runs a Caddy that owns ports 80/443. So Redart uses `deploy/docker-compose.behind-proxy.yml`:

- **No Caddy and no published ports.** `redart-web` and `redart-api` join TajStore's Docker network (`PROXY_NETWORK=tajstore_default`) under names that can't clash with TajStore's services. `redart-db` stays on Redart's private network.
- **Routing.** TajStore's `Caddyfile` has an extra site block that sends `redart.169-58-96-52.sslip.io` to those containers.
- **The block must stay in TajStore's repo.** TajStore's deploy script rsyncs its Caddyfile, so the block lives in that repo (`store-management-system`, branch `chore/share-caddy-with-redart`). Merge it there, or the next TajStore deploy removes Redart's route.
- **How settings are chosen.**
  - On the server, logging in as `redart` (`ssh redart@169.58.96.52`), `/srv/redart/.env` holds `COMPOSE_FILE_NAME`, `DB_SERVICE`, `API_SERVICE` and `WEB_SERVICE`. The backup and restore scripts read the service names from there.
  - On your machine, `.env.deploy` sets `COMPOSE_FILE_NAME=docker-compose.behind-proxy.yml`, which tells `deploy.sh` which file to use.
- **Applying a Caddy change without downtime.** TajStore's Caddy mounts its Caddyfile as a single file, and file-replacing tools (rsync, editors) leave the running container on the old copy. Validate and hot-reload from a copy instead:
  ```bash
  docker exec -i tajstore-caddy-1 sh -c 'cat > /tmp/Caddyfile.new && caddy validate --config /tmp/Caddyfile.new --adapter caddyfile && caddy reload --config /tmp/Caddyfile.new --adapter caddyfile' < /opt/tajstore/Caddyfile
  ```

## The old Vercel project

Redart v2 needs the API and Postgres, so it doesn't run on Vercel. `vercel.json` makes the Vercel project skip the build and forward every path to the live site (a temporary 307, so it's easy to change). `deploy/vercel/index.html` is a fallback page with a link. If Redart gets its own domain, update the destination in both files.
