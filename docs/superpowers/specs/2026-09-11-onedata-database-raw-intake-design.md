# OneData 原始数据：数据库接入（替换对象存储）

**Date:** 2026-09-11  
**Status:** Draft for implementation planning  
**Related:** `docs/superpowers/specs/2026-09-09-onedata-catalog-completion-design.md`

## Summary

Replace the OneData **原始数据** intake connector **对象存储** with **数据库**, so users can connect an existing PostgreSQL or MySQL/MariaDB database and register **tables/views** as Raw sources for preview and session use. Training conversion remains optional and secondary.

User mental model: “I connected a whole database.” Platform model: connection is reusable credentials; **each Raw row is one table/view**.

## Goals

- Product entry: remove 对象存储 from OneData Raw intake; add 数据库
- Support Postgres + MySQL/MariaDB
- Account-level encrypted DB connections; list tables; register one or more tables as Raw
- Primary use after register: preview + attach session chips (papers / experiment tables / general structured data — not assumed trainable)
- Optional path: convert / agent processing → Already (materialize to platform-side files before trainability)
- Allow private/VPC IPs (private deployments); still block localhost and cloud metadata targets

## Non-goals (v1)

- Free-form SQL as a Raw identity
- Oracle / SQL Server
- Training jobs connecting directly to the user database
- Restoring object-store UI
- Auto RAG / vector indexing of DB content
- Deleting object-store backend tables/routes in the same change (may deprecate/hide only)

## Product semantics

### Hierarchy

```text
数据库连接（账号级凭证，不是 Raw）
  └── 表 / 视图 → 一条原始数据 Raw（raw_*）
        ├── 预览 / 加入对话（主路径）
        └── 可选 → convert / dataset_report → Already
```

| User says | Platform stores |
|---|---|
| 我接了一个库 | One `dbc_*` connection |
| 我要用 papers / experiments 表 | One Raw per table/view |

**Rule:** One Raw = one table or view under a saved connection. The database as a whole is never a Raw row.

### Naming (UI)

| UI | Meaning |
|---|---|
| 添加数据库连接 | Save + test connection |
| 从表登记原始数据 | Create Raw rows from selected tables |
| 原始数据 | Previewable, chip-attachable source (not necessarily trainable) |
| 加入对话 | Primary next step for non-training content |

Avoid copy that implies “接入数据库 = 一条原始数据” or that registered DB tables are already training sets.

## Architecture

Mirror the existing object-store key pattern:

```text
UI (OneData Raw tab)
  → db-connection APIs + raw-source (connector=database)
  → DataCatalog + new db-connection module
  → encrypted secrets in SQLite
  → runtime drivers: postgres / mysql (read-only queries)
```

### Persistence

**New table `onescience_db_connection`** (name may match Drizzle conventions in implementation):

- `id` (`dbc_*`)
- `account_id`
- `engine`: `postgres` | `mysql`
- `host`, `port`, `database`, `username`
- `password_ciphertext`
- `label` (optional)
- `ssl_mode` (optional)
- timestamps + soft delete as needed

Encryption: reuse the same class of master key as object-store secrets (`ONECODE_OBJECT_STORE_MASTER_KEY` or a renamed shared `ONECODE_SECRET_MASTER_KEY` if touched in implementation — product-invisible).

**Existing Raw storage** (`data_project` / catalog Raw):

- `connector = "database"`
- `raw_data_uri` examples:
  - `postgres://dbc_xxx/public.papers`
  - `mysql://dbc_xxx/app.experiments`
- Probe metadata (columns, sample counts) in existing metadata JSON fields

### CatalogConnector change

Extend `CatalogConnector` with `database`. Stop exposing `object_store` in OneData UI. Backend may keep `object_store` temporarily for compatibility.

### Publish / convert

- `database` Raw / Already: **cannot publish** (same policy family as former object_store)
- Direct convert (optional): materialize export to platform workspace files, then existing Already pipeline
- Do not treat DB URI as publicly shareable OneData without materialization

## API

### DB connection

| Method | Path | Behavior |
|---|---|---|
| `PUT` | `/experimental/onescience/db-connection` | Upsert connection; **test connectivity before persist** |
| `GET` | `/experimental/onescience/db-connection` | List connections for account; **never return password** |
| `DELETE` | `/experimental/onescience/db-connection/:id` | Delete; **409** if Raw rows still reference it |
| `GET` | `/experimental/onescience/db-connection/:id/tables` | List tables/views (`schema` + `name`) |

### Raw (extended)

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/experimental/onescience/raw-source` | `connector: "database"` + table URI; probe then insert |
| `GET` | `/experimental/onescience/raw-source/:id/preview` | Column info + limited sample rows (`LIMIT`, timeout, byte cap) |
| `POST` | `.../convert` | Optional; materialize then Already |
| chips | existing session chips APIs | Unchanged; prompt/context should note DB table is read-only source, not a training set by default |

### Frontend

- `onedata-catalog-api.ts`: replace object-store helpers with db-connection helpers
- `onedata-panel.tsx`: connector toggle + connection form + table picker + grouped Raw list
- Filters/labels: `connectorLabel("database")` → `数据库`; remove object-store from Raw intake UI

## UI flow

1. User selects connector **数据库**
2. **我的数据库连接**: add (engine, host, port, database, user, password, optional SSL/label) → test → save; list/delete
3. **从表登记**: pick connection → load tables → multi-select → register each as Raw (default title `database.table`, editable)
4. Raw list groups rows by connection:

```text
文献库 (PostgreSQL · 10.0.0.5/papers_db)
  public.papers       预览 · 加入对话
  public.experiments  预览 · 加入对话
```

Other connectors remain flat entries in the same list.

Intro copy should mention 已连接数据库中的表 alongside workspace path / public URL / remote.

## Security

- Passwords only as ciphertext; never in API responses or logs
- Engines limited to `postgres` | `mysql`
- Host policy:
  - **Allow** private ranges (10/8, 172.16–31, 192.168/16, etc.) for private deployments
  - **Deny** localhost / loopback (`127.0.0.0/8`, `::1`, `localhost`)
  - **Deny** link-local / cloud metadata (e.g. `169.254.169.254`)
- v1 queries: metadata + read-only `SELECT` with hard `LIMIT`, statement timeout (~5–8s), result size cap
- No user-supplied arbitrary SQL in v1
- Connection and Raw ownership scoped to `account_id`; URI `dbc_*` must belong to caller
- Account deletion cleans db connections (align with existing catalog secret cleanup)

## Probe behavior

On register / probe:

1. Parse URI → load owned connection
2. Connect with short timeout
3. Assert table/view exists
4. Load column definitions
5. Row count: prefer estimate or timed count; must not block forever on huge tables
6. Return exists, format hint (`table`), entry_count when available, column summary

Preview: same connection path; return columns + sample rows only.

## Testing

Run from package dirs (`packages/opencode`, `packages/app`), not repo root.

- Connection CRUD; password never listed
- Private host allowed; localhost/metadata rejected
- Register table → Raw URI → preview sample
- Session chips accept database Raw ids
- Delete connection with referencing Raw → 409
- App source/UI tests: no 对象存储 intake; 数据库 present; grouping/copy expectations

## Migration / compatibility

- Hide object-store from OneData Raw UI
- Existing `object_store` Raw rows (if any) remain readable where possible; no requirement to auto-migrate to database
- Object-store HTTP APIs may remain deprecated/hidden until a later cleanup task

## Open implementation choices (plan may pick defaults)

- Shared vs object-store-specific env name for secret master key
- Exact convert materialization format (CSV/Parquet) and max export size
- Whether MySQL URI path uses `db.table` only (no schema) vs Postgres `schema.table`

These do not change the product rules above.
