#!/bin/sh
# Seed the mounted /app/data volume with default files ONLY if they don't
# already exist. Existing catalog.json / list.json are never overwritten —
# this only fires for a brand new, empty data directory.

if [ ! -f /app/data/catalog.json ]; then
  echo "No catalog.json found — seeding default catalog..."
  cp /app/data-defaults/catalog.json /app/data/catalog.json
fi

if [ ! -f /app/data/list.json ]; then
  echo "No list.json found — seeding empty list..."
  cp /app/data-defaults/list.json /app/data/list.json
fi

exec node server.js
