#!/bin/sh
set -e

# Prepare: copy testnet migrations if IS_TESTNET is set
if [ -n "$IS_TESTNET" ]; then
  cp migrations/testnets/*.sql migrations/ 2>/dev/null || true
fi

# Run migrations with all passed arguments
node dist/scripts/run-migrations.js -m ./migrations -d POSTGRES_URL --no-check-order "$@"

# Cleanup: remove testnet migrations if IS_TESTNET is set
if [ -n "$IS_TESTNET" ]; then
  rm -f migrations/*testnet*.sql 2>/dev/null || true
fi
