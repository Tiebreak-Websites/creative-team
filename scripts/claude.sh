#!/usr/bin/env bash
# Launch Claude Code with .env vars exported so MCP servers (Framelink, etc.) pick them up.
# Usage: from repo root, run `./scripts/claude.sh`
#
# Why this exists: Claude Code does NOT auto-load .env into its process env.
# Project-level MCP servers configured in .mcp.json expect vars like FIGMA_API_KEY
# to be present in the parent shell when `claude` is launched.

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$repo_root/.env"

if [ ! -f "$env_file" ]; then
  echo "❌ No .env at $env_file" >&2
  echo "   Run: cp .env.example .env  — then fill in your keys." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

cd "$repo_root"
exec claude "$@"
