# Unified Workbench Implementation Plan

> **Document status:** Updated 2026-08-28. Phase 1 **complete** on `feat/frontend-refactor`. Reflects as-built code in `packages/app/src/workbench/`.

**Goal:** Ship a unified `/workspace` workbench shell with Capability Center, install→Session handoff, capability wizard, and soft login gates, while keeping marketing `/`.

**Architecture:** `packages/app/src/workbench/` owns the shell, left/right chrome, Capability Center, wizard, and pending-action resume. Existing `Session` + `handoff` remain the execution path. `/code` redirects to `/workspace/session`. Do not grow `onescience.tsx` for new UI—only change landing CTAs there.

**Spec:** `docs/superpowers/specs/2026-08-19-unified-workbench-design.md`

**Tech Stack:** SolidJS, `@solidjs/router`, Bun test (`bun test --preload ./happydom.ts`), `bun typecheck` from `packages/app`, `pushSessionHandoffDraft` / `markCodeNewSessionIntent`.

## Global Constraints

- Keep marketing `/`; CTAs go to `/workspace`
- Anonymous may enter workbench and browse Capability Center / intros / docs
- Login required for: install, wizard create-task, new project/session, upload, send, skills develop
- Do not rewrite agent/tool backend; wizard/install only produce prompts
- Tests and typecheck run from `packages/app`, never repo root
- Prefer source-contract tests consistent with `app.routes.test.tsx`

## File structure (as-built)

```
packages/app/src/workbench/
  routes.ts                     # workspace href helpers + legacy redirect targets
  routes.test.ts
  pending-action.ts             # one-shot resume after login
  pending-action.test.ts
  require-auth.ts               # requirePersonalSpace helper
  write-auth.test.ts            # write-action auth gate contracts
  shell.tsx                     # WorkbenchShell three-column card layout + resizers
  left-nav.tsx                  # nav, 项目, 未分类, 默认案例, 帮助/设置
  session-context-menu.tsx
  home.tsx                      # welcome chat home (default /workspace)
  skills.tsx                    # /workspace/skills
  docs.tsx                      # /workspace/docs
  resources.tsx                 # /workspace/resources (SSH)
  file-pane.tsx                 # right-panel directory + text/html editor
  right-panel.tsx               # + menu (目录 / 可视化)
  capabilities/
    catalog.ts                  # static resource configs + categories
    catalog.test.ts
    center.tsx                  # Capability Center main view
    center.test.ts
    intro.tsx                   # intro modal overlay
    wizard.tsx                  # 三栏能力向导
    wizard.test.ts
    install.ts                  # install prompt templates + open session
    install.test.ts
    prompt.ts                   # render wizard prompt from scenario + form
    prompt.test.ts
    selection.ts                # parse ?category= / ?domain= from URL
    oneskills-panel.tsx         # oneskills category tab
    oneskills-panel.test.ts
    onemodels/
      materials.ts | weather.ts | fluid.ts | bio.ts | shared.ts
packages/app/scripts/
  generate-onemodels-catalog.py # optional onemodel catalog codegen
```

---

## Phase 1 tasks (complete)

### Task 1: Workspace route helpers + contract tests — DONE

- [x] `routes.ts`, `routes.test.ts`, exports from `app-routes.ts`
- [x] `legacyWorkbenchRedirects` maps all legacy workbench paths (see spec table)
- [x] Added later: `workspaceSkillsHref`, `workspaceDocsHref`, `workspaceResourcesHref`, `caseDomainSessionIds`, `casesQueryValue`

### Task 2: WorkbenchShell skeleton + wire `/workspace` — DONE

- [x] `shell.tsx`, `left-nav.tsx`, `right-panel.tsx`, `capabilities/center.tsx`
- [x] Route tree in `app.tsx` under `/workspace`
- [x] Landing CTAs → `/workspace` in `onescience.tsx`
- [x] CSS: `os-client-*` card shell (not original `wb-*` sketch)

### Task 3: Capability catalog config + center cards — DONE

- [x] `catalog.ts` with MACE, DeePMD, LAMMPS, VASP
- [x] Domain tabs + category tabs + card grid
- [x] Expanded later (Task 11): onemodels per domain, oneskills panel, onedata/oneinfra placeholders

### Task 4: Model intro page — DONE

- [x] `intro.tsx` — modal overlay, 2×2 matrix, scenario shortcuts, footer links
- [x] Routes: `/workspace/capabilities/:id` (wizard route registered before `:id`)

### Task 5: Pending action + login gate helper — DONE

- [x] `pending-action.ts` — types: `install`, `wizard`, `prompt`, `fork`
- [x] `require-auth.ts` — redirect preserves current page URL
- [x] `write-auth.test.ts` — contract tests for all write entrypoints

### Task 6: Install → Session embed + handoff — DONE

- [x] `install.ts` — `startCapabilityInstall`, `buildInstallHandoff`
- [x] `WorkspaceSessionPanel` keepalive sibling in `app.tsx`
- [x] Resume pending install on capability center mount

### Task 7: Capability wizard (三栏) + create task — DONE

- [x] `wizard.tsx`, `prompt.ts`
- [x] Route `/workspace/capabilities/:id/wizard?scenario=`
- [x] `startCapabilityWizardTask` → handoff + navigate

### Task 8: Left nav projects/tasks + hide duplicate chrome — DONE

- [x] 项目 / 未分类 lists from `useGlobalSync`
- [x] Session context menu: archive, move to project, delete
- [x] `Layout embeddedCode routePrefix="/workspace"` hides old `/code` sidebar
- [x] Added later: 默认案例 section, session move API, project rename/remove

### Task 9: Legacy `/code` + workbench redirects — DONE

- [x] All `legacyWorkbenchRedirects` paths wired in `app.tsx`
- [x] `/code/:dir/session/:id?` → workspace equivalents
- [x] `/home` → `/workspace` (not capabilities — see Task 10)

### Task 10: Phase-1 acceptance pass — DONE

- [x] Welcome home default, card chrome, auth gates, redirects verified
- [x] `fix(app): polish unified workbench phase-1 acceptance gaps`

---

## Post–phase-1 tasks (complete on branch)

### Task 11: Welcome chat home — DONE

**Spec addendum:** `docs/superpowers/plans/2026-08-21-workbench-welcome-home.md`

- [x] `home.tsx` — brand hero, login card, `PromptInput` + `SessionEnvironmentBar` when logged in
- [x] `/workspace` index route → home (not redirect to capabilities)
- [x] Left nav「新建会话」active on home path

### Task 12: Card shell polish + resizable columns — DONE

- [x] Pane toggles on canvas, drag resizers, width clamps
- [x] Right panel default closed; no auto-toggle on route change
- [x] Right `+` menu: 目录 / 可视化组件 (not 待办/日志/独立编辑器)

### Task 13: Skills / Docs / Resources pages — DONE

- [x] `/workspace/skills` — `SkillManagerPanel`, `?tab=` URL sync
- [x] `/workspace/docs` — help sections from `docsItems`
- [x] `/workspace/resources` — `SshConfigPanel` page variant
- [x] Left nav links + footer 帮助

### Task 14: Capability catalog expansion — DONE

- [x] `onemodels/{materials,weather,fluid,bio}.ts` — domain model catalogs
- [x] MACE/DeePMD hand-authored; `generate-onemodels-catalog.py` for bulk entries
- [x] `CapabilityOneSkillsPanel` — skill layers, upgrade, develop handoff
- [x] Card/list view toggle + search toolbar
- [x] URL `?category=` + `?domain=` sync via `selection.ts`

### Task 15: Case fork + marketing handoff — DONE

- [x] `caseDomainSessionIds` + `?cases=` query handling in left nav
- [x] `/cases` legacy → `/workspace?cases=1`
- [x] Pending action type `fork` for case session handoff

### Task 16: Right panel file pane — DONE

- [x] `file-pane.tsx` — `FileTree`, text editor with save, HTML preview/source
- [x] Wired from right panel 目录 when session active

---

## Verification

```bash
cd packages/app
bun test --preload ./happydom.ts ./src/workbench ./src/app.routes.test.tsx
bun typecheck
```

## Spec coverage

| Spec section | Tasks |
|--------------|-------|
| Routes + landing CTA | 1, 2, 9 |
| Shell layout + resizers | 2, 12 |
| Welcome home | 11 |
| Auth soft gate + pendingAction | 5, 6, 7 |
| Catalog | 3, 14 |
| Intro page | 4 |
| Install → Session | 6 |
| Wizard | 7 |
| Projects / 未分类 / 默认案例 | 8, 15 |
| Skills / Docs / Resources | 13 |
| Legacy redirects | 1, 9 |
| Right panel directory | 12, 16 |
| Session keepalive embed | 6, 8 |

## Out of plan (still deferred)

- onedata / oneinfra card content
- Left nav conversation search backend
- Full right-panel IDE / standalone viz engine
- New RBAC
- Wizard cluster submit outside Session

## Implementation notes (for future workers)

1. **Session routing:** Main card `<Route path="/:dir/session/:id?" component={() => null} />` is a stub; real session UI renders in `WorkspaceSessionPanel` keepalive sibling. Do not mount Session inside the main ScrollView outlet without updating keepalive guards.

2. **Intro vs wizard route order:** In `app.tsx`, `/:id/wizard` must register **before** `/:id` so intro remains at `/capabilities/:id`.

3. **Pending action redirect:** `requirePersonalSpace` uses the **current page URL** as login redirect (not hardcoded capabilities path), so cancel restores browse context.

4. **Synthetic install ids:** Left-nav `__project__` / `__task__` stash install-type actions for gate purposes only; capability center resume ignores ids starting with `__`.

5. **Onemodel catalog size:** Prefer editing domain files under `onemodels/` or running `generate-onemodels-catalog.py`; keep MACE/DeePMD hand-tuned in `catalog.ts`.

6. **Brand palette:** Red OneScience theme (`style(onescience)`) is separate from workbench shell but ships on the same branch; login favicon/Mark logo aligned.
