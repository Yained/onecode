# Resource Derived Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selected dataset, model-library, and app-library derived primitives to the AI primitive catalog.

**Architecture:** Extend the existing static primitive catalog and migration seed with 24 resource-derived primitives. Keep resource pages unchanged, use primitive tags to drive catalog filters, and preserve source linkage in ids/tags/descriptions for future database-backed contracts.

**Tech Stack:** SolidJS static resource catalog, Bun tests, opencode primitive migration seed.

---

### Task 1: Catalog Tests

**Files:**
- Modify: `packages/app/src/pages/onescience-skills.test.ts`

- [x] **Step 1: Add failing assertions**

Require `Data Resources`, `Model Resources`, and `App Launchers` filters plus representative ids: `primitive-data-earth-era5-loader`, `primitive-model-aurora-runner`, `primitive-app-openfoam-runner`.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd packages/app && bun test src/pages/onescience-skills.test.ts`.
Expected: FAIL because filters and ids are not present yet.

### Task 2: Static Catalog Data

**Files:**
- Modify: `packages/app/src/pages/onescience-primitives.ts`

- [ ] **Step 1: Update count and filters**

Change count from 32 to 56 and add the three new categories.

- [ ] **Step 2: Append 24 primitives**

Add 8 data loaders, 8 model runners/train/eval entries, and 8 app launchers/workflows using existing `primitive(...)` helper.

### Task 3: Migration Seed

**Files:**
- Modify: `packages/opencode/src/onescience/primitive-migration.ts`

- [ ] **Step 1: Add the same 24 static primitives**

Mirror the catalog additions so database migration exposes the same primitives.

- [ ] **Step 2: Extend inference helpers**

Map `Data Resources` to `data.load`, `Model Resources` to `model.run`, and `App Launchers` to `app.launch`.

### Task 4: Verification and Serve

**Files:**
- Test: `packages/app/src/pages/onescience-skills.test.ts`
- Test: `packages/opencode/test/onescience/primitive.test.ts`

- [ ] **Step 1: Run targeted tests**

Run app and opencode primitive tests from their package directories.

- [ ] **Step 2: Run typechecks**

Run `bun typecheck` from affected package directories.

- [ ] **Step 3: Rebuild and restart 8006**

Rebuild the embedded binary and restart `onecode serve --port 8006 --hostname 0.0.0.0`.
