#!/usr/bin/env bash
# One-time setup of a fresh Contabo VPS (Ubuntu 24.04) for Redart. Run as root:
#   scp deploy/server-setup.sh root@SERVER:/root/ && ssh root@SERVER 'bash /root/server-setup.sh'
# Safe to run again. It refuses to disable password logins until key login works for the deploy user.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR=/srv/redart
BACKUP_DIR=/srv/backups/redart

[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || echo "Warning: written for Ubuntu; this is ${PRETTY_NAME:-unknown}."

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw fail2ban unattended-upgrades git

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Swap (Next.js builds need memory on small servers)"
if ! swapon --show | grep -q . && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 6000000 ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Docker Engine"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Deploy user '$DEPLOY_USER'"
id "$DEPLOY_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$DEPLOY_USER"
usermod -aG docker,sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
[ -f "/home/$DEPLOY_USER/.ssh/authorized_keys" ] && chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys" && chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> App folders"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR" "$APP_DIR/releases" "$BACKUP_DIR"
if [ ! -f "$APP_DIR/.env" ]; then
  pw="$(openssl rand -hex 24)"
  cat > "$APP_DIR/.env" <<ENV
DOMAIN=CHANGE_ME.example.com
POSTGRES_USER=redart
POSTGRES_PASSWORD=$pw
POSTGRES_DB=redart
ADMIN_EMAILS=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
LOG_LEVEL=info
ENV
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "    Created $APP_DIR/.env with a generated database password. Set DOMAIN in it."
fi

echo "==> Nightly database backup at 03:15"
cat > /etc/cron.d/redart-backup <<CRON
15 3 * * * $DEPLOY_USER $APP_DIR/current/deploy/backup.sh >> $BACKUP_DIR/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/redart-backup

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban for SSH"
systemctl enable --now fail2ban

echo "==> SSH hardening"
if [ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]; then
  cat > /etc/ssh/sshd_config.d/99-redart.conf <<SSHD
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
SSHD
  sshd -t && systemctl reload ssh
  echo "    Root and password logins are now off. Log in as: ssh $DEPLOY_USER@$(hostname -I | awk '{print $1}')"
else
  echo "    SKIPPED: no SSH key for $DEPLOY_USER yet. Add your public key to /home/$DEPLOY_USER/.ssh/authorized_keys and run this again."
fi

echo "Done. Next: set DOMAIN in $APP_DIR/.env, point the domain's DNS at this server, then deploy from your machine."
