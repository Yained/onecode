#!/usr/bin/env bash
# Install a flat Xenova/bge-small-zh-v1.5 directory into HuggingFace hub cache layout.
set -euo pipefail

SRC="${1:-${CATALOG_EMBEDDING_SRC:-}}"
CACHE="${2:-${CATALOG_EMBEDDING_CACHE:-}}"
MODEL="${CATALOG_EMBEDDING_MODEL:-Xenova/bge-small-zh-v1.5}"
SLUG="models--${MODEL//\//--}"
REV="${3:-manual}"
TARGET="$CACHE/$SLUG/snapshots/$REV"

if [[ -z "$SRC" || -z "$CACHE" ]]; then
  echo "Usage: $0 <flat-model-dir> <cache-dir> [revision]" >&2
  echo "Or set CATALOG_EMBEDDING_SRC and CATALOG_EMBEDDING_CACHE." >&2
  exit 1
fi

if [[ ! -f "$SRC/onnx/model.onnx" ]]; then
  echo "Missing $SRC/onnx/model.onnx" >&2
  exit 1
fi

mkdir -p "$TARGET" "$CACHE/$SLUG/refs"
cp -a "$SRC/." "$TARGET/"
printf '%s' "$REV" > "$CACHE/$SLUG/refs/main"

echo "Installed $MODEL into $CACHE"
echo "Use:"
echo "  export CATALOG_EMBEDDING_MODE=model"
echo "  export CATALOG_EMBEDDING_MODEL=$MODEL"
echo "  export CATALOG_EMBEDDING_CACHE=$CACHE"
echo "Or bundle into a release dist:"
echo "  ./packages/opencode/script/build.ts --single --skip-install --bundle-embedding --embedding-src=$SRC"
