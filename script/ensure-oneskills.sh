#!/usr/bin/env bash
set -euo pipefail

# Install OneSkills for source / dev startup when global skills are missing.
#
# Usage:
#   ./script/ensure-oneskills.sh /path/to/onecode-binary
#
# Optional:
#   ONESKILLS_AUTO_SETUP=0          skip install
#   ONESKILLS_RELEASE_URL=...       default: https://gitee.com/onescience-ai/oneskills/releases/download/latest/oneskills-latest.zip
#   ONECODE_EXTRA_PATH=...          install target root (default: $HOME)

has_discoverable_skills() {
  local skills_dir="$1"
  local skill_md

  [[ -d "$skills_dir" ]] || return 1
  shopt -s nullglob
  for skill_md in "$skills_dir"/*/SKILL.md; do
    [[ -f "$skill_md" ]] && return 0
  done
  return 1
}

main() {
  local bin="${1:-${ONECODE_BIN:-}}"
  local project_root="${ONECODE_EXTRA_PATH:-$HOME}"
  local skills_dir="$project_root/.opencode/oneskills/skills"

  if [[ "${ONESKILLS_AUTO_SETUP:-1}" == "0" ]]; then
    return 0
  fi

  if [[ -z "$bin" || ! -x "$bin" ]]; then
    echo "ensure-oneskills: onecode binary not found or not executable: ${bin:-<unset>}" >&2
    exit 1
  fi

  if has_discoverable_skills "$skills_dir"; then
    echo "OneSkills already installed: $skills_dir"
    return 0
  fi

  echo "Installing OneSkills from release package to $project_root/.opencode/oneskills"
  "$bin" oneskills install
}

main "$@"
