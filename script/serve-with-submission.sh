#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Compatibility entry point: submission now runs inside the OneCode process.
export ONECODE_PORT="${ONECODE_PORT:-8008}"
export ONECODE_SUBMISSION_ROOT="${ONECODE_SUBMISSION_ROOT:-$ROOT/packages/intelligent-submission}"
exec "$ROOT/script/serve-onescience.sh" "$@"
