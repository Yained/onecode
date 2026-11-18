# OneScience Skills Agent Registry Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Agent Registry from the AI primitive production workspace into the OneSkills route layer and prevent OneSkills cards from being converted into primitives.

**Architecture:** Keep `/primitives` focused on primitive catalog and factory production. Extend `/skills` with a OneSkills Agent Registry section that reuses the existing `AgentRegistryPanel` data flow. Gate the resource-card `转为原语` action so it does not appear for `page="skills"`.

**Tech Stack:** SolidJS, Bun tests, OneScience experimental primitive endpoints.

---

### Task 1: Route Semantics Tests

**Files:**
- Modify: `packages/app/src/app.routes.test.tsx`
- Modify: `packages/app/src/pages/onescience-skills.test.ts`

- [x] **Step 1: Write failing tests**

Tests assert `/primitives` includes catalog/factory only, `/skills` includes `SkillsAgentRegistrySection`, and skill cards contain the `props.page !== "skills"` gate.

- [x] **Step 2: Verify tests fail**

Run: `cd packages/app && bun test src/app.routes.test.tsx src/pages/onescience-skills.test.ts`
Expected: FAIL for missing `SkillsAgentRegistrySection`, remaining `tab=registry`, and missing `props.page !== "skills"`.

### Task 2: Implement Route Reshape

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`

- [ ] **Step 1: Change `SkillsPage`**

Render `ResourcePage page="skills"` followed by `<SkillsAgentRegistrySection />`.

- [ ] **Step 2: Remove registry tab from `PrimitiveWorkspacePage`**

Keep `tab=catalog` and `tab=factory`; remove `tab=registry` selection and panel render.

- [ ] **Step 3: Add `SkillsAgentRegistrySection`**

Wrap `AgentRegistryPanel` in an explanatory OneSkills route section titled `OneSkills Agent Registry`.

- [ ] **Step 4: Remove OneSkills from primitive factory sources**

Delete the `/skills` factory source link so skills are not framed as primitive source resources.

- [ ] **Step 5: Gate resource conversion**

Change the card conversion condition to `props.page !== "skills" && source().tone === "onescience"`.

### Task 3: Verify and Serve

**Files:**
- Test: `packages/app/src/app.routes.test.tsx`
- Test: `packages/app/src/pages/onescience-skills.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `cd packages/app && bun test src/app.routes.test.tsx src/pages/onescience-skills.test.ts`
Expected: PASS.

- [ ] **Step 2: Run app typecheck**

Run: `cd packages/app && bun typecheck`
Expected: PASS.

- [ ] **Step 3: Rebuild and restart 8006**

Run: `OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install`, then restart `onecode serve --port 8006 --hostname 0.0.0.0`.
Expected: `/skills` and `/primitives` are served from port `8006`.
