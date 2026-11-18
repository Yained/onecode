---
name: onescience-resources
description: 当 opencode 需要搜索、选择、引用或推理 OneScience 资源时使用，包括数据集、模型、应用、框架、OneSkills、AI 原语、资源契约，以及适用于代码实现、模型推理、训练与科研工作流的资源。
---

# OneScience 资源

## 概述

使用本技能在推荐资产或接入工作流之前，先从正在运行的 opencode / OneScience 服务动态检索资源。资源包括数据集、模型库、应用库、框架、OneSkills 与 AI 原语。

## 核心规则

不要凭记忆列举可用资源。先查询本地 OneScience 资源 API，再仅基于服务端返回结果做摘要与推荐。

## 快速搜索

在仓库根目录执行：

```bash
node .opencode/skills/onescience-resources/scripts/search-resources.mjs --query "climate" --type all --limit 8
```

常用选项：

| 选项 | 取值 | 用途 |
| --- | --- | --- |
| `--query` | 文本 | 过滤名称、描述、标签、提供方、领域、契约及关联资源。 |
| `--type` | `all`、`datasets`、`models`、`apps`、`frameworks`、`skills`、`primitives` | 限定目录类型。 |
| `--domain` | 文本 | 在 API 支持时按 OneScience 领域精确过滤。 |
| `--primitive-type` | 文本 | 按 AI 原语类型精确过滤：`data.load`、`data.transform`、`model.run`、`model.train`、`model.evaluate`、`app.launch`、`operator.apply`、`code.generate`、`workflow.compose`、`runtime.submit`。 |
| `--server` | URL | 覆盖默认地址 `http://127.0.0.1:8006`。 |
| `--json` | 标志 | 输出完整 JSON，便于后续程序处理。 |

## 检索流程

1. 识别用户任务：代码实现、数据集使用、模型训练、模型推理、应用工作流、框架集成，或原语契约查阅。
2. 用 `search-resources.mjs` 查询对应目录类型；广泛探索时使用 `--type all`。
3. 用户明确提到科学领域或 skill 上下文时，优先使用 `--domain` 与 `--primitive-type` 精确过滤。
4. 推荐前检查返回项的 `id`、`type`、`title`、`domain`、`tags`、`href`、`source`，以及原语的 `contractJson` 摘要。
5. 在代码或工作流中使用某资源时，写明资源 `id` 并说明与任务的匹配理由。

## 资源映射

| 用户意图 | 搜索类型 | 说明 |
| --- | --- | --- |
| 为实现或实验找数据 | `datasets` 或 `primitives --primitive-type data.load` | 数据集原语最适合代码实现与数据流水线。 |
| 选择可训练模型或训练组件 | `models` 或 `primitives --primitive-type model.train` | 用于训练、微调及训练工作流代码。 |
| 选择推理资产 | `models` 或 `primitives --primitive-type model.run` | 用于科研工作流执行与运行时推理。 |
| 组合模型模块 | `primitives --primitive-type operator.apply` 或 `code.generate` | 用于可复用算子、代码生成或重构。 |
| 执行科研工作流 | `apps` 或 `primitives --primitive-type app.launch` 或 `workflow.compose` | 应用原语是工作流级动作。 |
| 查找框架集成指引 | `frameworks` | 用于基础设施、运行时或库集成。 |
| 将原语绑定到 Agent skill | `skills` 或 `primitives` | 查看 skill 关联的原语，勿假设每个 skill 都能用全部原语。 |

## 输出建议

回复用户时保持简洁：

- 列出最匹配的 3–6 项。
- 包含 `type`、`id`、`domain` 及匹配理由。
- 对 AI 原语说明关键契约或关联资源。
- 若无匹配结果，说明目录中无对应资源，并建议放宽查询条件。

## 常见错误

| 错误做法 | 正确做法 |
| --- | --- |
| 推荐静态或记忆中的资源 | 先查询服务端。 |
| 每个 skill 都展示全部原语 | 使用 skill 关联原语或 `--primitive-type` 过滤。 |
| 把 skill 资源当作普通资源 | skill 走 skill API，不走通用 resource 页。 |
| 忽略契约 | 对 AI 原语检查 `contractJson`、`adapterJson` 及可用时的关联资源。 |
