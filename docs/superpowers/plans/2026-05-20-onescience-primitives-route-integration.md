# OneScience Primitives Route Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `/primitives` route with a tabbed primitive workspace that integrates catalog, factory, and agent registry views.

**Architecture:** Keep `/primitives` as the only visible route. Refactor primitive API access and UI panels into `pages/onescience.tsx`, reuse static `onescience-primitives.ts` as fallback, and keep resource cards as the contextual “转为原语” entry.

**Tech Stack:** SolidJS, Solid Router query params, Bun tests, existing OneScience experimental HTTP API.

---

### Task 1: Route and Source Tests

**Files:**
- Modify: `packages/app/src/app.routes.test.tsx`
- Modify: `packages/app/src/pages/onescience-skills.test.ts`

- [ ] Write failing tests that require `/primitives` to render a tabbed workspace, include catalog/factory/registry labels, stop using `ResourcePage page="primitives"`, and use `/experimental/onescience/...` primitive endpoints.
- [ ] Run `bun test src/app.routes.test.tsx src/pages/onescience-skills.test.ts` from `packages/app` and confirm failures.

### Task 2: Primitive Workspace Implementation

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`
- Modify: `packages/app/src/components/onescience/PrimitiveCreateDialog.tsx`

- [ ] Add primitive API helpers for list, registry list, resource get, primitive create, and cache-free static fallback.
- [ ] Replace `PrimitivesPage()` with a dedicated tabbed primitive workspace.
- [ ] Add catalog panel with DB-first load and static fallback.
- [ ] Add factory panel with resource page links and lifecycle copy.
- [ ] Add registry panel backed by `/experimental/onescience/agent-registry`.
- [ ] Fix `PrimitiveCreateDialog` to use `/experimental/...` via a `serverUrl` prop and navigate after success from the parent resource card.

### Task 3: Verification

**Files:**
- Test: `packages/app/src/app.routes.test.tsx`
- Test: `packages/app/src/pages/onescience-skills.test.ts`

- [ ] Run targeted app tests from `packages/app`.
- [ ] Run `bun typecheck` from `packages/app`.
- [ ] Verify current 8006 service still serves OneScience after rebuild/restart only if needed.
