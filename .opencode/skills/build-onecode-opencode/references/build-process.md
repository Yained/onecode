# OneCode/OpenCode Build Process

## Repository

- Root: `/root/opencode/onecode`
- Default branch: `dev`
- Tests must not be run from repo root.
- Type checking should use `bun typecheck` from package directories.

## Fast Dependency Strategy

Avoid slow full installs unless dependencies are absent or broken.

Preferred install:

```bash
bun install --ignore-scripts
```

Use this when `node_modules` is missing, package resolution fails, or build scripts report missing dependencies.

## Web App Build

Run from `/root/opencode/onecode/packages/app`:

```bash
bun typecheck
env PATH=/tmp/node22/bin:$PATH bun run build
```

Expected successful build signal:

```text
vite v7.x building for production...
✓ built in ...
```

Vite may warn about large chunks or dynamic imports. Treat those as non-blocking unless the command exits nonzero.

## Embedded Binary Build

Run from `/root/opencode/onecode`:

```bash
env PATH=/tmp/node22/bin:$PATH OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

This generates `packages/core/src/models-snapshot.js`, builds the web UI, builds:

```text
packages/opencode/dist/opencode-linux-x64/bin/opencode
```

and runs a smoke test:

```text
Running smoke test: dist/opencode-linux-x64/bin/opencode --version
Smoke test passed: ...
```

The command fetches `https://models.dev/api.json`. If it fails with `ConnectionRefused` or a sandbox network error, rerun with escalation and explain that model metadata is required for the binary build.

## Version Check

Run from repo root:

```bash
packages/opencode/dist/opencode-linux-x64/bin/opencode --version
```

## Dev Server

Run from `/root/opencode/onecode/packages/app`:

```bash
env PATH=/tmp/node22/bin:$PATH bun run dev --host 0.0.0.0 --port 8004 --strictPort
```

If `8004` is occupied:

```bash
ss -ltnp 'sport = :8004'
lsof -nP -iTCP:8004 -sTCP:LISTEN
```

Sandbox may prevent process details. Do not kill the occupant without explicit user approval.

## Optional Binary Install

When requested:

1. Ensure `/root/.opencode/bin` exists.
2. Back up existing `/root/.opencode/bin/opencode` with a versioned or timestamped suffix.
3. Copy `packages/opencode/dist/opencode-linux-x64/bin/opencode` to `/root/.opencode/bin/opencode`.
4. Verify:

```bash
/root/.opencode/bin/opencode --version
```

## Common Failure Handling

- `Port 8004 is already in use`: report it and ask before killing unknown processes.
- `models.dev` connection failure: rerun binary build with network escalation.
- `bun typecheck` fails: fix TypeScript from the reported package path; do not run `tsc` directly.
- Dirty worktree: preserve unrelated changes and mention touched files in the final response.
