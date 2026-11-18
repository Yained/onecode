#!/bin/sh
set -eu

mkdir -p "$ONECODE_EXTRA_PATH" "$OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY"
cd /app
exec bun --conditions=browser ./packages/opencode/src/index.ts serve --hostname 0.0.0.0 --port 8004
