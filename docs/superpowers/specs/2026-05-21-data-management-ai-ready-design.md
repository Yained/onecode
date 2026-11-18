# Data Management AI Ready Workflow Design

## Summary

Data Management becomes the intake and orchestration page for turning user raw data into AI Ready datasets. Users provide raw data addresses, raw data metadata, and the target dataset goal. OneScience records this as a data project, passes the structured request to an agent, and stores the agent's analysis, generated AI Ready artifacts, quality reports, and downstream release decisions.

The chosen architecture is方案 B: add dedicated data workflow tables while reusing existing `onescience_resource` for OneHub dataset publication and `ai_primitive` for future callable dataset operations.

## Goals

- Capture raw data source URI, user-provided data description, license, domain, and target dataset goal.
- Let an agent analyze the input and produce a data profile, cleaning plan, AI Ready dataset specification, and quality report.
- Track workflow states from draft intake to AI Ready, training-linked, and OneHub published.
- Allow AI Ready artifacts to either feed model training or publish to OneHub datasets.
- Keep OneHub dataset publication compatible with existing `onescience_resource` APIs.

## Non-goals

- Do not build a full object storage system in the first version.
- Do not run real distributed data processing jobs in the first version.
- Do not replace `onescience_resource`; use it as the published dataset catalog surface.
- Do not require a complete model training scheduler; store training handoff metadata first.

## Existing Context

Current `DataManagementPage` in `packages/app/src/pages/onescience.tsx` is static. The backend already has:

- `onescience_resource`: user-visible resource catalog entries, including datasets.
- `ai_primitive`: agent-facing primitive contracts.
- Experimental resource and primitive HTTP API routes under `/experimental/onescience/*`.

The new workflow should add data-project-specific tables and API routes, then create or link `onescience_resource` rows when the user publishes AI Ready output to OneHub.

## Product Flow

```text
Raw Data Intake -> Agent Analysis -> AI Ready Build -> Training Handoff or OneHub Publish
```

### Raw Data Intake

User creates a data project with:

- Raw data URI: URL, S3 path, local path, OSS path, dataset registry URL, or text pointer.
- Raw data description: source, collection method, schema clues, update frequency, known issues.
- Domain: earth, life, material, fluid, generic, or custom.
- Data format: csv, parquet, netcdf, grib, zarr, image, fasta, structure, unknown.
- License and privacy level.
- Target dataset name and goal.
- Target task type: classification, regression, forecasting, simulation, retrieval, generation, evaluation, other.

### Agent Analysis

The agent receives a normalized JSON payload and produces:

- Data profile: inferred schema, columns/variables, sample shape, size estimates.
- Risk analysis: missing metadata, license risk, privacy risk, unavailable URI, format risk.
- Cleaning plan: transforms, splits, normalization, dedupe, validation checks.
- AI Ready dataset spec: directory layout, metadata schema, split strategy, expected artifacts.
- Next action recommendation: build AI Ready, ask user for more info, or block.

### AI Ready Build

The first version stores the generated specification and artifact metadata. It may point to external generated outputs rather than physically moving data.

An AI Ready dataset is considered ready when it has:

- Dataset title and domain.
- Source lineage back to raw data.
- Machine-readable metadata JSON.
- Split and usage description.
- Quality report with train readiness score.
- At least one artifact URI or generation recipe.

### Training Or OneHub Release

From an AI Ready artifact, users can choose:

- `接入模型训练`: create a training handoff record with recommended primitive/model inputs.
- `发布到 OneHub`: create or update a `onescience_resource` row with `page = "datasets"` and link the release record to that resource ID.

## Page Design

### Header

- Title: `数据管理`
- Subtitle: `将原始数据接入智能体开发流程，生成可训练、可发布的 AI Ready 数据集。`
- Primary button: `+ 接入原始数据`
- Secondary button: `查看发布队列`

### Metrics

- `原始接入`
- `智能体分析中`
- `AI Ready`
- `已接入训练`
- `已发布 OneHub`

### Left Project List

Each project card shows:

- Dataset target title.
- Domain and target task type.
- Current workflow status.
- Raw data URI host/path summary.
- Updated time.

Filters:

- 全部
- 草稿
- 分析中
- AI Ready
- 训练接入
- 发布中
- 已发布
- 失败

### Detail Panel

Detail tabs:

- `接入信息`: raw URI, format, license, target goal.
- `智能体分析`: latest run plan, analysis result, warnings.
- `AI Ready 产物`: artifacts, metadata, quality score.
- `下游动作`: training handoff and OneHub release.

### Workflow Timeline

Use a 4-step timeline:

1. 原始数据接入
2. 智能体分析
3. AI Ready 构建
4. 训练接入 / OneHub 发布

Parent workflow statuses are state indicators, not navigation routes.

## Database Design

### `onescience_data_project`

Primary workflow entity.

```text
id                    text primary key
slug                  text not null unique
title                 text not null
description           text not null
domain                text not null
status                text not null
raw_data_uri           text not null
raw_data_format        text not null
raw_data_license       text
raw_data_metadata_json text json
target_dataset_name    text not null
target_dataset_goal    text not null
target_task_type       text not null
owner                 text
time_created           integer not null
time_updated           integer not null
time_deleted           integer
```

Statuses:

```text
draft | submitted | analyzing | plan_ready | building | ai_ready | training_linked | publish_pending | published | failed
```

### `onescience_data_agent_run`

Agent execution and analysis history.

```text
id                    text primary key
project_id            text not null references onescience_data_project(id)
run_type              text not null
status                text not null
input_json            text json not null
plan_json             text json
result_json           text json
error_message         text
session_id            text
time_started          integer not null
time_completed        integer
time_created          integer not null
time_updated          integer not null
time_deleted          integer
```

Run types:

```text
profile | plan | build_ai_ready | training_handoff | publish_onehub
```

### `onescience_data_artifact`

Produced or referenced artifacts.

```text
id                    text primary key
project_id            text not null references onescience_data_project(id)
run_id                text references onescience_data_agent_run(id)
artifact_type         text not null
title                 text not null
uri                   text
format                text not null
metadata_json         text json
version               text
quality_score         real
time_created          integer not null
time_updated          integer not null
time_deleted          integer
```

Artifact types:

```text
raw_profile | cleaning_plan | ai_ready_spec | ai_ready_dataset | training_config | onehub_payload
```

### `onescience_data_quality_report`

Quality and readiness checks.

```text
id                    text primary key
project_id            text not null references onescience_data_project(id)
artifact_id           text references onescience_data_artifact(id)
schema_score          real
missing_score         real
license_score         real
train_ready_score     real
checks_json           text json not null
recommendations_json  text json
time_created          integer not null
time_updated          integer not null
time_deleted          integer
```

### `onescience_data_release`

Downstream target handoff.

```text
id                    text primary key
project_id            text not null references onescience_data_project(id)
artifact_id           text references onescience_data_artifact(id)
target                text not null
status                text not null
resource_id           text references onescience_resource(id)
training_config_json  text json
publish_payload_json  text json
time_created          integer not null
time_updated          integer not null
time_deleted          integer
```

Targets:

```text
model_training | onehub
```

## API Design

Add experimental routes under `/experimental/onescience/data-project`.

- `GET /experimental/onescience/data-project`: list projects with status/domain pagination.
- `POST /experimental/onescience/data-project`: create raw data intake project.
- `GET /experimental/onescience/data-project/:id`: get project detail with latest run, artifacts, quality report, releases.
- `PATCH /experimental/onescience/data-project/:id`: update draft/intake metadata.
- `POST /experimental/onescience/data-project/:id/analyze`: create an agent run and mark project `analyzing`.
- `POST /experimental/onescience/data-project/:id/ai-ready`: store AI Ready artifact and report.
- `POST /experimental/onescience/data-project/:id/training`: create model training handoff release.
- `POST /experimental/onescience/data-project/:id/publish`: create/update `onescience_resource` dataset and mark release published.

## Agent Payload

```json
{
  "project_id": "data-project-id",
  "raw_data_uri": "https://example.org/raw-data",
  "raw_data_info": {
    "format": "netcdf",
    "domain": "地球科学",
    "license": "CC-BY-4.0",
    "description": "ERA5-like weather variables for model training"
  },
  "target_dataset": {
    "name": "Global Weather AI Ready Dataset",
    "goal": "用于天气预测模型训练和评估",
    "task_type": "forecasting"
  },
  "expected_outputs": [
    "data_profile",
    "cleaning_plan",
    "ai_ready_dataset_spec",
    "quality_report",
    "training_or_publish_recommendation"
  ]
}
```

## Testing Strategy

- Schema tests: project create/list/detail/update and status transitions.
- API tests: route payload validation, pagination, publish-to-resource behavior.
- UI source tests: page contains intake form, workflow states, agent panel, AI Ready actions.
- Integration test: publishing an AI Ready artifact creates a `onescience_resource` dataset row.

## Rollout

1. Add DB schema and service layer.
2. Add experimental API routes.
3. Replace static `DataManagementPage` with project list/detail UI backed by API.
4. Add create intake dialog and local optimistic refresh.
5. Add publish-to-OneHub action.
6. Add training handoff action as metadata-only first version.
