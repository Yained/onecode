# OneData：可训练数据与 data.load 原语软绑定

**Date:** 2026-09-11  
**Status:** Implementing  
**Supersedes (partial):** 2026-09-09 catalog completion claim that “模型用数不需要数据集原语”

## Decision (scheme 1)

- Identity remains Catalog Already (`alr_*`).
- Ideal state: 1:1 private `data.load` primitive referencing that `alr_*` via `datasetRefs`.
- User copy weakens “AI 原语”; UI says「数据说明」.
- Direct convert: convert first → minimal dialog; dismiss keeps Already with `primitive_complete=false`.
- Agent path: `dataset_report` unchanged; new tool `register_dataset_primitive` binds Already → `data.load`.
- If Agent skips tool: Already usable but incomplete; remind on train/use.

## Minimal user fields

1. 名称 (required, prefill title)  
2. 一句话说明 (optional)  
3. 数据长什么样 (optional, prefill format)  
4. 怎么用/注意点 (optional)

## Storage

Already `metadata_json`:
- `primitive_id?: string`
- `primitive_complete?: boolean` (true after successful bind)

## API / tool

- `POST /experimental/onescience/already/:id/primitive` body: `{ title?, description?, data_schema?, usage_notes? }`
- Tool `register_dataset_primitive`: `already_id` + same optional fields
