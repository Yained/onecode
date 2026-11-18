#!/usr/bin/env bash
set -euo pipefail

# OneScience / onecode HTTP server (catalog + workspace API).
#
# Usage:
#   export ONECODE_PORT=your-port
#   ./script/serve-onescience.sh
#
# Optional overrides:
#   ONECODE_BIN, ONECODE_HOST, ONECODE_CORS
#   OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
#   CATALOG_EMBEDDING_MODE, CATALOG_EMBEDDING_MODEL, CATALOG_EMBEDDING_CACHE
#   ONESKILLS_AUTO_SETUP=0, ONESKILLS_RELEASE_URL
#
# Release build with bundled embedding model:
#   ./packages/opencode/script/build.ts --single --skip-install --bundle-embedding

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export ONECODE_ROOT="${ONECODE_ROOT:-$ROOT}"
BIN="${ONECODE_BIN:-$ROOT/packages/opencode/dist/onecode-linux-x64/bin/onecode}"
PORT="${ONECODE_PORT:-}"
HOST="${ONECODE_HOST:-0.0.0.0}"
CORS="${ONECODE_CORS:-http://onescience.ai:${PORT}}"

if [[ ! -x "$BIN" ]]; then
  echo "onecode binary not found: $BIN" >&2
  echo "Build first: cd $ROOT && ./packages/opencode/script/build.ts --single --skip-install [--bundle-embedding]" >&2
  exit 1
fi

if [[ -z "$PORT" ]]; then
  echo "Set ONECODE_PORT before starting." >&2
  exit 1
fi

if [[ -n "${OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY:-}" ]]; then
  export OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
fi
export CATALOG_EMBEDDING_MODE="${CATALOG_EMBEDDING_MODE:-model}"
export CATALOG_EMBEDDING_MODEL="${CATALOG_EMBEDDING_MODEL:-Xenova/bge-small-zh-v1.5}"
DIST_DIR="$(cd "$(dirname "$BIN")/.." && pwd)"
BUNDLED_EMBEDDING_CACHE="$DIST_DIR/embedding-models"
DEFAULT_EMBEDDING_CACHE="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/embedding-models"
EMBEDDING_SLUG="models--${CATALOG_EMBEDDING_MODEL//\//--}"
if [[ -z "${CATALOG_EMBEDDING_CACHE:-}" ]]; then
  if [[ -f "$BUNDLED_EMBEDDING_CACHE/$EMBEDDING_SLUG/refs/main" ]]; then
    export CATALOG_EMBEDDING_CACHE="$BUNDLED_EMBEDDING_CACHE"
  else
    export CATALOG_EMBEDDING_CACHE="$DEFAULT_EMBEDDING_CACHE"
  fi
fi
LIB_DIR="$(cd "$(dirname "$BIN")/../lib" && pwd)"
SOURCE_TRANSFORMERS="$ROOT/packages/opencode/node_modules/@huggingface/transformers/dist/transformers.node.mjs"
if [[ -f "$SOURCE_TRANSFORMERS" ]]; then
  export ONECODE_TRANSFORMERS_PATH="${ONECODE_TRANSFORMERS_PATH:-$SOURCE_TRANSFORMERS}"
else
  export ONECODE_TRANSFORMERS_PATH="${ONECODE_TRANSFORMERS_PATH:-$LIB_DIR/transformers.node.mjs}"
fi
export NODE_PATH="${ROOT}/packages/opencode/node_modules:${LIB_DIR}/node_modules${NODE_PATH:+:$NODE_PATH}"

"$ROOT/script/ensure-oneskills.sh" "$BIN"

exec "$BIN" serve \
  --port "$PORT" \
  --hostname "$HOST" \
  --cors "$CORS"
