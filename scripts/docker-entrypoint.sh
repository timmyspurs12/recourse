#!/bin/sh
# Container entrypoint.
#
# Persistent volumes are attached at RUN time, after the image is built, and
# most hosts (Railway, Fly, plain `docker run -v`) attach them owned by root.
# That silently discards any ownership the Dockerfile set at build time, so an
# app running as a non-root user cannot write to its own data directory.
#
# The fix is the standard one: start as root, take ownership of the mount, then
# drop privileges before executing the app. The application itself never runs
# as root.
#
# This is deliberately host-agnostic. It removes the need for platform-specific
# escape hatches such as RAILWAY_RUN_UID=0, which "fix" the problem by running
# everything as root.

set -e

DATA_DIR="$(dirname "${RECOURSE_STORE_FILE:-/app/.recourse/ledger.json}")"

mkdir -p "$DATA_DIR"

# Only chown when it is actually needed: on a large volume this is not free,
# and on hosts that already hand us a correctly-owned mount it is a no-op.
CURRENT_OWNER="$(stat -c '%u' "$DATA_DIR" 2>/dev/null || echo 0)"
if [ "$CURRENT_OWNER" != "1001" ]; then
  echo "[recourse] taking ownership of $DATA_DIR (was uid $CURRENT_OWNER)"
  chown -R 1001:1001 "$DATA_DIR" || echo "[recourse] warning: could not chown $DATA_DIR"
fi

# Drop to the unprivileged app user for everything that follows.
if [ "$(id -u)" = "0" ]; then
  exec su-exec 1001:1001 "$@"
fi

echo "[recourse] already running unprivileged as uid $(id -u)"
exec "$@"
