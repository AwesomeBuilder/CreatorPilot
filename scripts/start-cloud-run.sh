#!/bin/sh
set -eu

mkdir -p uploads renders prisma

npx prisma migrate deploy

exec npx next start --hostname 0.0.0.0 --port "${PORT:-8080}"

