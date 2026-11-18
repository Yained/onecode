# OneScience Primitives Route Integration Design

## Summary

Integrate the recently added OneScience resource, AI primitive, and agent registry layers into the visible OneScience workspace routing. The goal is to turn `/primitives` from a mostly static card page into a focused AI primitive workspace that reflects the product architecture:

```text
Resource Center -> Primitive Factory -> Agent Registry
```

The implementation should keep the existing OneScience sidebar simple while making the primitive lifecycle visible and usable from the interface.

## Goals

- Make `/primitives` the single user-facing entry for AI primitive discovery, creation, and registry browsing.
- Reuse existing database-backed primitive and agent registry APIs instead of leaving `pages/primitives.tsx` and `pages/agent-registry.tsx` disconnected.
- Preserve static primitive data as a fallback catalog when the API is unavailable or no migrated primitives exist.
- Keep resource pages focused on foundation resource discovery and management.
- Keep “转为原语” available from resource cards and route successful creation back into the primitive workspace.
- Avoid adding more top-level sidebar items unless they represent a broad product area.

## Non-goals

- Do not build a full primitive detail route such as `/primitives/:id` in this iteration.
- Do not implement primitive execution, validation workflows, or publish controls beyond displaying status and contract metadata.
- Do not redesign the entire OneScience resource center.
- Do not remove the static primitive catalog until a migration path is proven in production.

## Current State

The backend has the core data and API layer:

- `onescience_resource` stores foundation resources and has extension fields for trust, metadata, and verification state.
- `ai_primitive` stores first-class primitives with source resource IDs, lifecycle status, contract JSON, adapter JSON, validation JSON, and quality metadata.
- `/experimental/onescience/resource` exposes resource CRUD.
- `/experimental/onescience/primitive` exposes primitive CRUD.
- `/experimental/onescience/agent-registry` exposes callable primitives.

The frontend has partial integration:

- `/primitives` is registered in the main OneScience route tree.
- The sidebar includes `AI原语` after `OneSkills`.
- The active `/primitives` route currently resolves to `PrimitivesPage()` in `pages/onescience.tsx`, which renders the generic resource page using the static `primitivePage` catalog.
- `pages/primitives.tsx` and `pages/agent-registry.tsx` contain database/API-driven views but are not mounted in the route tree.
- `PrimitiveCreateDialog` can create a primitive from a resource, but it uses `/api/experimental/...`, which falls through to the web UI in the current single-port server. The correct same-origin API prefix is `/experimental/...` or the current server URL plus `/experimental/...`.

## Recommended Information Architecture

Use one top-level sidebar item and three secondary views inside `/primitives`:

```text
/primitives?tab=catalog   原语目录
/primitives?tab=factory   原语工厂
/primitives?tab=registry  Agent Registry
```

The default `/primitives` view should resolve to `catalog`.

### 原语目录

The catalog tab is the main human browsing surface for primitives.

It should:

- Fetch primitives from `GET /experimental/onescience/primitive`.
- Support basic filters for domain, primitive type, status, and search text.
- Display status badges using localized labels.
- Show contract and adapter metadata in a modal or drawer.
- Fall back to `primitivePage.items` when the API is unavailable or returns no items.
- Clearly label fallback data as “静态目录，尚未迁入数据库”.

### 原语工厂

The factory tab explains and supports conversion from foundation resources into candidate primitives.

It should:

- Explain that primitives are execution-grade contracts derived from datasets, models, apps, code, skills, frameworks, or operators.
- Link users back to resource pages for conversion, e.g. datasets, models, apps, frameworks, and skills.
- Optionally show recent or eligible OneScience resources once the resource query API supports cross-page queries.
- Reuse `PrimitiveCreateDialog` for direct creation when a source resource ID is known.

The existing resource card “转为原语” button remains the primary contextual creation entry.

### Agent Registry

The registry tab is the agent-facing capability view.

It should:

- Fetch `GET /experimental/onescience/agent-registry?status=callable` by default.
- Allow filters for domain and primitive type.
- Emphasize that the registry contains capabilities available to OneSkills, routing, and future MCP/API execution surfaces.
- Show contract and adapter previews so users can understand why an agent would choose a primitive.
- Display an empty state when there are no callable primitives, with a CTA to review or publish primitives later when lifecycle controls exist.

## Route Design

Keep the main route tree as:

```tsx
<Route path="/primitives" component={PrimitivesRoute} />
```

But change `PrimitivesRoute` to render a dedicated primitive workspace rather than the generic `ResourcePage page="primitives"` view.

The route should parse query params:

- missing or unknown `tab` -> `catalog`
- `tab=catalog` -> primitive catalog panel
- `tab=factory` -> primitive factory panel
- `tab=registry` -> agent registry panel
- optional `highlight=<primitiveID>` -> highlight or scroll to a newly created primitive when possible

No additional top-level `/agent-registry` route should be exposed in the sidebar for this iteration. If a route is useful for deep linking, it can redirect to `/primitives?tab=registry`, but the visible product model should remain one `AI原语` entry.

## Component Design

### PrimitiveWorkspacePage

A new or refactored component should own the `/primitives` page shell.

Responsibilities:

- Render the page title, explanation, and tab controls.
- Read and update the `tab` query param.
- Host the three tab panels.
- Keep visual style aligned with existing OneScience workspace cards and filters.

### PrimitiveCatalogPanel

This panel replaces the active static primitive resource page behavior.

Responsibilities:

- Fetch all primitives from `/experimental/onescience/primitive`.
- Normalize database primitives and static fallback primitives into a common card view model.
- Render filters, cards, empty state, and contract/adapter modal.
- Prefer database data when available.

### PrimitiveFactoryPanel

This panel explains the conversion workflow and provides entry points.

Responsibilities:

- Show the resource-to-primitive lifecycle.
- Link to resource pages that contain “转为原语”.
- Offer direct primitive creation only when source metadata is available.

### AgentRegistryPanel

This panel should absorb the useful logic from `pages/agent-registry.tsx`.

Responsibilities:

- Fetch callable primitives from `/experimental/onescience/agent-registry`.
- Show registry-specific filters and contract previews.
- Avoid duplicating catalog UI more than necessary.

### PrimitiveCreateDialog

This dialog remains the bridge from resource cards to primitives.

Required fixes:

- Replace `/api/experimental/...` requests with the same API base pattern used by `onescience.tsx` resource calls.
- When a primitive is created, close the dialog and navigate to `/primitives?tab=catalog&highlight=<id>`.
- Preserve source resource linking through `sourceResourceIds`.

## Data Flow

### Resource Center

```text
ResourcePage
  -> listUploadedResources(serverUrl, page, filters)
  -> GET /experimental/onescience/resource
  -> ResourceCard
```

### Resource to Primitive

```text
ResourceCard "转为原语"
  -> PrimitiveCreateDialog(resourceId)
  -> GET /experimental/onescience/resource/:id
  -> POST /experimental/onescience/primitive
  -> navigate /primitives?tab=catalog&highlight=<primitiveID>
```

### Primitive Catalog

```text
PrimitiveWorkspacePage(tab=catalog)
  -> PrimitiveCatalogPanel
  -> GET /experimental/onescience/primitive
  -> cards + contract modal
  -> fallback primitivePage.items when needed
```

### Agent Registry

```text
PrimitiveWorkspacePage(tab=registry)
  -> AgentRegistryPanel
  -> GET /experimental/onescience/agent-registry?status=callable
  -> callable capability cards
```

## Error Handling

- API failures in the catalog tab should fall back to static primitives and show a non-blocking notice.
- API failures in the registry tab should show an error state because registry data should be authoritative.
- Creation failures should keep the dialog open and show an inline error.
- If a resource cannot be preloaded for primitive creation, allow manual entry rather than blocking creation.
- Unknown tabs should normalize to `catalog`.

## Copy and Status Labels

Primitive status labels:

- `draft`: 草稿
- `review_pending`: 待验证
- `verified`: 已验证
- `callable`: 可调用
- `deprecated`: 已废弃

Suggested tab labels:

- `原语目录`
- `原语工厂`
- `Agent Registry`

Suggested helper copy:

- Catalog: “沉淀可复用的 AI4Science 能力契约，供人和 Agent 共同发现。”
- Factory: “从数据、模型、应用、代码和技能资源中提炼可验证、可调用的 AI 原语。”
- Registry: “仅展示可被 OneSkills 和 Agent 路由选择的 callable 原语。”

## Testing Strategy

Add or update frontend tests for:

- `/primitives` route renders the primitive workspace instead of the generic resource page.
- Query tabs select the expected panel.
- Catalog fetches `/experimental/onescience/primitive` and falls back to static primitives on failure.
- Registry fetches `/experimental/onescience/agent-registry`.
- `PrimitiveCreateDialog` uses `/experimental/onescience/...`, not `/api/experimental/...`.
- Resource card “转为原语” navigates to `/primitives?tab=catalog&highlight=<id>` on success.

Add or update backend tests only if route contracts change. This design does not require backend API shape changes.

## Implementation Notes

- Prefer refactoring `pages/primitives.tsx` and `pages/agent-registry.tsx` into importable panels rather than keeping them as disconnected route files.
- Avoid adding `any` in new code. Define a small normalized primitive card type for UI rendering.
- Keep API helpers close to the primitive workspace code unless they are reused by other OneScience pages.
- Do not treat `primitives` as a normal `ResourcePage`; primitives are a distinct product asset with lifecycle and agent-facing contracts.
- Keep static `onescience-primitives.ts` as fallback and migration source until the database migration is confirmed in deployment.

## Open Decisions Resolved

- Agent Registry will be a tab inside `/primitives`, not a separate sidebar item.
- `/primitives/:id` will not be added in this iteration.
- Static primitive data remains as fallback.
- Resource pages keep contextual “转为原语” actions.
