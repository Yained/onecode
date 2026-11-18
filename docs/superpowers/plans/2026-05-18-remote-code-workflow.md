# Remote Code Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable SSH remote development path for `/code`, with MCP kept as a separate tool group in the server UI.

**Architecture:** Reuse the current `/code` HTTP server contract by storing SSH connections as `ServerConnection.Ssh` entries whose `http.url` points to a local tunnel. The renderer owns forms and persisted server entries; the desktop platform exposes optional SSH lifecycle APIs; a focused desktop SSH manager builds and runs local `ssh` commands without storing secrets.

**Tech Stack:** SolidJS, Bun test runner, Electron desktop preload/main IPC, OpenCode HTTP SDK.

---

### Task 1: Server Model

**Files:**
- Modify: `packages/app/src/context/server.tsx`
- Test: `packages/app/src/context/server.test.ts`

- [x] Write failing tests for SSH keys, persistence, and removal.
- [x] Run `env PATH=/tmp/node22/bin:$PATH bun test src/context/server.test.ts` from `packages/app` and confirm failure.
- [x] Extend `ServerConnection.Ssh`, stored server typing, keying, add, and remove flows.
- [x] Re-run the same test and confirm it passes.

### Task 2: Platform SSH Contract

**Files:**
- Modify: `packages/app/src/context/platform.tsx`
- Modify: `packages/desktop/src/preload/types.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Modify: `packages/desktop/src/main/ipc.ts`
- Create: `packages/desktop/src/main/ssh-remote.ts`
- Test: `packages/desktop/src/main/ssh-remote.test.ts`

- [x] Write failing tests for SSH command planning and status mapping.
- [x] Run the desktop test and confirm failure.
- [x] Add renderer platform methods and main-process IPC.
- [x] Add an SSH remote manager that starts remote `onecode serve`, creates a local tunnel, tracks status, and disconnects owned processes.
- [x] Re-run the desktop test and confirm it passes.

### Task 3: Server Selector UI

**Files:**
- Modify: `packages/app/src/components/dialog-select-server.tsx`
- Modify: `packages/app/src/components/server/server-row.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/zh.ts`
- Modify: `packages/app/src/i18n/zht.ts`

- [x] Add UI tests or source-level tests for SSH row labels and form state.
- [x] Run the focused app tests and confirm failure.
- [x] Add HTTP, SSH, MCP grouped navigation.
- [x] Add SSH form with basic and advanced fields.
- [x] Wire `platform.sshConnect`, `platform.sshDisconnect`, and SSH persistence.
- [x] Re-run focused tests and confirm they pass.

### Task 4: Verification

**Files:**
- No new source files expected.

- [x] Run `env PATH=/tmp/node22/bin:$PATH bun typecheck` from `packages/app`.
- [x] Run focused Bun tests from package directories.
- [ ] Manually inspect `/code` server selector in the running web app if the dev server is available.
- [ ] Commit only the implementation files, preserving unrelated existing changes.
