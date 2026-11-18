# Workbench Welcome Home Implementation Plan

> **Document status:** Updated 2026-08-28. **Complete** — merged into phase-1 delivery on `feat/frontend-refactor`.

**Goal:** Make `/workspace` open a two-card workbench (left + welcome chat main); Capability Center only via left nav; right card toggle per spec.

**Architecture:** `WorkbenchShell` card chrome unchanged. `workbench/home.tsx` is the default `/workspace` outlet. Right panel stays user-toggled.

**Spec:** `docs/superpowers/specs/2026-08-19-unified-workbench-design.md`

## Global Constraints

- Default: left + main cards only; right closed.
- Right `+` menu (as-built): **目录 / 可视化组件** (not 待办/日志/独立文本编辑器 — see spec 2026-08-21 revision).
- Anonymous may enter `/workspace`; send/create gates stay.

---

## Tasks (complete)

### Task 1: Route + welcome home — DONE

- [x] `/workspace` index → `WorkbenchHomePage` (removed capabilities redirect)
- [x] Brand hero: logo image, title, subtitle
- [x] Logged-out login card; logged-in `SessionEnvironmentBar` + `PromptInput`
- [x] Send/attach gated via `requirePersonalSpace({ type: "prompt" })`
- [x] Left nav: 新建会话 active on `/workspace`; 能力中心 active only on `/workspace/capabilities*`
- [x] `app.routes.test.tsx` contract coverage

### Task 2: Right panel + shell toggle — DONE

- [x] Right panel `+` dropdown: 目录 / 可视化组件
- [x] Empty copy:「尚未打开页面」
- [x] Shell `rightOpen` default `false`; no auto-close on capability paths
- [x] Card chrome: resizable columns, canvas toggles

### Task 3: Verify — DONE

- [x] Workbench + routes tests pass from `packages/app`
- [x] Manual: entry two cards; toggle right; 能力中心 nav; welcome composer

## Deviations from original 2026-08-21 draft

| Original plan | As-built |
|---------------|----------|
| Right menu: 待办 / 日志 / 文本编辑器 / 可视化 | 目录 / 可视化组件 only; text edit via 目录 → file |
| Composer pills「技能 / 基座模型」hardcoded | Uses full `PromptInput` + `SessionEnvironmentBar` |
| Search placeholder in left nav | Not implemented (deferred) |

## Related follow-ups (separate tasks, also complete)

- Case fork via `?cases=` — see main plan Task 15
- Skills/Docs/Resources nav entries — see main plan Task 13
