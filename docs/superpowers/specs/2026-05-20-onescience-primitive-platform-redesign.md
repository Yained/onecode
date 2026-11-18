# OneScience 原语平台界面重新设计

## 概述

本设计文档基于 `2026-05-20-onescience-resource-primitive-platform-design.md` 的产品架构,提出界面和产品的重新设计方案。

OneScience 将从资源展示工作区演变为科学 AI 能力资产平台,采用渐进式混合架构实现三层产品结构:

```
Resource Center -> Primitive Factory -> Agent Registry
```

核心理念:
- 保持现有界面风格和用户体验
- 通过渐进式引入原语概念,降低学习成本
- 将静态原语数据迁移到数据库,支持动态管理
- 最小化代码改动,最大化功能价值

## 目标

- 在现有资源页面基础上,添加"转为原语"功能
- 实现原语创建、编辑、验证的完整生命周期管理
- 新增 Agent Registry 页面,展示可调用的原语
- 将 32 个静态原语数据迁移到数据库
- 建立资源与原语的关联关系
- 支持原语的状态流转: draft -> review_pending -> verified -> callable -> deprecated

## 非目标

- 不改变现有资源页面的基本布局和交互方式
- 不创建复杂的工作流编排界面(留待后续迭代)
- 不实现原语的自动执行功能(第一版仅支持文档和代码引用模式)
- 不改变现有的导航结构和信息架构

## 当前状态分析

### 现有实现

1. **资源管理**
   - 已有 datasets, models, apps, frameworks, skills 等资源页面
   - 支持用户上传和编辑资源
   - 资源存储在 `onescience_resource` 表中

2. **原语展示**
   - 32 个静态原语定义在 `onescience-primitives.ts` 中
   - 原语页面 `/primitives` 展示静态数据
   - 无法动态添加或编辑原语

3. **数据模型**
   - `onescience_resource` 表包含基础字段
   - 缺少原语相关的数据结构
   - 缺少资源与原语的关联关系

### 存在的问题

1. 原语数据静态化,无法动态管理
2. 资源和原语概念混淆,缺少清晰的转换路径
3. 缺少原语的生命周期管理
4. 缺少面向 Agent 的原语注册表

## 方案选择

经过评估三种方案后,选择**方案3: 渐进式混合架构**。

### 方案对比

| 维度 | 方案1: 独立页面 | 方案2: 统一工作台 | 方案3: 渐进式混合 |
|------|----------------|------------------|------------------|
| 实现复杂度 | 高 | 中 | 低 |
| 用户学习成本 | 高 | 中 | 低 |
| 功能扩展性 | 高 | 中 | 中 |
| 与现有系统兼容性 | 低 | 中 | 高 |

### 选择理由

1. **最小化改动**: 保持现有页面结构和用户体验
2. **降低学习成本**: 用户可以在熟悉的界面中逐步了解原语概念
3. **快速交付**: 实现复杂度最低,可以快速上线验证
4. **易于迭代**: 后续可以根据用户反馈逐步增强功能

## 详细设计

### 整体架构

```
┌─────────────────────────────────────────────────────┐
│ Resource Center (现有页面)                           │
│ - datasets, models, apps, operators, code           │
│ - 每个资源卡片添加"转为原语"按钮                      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Primitive Factory (对话框形式)                       │
│ - 原语创建/编辑对话框                                │
│ - 契约定义、适配器配置、验证信息                      │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Agent Registry (新增页面 /agent-registry)            │
│ - 展示所有可调用的原语                               │
│ - 按状态、领域、类型筛选                             │
└─────────────────────────────────────────────────────┘
```

### 核心工作流

1. **资源到原语的转换**
   ```
   用户浏览资源 → 点击"转为原语" → 填写原语信息
   → 保存为 draft → 提交审核 → verified → callable
   ```

2. **原语的使用**
   ```
   Agent/OneSkills → 查询 Agent Registry
   → 获取可调用原语列表 → 选择原语 → 执行
   ```

### 界面改动详情

#### 1. 资源卡片增强

**改动位置**: `ResourceCard` 组件

**新增功能**:
- 在卡片底部操作区添加"转为原语"按钮
- 仅对已验证的资源显示此按钮
- 点击后打开原语创建对话框

**界面示例**:
```
┌─────────────────────────────────┐
│ GraphCast                       │
│ [地球科学] [weather] [forecast] │
│ Google DeepMind 中期全球天气... │
│ ◈ weather  ◒ JAX               │
│ ↓ 12.5k  ☆ 2.8k                │
│ [开发] [论文] [转为原语] ←新增  │
└─────────────────────────────────┘
```

#### 2. 原语创建对话框

**新增组件**: `PrimitiveCreateDialog`

**对话框结构**:
```
┌─────────────────────────────────────┐
│ 创建 AI 原语                        │
├─────────────────────────────────────┤
│ 基础信息 (自动填充自资源)           │
│ - 名称: [GraphCast 气象预测]       │
│ - 描述: [...]                      │
│ - 领域: [地球科学]                 │
│                                     │
│ 原语配置                            │
│ - 原语类型: [model.run ▼]          │
│ - 意图标签: [weather_forecast]     │
│                                     │
│ 契约定义                            │
│ - 输入参数: [+ 添加参数]           │
│ - 输出结果: [+ 添加输出]           │
│                                     │
│ 适配器模式                          │
│ - 模式: [documentation ▼]          │
│                                     │
│         [取消] [保存为草稿]         │
└─────────────────────────────────────┘
```

**字段说明**:
- **原语类型**: data.load, data.transform, model.run, model.train, model.evaluate 等
- **意图标签**: 用于 Agent 查询匹配的关键词
- **契约定义**: 输入输出的结构化描述
- **适配器模式**: documentation, code_reference, script, http, mcp, workflow

#### 3. Agent Registry 页面

**新增页面**: `/agent-registry`

**页面结构**:
```
┌─────────────────────────────────────────────────┐
│ Agent Registry                                  │
│ 代理注册表 - 可调用的 AI 原语                    │
├─────────────────────────────────────────────────┤
│ [搜索框]  [领域筛选▼]  [类型筛选▼]  [状态筛选▼] │
├─────────────────────────────────────────────────┤
│ [全部] [callable] [verified] [deprecated]       │
├─────────────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐        │
│ │ GraphCast       │ │ FourCastNet     │        │
│ │ [callable]      │ │ [verified]      │        │
│ │ model.run       │ │ model.run       │        │
│ │ [查看契约][使用] │ │ [查看契约][使用] │        │
│ └─────────────────┘ └─────────────────┘        │
└─────────────────────────────────────────────────┘
```

**功能特性**:
- 仅展示 verified 和 callable 状态的原语
- 支持按领域、类型、状态筛选
- 提供"查看契约"功能,展示原语的详细契约信息
- 提供"使用"功能,生成调用代码或跳转到代码开发页面

#### 4. Primitives 页面改造

**改动页面**: `/primitives`

**改动内容**:
- 保持现有展示方式
- 数据源改为: 静态数据(迁移后) + 数据库数据
- 添加状态标识,区分不同来源的原语
- 添加"编辑"和"管理"功能(仅对数据库原语)

### 数据模型设计

#### 1. AI Primitive 表

**表名**: `ai_primitive`

**字段定义**:
```sql
CREATE TABLE ai_primitive (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  domain TEXT NOT NULL,
  primitive_type TEXT NOT NULL,
  intent_tags TEXT NOT NULL, -- JSON array
  source_resource_ids TEXT, -- JSON array
  status TEXT NOT NULL DEFAULT 'draft',
  contract_json TEXT, -- JSON object
  adapter_json TEXT, -- JSON object
  validation_json TEXT, -- JSON object
  quality_score REAL,
  owner TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_deleted INTEGER
);
```

**状态枚举**:
- `draft`: 草稿
- `review_pending`: 待审核
- `verified`: 已验证
- `callable`: 可调用
- `deprecated`: 已废弃

**原语类型枚举**:
- `data.load`: 数据加载
- `data.transform`: 数据转换
- `model.run`: 模型运行
- `model.train`: 模型训练
- `model.evaluate`: 模型评估
- `app.launch`: 应用启动
- `operator.apply`: 算子应用
- `code.generate`: 代码生成
- `workflow.compose`: 工作流组合
- `runtime.submit`: 运行时提交

#### 2. Resource 表扩展

**表名**: `onescience_resource` (现有表)

**新增字段**:
```sql
ALTER TABLE onescience_resource ADD COLUMN resource_type TEXT;
ALTER TABLE onescience_resource ADD COLUMN trust_level TEXT DEFAULT 'user';
ALTER TABLE onescience_resource ADD COLUMN license TEXT;
ALTER TABLE onescience_resource ADD COLUMN version TEXT;
ALTER TABLE onescience_resource ADD COLUMN owner TEXT;
ALTER TABLE onescience_resource ADD COLUMN metadata TEXT; -- JSON
ALTER TABLE onescience_resource ADD COLUMN verification_state TEXT DEFAULT 'draft';
ALTER TABLE onescience_resource ADD COLUMN verified_at INTEGER;
ALTER TABLE onescience_resource ADD COLUMN verified_by TEXT;
```

**resource_type 枚举**:
- `dataset`, `model`, `app`, `operator`, `code`, `skill`, `framework`

**trust_level 枚举**:
- `user`: 用户上传
- `reviewed`: 已审核
- `verified`: 已验证

**verification_state 枚举**:
- `draft`: 草稿
- `submitted`: 已提交
- `verified`: 已验证
- `deprecated`: 已废弃

#### 3. 契约数据结构

**Contract JSON 示例**:
```json
{
  "id": "earth.graphcast.forecast",
  "name": "GraphCast 气象预测",
  "intent": ["weather_forecast", "earth_model_run"],
  "inputs": [
    {
      "name": "start_time",
      "type": "datetime",
      "required": true,
      "description": "预测起始时间"
    },
    {
      "name": "horizon_hours",
      "type": "number",
      "required": true,
      "description": "预测时长(小时)"
    }
  ],
  "outputs": [
    {
      "name": "forecast",
      "type": "artifact",
      "description": "预测结果"
    }
  ],
  "constraints": {
    "accelerator": ["GPU", "DCU"],
    "data_format": ["zarr", "netcdf"]
  }
}
```

#### 4. 适配器数据结构

**Adapter JSON 示例**:
```json
{
  "mode": "code_reference",
  "reference": {
    "repo": "https://gitee.com/onescience-ai/onescience",
    "path": "examples/earth/graphcast",
    "entry": "inference.py"
  },
  "instructions": "参考 GraphCast 推理脚本..."
}
```

**适配器模式**:
- `documentation`: 仅文档
- `code_reference`: 代码引用
- `script`: 可执行脚本
- `http`: HTTP API
- `mcp`: MCP 工具
- `workflow`: 工作流组合

### API 设计

#### 原语管理 API

**创建原语**:
```
POST /experimental/onescience/primitive
Body: {
  title, description, domain, primitive_type,
  intent_tags, source_resource_ids,
  contract_json, adapter_json
}
Response: { id, ...primitive }
```

**获取原语列表**:
```
GET /experimental/onescience/primitive?status=callable&domain=地球科学
Response: { items: [...], nextOffset }
```

**更新原语**:
```
PATCH /experimental/onescience/primitive/:id
Body: { ...updates }
Response: { id, ...primitive }
```

**删除原语**:
```
DELETE /experimental/onescience/primitive/:id
Response: { success: true }
```

**原语状态流转**:
```
POST /experimental/onescience/primitive/:id/verify
POST /experimental/onescience/primitive/:id/publish
POST /experimental/onescience/primitive/:id/deprecate
```

#### Agent Registry API

**查询可调用原语**:
```
GET /experimental/onescience/agent-registry?domain=地球科学&type=model.run
Response: {
  items: [
    {
      id, title, domain, primitiveType, status,
      contract, adapter, sourceResources
    }
  ]
}
```

### 实施计划

#### Phase 1: 数据模型和基础 API (1-2周)

**任务**:
1. 创建 `ai_primitive` 表
2. 扩展 `onescience_resource` 表
3. 实现原语 CRUD API
4. 迁移 32 个静态原语数据到数据库

**交付物**:
- 数据库迁移脚本
- 原语管理 API
- 数据迁移脚本

#### Phase 2: 资源卡片增强 (1周)

**任务**:
1. 在 `ResourceCard` 组件添加"转为原语"按钮
2. 实现原语创建对话框 `PrimitiveCreateDialog`
3. 实现契约编辑器组件
4. 集成原语创建 API

**交付物**:
- 增强的资源卡片组件
- 原语创建对话框组件
- 端到端的原语创建流程

#### Phase 3: Agent Registry 页面 (1周)

**任务**:
1. 创建 `/agent-registry` 页面
2. 实现原语列表展示
3. 实现筛选和搜索功能
4. 实现契约查看功能
5. 实现 Agent Registry API

**交付物**:
- Agent Registry 页面
- 原语查询和筛选功能
- Agent Registry API

#### Phase 4: Primitives 页面改造 (1周)

**任务**:
1. 改造 `/primitives` 页面数据源
2. 合并静态数据和数据库数据
3. 添加原语编辑功能
4. 添加状态管理功能

**交付物**:
- 改造后的 Primitives 页面
- 原语编辑和管理功能

#### Phase 5: 测试和优化 (1周)

**任务**:
1. 端到端测试
2. 性能优化
3. 用户体验优化
4. 文档编写

**交付物**:
- 测试报告
- 用户文档
- 开发文档

### 成功标准

1. **功能完整性**
   - 用户可以从资源创建原语
   - 原语支持完整的生命周期管理
   - Agent Registry 可以查询和筛选原语
   - 32 个静态原语成功迁移到数据库

2. **用户体验**
   - 原语创建流程流畅,不超过 3 步
   - 页面加载时间不超过 2 秒
   - 界面保持现有风格,无明显视觉差异

3. **技术指标**
   - API 响应时间 < 500ms
   - 数据库查询优化,支持分页加载
   - 代码覆盖率 > 80%

4. **业务指标**
   - 用户可以成功创建和管理原语
   - Agent/OneSkills 可以通过 API 查询原语
   - 原语数量逐步增长

### 风险和缓解措施

**风险1: 数据迁移失败**
- 缓解: 提前备份数据,编写回滚脚本

**风险2: 性能问题**
- 缓解: 实施分页加载,添加数据库索引

**风险3: 用户学习成本高**
- 缓解: 提供详细的引导和文档,逐步引入功能

**风险4: 与现有系统冲突**
- 缓解: 充分测试,保持向后兼容

### 后续迭代方向

1. **原语执行引擎**: 支持原语的自动执行
2. **工作流编排**: 支持多个原语的组合和编排
3. **版本管理**: 支持原语的版本控制
4. **权限管理**: 细粒度的原语访问控制
5. **监控和日志**: 原语使用情况的监控和分析

