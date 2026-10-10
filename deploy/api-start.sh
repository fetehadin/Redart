#!/bin/sh
# Apply pending migrations, then start the API. If a migration fails, the container stops instead of serving.
set -e
./node_modules/.bin/prisma migrate deploy
exec node dist/index.js
