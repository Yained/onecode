# Unified Workbench Design

> **Document status:** Updated 2026-08-28 to reflect the as-built implementation on `feat/frontend-refactor` (`packages/app/src/workbench/`). Original draft 2026-08-19; welcome-home and card-shell decisions locked 2026-08-21.

## Goal

Replace the fragmented OneScience workbench (`/home` + resource pages) and the separate `/code` development UI with one unified workbench shell, while keeping the marketing homepage at `/`.

Users enter the new workbench from「进入工作台 / 立即体验」. Capability Center absorbs the old workbench catalogs for models and HPC software. Research chat reuses existing Session execution, embedded in the new shell.

## Decisions (locked)

- Full UI unification (not a thin skin on `/code` only).
- Keep marketing `/`; workbench is a separate product surface.
- Approach: new shell + Capability Center; embed existing Session (do not rewrite agent runtime).
- Auth model A: anonymous users may enter the workbench and browse Capability Center; login is required only when an action needs a personal writable space (create project/session, install, upload, send message, create task from wizard).
- Multi-user: keep existing account/platform isolation and admin entry points; fuse entrances into the new shell. No permission-model rewrite in this project.
- **Default entry:** `/workspace` opens the workbench shell with a **welcome chat home** in the main pane (OneScience brand + composer), not Capability Center. Capability Center is reached from the left nav (`/workspace/capabilities`).
- **Right panel:** default **closed**. Only left + center **cards** show on entry. User opens the right **card** via the top-right chrome toggle.
- **Card chrome:** left / main / right are separate rounded shadowed cards on a gray canvas (not flat full-bleed columns). Left/right widths are resizable via drag separators (230–430px left, 200–1280px right).

## Information architecture

```
Public marketing                 Workbench (anonymous browse OK)
─────────────────                ──────────────────────────────
/  landing page          →       /workspace  WorkbenchShell
                                 ├─ Welcome chat home (default main)
                                 ├─ Capability Center (left nav)
                                 ├─ Skills / Docs / Resources (left nav)
                                 ├─ Session chat (keepalive sibling panel)
                                 ├─ Projects / 未分类 / 默认案例 (left)
                                 └─ Right dock (toggle; 目录 / 可视化)
```

### Routes (as-built)

| Path | Role | Auth |
|------|------|------|
| `/` | Marketing homepage (unchanged) | No |
| `/workspace` | Unified shell; default main = welcome chat home | Enter without login |
| `/workspace/capabilities` | Capability Center (`?category=` + optional `?domain=`) | Browse no; write/use gates yes |
| `/workspace/capabilities/:id` | Capability intro (modal overlay in main card) | Browse no |
| `/workspace/capabilities/:id/wizard` | Capability wizard (`?scenario=` optional) | Create-task yes |
| `/workspace/skills` | Skills manager (`?tab=list\|repo\|upload`) | Tab browse; develop/upgrade gated |
| `/workspace/docs` | Help docs (`#manual\|plugins\|release`) | No |
| `/workspace/resources` | SSH / resource configuration page | Browse; SSH write gated |
| `/workspace/:dir/session/:id?` | Session (`dir` = base64 workspace path) | Create/send yes |
| `/login`, `/register`, `/forgot-password` | Account flows | — |
| `/account` | Account center | Yes |

**Route helpers:** `packages/app/src/workbench/routes.ts` — `workspaceSessionHref`, `workspaceCapabilitiesCategoryHref`, `legacyWorkbenchRedirects`, `caseDomainSessionIds`, `casesQueryValue`.

**Legacy redirects** (`legacyWorkbenchRedirects`):

| Legacy | Target |
|--------|--------|
| `/home`, `/tasks`, `/data-management`, `/apphub`, `/research` | `/workspace` |
| `/models` | `/workspace/capabilities?category=onemodel` |
| `/apps` | `/workspace/capabilities?category=hpc` |
| `/datasets` | `/workspace/capabilities?category=onedata` |
| `/skills`, `/primitives` | `/workspace/capabilities?category=oneskills` |
| `/infra`, `/frameworks`, `/operators` | `/workspace/capabilities?category=oneinfra` |
| `/cases` | `/workspace?cases=1` (expand 默认案例) |
| `/docs` | `/workspace/docs` |
| `/code/:dir/session/:id?` | `/workspace/:dir/session/:id?` |

Landing CTAs that pointed at `/home` now point at `/workspace`. `/code` entry route remains for compatibility but session URLs redirect into `/workspace`.

## Shell layout

### Visual chrome (card shell)

Workbench uses class prefix `os-client-workbench` on a **light gray canvas**. Left / main / right are **separate rounded cards** (white, soft shadow, gap between cards).

| Region | Implementation |
|--------|----------------|
| Page | Gray canvas; **top-right chrome toggles** float on canvas (outside cards) |
| Left | `WorkbenchLeftNav` — brand, nav links, project/session lists, footer |
| Main | `ScrollView.wb-main-inner` — welcome / capabilities / skills / docs / resources outlets |
| Right | `WorkbenchRightPanel` — only mounted when user toggles right panel open |

Top-right chrome: **left-panel toggle** + **right-panel toggle**. Default entry = **two cards only** (left + main). Column widths stored in CSS vars `--os-client-sidebar-w` / `--os-client-tool-w`.

### Default on entry (right closed)

```
  canvas gray                          [left ▯] [right ▯]
┌─ Left card ────────┬─ Main card ──────────────────────────┐
│ Brand + nav        │ Welcome brand + composer (logged in) │
│ 新建会话           │ or login CTA (logged out)            │
│ 能力中心 / skills  │                                      │
│ 资源配置           │                                      │
│ 项目 / 未分类      │                                      │
│ 默认案例 (toggle)  │                                      │
│ 帮助 / 设置        │                                      │
└────────────────────┴──────────────────────────────────────┘
```

### Session embed (parallel to main card)

Session does **not** replace the main card route outlet. Instead, `WorkspaceSessionPanel` in `app.tsx` mounts a **keepalive sibling** (`os-code-keepalive`) when pathname matches `/workspace/:dir/session/*`. Main card can show welcome/capabilities while session panel renders the chat UI via `Layout embeddedCode routePrefix="/workspace"`.

Leaving a session route clears capability prefill and new-session intent for that directory.

### Left nav (as-built)

**Brand row:** Web → marketing `/` + label「OneScience」; Desktop → `/workspace` + label「OneCode」.

**Primary nav (icons + labels):**

| Link | Path | Active when |
|------|------|-------------|
| 新建会话 | `/workspace` | `isWorkspaceHomePath` |
| 能力中心 | `/workspace/capabilities` | pathname starts with `/workspace/capabilities` |
| skills设置 | `/workspace/skills` | pathname starts with `/workspace/skills` |
| 资源配置 | `/workspace/resources` | pathname starts with `/workspace/resources` |

**项目** section:

- Header `+` only → `requirePersonalSpace` → open/create project (native or dialog picker).
- Lists **user-created projects only** (hides auto-created `default`).
- Logged-out:「登录后同步个人空间」.
- Each project row: name link → `workspaceSessionHref(worktree)`; `…` menu → **新建会话**, **重命名**, **从视图移除**.
- Expanding active project shows nested session rows with context menu (归档 / 移动到项目 / 删除).

**未分类** section (formerly spec「最近」):

- Sessions stored under auto-created `default` project only.
- Default show **4** rows; **展开更多** / **收起**.
- `+` → new session in `default` (login gated).
- Context menu: archive, move to project, delete.

**默认案例** section (shared cases root):

- Collapsible; preset case sessions from shared directory.
- Default show 4; expand/collapse.
- `?cases=<sessionId>` on `/workspace` auto-expands and navigates to that session.
- Marketing domain CTAs use `caseDomainSessionIds` (earth / material / life / fluid).

**Footer:**

| Link | Action |
|------|--------|
| 帮助 | `/workspace/docs` |
| 设置 | Opens `DialogSettings` tab `account` |

No top search field (removed from phase-1 placeholder).

### Main area

#### `/workspace` — Welcome chat home (`workbench/home.tsx`)

- Centered OneScience logo + title「全流程科研模型生成平台」+ subtitle.
- **Logged out:** login card with CTA → `/login?redirect=/workspace`.
- **Logged in:** `SessionEnvironmentBar` + `PromptInput` in `os-client-welcome-prompt`; attach/send clicks gated via `requirePersonalSpace` with `{ type: "prompt" }`.
- On mount: `consumePendingAction()` type `prompt` focuses composer.

#### `/workspace/capabilities` — Capability Center (`capabilities/center.tsx`)

- Domain tabs: **全部 / 材料 / 气象 / 流体 / 生信** (hidden for oneskills / oneinfra categories).
- Category tabs: **onemodel / HPC 软件 / onedata / oneinfra / oneskills**.
- URL sync: `?category=` + `?domain=` preserved for login cancel restore.
- Card **grid / list** toggle (persisted in `localStorage` key `os-capability-view-mode`).
- Search input when category has ≥ 6 items.
- Card actions: **详情** / **安装** / **使用** (primary).

#### Intro + Wizard (nested routes)

- `/workspace/capabilities/:id` → `CapabilityIntroPage` (modal overlay, backdrop blur).
- `/workspace/capabilities/:id/wizard` → `CapabilityWizardPage`.

#### `/workspace/skills` — Skills page (`workbench/skills.tsx`)

- Embeds `SkillManagerPanel` with tabs list / repo / upload (`?tab=` in URL).
- Login required for develop/upgrade flows.

#### `/workspace/docs` — Help (`workbench/docs.tsx`)

- Sections: 用户手册 / 插件与镜像 / 发版记录 (`#hash`).
- Reuses `docsItems` from marketing docs data.

#### `/workspace/resources` — Resources (`workbench/resources.tsx`)

- SSH configuration via `SshConfigPanel variant="page"`.

### Right panel (as-built)

- **Default closed.** Toggle only via top-right button; does not auto-open on route change.
- **`+` menu** (implemented):

  | Menu item | Role |
  |-----------|------|
  | **目录** | File tree for active session directory (`WorkbenchDirectoryPane` + `FileTree`). No session → stub message. Click text file → inline editor with save; HTML → preview/source toggle via ticketed preview URL. |
  | **可视化组件** | Stub; guidance to open `.html` from 目录 |

- Removed from menu (per original 2026-08-21 revision): **待办**, standalone **文本编辑器** (editing only via 目录 → file).
- Empty state:「尚未打开页面」+ guidance copy.

## Auth and personal space

Rule:

> Read-only browsing of Capability Center does not require login. Any action that writes into a personal workspace or consumes isolated user resources requires login.

| Allowed anonymously | Requires login |
|---------------------|----------------|
| Enter `/workspace`, browse capabilities, open intros, read docs | Install, wizard create-task, new project/session, prompt send/attach, skills develop/upgrade, SSH save |

**Pending action resume** (`workbench/pending-action.ts`, key `onescience.workbench.pending-action.v1`):

```ts
type PendingAction =
  | { type: "install"; resourceId: string }
  | { type: "wizard"; resourceId: string; scenarioId: string; values: Record<string, string>; prompt: string }
  | { type: "prompt"; prompt: string }
  | { type: "fork"; sessionId: string }
```

`requirePersonalSpace` (`workbench/require-auth.ts`) stashes action and navigates to `/login?redirect=<current page>`. After login, capability center `onMount` or home page consumes and resumes.

Synthetic resource ids `__project__` / `__task__` used for left-nav gates; not treated as capability installs.

**Personal `default` project:** Registration auto-creates `…/workspaces/<account>/default`. Hidden from「项目」. Welcome send, install/wizard without chosen project, and「未分类」sessions live there.

## Capability Center (as-built)

### Catalog structure

Static config in `workbench/capabilities/catalog.ts` + domain splits in `onemodels/{materials,weather,fluid,bio}.ts`. MACE and DeePMD are hand-authored; additional onemodel entries generated/curated per domain. Optional codegen: `packages/app/scripts/generate-onemodels-catalog.py`.

| Category | Status | Content |
|----------|--------|---------|
| **onemodel** | Active | MACE, DeePMD + domain models (materials / weather / fluid / bio) |
| **hpc** | Active | LAMMPS, VASP (domain-filtered) |
| **oneskills** | Active | `CapabilityOneSkillsPanel` — catalog skills by layer, upgrade, develop handoff |
| **onedata** | Placeholder | Tab visible; empty state「即将上线」 |
| **oneinfra** | Placeholder | Tab visible; empty state「即将上线」 |

Domain filter applies to onemodel and hpc; oneskills and oneinfra are domain-independent.

### Per-resource config shape

Each `CapabilityResource` includes:

- `id`, `name`, `category`, `domain`, `tags`, `blurb`, `docsHref` (Gitee tree path)
- `intro` — suited / notFor / prepare / obtain / steps
- `install.banner` + `install.prompt` — environment setup handoff
- `scenarios[]` — wizard scenarios with fields, capabilitySummary, promptTemplate (`{{fieldId}}` placeholders)

### Card actions

| Action | Result |
|--------|--------|
| **详情** | `/workspace/capabilities/:id` intro modal |
| **安装** | `startCapabilityInstall` → handoff prompt → `workspaceSessionHref` |
| **使用** | `/workspace/capabilities/:id/wizard` |

### Intro page (as-built)

- Full-screen modal overlay with blurred backdrop; close via backdrop or ×.
- Header: intro title (default「30 秒看懂模型」) + name + subtitle.
- 2×2 matrix: 适合解决 / 不建议直接用在 / 需要准备什么 / 可以得到什么 (chip styling).
- Recommended flow steps (numbered list).
- Shortcut scenario cards → wizard with `?scenario=`.
- Footer: **深入资料** (external `docsHref`) + **进入能力向导** (primary).
- No「添加待办」button.

### Install → Session

Does not go through wizard. Flow (`capabilities/install.ts`):

1. `requirePersonalSpace({ type: "install", resourceId })`
2. Resolve directory via `codeEntryWorkspaceDirectory` / `defaultPlatformProjectDirectory`
3. `pushSessionHandoffDraft` + `markCodeNewSessionIntent`
4. Toast with `install.banner`
5. Navigate to `workspaceSessionHref(directory)`

### Capability wizard (三栏)

Route: `/workspace/capabilities/:id/wizard`.

```
← {模型|软件}介绍     使用 {name} 开始科研任务     ✕

┌ 你想做什么？ ┬ 补充信息 ──────────┬ 起始任务 (prompt) ─┐
│ Scenario     │ User fields         │ Expected outputs   │
│ cards        │ Read-only capability│ Editable prompt    │
│              │ config summary      │ [重新生成][创建任务]│
└──────────────┴─────────────────────┴────────────────────┘
```

「创建任务」→ `startCapabilityWizardTask` → same handoff path as install. Cluster submit stays inside Session tools.

### Prompt rendering

`capabilities/prompt.ts` — `renderCapabilityPrompt(template, values)` replaces `{{fieldId}}` placeholders.

## Session embedding

```
WorkbenchShellRoute (app.tsx)
  ├─ WorkbenchShell
  │    ├─ WorkbenchLeftNav
  │    ├─ Main outlet (home | capabilities | skills | docs | resources)
  │    └─ WorkbenchRightPanel (when toggled)
  └─ WorkspaceSessionPanel (sibling keepalive when /workspace/:dir/session/*)
       └─ Layout embeddedCode routePrefix="/workspace"
            └─ DirectoryLayout prefix="/workspace"
                 └─ SessionRoute
```

Impacts:

1. Project/session tree duties live in `workbench/left-nav.tsx` for `/workspace`.
2. `Session` message timeline + composer unchanged; no SDK/tool pipeline rewrite.
3. Install/wizard use `pushSessionHandoffDraft` + `markCodeNewSessionIntent`.
4. `touchCode` guards preserved for workspace directories; shared catalog dirs excluded.

## Multi-user fusion

In scope (implemented):

- Platform auth, personal workspace isolation, account center, admin settings reachable via **设置**.
- Write gates on all personal-space mutations (see `write-auth.test.ts` contract list).

Out of scope:

- New RBAC / team permission model.
- Registration audit / invite flow redesign.

## File / package map (as-built)

```
packages/app/src/workbench/
  routes.ts                     # href helpers, legacy redirects, case domain ids
  routes.test.ts
  pending-action.ts             # sessionStorage resume
  pending-action.test.ts
  require-auth.ts               # requirePersonalSpace
  write-auth.test.ts            # auth gate contracts
  shell.tsx                     # three-column card shell + resizers
  left-nav.tsx                  # nav, projects, 未分类, 默认案例
  session-context-menu.tsx      # archive / move / delete menus
  home.tsx                      # welcome chat home
  skills.tsx                    # skills manager page
  docs.tsx                      # help docs page
  resources.tsx                 # SSH resources page
  file-pane.tsx                 # right-panel directory + editor
  right-panel.tsx               # + menu, pane stubs
  capabilities/
    catalog.ts                  # resource definitions + categories
    catalog.test.ts
    center.tsx                  # capability center UI
    center.test.ts
    intro.tsx                   # intro modal
    wizard.tsx                  #三栏向导 + startCapabilityWizardTask
    wizard.test.ts
    install.ts                  # install handoff
    install.test.ts
    prompt.ts                   # template renderer
    prompt.test.ts
    selection.ts                # URL category/domain parsing
    oneskills-panel.tsx         # oneskills tab content
    oneskills-panel.test.ts
    onemodels/
      materials.ts | weather.ts | fluid.ts | bio.ts | shared.ts
```

Also modified: `app.tsx` (route tree, `WorkspaceSessionPanel`, legacy redirects), `app-routes.ts`, `index.css` (`os-client-*` workbench styles), `app.routes.test.tsx`.

Prefer not to grow `onescience.tsx`; new UI lives under `workbench/`.

## Acceptance criteria (phase 1) — status

| Criterion | Status |
|-----------|--------|
| `/` marketing unchanged; CTAs → `/workspace` | Done |
| `/workspace` default = welcome home, two cards, right closed | Done |
| Card visual treatment (rounded, gap, shadow) | Done |
| Right `+` menu: 目录 / 可视化组件; empty state copy | Done |
| Left nav opens capabilities/skills/resources/docs | Done |
| Anonymous browse capabilities + intros | Done |
| Install / create-task / new project → login → resume | Done |
| Install opens Session with environment prompt | Done |
| Wizard three columns; create-task → Session + handoff | Done |
| Legacy `/home`, `/code/...` redirect | Done |
| Left nav project + 未分类 lists wired | Done |
| Session keepalive without blanking main pane | Done |

## Out of scope / deferred

- **onedata / oneinfra** card content (tabs exist, placeholder only)
- Full right-panel IDE / rich viz hosting
- Rewriting model/tool backend
- New multi-user permission system
- Wizard cluster submit outside Session
- Left nav conversation search backend

## Risks (updated)

| Risk | Mitigation (as-built) |
|------|------------------------|
| Tight `Layout`/`Session` coupling | `embeddedCode` + `routePrefix="/workspace"`; keepalive sibling panel |
| Keepalive / blank pane regressions | Session panel isolated from main outlet; acceptance tests in `app.routes.test.tsx` |
| Forced-login deployments vs anon browse | Write paths always gate; deploy overlay still valid |
| Mega-file churn in `onescience.tsx` | `workbench/` module boundary |
| Large onemodel catalog maintenance | Domain split files + optional Python codegen script |
