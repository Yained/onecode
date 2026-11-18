---
name: onecode-windows-dev
description: Use when setting up, repairing, verifying, building, or starting the OneScience onecode/opencode project on Windows, especially when Bun installs resolve wrong dependency versions, Git symlinks become plain files, Vite cannot build, or localhost:4444 is unavailable.
---

# OneCode Windows Dev

## Overview

Use the repository script first. Windows needs a few project-specific repairs after Bun install: hoisted linking, checkout compatibility for Git symlinks, and package-local junctions for dependencies that Bun may otherwise resolve from the wrong `.bun/node_modules` version.

## Quick Commands

From the repo root:

```powershell
bun run setup:windows
```

Useful modes:

```powershell
powershell -ExecutionPolicy Bypass -File script/setup-windows-dev.ps1 -Mode install
powershell -ExecutionPolicy Bypass -File script/setup-windows-dev.ps1 -Mode verify
powershell -ExecutionPolicy Bypass -File script/setup-windows-dev.ps1 -Mode start
```

`setup:windows` installs dependencies, repairs Windows-specific links/files, runs `packages/app` typecheck/build, then opens persistent cmd windows for:

- Backend: `packages/opencode`, port `4096`
- App UI: `packages/app`, port `4444`

Open `http://localhost:4444/`.

## Workflow

1. Check current state with `git status --short`; preserve unrelated user changes.
2. Confirm `bun --version` is `1.3.x`. Node 22 LTS is preferred, but the app build has been verified with Bun handling the toolchain.
3. Run `bun run setup:windows`.
4. If browser cannot open `http://localhost:4444/`, check whether port `4444` is listening and whether the opened cmd window is still running.
5. For verification only, run `bun run verify:windows`.
6. For starting already prepared dependencies, run `bun run dev:windows`.

## What The Script Fixes

- Writes/updates `.bunfig.toml` with `linker = "hoisted"` and `registry = "https://registry.npmmirror.com"`.
- Runs `bun install --ignore-scripts --linker hoisted --force`.
- Sets repo `core.symlinks=false` for Windows checkouts without symlink permission.
- Copies `packages/ui/src/custom-elements.d.ts` into `packages/app/src/custom-elements.d.ts`, because the repo symlink can become plain text on Windows.
- Adds junctions under `node_modules/.bun` so package-local dependency resolution uses the versions required by Babel, Motion, and Shiki.

## Expected Verification

These must pass from `packages/app`:

```powershell
bun typecheck
bun run build
```

Vite warnings about large chunks, dynamic imports staying in the same chunk, or sourcemap overwrite are non-blocking if the command exits `0`.

## Common Failures

| Symptom | Action |
| --- | --- |
| `TS1128` in `custom-elements.d.ts` | Run `bun run setup:windows`; the script replaces the broken symlink text with real declarations. |
| `_lruCache is not a constructor` | Run setup again; Babel needs package-local `lru-cache@5.1.1` in `.bun`. |
| `motion` has no exported member `animate` | Run setup again; Motion needs package-local `framer-motion@12.38.0` and `motion-utils@12.36.0`. |
| Shiki export mismatch | Run setup again; Shiki needs package-local `@shikijs/*@3.20.0`. |
| `localhost:4444` unavailable | The Vite cmd window likely closed. Run `bun run dev:windows` and keep both opened cmd windows alive. |

## Notes

- Do not run repo-root tests; this repo guards against root test runs.
- Use package-local commands such as `cd packages/app; bun typecheck`.
- `node_modules` repairs are install artifacts; rerunning `bun install` may require rerunning `bun run setup:windows`.
