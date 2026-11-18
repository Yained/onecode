# OneScience 原语平台实现计划

## 概述

本计划基于 `docs/superpowers/specs/2026-05-20-onescience-primitive-platform-redesign.md` 设计文档，实现 OneScience 从资源展示工作区到科学 AI 能力资产平台的演变。

## 目标

- 创建 `ai_primitive` 表和扩展 `onescience_resource` 表
- 实现原语 CRUD API
- 迁移 32 个静态原语到数据库
- 在资源卡片添加"转为原语"功能
- 创建 Agent Registry 页面
- 改造 Primitives 页面数据源

## 文件结构映射

### 后端文件

```
packages/opencode/src/onescience/
├── resource.sql.ts              # 现有：资源表定义
├── resource.ts                  # 现有：资源业务逻辑
├── primitive.sql.ts             # 新增：原语表定义
├── primitive.ts                 # 新增：原语业务逻辑
└── primitive-migration.ts       # 新增：静态原语迁移脚本
```

### 前端文件

```
packages/app/src/
├── pages/
│   ├── onescience.tsx           # 修改：添加"转为原语"按钮
│   ├── onescience-primitives.ts # 保留：静态原语数据（作为备份）
│   ├── agent-registry.tsx       # 新增：Agent Registry 页面
│   └── primitives.tsx           # 新增：改造后的 Primitives 页面
└── components/onescience/
    ├── PrimitiveCreateDialog.tsx    # 新增：原语创建对话框
    ├── ContractEditor.tsx           # 新增：契约编辑器
    └── PrimitiveCard.tsx            # 新增：原语卡片组件
```

## Phase 1: 数据模型和基础 API

### 任务 1.1: 创建 ai_primitive 表定义

**文件**: `packages/opencode/src/onescience/primitive.sql.ts`

**步骤**:
1. 创建文件并定义表结构
2. 包含所有必需字段：id, slug, title, description, domain, primitive_type, intent_tags, source_resource_ids, status, contract_json, adapter_json, validation_json, quality_score, owner, timestamps

**代码**:
```typescript
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const AIPrimitiveTable = sqliteTable("ai_primitive", {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  description: text().notNull(),
  domain: text().notNull(),
  primitive_type: text().notNull(),
  intent_tags: text({ mode: "json" }).notNull().$type<string[]>(),
  source_resource_ids: text({ mode: "json" }).$type<string[]>(),
  status: text().notNull().default("draft"),
  contract_json: text({ mode: "json" }).$type<Record<string, any>>(),
  adapter_json: text({ mode: "json" }).$type<Record<string, any>>(),
  validation_json: text({ mode: "json" }).$type<Record<string, any>>(),
  quality_score: real(),
  owner: text(),
  ...Timestamps,
  time_deleted: integer(),
})
```

**验证**: 编译通过，类型检查无错误

---

### 任务 1.2: 扩展 onescience_resource 表

**文件**: `packages/opencode/src/onescience/resource.sql.ts`

**步骤**:
1. 添加新字段：resource_type, trust_level, license, version, owner, metadata, verification_state, verified_at, verified_by

**代码**:
```typescript
export const OneScienceResourceTable = sqliteTable("onescience_resource", {
  id: text().primaryKey(),
  page: text().notNull(),
  title: text().notNull(),
  copy: text().notNull(),
  domain: text().notNull().default("其它"),
  tags: text({ mode: "json" }).notNull().$type<string[]>(),
  provider: text().notNull(),
  size: text().notNull(),
  format: text().notNull(),
  href: text(),
  source: text().notNull(),
  metric_label: text().notNull(),
  action: text().notNull(),
  // 新增字段
  resource_type: text(),
  trust_level: text().default("user"),
  license: text(),
  version: text(),
  owner: text(),
  metadata: text({ mode: "json" }).$type<Record<string, any>>(),
  verification_state: text().default("draft"),
  verified_at: integer(),
  verified_by: text(),
  ...Timestamps,
  time_deleted: integer(),
})
```

**验证**: 编译通过，类型检查无错误

---

### 任务 1.3: 创建数据库迁移脚本

**文件**: 创建新的迁移目录和 SQL 文件

**步骤**:
1. 创建迁移目录（时间戳格式）
2. 编写 migration.sql 文件

**命令**:
```bash
mkdir -p packages/console/core/migrations/$(date +%Y%m%d%H%M%S)_add_ai_primitive
```

**SQL 内容**:
```sql
-- 创建 ai_primitive 表
CREATE TABLE IF NOT EXISTS ai_primitive (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,
  primitive_type TEXT NOT NULL,
  intent_tags TEXT NOT NULL,
  source_resource_ids TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  contract_json TEXT,
  adapter_json TEXT,
  validation_json TEXT,
  quality_score REAL,
  owner TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_deleted INTEGER
);

-- 扩展 onescience_resource 表
ALTER TABLE onescience_resource ADD COLUMN resource_type TEXT;
ALTER TABLE onescience_resource ADD COLUMN trust_level TEXT DEFAULT 'user';
ALTER TABLE onescience_resource ADD COLUMN license TEXT;
ALTER TABLE onescience_resource ADD COLUMN version TEXT;
ALTER TABLE onescience_resource ADD COLUMN owner TEXT;
ALTER TABLE onescience_resource ADD COLUMN metadata TEXT;
ALTER TABLE onescience_resource ADD COLUMN verification_state TEXT DEFAULT 'draft';
ALTER TABLE onescience_resource ADD COLUMN verified_at INTEGER;
ALTER TABLE onescience_resource ADD COLUMN verified_by TEXT;

-- 创建索引
CREATE INDEX idx_ai_primitive_status ON ai_primitive(status);
CREATE INDEX idx_ai_primitive_domain ON ai_primitive(domain);
CREATE INDEX idx_ai_primitive_type ON ai_primitive(primitive_type);
CREATE INDEX idx_ai_primitive_slug ON ai_primitive(slug);
```

**验证**: 迁移脚本语法正确

---

### 任务 1.4: 定义原语类型和状态枚举

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 定义 PrimitiveType 枚举
2. 定义 PrimitiveStatus 枚举
3. 使用 Effect Schema 定义类型

**代码**:
```typescript
import { Schema } from "effect"

export const PrimitiveType = Schema.Union([
  Schema.Literal("data.load"),
  Schema.Literal("data.transform"),
  Schema.Literal("model.run"),
  Schema.Literal("model.train"),
  Schema.Literal("model.evaluate"),
  Schema.Literal("app.launch"),
  Schema.Literal("operator.apply"),
  Schema.Literal("code.generate"),
  Schema.Literal("workflow.compose"),
  Schema.Literal("runtime.submit"),
])
export type PrimitiveType = typeof PrimitiveType.Type

export const PrimitiveStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("review_pending"),
  Schema.Literal("verified"),
  Schema.Literal("callable"),
  Schema.Literal("deprecated"),
])
export type PrimitiveStatus = typeof PrimitiveStatus.Type

export const AdapterMode = Schema.Union([
  Schema.Literal("documentation"),
  Schema.Literal("code_reference"),
  Schema.Literal("script"),
  Schema.Literal("http"),
  Schema.Literal("mcp"),
  Schema.Literal("workflow"),
])
export type AdapterMode = typeof AdapterMode.Type
```

**验证**: 编译通过，类型正确

---

### 任务 1.5: 定义原语数据结构

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 定义 Primitive Schema
2. 定义 CreatePrimitive Schema
3. 定义 UpdatePrimitive Schema

**代码**:
```typescript
export const Primitive = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  description: Schema.String,
  domain: Schema.String,
  primitiveType: PrimitiveType,
  intentTags: Schema.Array(Schema.String),
  sourceResourceIds: Schema.optional(Schema.Array(Schema.String)),
  status: PrimitiveStatus,
  contractJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  adapterJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  validationJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  qualityScore: Schema.optional(Schema.Number),
  owner: Schema.optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "AIPrimitive" })
export type Primitive = typeof Primitive.Type

export const CreatePrimitive = Schema.Struct({
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  domain: Schema.NonEmptyString,
  primitiveType: PrimitiveType,
  intentTags: Schema.Array(Schema.String),
  sourceResourceIds: Schema.optional(Schema.Array(Schema.String)),
  contractJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  adapterJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
}).annotate({ identifier: "CreateAIPrimitive" })
export type CreatePrimitive = typeof CreatePrimitive.Type

export const UpdatePrimitive = Schema.Struct({
  title: Schema.optional(Schema.NonEmptyString),
  description: Schema.optional(Schema.NonEmptyString),
  domain: Schema.optional(Schema.NonEmptyString),
  primitiveType: Schema.optional(PrimitiveType),
  intentTags: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(PrimitiveStatus),
  contractJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  adapterJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  validationJson: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  qualityScore: Schema.optional(Schema.Number),
}).annotate({ identifier: "UpdateAIPrimitive" })
export type UpdatePrimitive = typeof UpdatePrimitive.Type
```

**验证**: 编译通过，类型正确

---

### 任务 1.6: 实现原语 list 函数

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 实现 list 函数，支持分页和筛选
2. 支持按 status, domain, primitiveType 筛选

**代码**:
```typescript
import { Database } from "@/storage/db"
import { and, desc, eq, isNull } from "drizzle-orm"
import { AIPrimitiveTable } from "./primitive.sql"

export function list(input?: {
  status?: PrimitiveStatus
  domain?: string
  primitiveType?: PrimitiveType
  limit?: number
  offset?: number
}) {
  const limit = Math.max(1, Math.min(input?.limit ?? 24, 100))
  const offset = Math.max(0, input?.offset ?? 0)

  return Database.use((db) => {
    const rows = db
      .select()
      .from(AIPrimitiveTable)
      .where(
        and(
          input?.status ? eq(AIPrimitiveTable.status, input.status) : undefined,
          input?.domain ? eq(AIPrimitiveTable.domain, input.domain) : undefined,
          input?.primitiveType ? eq(AIPrimitiveTable.primitive_type, input.primitiveType) : undefined,
          isNull(AIPrimitiveTable.time_deleted),
        ),
      )
      .orderBy(desc(AIPrimitiveTable.time_created), desc(AIPrimitiveTable.id))
      .limit(limit + 1)
      .offset(offset)
      .all()

    return {
      items: rows.slice(0, limit).map(fromRow),
      nextOffset: rows.length > limit ? offset + limit : undefined,
    }
  })
}

function fromRow(row: typeof AIPrimitiveTable.$inferSelect): Primitive {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    domain: row.domain,
    primitiveType: row.primitive_type as PrimitiveType,
    intentTags: row.intent_tags,
    sourceResourceIds: row.source_resource_ids ?? undefined,
    status: row.status as PrimitiveStatus,
    contractJson: row.contract_json ?? undefined,
    adapterJson: row.adapter_json ?? undefined,
    validationJson: row.validation_json ?? undefined,
    qualityScore: row.quality_score ?? undefined,
    owner: row.owner ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}
```

**验证**: 编译通过，函数签名正确

---

### 任务 1.7: 实现原语 create 函数

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 实现 create 函数
2. 自动生成 id 和 slug
3. 设置默认状态为 draft

**代码**:
```typescript
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100)
}

export function create(input: CreatePrimitive) {
  const now = Date.now()
  const baseSlug = generateSlug(input.title)
  const slug = `${baseSlug}-${crypto.randomUUID().substring(0, 8)}`

  const row = {
    id: `primitive-${crypto.randomUUID()}`,
    slug,
    title: input.title,
    description: input.description,
    domain: input.domain,
    primitive_type: input.primitiveType,
    intent_tags: [...input.intentTags],
    source_resource_ids: input.sourceResourceIds ? [...input.sourceResourceIds] : null,
    status: "draft" as const,
    contract_json: input.contractJson ?? null,
    adapter_json: input.adapterJson ?? null,
    validation_json: null,
    quality_score: null,
    owner: null,
    time_created: now,
    time_updated: now,
    time_deleted: null,
  }

  Database.use((db) => db.insert(AIPrimitiveTable).values(row).run())
  return fromRow(row)
}
```

**验证**: 编译通过，函数逻辑正确

---

### 任务 1.8: 实现原语 update 函数

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 实现 update 函数
2. 支持部分更新
3. 更新 time_updated

**代码**:
```typescript
export function update(id: string, input: UpdatePrimitive) {
  return Database.transaction((db) => {
    const existing = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    db.update(AIPrimitiveTable)
      .set({
        title: input.title ?? existing.title,
        description: input.description ?? existing.description,
        domain: input.domain ?? existing.domain,
        primitive_type: input.primitiveType ?? existing.primitive_type,
        intent_tags: input.intentTags ? [...input.intentTags] : existing.intent_tags,
        status: input.status ?? existing.status,
        contract_json: input.contractJson !== undefined ? input.contractJson : existing.contract_json,
        adapter_json: input.adapterJson !== undefined ? input.adapterJson : existing.adapter_json,
        validation_json: input.validationJson !== undefined ? input.validationJson : existing.validation_json,
        quality_score: input.qualityScore !== undefined ? input.qualityScore : existing.quality_score,
        time_updated: Date.now(),
      })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    const row = db.select().from(AIPrimitiveTable).where(eq(AIPrimitiveTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    return fromRow(row)
  })
}
```

**验证**: 编译通过，事务逻辑正确

---

### 任务 1.9: 实现原语 remove 函数

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 实现软删除
2. 设置 time_deleted

**代码**:
```typescript
export function remove(id: string) {
  return Database.transaction((db) => {
    const existing = db
      .select({ id: AIPrimitiveTable.id })
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) return false

    db.update(AIPrimitiveTable)
      .set({ time_deleted: Date.now(), time_updated: Date.now() })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    return true
  })
}
```

**验证**: 编译通过，软删除逻辑正确

---

### 任务 1.10: 实现原语状态流转函数

**文件**: `packages/opencode/src/onescience/primitive.ts`

**步骤**:
1. 实现 verify 函数（draft/review_pending -> verified）
2. 实现 publish 函数（verified -> callable）
3. 实现 deprecate 函数（任何状态 -> deprecated）

**代码**:
```typescript
export function verify(id: string) {
  return Database.transaction((db) => {
    const existing = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    if (existing.status !== "draft" && existing.status !== "review_pending") {
      throw new Error(`Cannot verify primitive with status: ${existing.status}`)
    }

    db.update(AIPrimitiveTable)
      .set({ status: "verified", time_updated: Date.now() })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    const row = db.select().from(AIPrimitiveTable).where(eq(AIPrimitiveTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    return fromRow(row)
  })
}

export function publish(id: string) {
  return Database.transaction((db) => {
    const existing = db
      .select()
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    if (existing.status !== "verified") {
      throw new Error(`Cannot publish primitive with status: ${existing.status}`)
    }

    db.update(AIPrimitiveTable)
      .set({ status: "callable", time_updated: Date.now() })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    const row = db.select().from(AIPrimitiveTable).where(eq(AIPrimitiveTable.id, id)).get()
    if (!row) throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    return fromRow(row)
  })
}

export function deprecate(id: string) {
  return Database.transaction((db) => {
    const existing = db
      .select({ id: AIPrimitiveTable.id })
      .from(AIPrimitiveTable)
      .where(and(eq(AIPrimitiveTable.id, id), isNull(AIPrimitiveTable.time_deleted)))
      .get()

    if (!existing) {
      throw new Database.NotFoundError({ message: `AI Primitive not found: ${id}` })
    }

    db.update(AIPrimitiveTable)
      .set({ status: "deprecated", time_updated: Date.now() })
      .where(eq(AIPrimitiveTable.id, id))
      .run()

    return true
  })
}

export * as AIPrimitive from "./primitive"
```

**验证**: 编译通过，状态流转逻辑正确

---

### 任务 1.11: 创建静态原语迁移脚本

**文件**: `packages/opencode/src/onescience/primitive-migration.ts`

**步骤**:
1. 读取静态原语数据
2. 转换为数据库格式
3. 批量插入

**代码**:
```typescript
import { Database } from "@/storage/db"
import { AIPrimitiveTable } from "./primitive.sql"
import { primitivePage } from "../../app/src/pages/onescience-primitives"

type StaticPrimitive = {
  id: string
  title: string
  copy: string
  tags: string[]
  provider: string
  size: string
  format: string
  href: string
}

function inferPrimitiveType(tags: string[]): string {
  if (tags.includes("AI Modules")) return "code.generate"
  if (tags.includes("Metrics")) return "model.evaluate"
  if (tags.includes("DataPipes")) return "data.transform"
  if (tags.includes("Coder Assets")) return "code.generate"
  return "code.generate"
}

function inferDomain(tags: string[]): string {
  if (tags.some(t => t.includes("weather") || t.includes("earth"))) return "地球科学"
  if (tags.some(t => t.includes("bio") || t.includes("protein"))) return "生命科学"
  if (tags.some(t => t.includes("material"))) return "材料化学"
  return "其它"
}

function extractIntentTags(tags: string[]): string[] {
  return tags.filter(tag =>
    !["AI Modules", "Metrics", "DataPipes", "Coder Assets"].includes(tag)
  )
}

export function migratePrimitives() {
  const now = Date.now()
  return Database.transaction((db) => {
    let migrated = 0
    let skipped = 0

    for (const [index, item] of (primitivePage.items as StaticPrimitive[]).entries()) {
      const existing = db
        .select({ id: AIPrimitiveTable.id })
        .from(AIPrimitiveTable)
        .where(eq(AIPrimitiveTable.id, item.id))
        .get()

      if (existing) {
        skipped++
        continue
      }

      const slug = item.id.replace(/^primitive-/, "")
      const row = {
        id: item.id,
        slug,
        title: item.title,
        description: item.copy,
        domain: inferDomain(item.tags),
        primitive_type: inferPrimitiveType(item.tags),
        intent_tags: extractIntentTags(item.tags),
        source_resource_ids: null,
        status: "callable" as const,
        contract_json: {
          id: slug,
          name: item.title,
          intent: extractIntentTags(item.tags),
        },
        adapter_json: {
          mode: "code_reference",
          reference: {
            repo: item.href,
            path: "",
            entry: "",
          },
        },
        validation_json: null,
        quality_score: null,
        owner: "system",
        time_created: now - index,
        time_updated: now,
        time_deleted: null,
      }

      db.insert(AIPrimitiveTable).values(row).run()
      migrated++
    }

    return { migrated, skipped }
  })
}
```

**验证**: 编译通过，迁移逻辑正确

---

## Phase 2: 资源卡片增强

### 任务 2.1: 在 ResourceCard 添加"转为原语"按钮

**文件**: `packages/app/src/pages/onescience.tsx`

**步骤**:
1. 在资源卡片底部添加按钮
2. 仅对已验证资源显示
3. 点击打开对话框

**修改位置**: 找到 ResourceCard 组件的操作按钮区域

**代码片段**:
```tsx
// 在现有的操作按钮后添加
{resource.source === "onescience" && (
  <button
    class="text-sm px-3 py-1 rounded border border-gray-300 hover:bg-gray-50"
    onClick={() => setShowPrimitiveDialog(resource.id)}
  >
    转为原语
  </button>
)}
```

**验证**: UI 渲染正确，按钮显示

---

### 任务 2.2: 创建 PrimitiveCreateDialog 组件骨架

**文件**: `packages/app/src/components/onescience/PrimitiveCreateDialog.tsx`

**步骤**:
1. 创建对话框组件
2. 定义 props 接口
3. 实现基本布局

**代码**:
```tsx
import { Component, createSignal, Show } from "solid-js"

interface PrimitiveCreateDialogProps {
  resourceId?: string
  onClose: () => void
  onSuccess: (primitiveId: string) => void
}

export const PrimitiveCreateDialog: Component<PrimitiveCreateDialogProps> = (props) => {
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [domain, setDomain] = createSignal("地球科学")
  const [primitiveType, setPrimitiveType] = createSignal("model.run")
  const [intentTags, setIntentTags] = createSignal<string[]>([])

  return (
    <Show when={props.resourceId}>
      <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <h2 class="text-xl font-bold mb-4">创建 AI 原语</h2>

          {/* 基础信息 */}
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">名称</label>
              <input
                type="text"
                class="w-full border rounded px-3 py-2"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-1">描述</label>
              <textarea
                class="w-full border rounded px-3 py-2"
                rows={3}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
              />
            </div>

            <div>
              <label class="block text-sm font-medium mb-1">领域</label>
              <select
                class="w-full border rounded px-3 py-2"
                value={domain()}
                onChange={(e) => setDomain(e.currentTarget.value)}
              >
                <option value="地球科学">地球科学</option>
                <option value="生命科学">生命科学</option>
                <option value="材料化学">材料化学</option>
                <option value="流体仿真">流体仿真</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium mb-1">原语类型</label>
              <select
                class="w-full border rounded px-3 py-2"
                value={primitiveType()}
                onChange={(e) => setPrimitiveType(e.currentTarget.value)}
              >
                <option value="data.load">数据加载</option>
                <option value="data.transform">数据转换</option>
                <option value="model.run">模型运行</option>
                <option value="model.train">模型训练</option>
                <option value="model.evaluate">模型评估</option>
              </select>
            </div>
          </div>

          {/* 操作按钮 */}
          <div class="flex justify-end gap-2 mt-6">
            <button
              class="px-4 py-2 border rounded hover:bg-gray-50"
              onClick={props.onClose}
            >
              取消
            </button>
            <button
              class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() => {/* TODO: 实现保存逻辑 */}}
            >
              保存为草稿
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
```

**验证**: 组件渲染正确，对话框显示

---

### 任务 2.3: 实现对话框数据加载

**文件**: `packages/app/src/components/onescience/PrimitiveCreateDialog.tsx`

**步骤**:
1. 从资源 ID 加载资源数据
2. 自动填充基础信息

**代码片段**:
```tsx
const [loading, setLoading] = createSignal(true)
const [resource, setResource] = createSignal<any>(null)

createEffect(() => {
  if (props.resourceId) {
    setLoading(true)
    fetch(`/api/experimental/onescience/resource/${props.resourceId}`)
      .then(res => res.json())
      .then(data => {
        setResource(data)
        setTitle(data.title)
        setDescription(data.copy)
        setDomain(data.domain)
        setLoading(false)
      })
  }
})
```

**验证**: 数据加载正确，字段自动填充

---

### 任务 2.4: 实现保存原语功能

**文件**: `packages/app/src/components/onescience/PrimitiveCreateDialog.tsx`

**步骤**:
1. 实现保存函数
2. 调用后端 API
3. 处理成功和错误

**代码片段**:
```tsx
const [saving, setSaving] = createSignal(false)
const [error, setError] = createSignal("")

const handleSave = async () => {
  if (!title() || !description()) {
    setError("请填写名称和描述")
    return
  }

  setSaving(true)
  setError("")

  try {
    const response = await fetch("/api/experimental/onescience/primitive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title(),
        description: description(),
        domain: domain(),
        primitiveType: primitiveType(),
        intentTags: intentTags(),
        sourceResourceIds: props.resourceId ? [props.resourceId] : undefined,
      }),
    })

    if (!response.ok) throw new Error("保存失败")

    const data = await response.json()
    props.onSuccess(data.id)
    props.onClose()
  } catch (err) {
    setError(err instanceof Error ? err.message : "保存失败")
  } finally {
    setSaving(false)
  }
}
```

**验证**: 保存功能正常，错误处理正确

---

## Phase 3: Agent Registry 页面

### 任务 3.1: 创建 Agent Registry 页面骨架

**文件**: `packages/app/src/pages/agent-registry.tsx`

**步骤**:
1. 创建页面组件
2. 实现基本布局
3. 添加搜索和筛选区域

**代码**:
```tsx
import { Component, createSignal, createEffect, For } from "solid-js"

export default function AgentRegistry() {
  const [primitives, setPrimitives] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [domainFilter, setDomainFilter] = createSignal("")
  const [typeFilter, setTypeFilter] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal("callable")

  return (
    <div class="container mx-auto px-4 py-8">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">Agent Registry</h1>
        <p class="text-gray-600">代理注册表 - 可调用的 AI 原语</p>
      </div>

      {/* 搜索和筛选 */}
      <div class="mb-6 flex gap-4">
        <input
          type="text"
          placeholder="搜索原语..."
          class="flex-1 border rounded px-4 py-2"
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
        <select
          class="border rounded px-4 py-2"
          value={domainFilter()}
          onChange={(e) => setDomainFilter(e.currentTarget.value)}
        >
          <option value="">所有领域</option>
          <option value="地球科学">地球科学</option>
          <option value="生命科学">生命科学</option>
          <option value="材料化学">材料化学</option>
        </select>
        <select
          class="border rounded px-4 py-2"
          value={typeFilter()}
          onChange={(e) => setTypeFilter(e.currentTarget.value)}
        >
          <option value="">所有类型</option>
          <option value="model.run">模型运行</option>
          <option value="data.load">数据加载</option>
          <option value="data.transform">数据转换</option>
        </select>
        <select
          class="border rounded px-4 py-2"
          value={statusFilter()}
          onChange={(e) => setStatusFilter(e.currentTarget.value)}
        >
          <option value="">所有状态</option>
          <option value="callable">可调用</option>
          <option value="verified">已验证</option>
        </select>
      </div>

      {/* 原语列表 */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <For each={primitives()}>
          {(primitive) => (
            <div class="border rounded p-4">
              <h3 class="font-bold mb-2">{primitive.title}</h3>
              <p class="text-sm text-gray-600 mb-2">{primitive.description}</p>
              <div class="flex gap-2 mb-2">
                <span class="text-xs px-2 py-1 bg-blue-100 rounded">{primitive.status}</span>
                <span class="text-xs px-2 py-1 bg-gray-100 rounded">{primitive.primitiveType}</span>
              </div>
              <div class="flex gap-2">
                <button class="text-sm text-blue-600 hover:underline">查看契约</button>
                <button class="text-sm text-blue-600 hover:underline">使用</button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

**验证**: 页面渲染正确，布局合理

---

### 任务 3.2: 实现原语列表加载

**文件**: `packages/app/src/pages/agent-registry.tsx`

**步骤**:
1. 实现数据加载函数
2. 支持筛选参数
3. 处理加载状态

**代码片段**:
```tsx
const loadPrimitives = async () => {
  setLoading(true)
  try {
    const params = new URLSearchParams()
    if (domainFilter()) params.set("domain", domainFilter())
    if (typeFilter()) params.set("primitiveType", typeFilter())
    if (statusFilter()) params.set("status", statusFilter())

    const response = await fetch(`/api/experimental/onescience/agent-registry?${params}`)
    if (!response.ok) throw new Error("加载失败")

    const data = await response.json()
    setPrimitives(data.items)
  } catch (err) {
    console.error("加载原语失败:", err)
  } finally {
    setLoading(false)
  }
}

createEffect(() => {
  loadPrimitives()
})

createEffect(() => {
  // 监听筛选条件变化
  domainFilter()
  typeFilter()
  statusFilter()
  loadPrimitives()
})
```

**验证**: 数据加载正确，筛选功能正常

---

### 任务 3.3: 实现契约查看对话框

**文件**: `packages/app/src/pages/agent-registry.tsx`

**步骤**:
1. 创建契约查看对话框
2. 显示契约详细信息
3. 格式化 JSON 显示

**代码片段**:
```tsx
const [selectedPrimitive, setSelectedPrimitive] = createSignal<any>(null)

const ContractDialog: Component<{ primitive: any; onClose: () => void }> = (props) => {
  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold mb-4">原语契约</h2>

        <div class="space-y-4">
          <div>
            <h3 class="font-semibold mb-2">基本信息</h3>
            <p><strong>名称:</strong> {props.primitive.title}</p>
            <p><strong>类型:</strong> {props.primitive.primitiveType}</p>
            <p><strong>领域:</strong> {props.primitive.domain}</p>
          </div>

          <div>
            <h3 class="font-semibold mb-2">契约定义</h3>
            <pre class="bg-gray-100 p-4 rounded overflow-x-auto">
              {JSON.stringify(props.primitive.contractJson, null, 2)}
            </pre>
          </div>

          <div>
            <h3 class="font-semibold mb-2">适配器配置</h3>
            <pre class="bg-gray-100 p-4 rounded overflow-x-auto">
              {JSON.stringify(props.primitive.adapterJson, null, 2)}
            </pre>
          </div>
        </div>

        <div class="flex justify-end mt-6">
          <button
            class="px-4 py-2 border rounded hover:bg-gray-50"
            onClick={props.onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
```

**验证**: 对话框显示正确，契约信息完整

---

## Phase 4: Primitives 页面改造

### 任务 4.1: 改造 Primitives 页面数据源

**文件**: `packages/app/src/pages/primitives.tsx`（新建）

**步骤**:
1. 创建新的 Primitives 页面
2. 从数据库加载原语
3. 保留静态数据作为备份

**代码**:
```tsx
import { Component, createSignal, createEffect, For } from "solid-js"
import { primitivePage } from "./onescience-primitives"

export default function Primitives() {
  const [primitives, setPrimitives] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(true)
  const [filter, setFilter] = createSignal("全部")

  const loadPrimitives = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/experimental/onescience/primitive")
      if (!response.ok) {
        // 如果 API 失败，使用静态数据
        setPrimitives(primitivePage.items)
        return
      }

      const data = await response.json()
      setPrimitives(data.items)
    } catch (err) {
      console.error("加载原语失败，使用静态数据:", err)
      setPrimitives(primitivePage.items)
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    loadPrimitives()
  })

  const filteredPrimitives = () => {
    if (filter() === "全部") return primitives()
    return primitives().filter((p: any) =>
      p.tags?.includes(filter()) || p.intentTags?.includes(filter())
    )
  }

  return (
    <div class="container mx-auto px-4 py-8">
      <div class="mb-8">
        <h1 class="text-3xl font-bold mb-2">{primitivePage.title}</h1>
        <p class="text-gray-600">{primitivePage.count}</p>
      </div>

      {/* 筛选器 */}
      <div class="mb-6 flex gap-2">
        <For each={primitivePage.filters}>
          {(f) => (
            <button
              class={`px-4 py-2 rounded ${filter() === f ? "bg-blue-500 text-white" : "bg-gray-100"}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          )}
        </For>
      </div>

      {/* 原语列表 */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <For each={filteredPrimitives()}>
          {(primitive) => (
            <div class="border rounded p-4">
              <h3 class="font-bold mb-2">{primitive.title}</h3>
              <p class="text-sm text-gray-600 mb-2">
                {primitive.description || primitive.copy}
              </p>
              <div class="flex justify-between items-center">
                <span class="text-xs text-gray-500">
                  {primitive.provider || primitive.domain}
                </span>
                <a
                  href={primitive.href}
                  target="_blank"
                  class="text-sm text-blue-600 hover:underline"
                >
                  {primitive.action || "使用"}
                </a>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

**验证**: 页面渲染正确，数据加载正常，降级到静态数据正常

---

## Phase 5: API 路由和测试

### 任务 5.1: 添加原语 API 路由

**文件**: 需要查找现有的 API 路由配置文件

**步骤**:
1. 添加 `/experimental/onescience/primitive` 路由
2. 添加 `/experimental/onescience/agent-registry` 路由
3. 连接到业务逻辑函数

**注**: 具体实现取决于项目的路由配置方式，需要在实施时查看现有路由结构

---

### 任务 5.2: 运行数据库迁移

**步骤**:
1. 确保迁移脚本已创建
2. 运行迁移命令
3. 验证表结构

**命令**:
```bash
# 运行迁移（具体命令取决于项目配置）
npm run db:migrate
# 或
bun run db:migrate
```

**验证**: 表创建成功，字段正确

---

### 任务 5.3: 运行静态原语迁移

**步骤**:
1. 创建迁移脚本入口
2. 运行迁移
3. 验证数据

**代码**:
```typescript
// 在适当的位置调用迁移函数
import { migratePrimitives } from "@/onescience/primitive-migration"

const result = migratePrimitives()
console.log(`迁移完成: ${result.migrated} 个原语已迁移, ${result.skipped} 个已存在`)
```

**验证**: 32 个原语成功迁移到数据库

---

## 实施顺序

1. **Phase 1**: 按顺序执行任务 1.1 - 1.11，完成后端数据模型和 API
2. **Phase 2**: 按顺序执行任务 2.1 - 2.4，完成资源卡片增强
3. **Phase 3**: 按顺序执行任务 3.1 - 3.3，完成 Agent Registry 页面
4. **Phase 4**: 执行任务 4.1，完成 Primitives 页面改造
5. **Phase 5**: 执行任务 5.1 - 5.3，完成 API 路由和数据迁移

## 验证检查点

- [ ] Phase 1 完成：数据库表创建成功，API 函数编译通过
- [ ] Phase 2 完成：资源卡片显示"转为原语"按钮，对话框可以打开和保存
- [ ] Phase 3 完成：Agent Registry 页面可以访问，原语列表正常显示
- [ ] Phase 4 完成：Primitives 页面从数据库加载数据
- [ ] Phase 5 完成：32 个静态原语成功迁移，API 路由正常工作

## 注意事项

1. **最小化改动**: 每个任务只修改必要的代码，避免过度重构
2. **向后兼容**: 保留静态原语数据作为备份，API 失败时降级使用
3. **错误处理**: 所有 API 调用都要有错误处理和用户提示
4. **类型安全**: 使用 TypeScript 类型确保数据结构正确
5. **测试验证**: 每个任务完成后立即验证功能是否正常

