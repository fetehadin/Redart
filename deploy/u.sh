#!/usr/bin/env bash
# Creates the `redart` login user for deploying Redart, using root's SSH keys. Touches nothing else.
# Run as root on the server:  curl -L github.com/fetehadin/Redart/raw/main/deploy/u.sh | bash
set -e
id redart >/dev/null 2>&1 || adduser --disabled-password --gecos "" redart
echo "redart ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/redart
chmod 440 /etc/sudoers.d/redart
install -d -m 700 -o redart -g redart /home/redart/.ssh
cp /root/.ssh/authorized_keys /home/redart/.ssh/authorized_keys
chown redart:redart /home/redart/.ssh/authorized_keys
chmod 600 /home/redart/.ssh/authorized_keys
echo
echo "OK: user 'redart' is ready. You can close this window."
