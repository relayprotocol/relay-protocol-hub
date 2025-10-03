#!/bin/sh
set -eu
set -a
if [ -d /vault/secrets ]; then
  for f in /vault/secrets/*;
    do [ -f "$f" ] && . "$f" || true;
  done
fi
set +a
exec "$@"
