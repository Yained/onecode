# Task And Data Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OneScience workspace entries and static pages for task management and data management under the research development navigation area.

**Architecture:** Extend the existing `packages/app/src/pages/onescience.tsx` workspace shell with two new page exports, icons, mock data, and navigation entries. Register lazy routes in `packages/app/src/app.tsx`, and update existing route/source tests in `packages/app/src/app.routes.test.tsx`.

**Tech Stack:** SolidJS, `@solidjs/router`, Bun tests, existing OneScience CSS in `packages/app/src/app.css`.

---

### Task 1: Route And Sidebar Tests

**Files:**
- Modify: `packages/app/src/app.routes.test.tsx`

- [ ] Add assertions that `/tasks` and `/data-management` are lazy-loaded and mounted inside `WorkspaceShell`.
- [ ] Add assertions that `任务管理` and `数据管理` appear immediately after `科研开发` in `workspaceNavGroups`.
- [ ] Run `bun test src/app.routes.test.tsx` from `packages/app` and confirm the new assertions fail because routes/nav entries do not exist yet.

### Task 2: Routes, Icons, And Navigation

**Files:**
- Modify: `packages/app/src/app.tsx`
- Modify: `packages/app/src/pages/onescience.tsx`

- [ ] Add `TasksRoute` and `DataManagementRoute` lazy imports from `@/pages/onescience`.
- [ ] Add `<Route path="/tasks" component={TasksRoute} />` and `<Route path="/data-management" component={DataManagementRoute} />` inside `WorkspaceShell` routes.
- [ ] Extend `WorkspaceIconName` and `WorkspaceNavIcon` with `tasks` and `data-management` icons.
- [ ] Update `workspaceNavGroups` so the first group is `首页`, `科研开发`, `任务管理`, `数据管理`.

### Task 3: Static Workspace Pages

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`

- [ ] Add `TasksPage()` following `job.png`: header chips, action buttons, left task list, right details, metric cards, progress, logs.
- [ ] Add `DataManagementPage()` following `datasets.png`: header actions, left storage/type/workflow summary, tab filters, search field, data asset cards.
- [ ] Keep content static and focused on research workflows: raw data, preprocessing, generated data, intermediate data, AI Ready publishing.

### Task 4: Workspace Styling

**Files:**
- Modify: `packages/app/src/app.css`

- [ ] Add reusable classes for the management pages: shell grid, topbar, sidebar panel, list cards, status pills, metrics, logs, workflow cards.
- [ ] Ensure responsive behavior collapses two-column layouts on narrower viewports.

### Task 5: Verification

**Files:**
- Test: `packages/app/src/app.routes.test.tsx`

- [ ] Run `bun test src/app.routes.test.tsx` from `packages/app`; expect pass.
- [ ] Run `bun typecheck` from `packages/app`; expect pass.
