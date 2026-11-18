# OneScience Web Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OneScience landing page and workspace resource shell while preserving the opencode development interface at `/code`.

**Architecture:** `packages/app/src/app.tsx` owns route wiring. `packages/app/src/pages/onescience.tsx` owns OneScience landing, workspace shell, and resource card pages. `packages/app/src/pages/home.tsx` continues to provide `DevelopmentHome` for the opencode workflow.

**Tech Stack:** SolidJS, `@solidjs/router`, Tailwind utility classes, Bun test/typecheck.

---

### Task 1: Route Contract

**Files:**
- Modify: `packages/app/src/app.tsx`
- Create: `packages/app/src/app.routes.test.tsx`

- [ ] Add tests that assert route definitions include `/code` and `/dev` redirects to `/code`.
- [ ] Update route wiring so `/code` renders `DevelopmentShell` and `/dev` redirects to `/code`.
- [ ] Run `bun test --preload ./happydom.ts ./src/app.routes.test.tsx` from `packages/app`.

### Task 2: Workspace Shell and Resource Pages

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`

- [ ] Replace the current mixed dark-page resource implementation with a product landing plus shared workspace shell.
- [ ] Add left navigation entries: 首页, 代码开发, Skills, 数据集, 模型库, 应用库, AI框架, 通用算子, 案例, 文档下载, 设置.
- [ ] Add resource data and card grids for Skills, datasets, models, apps, frameworks, operators, cases, docs, infra, apphub, and research.
- [ ] Ensure `/models`, `/apps`, `/frameworks`, and `/operators` exported page components exist for route wiring.

### Task 3: Product Landing

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`
- Modify: `packages/app/src/index.css`

- [ ] Implement `/` as the product page with top dropdown nav and the requested product sections.
- [ ] Point top nav menu items to workspace routes and anchors.
- [ ] Keep visual style professional and readable, avoiding nested cards and one-note color palettes.

### Task 4: Verification

**Files:**
- Modify as needed based on verification failures.

- [ ] Run route unit tests from `packages/app`.
- [ ] Run `bun typecheck` from `packages/app`.
- [ ] Run `env PATH=/tmp/node22/bin:$PATH bun run build` from `packages/app`.

