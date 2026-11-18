# Data Management AI Ready Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the方案 B Data Management workflow that records raw data intake, lets agents generate AI Ready datasets, and publishes AI Ready outputs to model training or OneHub.

**Architecture:** Add focused OneScience data workflow tables and service APIs while reusing `onescience_resource` for published OneHub dataset entries. Replace the static Data Management page with a project list/detail workflow UI that calls the new experimental API surface.

**Tech Stack:** Bun, TypeScript, SolidJS, Effect Schema, Drizzle SQLite, existing `/experimental/onescience/*` API patterns, package-local `bun test` and `bun typecheck`.

---

## File Map

- Create `packages/opencode/src/onescience/data-project.sql.ts`: Drizzle tables for projects, runs, artifacts, reports, releases.
- Create `packages/opencode/src/onescience/data-project.ts`: schema types and CRUD/workflow service functions.
- Modify `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts`: API schemas and route definitions.
- Modify experimental route handler file that currently handles resource/primitive endpoints: wire data project route handlers beside resource handlers.
- Create `packages/opencode/test/onescience/data-project.test.ts`: service-level tests for workflow state and OneHub publish.
- Modify `packages/app/src/pages/onescience.tsx`: replace static `DataManagementPage` with API-backed workflow UI and intake dialog.
- Modify `packages/app/src/app.routes.test.tsx`: assert Data Management page source contains the new workflow concepts.
- Modify `packages/app/src/pages/onescience-skills.test.ts`: add API helper/source tests if data helper functions are placed near resource helpers.
- Modify `packages/app/src/index.css`: style project list, workflow timeline, agent panel, artifact cards, release actions.

---

### Task 1: Backend Data Workflow Schema

**Files:**
- Create: `packages/opencode/src/onescience/data-project.sql.ts`
- Test: `packages/opencode/test/onescience/data-project.test.ts`

- [ ] **Step 1: Write failing schema export test**

Add a test that imports the future tables and verifies snake_case columns exist.

```ts
import { describe, expect, test } from "bun:test"
import {
  OneScienceDataProjectTable,
  OneScienceDataAgentRunTable,
  OneScienceDataArtifactTable,
  OneScienceDataQualityReportTable,
  OneScienceDataReleaseTable,
} from "@/onescience/data-project.sql"

describe("OneScience data project schema", () => {
  test("defines AI Ready data workflow tables", () => {
    expect(OneScienceDataProjectTable.id.name).toBe("id")
    expect(OneScienceDataProjectTable.raw_data_uri.name).toBe("raw_data_uri")
    expect(OneScienceDataProjectTable.target_dataset_goal.name).toBe("target_dataset_goal")
    expect(OneScienceDataAgentRunTable.project_id.name).toBe("project_id")
    expect(OneScienceDataArtifactTable.artifact_type.name).toBe("artifact_type")
    expect(OneScienceDataQualityReportTable.train_ready_score.name).toBe("train_ready_score")
    expect(OneScienceDataReleaseTable.resource_id.name).toBe("resource_id")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/opencode`:

```bash
bun test test/onescience/data-project.test.ts
```

Expected: fail because `@/onescience/data-project.sql` does not exist.

- [ ] **Step 3: Implement schema tables**

Create `packages/opencode/src/onescience/data-project.sql.ts` with:

```ts
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"
import { OneScienceResourceTable } from "./resource.sql"

export const OneScienceDataProjectTable = sqliteTable("onescience_data_project", {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  description: text().notNull(),
  domain: text().notNull(),
  status: text().notNull(),
  raw_data_uri: text().notNull(),
  raw_data_format: text().notNull(),
  raw_data_license: text(),
  raw_data_metadata_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  target_dataset_name: text().notNull(),
  target_dataset_goal: text().notNull(),
  target_task_type: text().notNull(),
  owner: text(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataAgentRunTable = sqliteTable("onescience_data_agent_run", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  run_type: text().notNull(),
  status: text().notNull(),
  input_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
  plan_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  result_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  error_message: text(),
  session_id: text(),
  time_started: integer().notNull(),
  time_completed: integer(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataArtifactTable = sqliteTable("onescience_data_artifact", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  run_id: text().references(() => OneScienceDataAgentRunTable.id, { onDelete: "set null" }),
  artifact_type: text().notNull(),
  title: text().notNull(),
  uri: text(),
  format: text().notNull(),
  metadata_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  version: text(),
  quality_score: real(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataQualityReportTable = sqliteTable("onescience_data_quality_report", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  artifact_id: text().references(() => OneScienceDataArtifactTable.id, { onDelete: "set null" }),
  schema_score: real(),
  missing_score: real(),
  license_score: real(),
  train_ready_score: real(),
  checks_json: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
  recommendations_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
  time_deleted: integer(),
})

export const OneScienceDataReleaseTable = sqliteTable("onescience_data_release", {
  id: text().primaryKey(),
  project_id: text().notNull().references(() => OneScienceDataProjectTable.id, { onDelete: "cascade" }),
  artifact_id: text().references(() => OneScienceDataArtifactTable.id, { onDelete: "set null" }),
  target: text().notNull(),
  status: text().notNull(),
  resource_id: text().references(() => OneScienceResourceTable.id, { onDelete: "set null" }),
  training_config_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  publish_payload_json: text({ mode: "json" }).$type<Record<string, unknown>>(),
  ...Timestamps,
  time_deleted: integer(),
})
```

- [ ] **Step 4: Run schema test**

Run:

```bash
bun test test/onescience/data-project.test.ts
```

Expected: pass for the schema export test.

---

### Task 2: Backend Service And Status Flow

**Files:**
- Create: `packages/opencode/src/onescience/data-project.ts`
- Modify: `packages/opencode/test/onescience/data-project.test.ts`

- [ ] **Step 1: Add failing service tests**

Append tests for creating a project, listing it, adding an AI Ready artifact, and publishing to OneHub.

```ts
import { OneScienceDataProject } from "@/onescience/data-project"

test("creates and lists raw data intake projects", () => {
  const created = OneScienceDataProject.create({
    title: "ERA5 Raw Intake",
    description: "ERA5 pressure-level weather variables for forecast training.",
    domain: "地球科学",
    rawDataUri: "https://example.org/era5.zarr",
    rawDataFormat: "zarr",
    rawDataLicense: "CC-BY-4.0",
    rawDataMetadataJson: { variables: ["t", "u", "v"] },
    targetDatasetName: "ERA5 AI Ready Forecast Dataset",
    targetDatasetGoal: "用于天气预测模型训练和评估",
    targetTaskType: "forecasting",
  })

  expect(created.status).toBe("draft")
  expect(created.rawDataUri).toBe("https://example.org/era5.zarr")
  expect(OneScienceDataProject.list({ limit: 10 }).items.some((item) => item.id === created.id)).toBe(true)
})

test("publishes an AI Ready artifact to OneHub datasets", () => {
  const project = OneScienceDataProject.create({
    title: "Protein Raw Intake",
    description: "Protein sequence corpus for structure model fine-tuning.",
    domain: "生命科学",
    rawDataUri: "https://example.org/protein.fasta",
    rawDataFormat: "fasta",
    rawDataLicense: "research-only",
    targetDatasetName: "Protein AI Ready Dataset",
    targetDatasetGoal: "用于蛋白结构预测模型训练",
    targetTaskType: "generation",
  })
  const artifact = OneScienceDataProject.createArtifact(project.id, {
    artifactType: "ai_ready_dataset",
    title: "Protein AI Ready Dataset v1",
    uri: "file:///data/protein-ai-ready",
    format: "parquet",
    metadataJson: { split: ["train", "valid", "test"] },
    version: "v1",
    qualityScore: 0.91,
  })
  const release = OneScienceDataProject.publishToOneHub(project.id, artifact.id)

  expect(release.target).toBe("onehub")
  expect(release.status).toBe("published")
  expect(release.resourceId).toStartWith("custom-datasets-")
  expect(OneScienceDataProject.get(project.id).project.status).toBe("published")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test test/onescience/data-project.test.ts
```

Expected: fail because service module does not exist.

- [ ] **Step 3: Implement service schemas and functions**

Create `packages/opencode/src/onescience/data-project.ts`. Follow existing `resource.ts` and `primitive.ts` patterns. Export `OneScienceDataProject` namespace with:

```ts
export * as OneScienceDataProject from "./data-project"
```

Core exported functions:

```ts
export function create(input: CreateProject): Project
export function list(input?: { status?: ProjectStatus; domain?: string; limit?: number; offset?: number }): { items: Project[]; nextOffset?: number }
export function get(id: string): ProjectDetail
export function update(id: string, input: UpdateProject): Project
export function createAgentRun(projectID: string, input: CreateAgentRun): AgentRun
export function completeAgentRun(runID: string, input: CompleteAgentRun): AgentRun
export function createArtifact(projectID: string, input: CreateArtifact): Artifact
export function createQualityReport(projectID: string, input: CreateQualityReport): QualityReport
export function createTrainingHandoff(projectID: string, artifactID: string, trainingConfigJson: Record<string, unknown>): Release
export function publishToOneHub(projectID: string, artifactID: string): Release
```

Use `Database.transaction`, soft-delete filters, and camelCase API output matching existing service style.

- [ ] **Step 4: Run service tests**

Run:

```bash
bun test test/onescience/data-project.test.ts
```

Expected: pass.

---

### Task 3: API Routes

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts`
- Modify: experimental route handler implementation file for this group
- Modify: `packages/opencode/test/onescience/data-project.test.ts`

- [ ] **Step 1: Add API schema assertions**

Add source-level assertions that experimental paths include:

```ts
expect(source).toContain('dataProject: "/experimental/onescience/data-project"')
expect(source).toContain('dataProjectItem: "/experimental/onescience/data-project/:id"')
expect(source).toContain('dataProjectAnalyze: "/experimental/onescience/data-project/:id/analyze"')
expect(source).toContain('dataProjectPublish: "/experimental/onescience/data-project/:id/publish"')
```

- [ ] **Step 2: Run API assertions to verify failure**

Run:

```bash
bun test test/onescience/data-project.test.ts
```

Expected: fail because paths are missing.

- [ ] **Step 3: Add HttpApi schemas and endpoints**

In `experimental.ts`, add request/response schemas for project list/detail/create/update/action endpoints. Add path constants:

```ts
dataProject: "/experimental/onescience/data-project",
dataProjectItem: "/experimental/onescience/data-project/:id",
dataProjectAnalyze: "/experimental/onescience/data-project/:id/analyze",
dataProjectAIReady: "/experimental/onescience/data-project/:id/ai-ready",
dataProjectTraining: "/experimental/onescience/data-project/:id/training",
dataProjectPublish: "/experimental/onescience/data-project/:id/publish",
```

- [ ] **Step 4: Wire handlers**

Use `OneScienceDataProject` service functions in the same route handler style as `OneScienceResource` and `AIPrimitive`.

- [ ] **Step 5: Run package tests**

Run:

```bash
bun test test/onescience/data-project.test.ts
```

Expected: pass.

---

### Task 4: Data Management UI Source Tests

**Files:**
- Modify: `packages/app/src/app.routes.test.tsx`

- [ ] **Step 1: Add failing UI source test**

Add a test near the existing Data Management route test:

```ts
test("designs Data Management as an AI Ready intake workflow", async () => {
  const oneScienceSource = await Bun.file(new URL("./pages/onescience.tsx", import.meta.url)).text()

  expect(oneScienceSource).toContain("接入原始数据")
  expect(oneScienceSource).toContain("智能体分析")
  expect(oneScienceSource).toContain("AI Ready 产物")
  expect(oneScienceSource).toContain("接入模型训练")
  expect(oneScienceSource).toContain("发布到 OneHub")
  expect(oneScienceSource).toContain("rawDataUri")
  expect(oneScienceSource).toContain("targetDatasetGoal")
})
```

- [ ] **Step 2: Run test to verify failure**

Run from `packages/app`:

```bash
bun test src/app.routes.test.tsx --test-name-pattern "AI Ready intake workflow"
```

Expected: fail because the static page does not contain the new workflow UI.

---

### Task 5: API Client Helpers And Page State

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`

- [ ] **Step 1: Implement data project types**

Add page-local types near resource helper types:

```ts
type DataProjectStatus = "draft" | "submitted" | "analyzing" | "plan_ready" | "building" | "ai_ready" | "training_linked" | "publish_pending" | "published" | "failed"

type DataProject = {
  id: string
  title: string
  description: string
  domain: string
  status: DataProjectStatus
  rawDataUri: string
  rawDataFormat: string
  rawDataLicense?: string
  rawDataMetadataJson?: Record<string, unknown>
  targetDatasetName: string
  targetDatasetGoal: string
  targetTaskType: string
  timeCreated: number
  timeUpdated: number
}
```

- [ ] **Step 2: Implement API helpers**

Add helpers:

```ts
async function listDataProjects(serverUrl: string, status?: string) { ... }
async function createDataProject(serverUrl: string, input: CreateDataProjectInput) { ... }
async function analyzeDataProject(serverUrl: string, id: string) { ... }
async function publishDataProject(serverUrl: string, id: string) { ... }
async function createTrainingHandoff(serverUrl: string, id: string) { ... }
```

Use the same `fetch` and JSON style as existing resource helpers in `onescience.tsx`.

---

### Task 6: Replace Static DataManagementPage

**Files:**
- Modify: `packages/app/src/pages/onescience.tsx`
- Modify: `packages/app/src/index.css`

- [ ] **Step 1: Render project list/detail layout**

Update `DataManagementPage()` to use:

- header metrics
- left project list
- right detail panel
- workflow timeline
- agent analysis panel
- AI Ready artifact cards
- downstream action buttons

- [ ] **Step 2: Add intake dialog**

Add `DataProjectCreateDialog` inside `onescience.tsx` with fields:

```text
rawDataUri
rawDataFormat
rawDataLicense
description
domain
targetDatasetName
targetDatasetGoal
targetTaskType
```

- [ ] **Step 3: Add action buttons**

Buttons:

- `提交给智能体`: calls analyze endpoint.
- `接入模型训练`: calls training endpoint.
- `发布到 OneHub`: calls publish endpoint.

- [ ] **Step 4: Add CSS**

Add classes in `packages/app/src/index.css`:

```css
.os-data-intake-grid
.os-data-project-list
.os-data-project-card
.os-data-workflow-timeline
.os-data-agent-panel
.os-data-artifact-grid
.os-data-release-actions
```

Keep layout responsive under existing management page media queries.

---

### Task 7: Final Verification

**Files:**
- Test: `packages/opencode/test/onescience/data-project.test.ts`
- Test: `packages/app/src/app.routes.test.tsx`

- [ ] Run backend tests:

```bash
cd packages/opencode && bun test test/onescience/data-project.test.ts
```

Expected: all tests pass.

- [ ] Run app route tests:

```bash
cd packages/app && bun test src/app.routes.test.tsx --test-name-pattern "Data Management|AI Ready intake workflow"
```

Expected: selected tests pass.

- [ ] Run type checks:

```bash
cd packages/opencode && bun typecheck
cd packages/app && bun typecheck
```

Expected: both pass.

- [ ] Rebuild embedded binary if deploying to `8006`:

```bash
env PATH=/tmp/node22/bin:$PATH OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

Expected: smoke test prints the new dev version.

---

## Self-Review

- Spec coverage: covers raw data intake, agent analysis, AI Ready artifacts, training handoff, OneHub publish, page design, DB design, and API surface.
- Placeholder scan: no `TBD`, `TODO`, or vague standalone implementation steps remain.
- Type consistency: `rawDataUri`, `targetDatasetGoal`, `artifactType`, `resourceId`, and status names are consistent between plan and spec.
