# OneData Database Raw Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用「数据库连接 + 按表登记 Raw」替换 OneData 原始数据接入里的对象存储入口，支持用户已有 Postgres/MySQL 在平台上预览与会话使用。

**Architecture:** 新增账号级加密 `dbc_*` 连接表与 `db-connection` API；Raw 使用 `connector=database` 与 URI `postgres://dbc_…/schema.table`（MySQL：`mysql://dbc_…/table`）。Probe/预览走只读查询；主路径预览 + chips；可选 convert 先物化 CSV 再进 Already；`database` 不可 publish。UI 去掉对象存储。

**Tech Stack:** Bun、TypeScript、SolidJS、Drizzle/SQLite、Effect Schema HttpApi、Bun `SQL`（Postgres/MySQL）、现有 DataCatalog。

**Spec:** `docs/superpowers/specs/2026-09-11-onedata-database-raw-intake-design.md`

## Global Constraints

- 一条 Raw = 一张表/视图；整库只作为连接，不是 Raw
- 引擎仅 `postgres` | `mysql`；v1 无自由 SQL
- 允许内网 IP；拒绝 localhost/loopback 与 `169.254.0.0/16` metadata
- 密码只密文存储；列表 API 永不返回密码
- `database` 不可 publish；convert 须先物化到平台文件
- 测试在 `packages/opencode` / `packages/app` 包目录跑，禁止 repo root
- Commit 仅当用户明确要求；计划中的 Commit step 默认跳过除非用户要求
- 不删除 object-store 后端表/路由（仅 UI 下线）

### Locked defaults (spec open choices)

- 密钥：继续用 `ONECODE_OBJECT_STORE_MASTER_KEY`（32-byte base64）；抽出共享加解密到 `catalog-secret.ts`，object-store 与 db-connection 共用
- Convert 物化：CSV；最多 `50_000` 行或约 `32MB`（先到先停）；写入当前 serve 工作区 `.onescience/db-export/<raw_id>.csv`
- MySQL URI path：仅表名 `mysql://dbc_xxx/papers`（库名在连接上）；Postgres：`postgres://dbc_xxx/public.papers`

---

## File Map

| 文件 | 职责 |
|---|---|
| `packages/opencode/src/onescience/catalog-secret.ts` | 共享主密钥加解密 |
| `packages/opencode/src/onescience/db-connection.ts` | 连接 CRUD、host 策略、测通、list tables、抽样查询 |
| `packages/opencode/src/onescience/data-project.sql.ts` | 新增 `onescience_db_connection` 表 |
| `packages/opencode/migration/<ts>_onescience_db_connection/` | Drizzle migration |
| `packages/opencode/src/onescience/object-store-key.ts` | 改用 `catalog-secret` |
| `packages/opencode/src/onescience/data-catalog.ts` | `database` connector：probe/register/preview/convert/publish |
| `packages/opencode/src/onescience/data-catalog-account.ts` | 删账号时清 db connections |
| `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts` | paths、payload、endpoints |
| `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts` | handlers |
| `packages/opencode/src/server/shared/workspace-routing.ts` | db-connection → local |
| `packages/opencode/test/onescience/db-connection.test.ts` | 连接/host/引用删除 |
| `packages/opencode/test/onescience/data-catalog.test.ts` | database Raw 矩阵 |
| `packages/app/src/workbench/capabilities/onedata-filters.ts` | labels、publish 规则、`database` connector |
| `packages/app/src/workbench/capabilities/onedata-catalog-api.ts` | db-connection client helpers |
| `packages/app/src/workbench/capabilities/onedata-panel.tsx` | UI：数据库替换对象存储 |
| `packages/app/src/workbench/capabilities/onedata-panel.test.ts` | 文案/入口 source tests |

---

### Task 1: Shared secret + DB connection table + CRUD

**Files:**
- Create: `packages/opencode/src/onescience/catalog-secret.ts`
- Create: `packages/opencode/src/onescience/db-connection.ts`
- Modify: `packages/opencode/src/onescience/data-project.sql.ts`
- Modify: `packages/opencode/src/onescience/object-store-key.ts`（改用 catalog-secret）
- Create: `packages/opencode/test/onescience/db-connection.test.ts`
- Generate: migration via `bun run db generate --name onescience_db_connection`（在 `packages/opencode`）

**Interfaces:**
- Produces:
  - `encryptSecret(plain: string): string` / `decryptSecret(cipher: string): string` / `requireSecretMasterKey(): Buffer`
  - `putDbConnection(input): DbConnectionPublic`
  - `listDbConnections(accountId): { items: DbConnectionPublic[] }`
  - `deleteDbConnection(accountId, id): { ok: true }`（有 Raw 引用时由 Task 3 接引用检查；本任务可先做无引用删除）
  - `DbConnectionPublic`: `{ id, engine, host, port, database, username, label?, ssl_mode?, time_created, time_updated }`（无密码）
  - `DbEngine = "postgres" | "mysql"`

- [ ] **Step 1: 写失败测试（加密与 CRUD 形状）**

在 `packages/opencode/test/onescience/db-connection.test.ts`：

```ts
import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
// after implement:
import * as DbConnection from "../../src/onescience/db-connection"

const accountId = "acct_db_test"

describe("db-connection", () => {
  test("stores password as ciphertext and never returns it", () => {
    const previous = process.env.ONECODE_OBJECT_STORE_MASTER_KEY
    process.env.ONECODE_OBJECT_STORE_MASTER_KEY = Buffer.alloc(32, 7).toString("base64")
    try {
      const saved = DbConnection.putDbConnection({
        accountId,
        engine: "postgres",
        host: "10.0.0.5",
        port: 5432,
        database: "papers_db",
        username: "reader",
        password: "super-secret-db",
        label: "文献库",
        // v1: skipLiveProbe injected in put for unit test — see Step 3
        skipLiveProbe: true,
      })
      expect(saved.id.startsWith("dbc_")).toBe(true)
      expect(JSON.stringify(saved)).not.toContain("super-secret-db")
      expect(JSON.stringify(DbConnection.listDbConnections(accountId))).not.toContain("super-secret-db")
    } finally {
      if (previous === undefined) delete process.env.ONECODE_OBJECT_STORE_MASTER_KEY
      else process.env.ONECODE_OBJECT_STORE_MASTER_KEY = previous
    }
  })

  test("rejects localhost hosts", () => {
    process.env.ONECODE_OBJECT_STORE_MASTER_KEY = Buffer.alloc(32, 7).toString("base64")
    expect(() =>
      DbConnection.assertDbHost("127.0.0.1"),
    ).toThrow()
    expect(() => DbConnection.assertDbHost("169.254.169.254")).toThrow()
    expect(() => DbConnection.assertDbHost("10.0.0.5")).not.toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/opencode && bun test test/onescience/db-connection.test.ts`  
Expected: FAIL（模块/符号不存在）

- [ ] **Step 3: 实现 schema + catalog-secret + put/list/delete + host assert**

`data-project.sql.ts` 增加：

```ts
export const OneScienceDbConnectionTable = sqliteTable("onescience_db_connection", {
  id: text().primaryKey(),
  account_id: text().notNull(),
  engine: text().notNull(), // postgres | mysql
  host: text().notNull(),
  port: integer().notNull(),
  database: text().notNull(),
  username: text().notNull(),
  password_ciphertext: text().notNull(),
  label: text(),
  ssl_mode: text(),
  ...Timestamps,
  time_deleted: integer(),
})
```

`assertDbHost(host)`：拒绝 `localhost`、`*.localhost`、`::1`、`0.0.0.0`、`127/8`、`169.254/16`；**允许** `10/8`、`172.16-31`、`192.168/16` 及其它非上述地址。

`putDbConnection`：校验 engine/port；`assertDbHost`；`id = Identifier.create("dbc", "ascending")`；加密密码；同 account+engine+host+port+database+username 可 upsert。  
本任务 `skipLiveProbe?: boolean` 仅测试用；生产路径 Task 2 强制 live probe。

从 `object-store-key.ts` 抽出加解密到 `catalog-secret.ts`，两边共用，行为不变。

生成 migration：`cd packages/opencode && bun run db generate --name onescience_db_connection`

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/opencode && bun test test/onescience/db-connection.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 2: Live probe — connect, list tables, sample rows

**Files:**
- Modify: `packages/opencode/src/onescience/db-connection.ts`
- Modify: `packages/opencode/test/onescience/db-connection.test.ts`

**Interfaces:**
- Consumes: Task 1 CRUD
- Produces:
  - `testDbConnection(input): Promise<void>`（失败抛 CatalogError）
  - `listDbTables(accountId, connectionId): Promise<{ items: Array<{ schema: string; name: string; kind: "table" | "view" }> }>`
  - `sampleDbTable(accountId, connectionId, tableRef, opts?: { limit?: number }): Promise<{ columns: string[]; rows: Record<string, unknown>[]; entry_count?: number }>`
  - `parseDbTableUri(uri): { engine, connectionId, schema: string | null, table: string }`
  - `formatDbTableUri(...): string`
  - Postgres tableRef: `{ schema, name }`；MySQL: `{ schema: null, name }`（schema 字段在 list 里 MySQL 可用 `database` 名或空字符串，URI 不含 schema）

- [ ] **Step 1: 写失败测试（URI 解析 + 无连接 list）**

```ts
test("parses postgres and mysql table URIs", () => {
  expect(DbConnection.parseDbTableUri("postgres://dbc_abc/public.papers")).toEqual({
    engine: "postgres",
    connectionId: "dbc_abc",
    schema: "public",
    table: "papers",
  })
  expect(DbConnection.parseDbTableUri("mysql://dbc_xyz/papers")).toEqual({
    engine: "mysql",
    connectionId: "dbc_xyz",
    schema: null,
    table: "papers",
  })
})

test("listDbTables rejects foreign connection", async () => {
  // create connection for accountId, then list with other account → 404/403
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/opencode && bun test test/onescience/db-connection.test.ts`  
Expected: FAIL on missing exports

- [ ] **Step 3: 实现 Bun SQL 访问**

使用 Bun `SQL`：

```ts
import { SQL } from "bun"

function openSql(conn: { engine: string; host: string; port: number; database: string; username: string; password: string; ssl_mode?: string | null }) {
  const protocol = conn.engine === "mysql" ? "mysql" : "postgres"
  // build URL with encodeURIComponent for user/pass; connection timeout ~8s via SQL options if available
  return new SQL(`${protocol}://${encodeURIComponent(conn.username)}:${encodeURIComponent(conn.password)}@${conn.host}:${conn.port}/${encodeURIComponent(conn.database)}`)
}
```

- Postgres list: `information_schema.tables` where `table_schema not in ('pg_catalog','information_schema')`
- MySQL list: `information_schema.tables` where `table_schema = database()`
- Sample: 仅构造标识符白名单（`/^[A-Za-z_][A-Za-z0-9_]*$/`）后 `` SELECT * FROM "schema"."table" LIMIT $n ``（MySQL 用反引号）；禁止拼接用户自由 SQL
- `putDbConnection` 默认调用 `testDbConnection`（`SELECT 1`）；测试可 `skipLiveProbe: true`
- 行数：Postgres 可用 `pg_class.reltuples` 估计；MySQL 可用 `information_schema.tables.table_rows`；失败则省略 `entry_count`

若本机无真实 DB，单测以 URI/权限/标识符校验为主；另加一个可用 `skipLiveProbe` 的集成注释，或用 mock `openSql` 注入（保持可测，避免强制 CI 起 Postgres）。

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/opencode && bun test test/onescience/db-connection.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 3: DataCatalog `database` connector

**Files:**
- Modify: `packages/opencode/src/onescience/data-catalog.ts`
- Modify: `packages/opencode/src/onescience/data-catalog-account.ts`
- Modify: `packages/opencode/test/onescience/data-catalog.test.ts`

**Interfaces:**
- Consumes: `DbConnection.parseDbTableUri`, `sampleDbTable`, `listDbTables`, load connection by id
- Produces:
  - `CatalogConnector` 含 `"database"`
  - `probe({ connector: "database", uri, accountId })` → exists + format_hint `"table"` + entry_count + metadata columns
  - `registerRaw` / `previewRaw` 支持 database
  - `convertRaw` for database：物化 CSV 后插入/更新 Already（`connector: "local_fs"`, `build_method: "direct"`），`source_raw_ids` 含原 raw
  - `canPublishConnector`：`database` → false；物化后的 local_fs Already 仍可 publish（与现规则一致）
  - `deleteDbConnection`：若任一未删 Raw 的 uri 含该 `dbc_id` → `CatalogError(409, "conflict", ...)`
  - `deleteAccountCatalog`：调用 `deleteAccountDbConnections(accountId)`

- [ ] **Step 1: 写失败测试**

```ts
test("database connector cannot publish; convert materializes to local file", async () => {
  // putDbConnection skipLiveProbe
  // registerRaw connector database uri postgres://dbc_…/public.t
  // publishAlready → forbidden/conflict
  // convertRaw → already.connector === "local_fs" && already.uri endsWith(".csv")
})

test("deleteDbConnection blocked while raw references it", async () => {
  // register raw then delete connection → status 409
})
```

对 probe/register：若无 live DB，在 `db-connection.ts` 提供测试钩子 `setDbQueryForTest(fn)` 或对 `sampleDbTable` mock；优先在 data-catalog 测试里注入最小假实现，避免假阴性。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/opencode && bun test test/onescience/data-catalog.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现 probe / preview / convert / publish / account cleanup**

在 `probe()` 增加 `database` 分支：解析 URI → 校验 connection owner → 确认表存在 → 返回 ProbeResult（`workspace_id: ""`, `connector: "database"`, `normalized_uri` 保持规范 URI）。

`previewRaw`：database 时走 `sampleDbTable`，把 `columns`/`rows` 放进 preview extras（扩展现有 return shape，例如 `table_preview: { columns, rows }`），不要走文件系统 sample。

`convertRaw`：若 `raw.connector === "database"`：

1. sample/export up to caps → write CSV under `leafRoot()/.onescience/db-export/<id>.csv`
2. 用 `local_fs` probe 该文件
3. 创建 Already 指向该文件（逻辑复用 convert 插入分支，但 `build_method: "direct"`，`connector: "local_fs"`）

`deleteDbConnection`：扫描 owner 的 Raw `raw_data_uri` 是否包含 `connectionId`。

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/opencode && bun test test/onescience/data-catalog.test.ts test/onescience/db-connection.test.ts`  
Expected: PASS

- [ ] **Step 5: `bun typecheck`（packages/opencode）**

- [ ] **Step 6: Commit（仅当用户要求）**

---

### Task 4: HTTP API + workspace routing

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/experimental.ts`
- Modify: `packages/opencode/src/server/shared/workspace-routing.ts`
- Modify: payload literals for probe/raw create to include `"database"`（仍可保留 `"object_store"`）

**Interfaces:**
- Produces paths:
  - `PUT/GET /experimental/onescience/db-connection`
  - `DELETE /experimental/onescience/db-connection/:id`
  - `GET /experimental/onescience/db-connection/:id/tables`
- Handlers call `DataCatalog` / `DbConnection` exports（与 object-store handlers 对称）
- `workspace-routing.ts` 增加 `{ path: "/experimental/onescience/db-connection", action: "local" }`

- [ ] **Step 1: 增加 Schema payload**

```ts
export const CatalogDbConnectionPayload = Schema.Struct({
  engine: Schema.Literals(["postgres", "mysql"]),
  host: Schema.NonEmptyString,
  port: Schema.Number,
  database: Schema.NonEmptyString,
  username: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
  label: Schema.optional(Schema.String),
  ssl_mode: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String), // upsert by id when present
})
```

扩展 `CatalogProbePayload.connector` 与 `CatalogRawCreatePayload.connector` 增加 `"database"`。

- [ ] **Step 2: 注册 endpoints + handlers**

镜像 `catalogObjectStoreKey*`：`put` 测通后保存；`list`；`delete`；`tables` GET。

- [ ] **Step 3: typecheck**

Run: `cd packages/opencode && bun typecheck`  
Expected: PASS

- [ ] **Step 4: Commit（仅当用户要求）**

---

### Task 5: Frontend API + filters（去掉对象存储入口类型）

**Files:**
- Modify: `packages/app/src/workbench/capabilities/onedata-filters.ts`
- Modify: `packages/app/src/workbench/capabilities/onedata-catalog-api.ts`
- Modify: `packages/app/src/workbench/capabilities/onedata-panel.test.ts`（先改断言）

**Interfaces:**
- Produces:
  - `RawConnector = "local_fs" | "http_dataset" | "database" | "remote_workspace"`
  - `connectorLabel("database") === "数据库"`
  - `publishBlockedReason` 对 `database` / `postgres://` / `mysql://` 返回不可发布文案
  - `listDbConnections` / `putDbConnection` / `deleteDbConnection` / `listDbTables`
  - 移除或停止导出 UI 使用的 object-store helpers（文件内可留 unused 删除）

- [ ] **Step 1: 写/改失败的 panel source 测试**

```ts
expect(source).toContain("数据库")
expect(source).not.toContain(">对象存储<")
expect(connectorLabel("database")).toBe("数据库")
expect(publishBlockedReason({ connector: "database", uri: "postgres://dbc_x/public.t" })).toBeTruthy()
```

- [ ] **Step 2: 跑 `packages/app` 测试确认失败**

Run: `cd packages/app && bun test src/workbench/capabilities/onedata-panel.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现 filters + catalog-api**

- [ ] **Step 4: 跑测试（filters 相关先过；panel 仍可能因 UI 未改失败——若 test 读 panel source，留到 Task 6）**

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 6: OneData panel UI

**Files:**
- Modify: `packages/app/src/workbench/capabilities/onedata-panel.tsx`
- Modify: `packages/app/src/workbench/capabilities/onedata-panel.test.ts`
- CSS：仅当现有 class 不够时少量加在现有 onedata 样式文件（若有）

**Interfaces:**
- Consumes: Task 5 API helpers
- Produces: 用户可添加连接、选表多选登记、列表按连接分组；无对象存储表单

- [ ] **Step 1: 更新 source 测试期望**

断言 intro 含「已连接数据库中的表」；connector 按钮「数据库」；不出现对象存储密钥表单文案「云厂商」。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 改 UI**

1. Connector toggle：`object_store` → `database`
2. `database` 时展示：
   - 连接表单（engine/host/port/database/user/password/label）+ 已存连接列表/删除
   - 选连接 → `listDbTables` → checkbox 多选 → 「登记为原始数据」循环 `registerRawSource`
3. Raw 列表：`database` 项按 `uri` 中 `dbc_*` 分组，组头显示 `label || host/database`
4. 主操作强调「预览」「加入对话」；「直接转化」保留但次要（database 可用）
5. 删除 object-store 密钥 UI 块

- [ ] **Step 4: 跑测试通过**

Run: `cd packages/app && bun test src/workbench/capabilities/onedata-panel.test.ts`  
Expected: PASS

- [ ] **Step 5: `bun typecheck`（packages/app）**

- [ ] **Step 6: Commit（仅当用户要求）**

---

### Task 7: Session chip context note + smoke checklist

**Files:**
- Modify: session prompt/chip inject 点（检索 `getChips` / `raw_ids` / `dataset_report` 邻近，常见于 `packages/opencode/src/session/prompt.ts` 或 onescience instruction；若已有 Raw chip 注入，追加一句）
- Modify: tests if present

**Interfaces:**
- When chip Raw has `connector === "database"`，注入文案包含：只读表数据、可用于阅读/整理；默认不是训练集；登记可训练需 `dataset_report` 或转化

- [ ] **Step 1: 定位现有 chip 注入代码并加 database 分支文案**

- [ ] **Step 2: 若有单测则补断言；否则手工 checklist 写入 PR 描述**

手工验收：

1. 添加 Postgres 内网连接 → 列表无密码  
2. 登记两张表 → 两条 Raw，同组  
3. 预览有列与抽样行  
4. 加入对话 → chips 可见  
5. 发布 database 物化前的 Already（若未 convert）应失败；convert 后 local_fs Already 可发布（可选）  
6. UI 无「对象存储」

- [ ] **Step 3: 全量相关测试**

```bash
cd packages/opencode && bun test test/onescience/db-connection.test.ts test/onescience/data-catalog.test.ts
cd packages/app && bun test src/workbench/capabilities/onedata-panel.test.ts
cd packages/opencode && bun typecheck
cd packages/app && bun typecheck
```

- [ ] **Step 4: Commit（仅当用户要求）**

---

## Spec coverage checklist

| Spec 要求 | Task |
|---|---|
| 连接 ≠ Raw；表 = Raw | 1–3, 6 |
| Postgres + MySQL | 2 |
| 加密连接 / 无密码回传 | 1, 4 |
| list tables + register | 2–4, 6 |
| 预览 + chips 主路径 | 3, 6, 7 |
| 可选 convert 物化 | 3 |
| 不可 publish database | 3, 5 |
| 允许内网、拒 localhost/metadata | 1–2 |
| UI 去对象存储 | 5–6 |
| 账号删除清连接 | 3 |
| 对象存储 API 暂留 | 4（不删） |

## Placeholder / consistency self-review

- 无 TBD；open choices 已锁定  
- URI / `dbc_` / `database` connector 命名在各 Task 一致  
- Commit 步骤服从用户「先要求再提交」约束
