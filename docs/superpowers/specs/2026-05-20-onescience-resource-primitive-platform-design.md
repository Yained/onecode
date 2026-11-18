# OneScience Resource Primitive Platform Design

## Summary

OneScience should evolve from a resource presentation workspace into a scientific AI capability asset platform.

Datasets, model libraries, application libraries, operators, and verified OneScience code are foundation resources. Users can add and maintain these resources. AI primitives are first-class operational assets derived from one or more foundation resources. Agents and OneSkills should call primitives, not raw resource cards.

The product structure is:

```text
Resource Center -> Primitive Factory -> Agent Registry
```

The core lifecycle is:

```text
Foundation Resource -> Candidate Primitive -> Review Pending -> Verified -> Callable -> Deprecated
```

## Goals

- Let users add datasets, models, apps, operators, and verified code resources.
- Keep verified OneScience code as a trusted source of implementation-backed resources.
- Convert selected resources into AI primitives with explicit contracts.
- Give agents and OneSkills a stable registry of callable, validated capabilities.
- Separate broad catalog discovery from execution-grade primitive contracts.
- Support future MCP/API exposure without changing the resource catalog model.

## Non-goals

- Do not make every resource automatically callable.
- Do not treat primitives as a visual-only grouping of resource cards.
- Do not require all primitives to be executable in the first version.
- Do not replace the existing `/code` workspace; verified code resources should link to or originate from it.

## Current Context

The app currently has resource pages for datasets, models, apps, frameworks, skills, and primitives. The backend stores user-managed resources in `onescience_resource`, with fields such as `page`, `domain`, `tags`, `href`, `source`, `metric_label`, and `action`.

Current AI primitives are static entries in `packages/app/src/pages/onescience-primitives.ts`. They are useful for display, but they are not yet connected to user-managed resources, lifecycle state, validation, or agent-facing contracts.

This design keeps the current resource center direction, but introduces primitives as a separate product asset type.

## Product Information Architecture

### Resource Center

The Resource Center owns foundation resources:

- Datasets
- Model library
- Application library
- Operators
- Verified OneScience code
- Optional future resource types such as papers, workflows, images, and environments

Each resource is human-editable and can be supplemented by users. Resource pages optimize for discovery, comparison, filtering, and source inspection.

Resource states:

- `draft`: user-added, incomplete or unreviewed.
- `submitted`: ready for review.
- `verified`: source, metadata, and availability checked.
- `deprecated`: kept for traceability but no longer recommended.

Verified OneScience code should be shown as a first-class resource source. Examples include model examples, DataPipes, modules, metrics, operators, scripts, notebooks, and validated case workflows.

### Primitive Factory

The Primitive Factory converts resources into AI primitives.

A primitive is not just a resource card. It is an operational contract that tells an agent:

- what capability exists
- when to use it
- what inputs it accepts
- what outputs it produces
- how to run or materialize it
- what runtime constraints apply
- what validation evidence exists

Primitive creation paths:

- User creates a primitive from a resource.
- Platform suggests primitive candidates from resource metadata.
- Verified OneScience code produces primitive candidates automatically.
- OneSkills authors add primitive contracts directly.

Primitive states:

- `candidate`: suggested from one or more resources.
- `draft`: being edited.
- `review_pending`: ready for validation.
- `verified`: contract and validation accepted.
- `callable`: available to agents and OneSkills.
- `deprecated`: hidden from default agent selection.

### Agent Registry

The Agent Registry exposes only verified or callable primitives to execution surfaces.

Consumers:

- OneSkills skill router
- Coder skill
- Runtime skill
- Hardware skill
- Workflow agents
- Future MCP or HTTP primitive APIs
- Code page recommendations

The registry optimizes for task intent lookup rather than human browsing. Agents should be able to ask for capabilities such as:

- "load ERA5 weather data"
- "run GraphCast forecast"
- "evaluate climate forecast metrics"
- "generate DataPipe scaffold"
- "submit remote DCU training job"

## Data Model

### Foundation Resource

The existing `onescience_resource` table can be extended rather than replaced.

Suggested additional fields:

```text
resource_type       dataset | model | app | operator | code | skill | framework
trust_level         user | reviewed | verified
license            text
link                alias or normalized external URL, backed by existing href
version            text
owner              text
metadata           json
verification_state draft | submitted | verified | deprecated
verified_at        integer
verified_by        text
```

The current `href` field should remain for compatibility. Product copy may call this "链接", while API clients should receive either `href` or a backward-compatible `link` alias if needed.

### AI Primitive

Add a first-class primitive entity.

```text
ai_primitive
  id
  slug
  title
  description
  domain
  primitive_type
  intent_tags
  source_resource_ids
  status
  contract_json
  adapter_json
  validation_json
  quality_score
  owner
  time_created
  time_updated
  time_deleted
```

Primitive types:

- `data.load`
- `data.transform`
- `model.run`
- `model.train`
- `model.evaluate`
- `app.launch`
- `operator.apply`
- `code.generate`
- `workflow.compose`
- `runtime.submit`

### Primitive Contract

The contract is the stable agent-facing part.

```json
{
  "id": "earth.graphcast.forecast",
  "name": "GraphCast 气象预测",
  "intent": ["weather_forecast", "earth_model_run"],
  "inputs": [
    { "name": "start_time", "type": "datetime", "required": true },
    { "name": "horizon_hours", "type": "number", "required": true },
    { "name": "variables", "type": "string[]", "required": true }
  ],
  "outputs": [
    { "name": "forecast", "type": "artifact" },
    { "name": "metrics", "type": "json" }
  ],
  "constraints": {
    "accelerator": ["GPU", "DCU"],
    "data_format": ["zarr", "netcdf"],
    "license": "check_required"
  }
}
```

### Primitive Adapter

The adapter describes how the primitive is executed or materialized.

Adapter modes:

- `documentation`: agent can cite or route to docs, but cannot execute.
- `code_reference`: agent can open verified code and generate instructions.
- `script`: agent can render or run a command/script.
- `http`: agent can call an HTTP endpoint.
- `mcp`: agent can call an MCP tool.
- `workflow`: agent can compose several primitives.

This lets the platform ship non-executable primitives first, then progressively make them callable.

## Key User Flows

### Add a foundation resource

1. User opens Resource Center.
2. User adds a dataset, model, app, operator, or code resource.
3. User provides title, domain, tags, source, link, license, version, and description.
4. Platform stores it as `draft` or `submitted`.
5. Reviewer verifies source and marks it `verified`.
6. Platform suggests candidate primitives when metadata is sufficient.

### Create an AI primitive from a resource

1. User chooses "转为 AI 原语" from a verified resource.
2. Primitive Factory opens a draft seeded from the resource.
3. User selects primitive type and task intent.
4. User defines inputs, outputs, constraints, and examples.
5. User binds an adapter or leaves it as documentation/code reference.
6. User runs or attaches validation evidence.
7. Reviewer marks it verified.
8. If adapter is callable, the primitive enters Agent Registry.

### Agent uses a primitive

1. Agent receives a scientific task.
2. Skill Router queries Agent Registry by domain and intent.
3. Registry returns compatible primitives with status, contract, constraints, and examples.
4. Agent selects a primitive or asks user to choose.
5. Coder/Runtime/Hardware skills execute or materialize the primitive according to adapter mode.
6. Run result and validation outcome are written back as evidence.

## UI Shape

### Resource Center

Resource pages should keep the existing card-grid experience, but add:

- resource type tabs: datasets, models, apps, operators, code
- trust badges: user, reviewed, verified
- source badges: OneScience, third-party, paper, local
- actions: edit, verify, deprecate, create primitive
- "primitive candidates" count on each resource

Operators should move from mostly static page content into editable foundation resources.

Verified code resources should appear as a catalog surface, not only under `/code`. They can link to OneScience examples, modules, metrics, DataPipes, scripts, or local code paths.

### Primitive Factory

Primitive Factory should have:

- candidate queue
- primitive editor
- contract builder
- adapter selector
- validation panel
- review status

The first implementation can use structured forms rather than a visual workflow builder.

### Agent Registry

Agent Registry should show:

- searchable primitive list
- task-intent filters
- primitive detail page
- contract preview
- linked source resources
- validation evidence
- "use in workflow" and "copy call contract" actions

This page is for humans checking what agents can use. The backend registry API is for agents.

## API Shape

Resource APIs can extend the current `/experimental/onescience/resource` surface.

Suggested primitive endpoints:

```text
GET    /experimental/onescience/primitive
POST   /experimental/onescience/primitive
GET    /experimental/onescience/primitive/:id
PATCH  /experimental/onescience/primitive/:id
DELETE /experimental/onescience/primitive/:id
POST   /experimental/onescience/primitive/:id/verify
POST   /experimental/onescience/primitive/:id/deprecate
POST   /experimental/onescience/primitive/:id/validate
GET    /experimental/onescience/agent-registry
```

Agent registry response should be optimized for machine use:

```json
{
  "items": [
    {
      "id": "earth.graphcast.forecast",
      "title": "GraphCast 气象预测",
      "domain": "地球科学",
      "primitiveType": "model.run",
      "status": "callable",
      "contract": {},
      "adapter": {},
      "sourceResources": []
    }
  ]
}
```

## Permissions And Review

Initial roles:

- Viewer: browse resources and primitives.
- Contributor: add resources and draft primitives.
- Reviewer: verify resources and primitives.
- Admin: deprecate, restore, and manage global registry settings.

Verification should check:

- source link is reachable or local path exists
- license is known or explicitly marked unknown
- required metadata is complete
- primitive contract is valid
- adapter mode is safe for its capability
- validation evidence exists for callable primitives

## Phased Delivery

### Phase 1: Resource model cleanup

- Normalize current resource model.
- Add `operators` and `code` as user-editable resource types.
- Add trust and verification fields.
- Preserve `href` and optionally expose a `link` alias.

### Phase 2: First-class primitive storage

- Add `ai_primitive` table and CRUD API.
- Move static primitives into seeded primitive data.
- Add source-resource linkage.
- Build Primitive Factory list and editor.

### Phase 3: Verification and registry

- Add validation state and review actions.
- Add Agent Registry page.
- Add machine-facing registry endpoint.
- Let OneSkills query verified/callable primitives.

### Phase 4: Execution adapters

- Start with documentation and code-reference adapters.
- Add script/http/mcp/workflow adapters later.
- Record run results as validation evidence.

## Open Decisions

- Whether the public API should expose both `href` and `link`, or only standardize on `href`.
- Whether verified code resources point to remote Gitee/GitHub URLs, local workspace paths, or both.
- Whether primitive validation is manual evidence first or automated run-first.
- How much of Agent Registry should be visible to non-admin users.

## Success Criteria

- Users can add foundation resources without touching code.
- Verified resources can produce primitive candidates.
- Primitives have explicit contracts and lifecycle states.
- Agents can query a registry of verified/callable primitives.
- OneSkills can use primitive metadata to route scientific tasks.
- The product clearly communicates the difference between "resource" and "callable primitive".
