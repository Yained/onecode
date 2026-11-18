# OneScience Task Capability System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 固化 OneScience 的 Resource → Primitive → Capability → Task Profile → Execution Skill 体系，并基于现有资源、原语和 OneSkills 内容逐步升级产品结构。

**Architecture:** 采用兼容式分层演进：现有 Resource、AI Primitive 和底层 OneSkills 继续保留；新增 Capability 与 Task Profile 作为上层语义组织层。界面从“资源/原语/skill 列表”逐步升级为“科研任务工作台”，底层仍通过 `onescience-workflow`、`onescience-role`、`onescience-skill`、`onescience-resources`、`onescience-coder`、`onescience-runtime`、`onescience-installer` 执行。

**Tech Stack:** Bun, TypeScript, SolidJS, Effect Schema, Drizzle SQLite, current `/experimental/onescience/*` API patterns, package-local `bun test` and `bun typecheck`.

---

## 0. Target Taxonomy

### Resource

资源层表示 OneScience / OneHub 中可追溯的素材来源。

Required resource categories:

- `dataset`
- `model`
- `app`
- `framework`
- `paper`
- `code`
- `checkpoint`
- `benchmark`
- `document`
- `case`

### Primitive

原语层表示可被任务组合的最小能力单元。

Required primitive types:

- `component`：组件原语
- `dataset`：数据集原语
- `data.process`：数据处理原语
- `model.architecture`：模型结构原语
- `model.train`：模型训练原语
- `model.infer`：模型推理原语
- `app.run`：应用原语
- `benchmark`：Benchmark 原语
- `profile`：性能分析原语
- `adapter`：模型 / 数据 / 硬件适配原语
- `report`：报告归档原语
- `workflow.compose`：工作流编排原语

Compatibility mapping from current primitive types:

| Current | Target |
|---|---|
| `data.load` | `dataset` |
| `data.transform` | `data.process` |
| `model.run` | `model.infer` |
| `model.train` | `model.train` |
| `model.evaluate` | `benchmark` |
| `app.launch` | `app.run` |
| `operator.apply` | `component` |
| `workflow.compose` | `workflow.compose` |
| `code.generate` | internal coder action |
| `runtime.submit` | internal runtime action |

### Capability

能力层表示跨任务复用的科研能力族。

Required capability families:

- `resource.discovery`：资源理解与检索
- `data.building`：数据与样本构建
- `model.building`：模型构建与适配
- `training`：训练与调参
- `inference.evaluation`：推理、评估与 Benchmark
- `performance.optimization`：性能优化与工程化
- `runtime.deployment`：运行环境与部署
- `report.reproducibility`：科研报告与复现归档

### Task Profile

任务画像层表示用户看到的科研任务入口。

Initial task profiles:

- `model-development`：开发模型
- `dataset-building`：构建数据集
- `model-training`：训练模型
- `model-inference-testing`：推理测试
- `research-workflow-building`：构建科研工作流
- `paper-reproduction`：论文复现
- `performance-optimization`：性能优化
- `model-adaptation`：模型适配

Reserved future task profiles:

- `benchmark-comparison`
- `model-release`
- `dataset-release`
- `experiment-reporting`

### Execution Skill

底层执行技能继续复用现有 OneSkills。

Public execution skills:

- `onescience-workflow`
- `onescience-role`
- `onescience-skill`
- `onescience-resources`
- `onescience-coder`
- `onescience-runtime`
- `onescience-installer`

Internal phases, not public task cards:

- hardware discovery → `onescience-runtime.discover` / `onescience-installer.precheck`
- debugging → `onescience-runtime.diagnose` / `onescience-installer.verify`

---

## 1. Development Principles

- [ ] Keep current execution skills stable. Do not rename or remove existing low-level skill IDs during the first migration.
- [ ] Add Task Profile and Capability as a semantic layer above current resources and primitives.
- [ ] Use metadata first, schema changes second. Prefer `contractJson.taskProfiles`, `contractJson.capabilityFamilies`, and `contractJson.targetPrimitiveType` before adding new tables.
- [ ] Make the UI task-first, not execution-skill-first.
- [ ] Preserve existing `/experimental/onescience/skill`, `/experimental/onescience/primitive`, and `/experimental/onescience/resource` behavior.
- [ ] Add new API views instead of replacing old API contracts.
- [ ] Keep `onescience-coder`, `onescience-runtime`, and `onescience-installer` as execution engines, not user-facing task categories.
- [ ] Every phase must be independently shippable and testable.

---

## 2. Implementation Phases

## Phase 1: Taxonomy Foundation

**Purpose:** Add a typed taxonomy source of truth without changing current UI or execution behavior.

**Files:**

- Create: `packages/opencode/src/onescience/taxonomy.ts`
- Test: `packages/opencode/test/onescience/taxonomy.test.ts`
- Optional mirror for UI constants later: `packages/app/src/pages/onescience-taxonomy.ts`

**Deliverables:**

- Capability family definitions.
- Task profile definitions.
- Primitive type compatibility mapping.
- Execution skill mapping.

**Acceptance criteria:**

- `model-development` requires `component`, `dataset`, `model.architecture`, and `adapter` primitives.
- `paper-reproduction` includes `resource.discovery`, `data.building`, `model.building`, `training`, `inference.evaluation`, and `report.reproducibility`.
- `performance-optimization` includes `profile` and `benchmark` primitive types.
- Legacy primitive type mapping remains deterministic.

**Test command:**

```bash
cd packages/opencode
bun test test/onescience/taxonomy.test.ts
```

---

## Phase 2: Primitive Metadata Compatibility

**Purpose:** Let current primitives participate in the new taxonomy without forcing a database migration.

**Files:**

- Modify: `packages/opencode/src/onescience/primitive.ts`
- Modify: `packages/opencode/src/onescience/primitive-migration.ts`
- Test: `packages/opencode/test/onescience/primitive.test.ts`

**Implementation rules:**

- Keep existing `primitiveType` accepted values for backward compatibility.
- Derive target primitive type from current `primitiveType` plus `contractJson.primitiveCategory` when available.
- Add normalized metadata to returned primitive objects:
  - `targetPrimitiveType`
  - `capabilityFamilies`
  - `taskProfiles`
  - `executionSkills`
- Do not break existing primitive list and create APIs.

**Acceptance criteria:**

- Existing `model.run` primitives appear as target `model.infer`.
- Existing `data.load` primitives appear as target `dataset`.
- Existing `app.launch` primitives appear as target `app.run`.
- `boundSkills` continues to work for existing skill binding.

**Test command:**

```bash
cd packages/opencode
bun test test/onescience/primitive.test.ts
```

---

## Phase 3: Task Profile API View

**Purpose:** Expose task-first data for the UI while preserving old skill API behavior.

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts`
- Create or modify: `packages/opencode/test/onescience/task-profile.test.ts`

**API options:**

Preferred new endpoint:

```text
GET /experimental/onescience/task-profile
```

Fallback if routing churn should stay minimal:

```text
GET /experimental/onescience/skill?view=task
```

**Response shape:**

```ts
{
  items: Array<{
    id: string
    title: string
    description: string
    category: string
    capabilityFamilies: string[]
    requiredPrimitiveTypes: string[]
    optionalPrimitiveTypes: string[]
    executionSkills: string[]
    primitiveCount: number
    resourceCount: number
    expectedArtifacts: string[]
    maturity: "draft" | "beta" | "stable"
  }>
}
```

**Acceptance criteria:**

- Task profile API returns the eight initial task profiles.
- Task profile API counts related primitives when primitive metadata exists.
- Old skill API response remains unchanged.

**Test command:**

```bash
cd packages/opencode
bun test test/onescience/task-profile.test.ts
```

---

## Phase 4: UI Information Architecture

**Purpose:** Shift the user-facing entry point from skill list to task-first scientific workbench.

**Files:**

- Modify: `packages/app/src/pages/onescience.tsx`
- Modify: `packages/app/src/pages/onescience-skills.test.ts`
- Modify: `packages/app/src/pages/layout/sidebar-items.tsx` if navigation changes are included
- Modify: `packages/app/src/index.css`

**Navigation target structure:**

```text
OneScience
├─ 工作台
├─ 科研任务
├─ 原语库
├─ 资源库
├─ 运行记录
├─ 报告归档
└─ OneSkills
```

**First UI milestone:**

Keep current routes if route churn is risky, but reorganize content:

- `/skills` becomes “OneSkills 编排体系”.
- Add task profile cards at the top.
- Move low-level execution skills to a “执行技能层” section.
- Primitive cards should be shown by task relevance, not only by bound skill.

**Task card required fields:**

- title
- description
- capability chain
- required primitive types
- optional primitive types
- execution skills
- expected artifacts
- related primitive count
- related resource count

**Acceptance criteria:**

- Users can see the eight task profiles.
- `onescience-coder`, `onescience-runtime`, and `onescience-installer` are shown as execution engines, not primary task cards.
- Existing resource, primitive, and skill links still work.

**Test command:**

```bash
cd packages/app
bun test src/pages/onescience-skills.test.ts
```

---

## Phase 5: Task Creation Flow

**Purpose:** Add a unified task intake flow that turns a user goal into resources, primitives, capability chain, and execution handoff.

**Files:**

- Create: `packages/app/src/components/onescience/TaskCreateDialog.tsx`
- Modify: `packages/app/src/pages/onescience.tsx`
- Create or modify: `packages/app/src/pages/onescience-task-flow.test.ts`

**Flow:**

1. User selects a Task Profile.
2. User enters natural-language goal.
3. User optionally selects resources.
4. System recommends primitive types and candidate primitives.
5. System renders a draft execution plan:
   - task profile
   - capability chain
   - primitive bundle
   - execution skills
   - expected artifacts
   - missing requirements
6. User starts a session or sends the handoff to code/runtime.

**Acceptance criteria:**

- Task intake can start from any initial task profile.
- The generated handoff references Task Profile, Capability, Primitive, Resource, and Execution Skill explicitly.
- The flow can continue even when no primitive is selected yet by marking missing requirements.

---

## Phase 6: Report and Run Alignment

**Purpose:** Prepare for paper reproduction, performance optimization, and model adaptation by making runs and reports first-class UI concepts.

**Files:**

- Existing data project files can be reused:
  - `packages/opencode/src/onescience/data-project.ts`
  - `packages/opencode/src/onescience/data-project.sql.ts`
- New files should only be added after confirming current data-project model cannot represent run/report artifacts.

**Required artifact categories:**

- `dataset_manifest`
- `model_config`
- `training_config`
- `checkpoint`
- `inference_result`
- `benchmark_report`
- `profile_report`
- `reproduction_report`
- `optimization_report`
- `adapter_report`

**Acceptance criteria:**

- Paper reproduction can produce a `reproduction_report` artifact.
- Performance optimization can produce `profile_report` and `optimization_report` artifacts.
- Model adaptation can produce `adapter_report` and inference validation artifacts.

---

## 3. Task Profile Definitions

### `model-development`

**Title:** 开发模型

**Purpose:** 构建或改造科学模型。

**Capabilities:**

- `resource.discovery`
- `data.building`
- `model.building`
- `inference.evaluation`

**Required primitives:**

- `component`
- `dataset`
- `model.architecture`
- `adapter`

**Optional primitives:**

- `model.infer`
- `benchmark`
- `profile`
- `report`

**Execution skills:**

- `onescience-resources`
- `onescience-coder`
- `onescience-runtime`

**Expected artifacts:**

- `model_source`
- `model_config`
- `adapter_spec`
- `inference_smoke_test`

### `dataset-building`

**Title:** 构建数据集

**Purpose:** 将原始数据、仿真结果或实验数据转成 AI-ready 数据集。

**Capabilities:**

- `resource.discovery`
- `data.building`
- `report.reproducibility`

**Required primitives:**

- `dataset`
- `data.process`

**Optional primitives:**

- `app.run`
- `benchmark`
- `report`

**Execution skills:**

- `onescience-resources`
- `onescience-coder`
- `onescience-runtime`

**Expected artifacts:**

- `dataset_manifest`
- `data_quality_report`
- `dataset_adapter`

### `model-training`

**Title:** 训练模型

**Purpose:** 训练、微调或复现实验训练过程。

**Capabilities:**

- `resource.discovery`
- `training`
- `runtime.deployment`
- `report.reproducibility`

**Required primitives:**

- `model.train`
- `dataset`
- `model.architecture`

**Optional primitives:**

- `benchmark`
- `profile`
- `report`

**Execution skills:**

- `onescience-coder`
- `onescience-runtime`
- `onescience-installer`

**Expected artifacts:**

- `training_config`
- `training_log`
- `checkpoint`
- `metric_report`

### `model-inference-testing`

**Title:** 推理测试

**Purpose:** 对已有模型进行预测、仿真、评估或 Benchmark。

**Capabilities:**

- `inference.evaluation`
- `runtime.deployment`
- `report.reproducibility`

**Required primitives:**

- `model.infer`
- `benchmark`

**Optional primitives:**

- `dataset`
- `app.run`
- `profile`
- `report`

**Execution skills:**

- `onescience-runtime`
- `onescience-coder`

**Expected artifacts:**

- `inference_result`
- `benchmark_report`
- `validation_summary`

### `research-workflow-building`

**Title:** 构建科研工作流

**Purpose:** 组合应用、模型推理、数据处理和报告，形成端到端科研流程。

**Capabilities:**

- `resource.discovery`
- `data.building`
- `inference.evaluation`
- `runtime.deployment`
- `report.reproducibility`

**Required primitives:**

- `app.run`
- `model.infer`
- `workflow.compose`

**Optional primitives:**

- `data.process`
- `dataset`
- `benchmark`
- `report`

**Execution skills:**

- `onescience-workflow`
- `onescience-role`
- `onescience-skill`
- `onescience-runtime`

**Expected artifacts:**

- `workflow_spec`
- `execution_plan`
- `workflow_run_report`

### `paper-reproduction`

**Title:** 论文复现

**Purpose:** 从论文、代码、数据和指标出发复现实验结果。

**Capabilities:**

- `resource.discovery`
- `data.building`
- `model.building`
- `training`
- `inference.evaluation`
- `report.reproducibility`

**Required primitives:**

- `dataset`
- `model.architecture`
- `model.train`
- `model.infer`
- `benchmark`
- `report`

**Optional primitives:**

- `app.run`
- `adapter`
- `profile`

**Execution skills:**

- `onescience-workflow`
- `onescience-resources`
- `onescience-coder`
- `onescience-runtime`

**Expected artifacts:**

- `reproduction_plan`
- `dataset_manifest`
- `training_config`
- `checkpoint`
- `benchmark_report`
- `reproduction_report`

### `performance-optimization`

**Title:** 性能优化

**Purpose:** 优化训练、推理或应用运行性能。

**Capabilities:**

- `inference.evaluation`
- `performance.optimization`
- `runtime.deployment`
- `report.reproducibility`

**Required primitives:**

- `profile`
- `benchmark`

**Optional primitives:**

- `model.infer`
- `model.train`
- `component`
- `adapter`
- `report`

**Execution skills:**

- `onescience-runtime`
- `onescience-coder`
- `onescience-runtime`

**Expected artifacts:**

- `baseline_benchmark_report`
- `profile_report`
- `optimization_patch`
- `optimized_benchmark_report`

### `model-adaptation`

**Title:** 模型适配

**Purpose:** 将已有模型适配到新数据、新任务、新框架或新硬件。

**Capabilities:**

- `model.building`
- `data.building`
- `inference.evaluation`
- `runtime.deployment`

**Required primitives:**

- `adapter`
- `model.architecture`
- `component`

**Optional primitives:**

- `dataset`
- `model.infer`
- `model.train`
- `benchmark`

**Execution skills:**

- `onescience-coder`
- `onescience-runtime`

**Expected artifacts:**

- `adapter_spec`
- `adapted_model_source`
- `inference_validation_report`

---

## 4. Recommended Execution Order

1. Implement taxonomy source of truth and tests.
2. Normalize primitive metadata in API responses.
3. Add task profile API view.
4. Update Skills page into task/capability/execution layered view.
5. Add task intake flow.
6. Add run/report artifact alignment.
7. Add thin task skill documents only after the task profile layer is stable.

---

## 5. Validation Commands

Backend focused tests:

```bash
cd packages/opencode
bun test test/onescience/taxonomy.test.ts
bun test test/onescience/primitive.test.ts
bun test test/onescience/skill.test.ts
```

Frontend focused tests:

```bash
cd packages/app
bun test src/pages/onescience-skills.test.ts
```

Type checks:

```bash
cd packages/opencode
bun typecheck
```

```bash
cd packages/app
bun typecheck
```

---

## 6. Migration Guardrails

- Do not delete existing skill IDs in the first release.
- Do not require all primitives to have full taxonomy metadata before showing task profiles.
- Do not block existing resource pages on task profile API readiness.
- Do not expose hardware/debug as primary task cards.
- Do not add many new `SKILL.md` files until UI/API taxonomy proves stable.
- Do not convert `runtime.submit` or `code.generate` into user-facing primitive cards; keep them as internal execution actions.

---

## 7. Product Milestones

### Milestone A: Taxonomy Visible Internally

- Backend has typed taxonomy definitions.
- Tests verify mappings and task profiles.
- No visible UI behavior changes.

### Milestone B: Task Profiles Visible in UI

- `/skills` shows task profiles first.
- Execution skills are shown as system layer.
- Primitive counts appear by task.

### Milestone C: Task-Driven Workbench

- Users can start from a task profile.
- Task creation flow recommends primitive types and resources.
- Handoff can start a coding or runtime session.

### Milestone D: Future Capabilities Enabled

- Paper reproduction can generate a reproduction plan.
- Performance optimization can generate baseline/profile/optimized reports.
- Model adaptation can generate adapter specs and validation reports.

---

## 8. Open Design Decisions

These should be decided before implementation starts:

1. Use new endpoint `/experimental/onescience/task-profile` or query view `/experimental/onescience/skill?view=task`.
2. Store taxonomy only in code first, or seed it into SQLite.
3. Show task profiles under existing `/skills`, or introduce a new `/tasks` route.
4. Keep primitive type compatibility as response-only metadata, or migrate stored primitive records.
5. Whether reports should reuse current data-project artifact tables or get dedicated report tables.
