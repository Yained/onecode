import { Component, createMemo, createSignal, Show, createEffect, For } from "solid-js"
import { Portal } from "solid-js/web"
import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { FieldSelect } from "@/components/onescience/FieldSelect"
import { primitiveTypeDisplayLabel, publishAIPrimitive } from "@/pages/onescience-catalog"
import { draftFormState } from "@/pages/onescience-primitive-prefill"
import { AlreadyDatasetRefsField } from "@/components/onescience/AlreadyDatasetRefsField"
import { modelScopeDatasetDownloadMethod, modelScopeModelDownloadMethod } from "@/pages/modelscope-catalog"
import type { AIPrimitiveItem } from "@/pages/onescience-primitives-types"

export type PrimitiveResourcePage = "datasets" | "models" | "apps" | "frameworks"

export type PrimitiveSourceHint = {
  title: string
  copy: string
  provider: string
  tags: string[]
  domain?: string
  format?: string
  size?: string
  href?: string
  page?: PrimitiveResourcePage
  datasetDownloadMethod?: string
  modelDownloadMethod?: string
}

interface PrimitiveCreateDialogProps {
  resourceId?: string
  resourcePage?: PrimitiveResourcePage
  draftId?: string
  initialPrimitiveType?: string
  sourceHint?: PrimitiveSourceHint
  serverUrl: string
  open: boolean
  onClose: () => void
  onSuccess?: (item: AIPrimitiveItem) => void
}

type SourceSummary = {
  title: string
  domain: string
  provider: string
  tags: string[]
  copy: string
  page?: string
  format?: string
  size?: string
  href?: string
}


export type PublishExtraField = {
  key: string
  label: string
  required: boolean
  placeholder: string
  hint?: string
}

type PublishProfile = {
  sectionTitle: string
  sectionHint: string
  primitiveTypes: { value: string; label: string }[]
  titlePlaceholder: string
  descriptionPlaceholder: string
  intentTagsPlaceholder: string
  extraFields: PublishExtraField[]
}

const publishDomainOptions = ["地球科学", "生命科学", "材料化学", "流体仿真", "其它"] as const

export const PrimitiveCreateDialog: Component<PrimitiveCreateDialogProps> = (props) => {
  const [sourceTitle, setSourceTitle] = createSignal("当前资源")
  const [sourceDomain, setSourceDomain] = createSignal("地球科学")
  const [sourceProvider, setSourceProvider] = createSignal("OneScience")
  const [sourceTags, setSourceTags] = createSignal<string[]>([])
  const [sourcePage, setSourcePage] = createSignal<string>()
  const [sourceFormat, setSourceFormat] = createSignal<string>()
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [domain, setDomain] = createSignal("")
  const [primitiveType, setPrimitiveType] = createSignal("")
  const [intentTags, setIntentTags] = createSignal("")
  const [extraValues, setExtraValues] = createSignal<Record<string, string>>({})
  const [loading, setLoading] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")
  const [existingDraftId, setExistingDraftId] = createSignal<string>()
  const [publishedTypes, setPublishedTypes] = createSignal<string[]>([])
  let modelSlotDraftRequest = 0
  let publishedTypesRequest = 0

  const prefillContext = () => resourcePrefillContext({
    sourceFormat: sourceFormat(),
    resourcePage: resourcePage(),
    resourceId: props.resourceId,
    resourceTitle: sourceTitle(),
    sourceHint: props.sourceHint,
  })

  const applyModelPrimitiveTypeChange = (next: string) => {
    setPrimitiveType(next)
    setExtraValues((current) => ({
      ...stripOppositeModelExtra(current, next),
      ...prefillContext(),
    }))
    const resourceId = props.resourceId
    if (!resourceId) {
      setExistingDraftId(undefined)
      return
    }
    const requestId = ++modelSlotDraftRequest
    void authenticatedFetch(`${oneScienceApiBaseUrl(props.serverUrl)}/experimental/onescience/primitive/by-resource/${encodeURIComponent(resourceId)}`)
      .then((res) => res.ok ? res.json() as Promise<PrimitiveSlotLookup> : undefined)
      .then((lookup) => {
        if (requestId !== modelSlotDraftRequest) return
        const draft = modelSlotDraft(lookup, next)
        if (!draft) {
          setExistingDraftId(undefined)
          return
        }
        setExistingDraftId(draft.id)
        const form = draftFormState(draft)
        if (form.title) setTitle(form.title)
        if (form.description) setDescription(form.description)
        if (form.intentTags) setIntentTags(form.intentTags)
        setExtraValues((current) => ({
          ...stripOppositeModelExtra(current, next),
          ...prefillContext(),
          ...form.extraValues,
        }))
      })
      .catch(() => undefined)
  }

  const resourcePage = createMemo((): PrimitiveResourcePage | undefined => {
    if (props.resourcePage) return props.resourcePage
    const page = sourcePage()
    if (page === "datasets" || page === "models" || page === "apps" || page === "frameworks") return page
    return undefined
  })

  const resolvedDomain = () => {
    if (resourcePage() === "frameworks") return inferFrameworkDomain(props.resourceId, sourceTags())
    return domain()
  }

  const resolvedPrimitiveType = () => {
    const selected = primitiveType().trim()
    if (resourcePage() === "apps") return "app.launch"
    if (resourcePage() === "frameworks") return "code.generate"
    if (selected) return selected
    return inferPrimitiveType(resourcePage(), sourceTags())
  }

  const profilePrimitiveType = createMemo(() => {
    const selected = primitiveType().trim()
    if (resourcePage() === "models") return selected
    if (resourcePage() === "apps") return "app.launch"
    if (resourcePage() === "frameworks") return "code.generate"
    if (selected) return selected
    return inferPrimitiveType(resourcePage(), sourceTags())
  })

  const profile = createMemo(() => publishProfile(resourcePage(), profilePrimitiveType()))

  const primitiveTypeOptions = createMemo(() =>
    availablePublishPrimitiveTypes(profile().primitiveTypes, publishedTypes(), props.initialPrimitiveType),
  )

  // Only lock when a single model type remains (e.g. train already published → force inference).
  // A suggested initialPrimitiveType must not freeze the dropdown when 推理/训练 both remain.
  const lockedModelPrimitiveType = createMemo(() => {
    if (resourcePage() !== "models") return undefined
    const options = primitiveTypeOptions()
    if (options.length !== 1) return undefined
    return options[0]!.value
  })

  const showExtraFields = createMemo(() => {
    if (resourcePage() === "models") return !!primitiveType().trim()
    return true
  })

  createEffect(() => {
    if (!props.open) return
    const openToken = `${props.resourceId ?? ""}:${props.draftId ?? ""}:${props.initialPrimitiveType ?? ""}`
    setError("")
    setExistingDraftId(props.draftId)
    setTitle("")
    setDescription("")
    setDomain("")
    setPublishedTypes([])
    setPrimitiveType(
      props.initialPrimitiveType?.trim()
        || (props.resourcePage === "apps" ? "app.launch" : "")
        || (props.resourcePage === "frameworks" ? "code.generate" : ""),
    )
    setIntentTags("")
    setExtraValues({})
    const resourceId = props.resourceId
    if (resourceId && (resourcePage() === "models" || resourcePage() === "datasets")) {
      const requestId = ++publishedTypesRequest
      void authenticatedFetch(`${oneScienceApiBaseUrl(props.serverUrl)}/experimental/onescience/primitive/by-resource/${encodeURIComponent(resourceId)}`)
        .then((res) => res.ok ? res.json() as Promise<PrimitiveSlotLookup> : undefined)
        .then((lookup) => {
          if (requestId !== publishedTypesRequest) return
          if (openToken !== `${props.resourceId ?? ""}:${props.draftId ?? ""}:${props.initialPrimitiveType ?? ""}`) return
          const occupied = publishedPrimitiveTypesFromLookup(lookup)
          setPublishedTypes(occupied)
          const selected = props.initialPrimitiveType?.trim() || primitiveType()
          if (selected && occupied.includes(selected) && selected !== props.initialPrimitiveType?.trim()) {
            const next = availablePublishPrimitiveTypes(publishProfile(resourcePage(), selected).primitiveTypes, occupied, props.initialPrimitiveType)[0]?.value ?? ""
            if (resourcePage() === "models") applyModelPrimitiveTypeChange(next)
            else setPrimitiveType(next)
          }
        })
        .catch(() => undefined)
    }
    const hint = props.sourceHint
    if (props.resourcePage === "frameworks" || hint?.page === "frameworks") {
      setDomain(inferFrameworkDomain(props.resourceId, hint?.tags ?? []))
    }
    if (hint) {
      setSourceTitle(hint.title || "当前资源")
      setSourceDomain(hint.domain || "")
      setSourceProvider(hint.provider || "OneScience")
      setSourceTags(hint.tags ?? [])
      setSourcePage(hint.page)
      setSourceFormat(hint.format)
      if (hint.page === "apps") setPrimitiveType("app.launch")
      if (hint.page === "frameworks") {
        setPrimitiveType("code.generate")
        setDomain(inferFrameworkDomain(props.resourceId, hint.tags))
      }
      const prefill = resourcePrefillContext({
        sourceFormat: hint.format,
        sourceSize: hint.size,
        sourceHref: hint.href,
        resourcePage: hint.page,
        resourceId: props.resourceId,
        resourceTitle: hint.title,
        sourceHint: hint,
      })
      if (Object.keys(prefill).length) setExtraValues(prefill)
    }
    if (!resourceId) {
      setLoading(false)
      return
    }
    setLoading(true)
    const applyDraft = (draft: AIPrimitiveItem | undefined) => {
      if (!draft || openToken !== `${props.resourceId ?? ""}:${props.draftId ?? ""}:${props.initialPrimitiveType ?? ""}`) return
      const form = draftFormState(draft)
      if (form.title) setTitle(form.title)
      if (form.description) setDescription(form.description)
      if (form.domain && props.resourcePage !== "frameworks") setDomain(form.domain)
      if (form.primitiveType && !props.initialPrimitiveType?.trim()) setPrimitiveType(form.primitiveType)
      if (form.intentTags) setIntentTags(form.intentTags)
      if (Object.keys(form.extraValues).length) {
        setExtraValues((current) => ({ ...current, ...form.extraValues }))
      }
    }
    const draftRequests: Promise<AIPrimitiveItem | undefined>[] = []
    if (props.draftId) {
      draftRequests.push(
        authenticatedFetch(`${oneScienceApiBaseUrl(props.serverUrl)}/experimental/onescience/primitive/${encodeURIComponent(props.draftId)}`)
          .then((res) => res.ok ? res.json() as Promise<AIPrimitiveItem> : undefined),
      )
    }
    Promise.all([
      authenticatedFetch(`${oneScienceApiBaseUrl(props.serverUrl)}/experimental/onescience/resource/${resourceId}`)
        .then((res) => res.ok ? res.json() : undefined) as Promise<(Partial<SourceSummary> & { tags?: string[] }) | undefined>,
      authenticatedFetch(`${oneScienceApiBaseUrl(props.serverUrl)}/experimental/onescience/primitive/by-resource/${encodeURIComponent(resourceId)}`)
        .then((res) => res.ok ? res.json() : undefined) as Promise<{
          draft?: AIPrimitiveItem
          inference?: { draft?: AIPrimitiveItem }
          training?: { draft?: AIPrimitiveItem }
          slots?: Record<string, { draft?: AIPrimitiveItem }>
        } | undefined>,
      ...draftRequests,
    ])
      .then(([resource, lookup, explicitDraft]) => {
        if (openToken !== `${props.resourceId ?? ""}:${props.draftId ?? ""}:${props.initialPrimitiveType ?? ""}`) return
        let draft = explicitDraft
        if (!draft && lookup) {
          const slotDraft = props.initialPrimitiveType === "model.train"
            ? lookup.training?.draft ?? lookup.slots?.["model-training"]?.draft
            : props.initialPrimitiveType === "model.run"
              ? lookup.inference?.draft ?? lookup.slots?.["model-inference"]?.draft
              : props.initialPrimitiveType === "data.transform"
                ? lookup.slots?.["data-processing"]?.draft
                : props.initialPrimitiveType === "data.load"
                  ? lookup.slots?.["dataset"]?.draft
                  : undefined
          draft = slotDraft
            ?? (props.initialPrimitiveType?.trim()
              ? undefined
              : lookup.inference?.draft
                ?? lookup.training?.draft
                ?? lookup.slots?.["dataset"]?.draft
                ?? lookup.slots?.["data-processing"]?.draft
                ?? lookup.draft)
        }
        if (!props.draftId && draft?.id) setExistingDraftId(draft.id)
        applyDraft(draft)
        if (!resource) return
        setSourceTitle(resource.title || "当前资源")
        setSourceDomain(resource.domain || "")
        setSourceProvider(resource.provider || "OneScience")
        setSourceTags(resource.tags ?? [])
        setSourcePage(resource.page)
        setSourceFormat(resource.format)
        if (resource.page === "apps") setPrimitiveType("app.launch")
        if (resource.page === "frameworks") {
          setPrimitiveType("code.generate")
          setDomain(resource.domain?.trim() || inferFrameworkDomain(props.resourceId, resource.tags ?? []))
        }
        const prefill = resourcePrefillContext({
          sourceFormat: resource.format,
          sourceSize: resource.size,
          sourceHref: resource.href,
          resourcePage: resource.page === "datasets" || resource.page === "models" || resource.page === "apps" || resource.page === "frameworks" ? resource.page : undefined,
          resourceId,
          resourceTitle: resource.title,
          sourceHint: props.sourceHint,
        })
        if (Object.keys(prefill).length) {
          setExtraValues((current) => ({ ...current, ...prefill }))
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  })

  const intentTagList = createMemo(() => intentTags().split(",").map((tag) => tag.trim()).filter(Boolean))
  const primitiveCategory = createMemo(() => categoryFromType(resolvedPrimitiveType()))
  const contractPreview = createMemo(() => buildContract({
    title: title(),
    description: description(),
    domain: resolvedDomain(),
    resourceId: props.resourceId,
    primitiveType: resolvedPrimitiveType(),
    primitiveCategory: primitiveCategory(),
    intentTags: intentTagList(),
    sourcePage: sourcePage(),
    sourceProvider: sourceProvider(),
    sourceFormat: sourceFormat() ?? sourceTags().find((tag) => !tag.includes(":")) ?? "unknown",
    resourcePage: resourcePage(),
    extraValues: extraValues(),
  }))
  const adapterPreview = createMemo(() => ({
    mode: defaultAdapterMode(resourcePage(), resolvedPrimitiveType()),
    page: sourcePage(),
    resourceId: props.resourceId,
    provider: sourceProvider(),
    source: sourceTitle(),
  }))

  const handleSave = async () => {
    const validationError = validatePublishForm({
      title: title(),
      description: description(),
      domain: resolvedDomain(),
      primitiveType: resolvedPrimitiveType(),
      intentTags: intentTags(),
      extraValues: extraValues(),
      resourcePage: resourcePage(),
    })
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError("")

    try {
      const payload = {
        title: title().trim(),
        description: description().trim(),
        domain: resolvedDomain(),
        primitiveType: resolvedPrimitiveType(),
        intentTags: intentTagList(),
        contractJson: contractPreview(),
        adapterJson: adapterPreview(),
      }
      let id = existingDraftId()
      if (!id) {
        const response = await authenticatedFetch(`${oneScienceApiBaseUrl(props.serverUrl)}/experimental/onescience/primitive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            sourceResourceIds: props.resourceId ? [props.resourceId] : undefined,
          }),
        })
        if (!response.ok) throw new Error("创建失败")
        const data = await response.json() as { id: string }
        id = data.id
      }
      const published = await publishAIPrimitive(props.serverUrl, id, payload)
      props.onSuccess?.(published)
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div class="os-modal-backdrop" role="presentation">
          <form class="os-upload-dialog os-primitive-create-dialog" onSubmit={(event) => { event.preventDefault(); void handleSave() }} onClick={(event) => event.stopPropagation()}>
            {dialogBody()}
          </form>
        </div>
      </Portal>
    </Show>
  )

  function dialogBody() {
    return (
      <>
        <div class="os-upload-head">
          <div>
            <div class="os-eyebrow">发布 AI 原语</div>
            <h2>{`从资源「${sourceTitle()}」发布原语`}</h2>
            <p>已预填可用字段，可按需修改后发布。</p>
          </div>
          <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
        </div>

        <div class="os-primitive-create-body">
          <Show when={loading()}>
            <div class="os-primitive-create-loading">
              <span class="os-primitive-create-loading-dot" aria-hidden="true" />
              正在读取来源资源与草稿...
            </div>
          </Show>

          <article class="os-primitive-source-card">
            <div class="os-primitive-source-card-head">
              <span class="os-primitive-source-card-label">来源资源</span>
              <span class="os-source-badge" data-source="onescience">{resourcePageLabel(resourcePage())}</span>
            </div>
            <h3>{sourceTitle()}</h3>
            <div class="os-primitive-source-meta">
              <Show when={sourceDomain()}><span>{sourceDomain()}</span></Show>
              <Show when={sourceProvider()}><span>{sourceProvider()}</span></Show>
              <Show when={sourceFormat()}><span>{sourceFormat()}</span></Show>
            </div>
            <Show when={sourceTags().length}>
              <div class="os-primitive-source-tags">
                <For each={sourceTags().slice(0, 6)}>{(tag) => <span class="os-chip">{tag}</span>}</For>
              </div>
            </Show>
          </article>

          <section class="os-primitive-dialog-section os-primitive-create-section-primary">
            <h3>{profile().sectionTitle}</h3>
            <p class="os-primitive-section-hint">{profile().sectionHint}</p>
            <Show
              when={resourcePage() === "frameworks"}
              fallback={(
                <>
                  <label>
                    <span class="os-field-label">原语名称<span class="os-field-required" aria-hidden="true"> *</span></span>
                    <input value={title()} onInput={(event) => setTitle(event.currentTarget.value)} placeholder={profile().titlePlaceholder} />
                  </label>
                  <label>
                    <span class="os-field-label">能力描述<span class="os-field-required" aria-hidden="true"> *</span></span>
                    <textarea rows={3} value={description()} onInput={(event) => setDescription(event.currentTarget.value)} placeholder={profile().descriptionPlaceholder} />
                  </label>
                  <div class="os-primitive-create-field-row">
                    <label>
                      <span class="os-field-label">领域<span class="os-field-required" aria-hidden="true"> *</span></span>
                      <FieldSelect
                        value={domain()}
                        placeholder="请选择领域"
                        options={publishDomainOptions.map((item) => ({ value: item, label: item }))}
                        onChange={setDomain}
                      />
                    </label>
                    <Show
                      when={resourcePage() === "apps" || lockedModelPrimitiveType()}
                      fallback={(
                        <label>
                          <span class="os-field-label">原语类型<span class="os-field-required" aria-hidden="true"> *</span></span>
                          <FieldSelect
                            value={primitiveType()}
                            placeholder="请选择原语类型"
                            options={primitiveTypeOptions()}
                            onChange={(next) => {
                              if (resourcePage() === "models") {
                                applyModelPrimitiveTypeChange(next)
                                return
                              }
                              setPrimitiveType(next)
                            }}
                          />
                        </label>
                      )}
                    >
                      <label>
                        <span class="os-field-label">原语类型</span>
                        <div class="os-field-select os-field-select-static">
                          <div class="os-field-select-trigger" aria-disabled="true">
                            <span class="os-field-select-value">{primitiveTypeDisplayLabel(resourcePage() === "apps" ? "app.launch" : lockedModelPrimitiveType()!)}</span>
                          </div>
                        </div>
                      </label>
                    </Show>
                  </div>
                </>
              )}
            >
              <div class="os-primitive-create-field-row">
                <label>
                  <span class="os-field-label">原语名称<span class="os-field-required" aria-hidden="true"> *</span></span>
                  <input value={title()} onInput={(event) => setTitle(event.currentTarget.value)} placeholder={profile().titlePlaceholder} />
                </label>
                <label>
                  <span class="os-field-label">原语类型</span>
                  <input value="框架原语" readOnly tabindex={-1} />
                </label>
              </div>
              <label>
                <span class="os-field-label">能力描述<span class="os-field-required" aria-hidden="true"> *</span></span>
                <textarea rows={3} value={description()} onInput={(event) => setDescription(event.currentTarget.value)} placeholder={profile().descriptionPlaceholder} />
              </label>
            </Show>
            <label>
              <span class="os-field-label">意图标签<span class="os-field-required" aria-hidden="true"> *</span></span>
              <input value={intentTags()} onInput={(event) => setIntentTags(event.currentTarget.value)} placeholder={profile().intentTagsPlaceholder} />
            </label>
            <Show when={showExtraFields()}>
              <For each={profile().extraFields}>
              {(field) => (
                <label>
                  <span class="os-field-label">
                    {field.label}
                    <Show when={field.required}>
                      <span class="os-field-required" aria-hidden="true"> *</span>
                    </Show>
                  </span>
                  <Show
                    when={field.key === "datasetRefs"}
                    fallback={
                      <input
                        value={extraValues()[field.key] ?? ""}
                        onInput={(event) => setExtraValues((current) => ({ ...current, [field.key]: event.currentTarget.value }))}
                        placeholder={field.placeholder}
                      />
                    }
                  >
                    <AlreadyDatasetRefsField
                      value={extraValues()[field.key] ?? ""}
                      onChange={(value) => setExtraValues((current) => ({ ...current, [field.key]: value }))}
                      hint={field.hint}
                    />
                  </Show>
                  <Show when={field.hint && field.key !== "datasetRefs"}>
                    <span class="os-field-help">{field.hint}</span>
                  </Show>
                </label>
              )}
            </For>
            </Show>
          </section>

          <details class="os-primitive-contract-preview">
            <summary>能力契约预览</summary>
            <pre>{JSON.stringify({ contractJson: contractPreview(), adapterJson: adapterPreview() }, null, 2)}</pre>
          </details>

          <Show when={error()}>{(message) => <div class="os-upload-error">{message()}</div>}</Show>
        </div>

        <div class="os-upload-actions os-primitive-dialog-actions">
          <span>发布成功后进入 AI原语 / 原语目录</span>
          <div>
            <button type="button" class="os-button os-button-secondary" onClick={props.onClose} disabled={saving()}>取消</button>
            <button class="os-button os-button-primary" type="submit" disabled={saving() || loading()}>{saving() ? "发布中..." : "发布原语"}</button>
          </div>
        </div>
      </>
    )
  }
}

function resourcePageLabel(page: PrimitiveResourcePage | undefined) {
  if (page === "datasets") return "数据集"
  if (page === "models") return "模型库"
  if (page === "apps") return "应用库"
  if (page === "frameworks") return "AI框架"
  return "OneHub 资源"
}

export function publishProfile(resourcePage: PrimitiveResourcePage | undefined, primitiveType: string): PublishProfile {
  const primitiveTypeOption = (value: string) => ({ value, label: primitiveTypeDisplayLabel(value) })

  if (resourcePage === "datasets") {
    const transform = primitiveType === "data.transform"
    return {
      sectionTitle: transform ? "数据处理原语字段" : "数据集原语字段",
      sectionHint: transform
        ? "说明 Agent 如何对该数据集做清洗、转换、切片或特征提取。"
        : "说明 Agent 如何发现、加载并访问该数据集资源。",
      primitiveTypes: [
        { value: "data.load", label: "数据集原语" },
        { value: "data.transform", label: "数据处理原语" },
      ],
      titlePlaceholder: transform ? "例如：ERA5 降水标准化原语" : "例如：ERA5 数据加载原语",
      descriptionPlaceholder: transform
        ? "描述输入数据形态、转换步骤、输出 schema，以及 Agent 何时调用该处理原语"
        : "描述数据覆盖范围、访问方式、输出格式，以及 Agent 何时应加载该数据集",
      intentTagsPlaceholder: transform ? "例如：normalize, regrid, netcdf" : "例如：weather, reanalysis, netcdf",
      extraFields: [
        {
          key: "storageLocation",
          label: "获取方式",
          required: false,
          placeholder: "例如：modelscope download --dataset OneScience/ERA5 --cache_dir modelscope/hub/datasets",
          hint: "说明 Agent 如何获取该数据集；资源卡片下载按钮可用时会预填 modelscope 下载命令。",
        },
        {
          key: "dataSchema",
          label: "数据模式",
          required: false,
          placeholder: "例如：t2m,tp @ hourly, 0.25° 或 smiles,label 列",
          hint: "变量名、维度、分辨率或表结构，便于 Agent 生成 DataPipe 与切片逻辑。",
        },
        {
          key: "accessMethod",
          label: "访问方式",
          required: false,
          placeholder: "例如：mount / download / api / zarr",
          hint: "说明 Agent 应挂载、下载还是通过 API 读取数据。",
        },
        {
          key: "authHint",
          label: "访问凭证",
          required: false,
          placeholder: "例如：none / IAM role / API key / 内网 VPN",
          hint: "公开数据可填 none；需要鉴权时说明凭证类型，避免 Agent 静默失败。",
        },
        ...(transform
          ? [{
              key: "transformOutput",
              label: "转换输出",
              required: false,
              placeholder: "例如：normalized zarr, regridded 1° netcdf",
              hint: "描述转换后的产物形态，便于 Agent 串联下游训练或评测。",
            }]
          : []),
      ],
    }
  }
  if (resourcePage === "models") {
    const modelPrimitiveTypes = [
      { value: "model", label: "模型原语" },
      primitiveTypeOption("model.run"),
      primitiveTypeOption("model.train"),
    ]
    if (!primitiveType) {
      return {
        sectionTitle: "模型原语字段",
        sectionHint: "请先选择原语类型：模型原语 / 模型推理原语 / 模型训练原语。",
        primitiveTypes: modelPrimitiveTypes,
        titlePlaceholder: "例如：GraphCast 模型原语",
        descriptionPlaceholder: "描述 Agent 何时使用该模型相关原语，以及它提供什么能力",
        intentTagsPlaceholder: "例如：forecasting, graph-model",
        extraFields: [],
      }
    }
    const architecture = primitiveType === "model"
    const train = primitiveType === "model.train"
    const resourceSyncField: PublishExtraField = {
      key: "modelAcquisitionMethod",
      label: "资源同步命令",
      required: false,
      placeholder: "例如：modelscope download --model OneScience/FengWu --cache_dir modelscope/hub/models",
      hint: "智能体在确认调用本原语时执行该命令，将远程模型仓库同步至本地缓存；无需预设目录结构，同步完成后自行查阅仓库以确定权重路径与入口脚本。",
    }
    return {
      sectionTitle: architecture ? "模型原语字段" : train ? "模型训练原语字段" : "模型推理原语字段",
      sectionHint: architecture
        ? "说明该模型资源本身的架构、能力边界与复用方式（非推理/训练调用契约）。"
        : train
          ? "说明 Agent 如何基于该模型资源发起训练、微调或 checkpoint 更新。"
          : "说明 Agent 如何加载权重、准备输入并调用该模型完成推理。",
      primitiveTypes: modelPrimitiveTypes,
      titlePlaceholder: architecture ? "例如：GraphCast 模型原语" : train ? "例如：GraphCast 微调原语" : "例如：GraphCast 推理原语",
      descriptionPlaceholder: architecture
        ? "描述模型架构、适用任务与资源定位，以及 Agent 何时选用该模型原语"
        : train
          ? "描述训练数据、优化目标、checkpoint 策略，以及 Agent 何时启动训练流程"
          : "描述推理输入、输出变量、运行后端，以及 Agent 何时调用该模型",
      intentTagsPlaceholder: architecture
        ? "例如：architecture, weather, foundation-model"
        : train
          ? "例如：fine-tune, checkpoint, pytorch"
          : "例如：forecasting, graph-model, inference",
      extraFields: architecture
        ? [resourceSyncField]
        : train
        ? [
            resourceSyncField,
            {
              key: "datasetRefs",
              label: "可训练数据 / 已公开 OneData",
              required: false,
              placeholder: "选择就绪的可训练数据，或多个 alr_ 用逗号分隔",
              hint: "仅可选择本人就绪的可训练数据，或已公开的 OneData。",
            },
            {
              key: "framework",
              label: "训练框架",
              required: false,
              placeholder: "例如：PyTorch / JAX / TensorFlow",
              hint: "可从资源格式自动预填；帮助 Agent 选择正确的训练脚本模板。",
            },
            {
              key: "baseCheckpoint",
              label: "基座 Checkpoint",
              required: false,
              placeholder: "例如：/models/graphcast/pretrained.ckpt",
              hint: "微调或继续训练时的起始权重路径。",
            },
            {
              key: "outputCheckpointDir",
              label: "Checkpoint 输出目录",
              required: false,
              placeholder: "例如：/output/graphcast-finetune/",
              hint: "训练产物保存位置，便于 Agent 配置 checkpoint 回调。",
            },
            {
              key: "trainingConfigHint",
              label: "训练配置参考",
              required: false,
              placeholder: "例如：configs/finetune.yaml 或 lr=1e-4, epochs=10",
              hint: "配置文件路径或关键超参摘要，减少 Agent 猜测训练参数。",
            },
          ]
        : [
            resourceSyncField,
            {
              key: "checkpointPath",
              label: "Checkpoint 路径",
              required: false,
              placeholder: "例如：/models/graphcast/checkpoint.ckpt 或 s3://bucket/weights/",
              hint: "推理时加载的权重或 checkpoint 路径；不填写则 Agent 从资源元数据推断。",
            },
            {
              key: "framework",
              label: "推理框架",
              required: false,
              placeholder: "例如：PyTorch / JAX / ONNX / vLLM",
              hint: "可从资源格式自动预填；帮助 Agent 选择模型加载与推理后端。",
            },
            {
              key: "inputSpec",
              label: "输入说明",
              required: false,
              placeholder: "例如：batch×lat×lon×channels float32, 6h lead time",
              hint: "张量形状、变量名或输入文件格式，便于 Agent 构造推理输入。",
            },
            {
              key: "outputSpec",
              label: "输出说明",
              required: false,
              placeholder: "例如：forecast fields t2m,tp @ 24h lead",
              hint: "推理产物变量与格式，便于 Agent 对接评测或下游工作流。",
            },
            {
              key: "datasetRefs",
              label: "可训练数据 / 已公开 OneData",
              required: false,
              placeholder: "选择就绪的可训练数据，或多个 alr_ 用逗号分隔",
              hint: "推理或评测时绑定的可训练数据 / 已公开 OneData。",
            },
          ],
    }
  }
  if (resourcePage === "apps") {
    return {
      sectionTitle: "应用启动原语字段",
      sectionHint: "说明 Agent 如何启动该应用、准备运行环境并提交远程作业。",
      primitiveTypes: [primitiveTypeOption("app.launch")],
      titlePlaceholder: "例如：OpenFOAM 作业启动原语",
      descriptionPlaceholder: "描述 runtime、entrypoint、资源约束，以及 Agent 何时启动该应用",
      intentTagsPlaceholder: "例如：cfd, mpi, gpu",
      extraFields: [
        {
          key: "runtime",
          label: "运行环境",
          required: false,
          placeholder: "例如：GPU / MPI / CPU",
          hint: "不填写时契约默认使用 CPU/GPU/MPI。",
        },
        {
          key: "entrypoint",
          label: "启动入口",
          required: false,
          placeholder: "例如：workflow.yaml 或 python main.py",
          hint: "不填写时契约默认使用 workflow.yaml。",
        },
        {
          key: "resourceRequirements",
          label: "资源需求",
          required: false,
          placeholder: "例如：4×GPU A100, 128GB RAM, 2 nodes MPI",
          hint: "帮助 Agent 在提交 HPC/云作业时选择合适队列与配额。",
        },
        {
          key: "containerImage",
          label: "容器/模块",
          required: false,
          placeholder: "例如：openfoam:11 或 module load openfoam/11",
          hint: "容器镜像名或集群 module 加载命令。",
        },
        {
          key: "inputArtifacts",
          label: "输入产物",
          required: false,
          placeholder: "例如：case/, config.yaml, mesh.su2",
          hint: "作业启动前必须准备的输入文件或目录。",
        },
      ],
    }
  }
  if (resourcePage === "frameworks") {
    return {
      sectionTitle: "AI框架原语字段",
      sectionHint: "说明 Agent 如何发现、安装和调用该 AI 框架，不区分科学领域。",
      primitiveTypes: [{ value: "code.generate", label: "框架原语" }],
      titlePlaceholder: "例如：PyTorch 框架接入原语",
      descriptionPlaceholder: "描述框架能力、硬件支持、安装入口，以及 Agent 何时使用该框架",
      intentTagsPlaceholder: "例如：pytorch, training, gpu, dcu",
      extraFields: [
        {
          key: "installEntry",
          label: "安装入口",
          required: false,
          placeholder: "例如：portal 安装链接或 GitHub 仓库地址",
          hint: "Agent 通过该入口完成框架安装或环境拉取。",
        },
        {
          key: "hardwareSupport",
          label: "硬件支持",
          required: false,
          placeholder: "例如：CPU/GPU / GPU / CPU/GPU/TPU",
          hint: "可从资源格式自动预填；帮助 Agent 判断运行栈是否匹配。",
        },
        {
          key: "frameworkLanguage",
          label: "开发语言",
          required: false,
          placeholder: "例如：Python / Python/CUDA / C++",
          hint: "可从资源规模字段自动预填；说明框架主要接口语言。",
        },
        {
          key: "adapterRepo",
          label: "适配仓库",
          required: false,
          placeholder: "例如：https://github.com/flagos-ai/vllm-FL",
          hint: "FlagOS 或国产硬件适配仓库，便于 Agent 选择正确分支。",
        },
      ],
    }
  }

  if (primitiveType === "data.load" || primitiveType === "data.transform") {
    return publishProfile("datasets", primitiveType)
  }
  if (primitiveType === "model.run" || primitiveType === "model.train") {
    return publishProfile("models", primitiveType)
  }
  if (primitiveType === "app.launch" || primitiveType === "workflow.compose") {
    return publishProfile("apps", primitiveType)
  }
  return {
    sectionTitle: "核心字段",
    sectionHint: "补全原语名称、能力描述和意图标签，供 Agent 检索与调用。",
    primitiveTypes: [
      primitiveTypeOption("data.load"),
      primitiveTypeOption("model.run"),
      primitiveTypeOption("app.launch"),
      primitiveTypeOption("code.generate"),
    ],
    titlePlaceholder: "例如：ERA5 数据加载原语",
    descriptionPlaceholder: "描述 Agent 何时使用这个原语，以及它提供什么能力",
    intentTagsPlaceholder: "例如：weather_forecast, climate_model",
    extraFields: [],
  }
}

export function validatePublishForm(input: {
  title: string
  description: string
  domain: string
  primitiveType: string
  intentTags: string
  extraValues: Record<string, string>
  resourcePage?: PrimitiveResourcePage
}) {
  if (!input.title.trim() || !input.description.trim()) return "请填写原语名称和能力描述"
  const primitiveType = input.resourcePage === "apps"
    ? "app.launch"
    : input.resourcePage === "frameworks"
      ? "code.generate"
      : input.primitiveType.trim()
  if (input.resourcePage !== "frameworks" && !input.domain.trim()) return "请选择领域"
  if (input.resourcePage === "frameworks" && !input.domain.trim()) return "无法识别框架分类"
  if (!primitiveType) return "请选择原语类型"
  if (!input.intentTags.split(",").map((tag) => tag.trim()).filter(Boolean).length) return "请至少填写一个意图标签"
  const profile = publishProfile(input.resourcePage, primitiveType)
  for (const field of profile.extraFields) {
    if (!field.required) continue
    if (!input.extraValues[field.key]?.trim()) return `请填写${field.label}`
  }
  return undefined
}

function defaultRequiredInputs(input: {
  resourceId?: string
  domain: string
  primitiveType: string
  sourceProvider: string
  sourceFormat: string
  resourcePage?: PrimitiveResourcePage
  extraValues?: Record<string, string>
}) {
  const extra = input.extraValues ?? {}
  const lines = [
    ...(input.resourceId ? [`resourceId: ${input.resourceId}`] : []),
    ...(input.domain.trim() ? [`domain: ${input.domain.trim()}`] : []),
    `format: ${input.sourceFormat}`,
    `provider: ${input.sourceProvider}`,
    `primitiveType: ${input.primitiveType}`,
  ]
  if (input.resourcePage === "datasets" || input.primitiveType.startsWith("data.")) {
    pushContractLine(lines, extra, "storageLocation", "storage")
    pushContractLine(lines, extra, "dataSchema", "schema")
    pushContractLine(lines, extra, "accessMethod", "access")
    pushContractLine(lines, extra, "authHint", "auth")
    if (input.primitiveType === "data.transform") pushContractLine(lines, extra, "transformOutput", "transformOutput")
  }
  if (input.resourcePage === "models" || input.primitiveType.startsWith("model.")) {
    lines.push(`modelId: ${input.resourceId ?? input.sourceProvider}`)
    pushContractLine(lines, extra, "modelAcquisitionMethod", "resourceSync")
    pushContractLine(lines, extra, "framework", "framework")
    const datasetRefs = extra.datasetRefs?.split(",").map((item) => item.trim()).filter(Boolean) ?? []
    if (datasetRefs.length) lines.push(`datasetIds: ${datasetRefs.join(", ")}`)
    if (input.primitiveType === "model.run") {
      pushContractLine(lines, extra, "checkpointPath", "checkpoint")
      pushContractLine(lines, extra, "inputSpec", "inputSpec")
      pushContractLine(lines, extra, "outputSpec", "outputSpec")
    }
    if (input.primitiveType === "model.train") {
      pushContractLine(lines, extra, "baseCheckpoint", "baseCheckpoint")
      pushContractLine(lines, extra, "outputCheckpointDir", "outputCheckpointDir")
      pushContractLine(lines, extra, "trainingConfigHint", "trainingConfig")
    }
  }
  if (input.resourcePage === "apps" || input.primitiveType === "app.launch" || input.primitiveType === "workflow.compose") {
    lines.push(`runtime: ${extra.runtime?.trim() || "CPU/GPU/MPI"}`)
    lines.push(`entrypoint: ${extra.entrypoint?.trim() || "workflow.yaml"}`)
    pushContractLine(lines, extra, "resourceRequirements", "resources")
    pushContractLine(lines, extra, "containerImage", "image")
    pushContractLine(lines, extra, "inputArtifacts", "inputs")
    if (input.primitiveType === "workflow.compose") {
      pushContractLine(lines, extra, "pipelineSteps", "steps")
      pushContractLine(lines, extra, "dependencies", "dependencies")
    }
  }
  if (input.resourcePage === "frameworks") {
    pushContractLine(lines, extra, "installEntry", "install")
    pushContractLine(lines, extra, "hardwareSupport", "hardware")
    pushContractLine(lines, extra, "frameworkLanguage", "language")
    pushContractLine(lines, extra, "adapterRepo", "adapterRepo")
  }
  return lines
}

function pushContractLine(lines: string[], extra: Record<string, string>, key: string, prefix: string) {
  const value = extra[key]?.trim()
  if (value) lines.push(`${prefix}: ${value}`)
}

type PrimitiveSlotLookup = {
  draft?: AIPrimitiveItem
  model?: { callable?: AIPrimitiveItem; draft?: AIPrimitiveItem }
  inference?: { callable?: AIPrimitiveItem; draft?: AIPrimitiveItem }
  training?: { callable?: AIPrimitiveItem; draft?: AIPrimitiveItem }
  slots?: Record<string, { callable?: AIPrimitiveItem; draft?: AIPrimitiveItem }>
}

export function publishedPrimitiveTypesFromLookup(lookup?: PrimitiveSlotLookup) {
  if (!lookup) return [] as string[]
  const slots = lookup.slots ?? {}
  return [
    ...((lookup.model?.callable || slots.model?.callable) ? ["model"] : []),
    ...((lookup.inference?.callable || slots["model-inference"]?.callable) ? ["model.run"] : []),
    ...((lookup.training?.callable || slots["model-training"]?.callable) ? ["model.train"] : []),
    ...(slots.dataset?.callable ? ["data.load"] : []),
    ...(slots["data-processing"]?.callable ? ["data.transform"] : []),
  ]
}

export function availablePublishPrimitiveTypes(
  types: { value: string; label: string }[],
  published: readonly string[],
  keepType?: string,
) {
  const occupied = new Set(published)
  const keep = keepType?.trim()
  return types.filter((item) => item.value === keep || !occupied.has(item.value))
}

const modelInferenceExtraKeys = ["checkpointPath", "inputSpec", "outputSpec"]
const modelTrainingExtraKeys = ["baseCheckpoint", "outputCheckpointDir", "trainingConfigHint"]

function oppositeModelExtraKeys(primitiveType: string) {
  if (primitiveType === "model") return [...modelInferenceExtraKeys, ...modelTrainingExtraKeys]
  return primitiveType === "model.train" ? modelInferenceExtraKeys : modelTrainingExtraKeys
}

function stripOppositeModelExtra(values: Record<string, string>, primitiveType: string) {
  const drop = new Set(oppositeModelExtraKeys(primitiveType))
  return Object.fromEntries(Object.entries(values).filter(([key]) => !drop.has(key)))
}

function modelSlotDraft(lookup: PrimitiveSlotLookup | undefined, primitiveType: string) {
  if (!lookup) return undefined
  if (primitiveType === "model") return lookup.model?.draft ?? lookup.slots?.model?.draft
  if (primitiveType === "model.train") return lookup.training?.draft ?? lookup.slots?.["model-training"]?.draft
  if (primitiveType === "model.run") return lookup.inference?.draft ?? lookup.slots?.["model-inference"]?.draft
  return undefined
}

function resourcePrefillContext(input: {
  sourceFormat?: string
  sourceSize?: string
  sourceHref?: string
  resourcePage?: PrimitiveResourcePage
  resourceId?: string
  resourceTitle?: string
  sourceHint?: PrimitiveSourceHint
}) {
  const page = input.resourcePage
  if (page !== "datasets" && page !== "models" && page !== "apps" && page !== "frameworks") return {}
  return prefilledExtraValues({
    format: input.sourceFormat,
    size: input.sourceSize,
    href: input.sourceHref,
    page,
    resourceId: input.resourceId,
    resourceTitle: input.resourceTitle,
    datasetDownloadMethod: input.sourceHint?.datasetDownloadMethod,
    modelDownloadMethod: input.sourceHint?.modelDownloadMethod,
  })
}

function prefilledExtraValues(input: {
  format?: string
  size?: string
  href?: string
  page?: PrimitiveResourcePage
  resourceId?: string
  resourceTitle?: string
  datasetDownloadMethod?: string
  modelDownloadMethod?: string
}) {
  const values: Record<string, string> = {}
  if (input.page === "models" && input.format?.trim()) values.framework = input.format.trim()
  if (input.page === "apps" && input.format?.trim()) values.runtime = input.format.trim()
  if (input.page === "frameworks") {
    if (input.format?.trim()) values.hardwareSupport = input.format.trim()
    if (input.size?.trim()) values.frameworkLanguage = input.size.trim()
    if (input.href?.trim()) values.installEntry = input.href.trim()
  }
  const downloadMethod = input.datasetDownloadMethod?.trim()
    || (input.page === "datasets" && input.resourceId ? modelScopeDatasetDownloadMethod(input.resourceId) : undefined)
  if (downloadMethod) values.storageLocation = downloadMethod
  const modelDownloadMethod = input.modelDownloadMethod?.trim()
    || (input.page === "models" && input.resourceTitle ? modelScopeModelDownloadMethod(input.resourceTitle) : undefined)
  if (modelDownloadMethod) values.modelAcquisitionMethod = modelDownloadMethod
  return values
}

function categoryFromType(primitiveType: string) {
  if (primitiveType === "data.load") return "dataset"
  if (primitiveType === "model.train") return "model-training"
  if (primitiveType === "model.run") return "model-inference"
  if (primitiveType === "model.evaluate") return "evaluation"
  if (primitiveType === "app.launch" || primitiveType === "workflow.compose") return "app"
  if (primitiveType === "data.transform") return "data-processing"
  if (primitiveType === "code.generate") return "code-asset"
  return "code-asset"
}

function resourceSyncCommand(extra: Record<string, string>, resourcePage?: PrimitiveResourcePage, primitiveType?: string) {
  if (resourcePage === "models" || primitiveType?.startsWith("model.")) return extra.modelAcquisitionMethod?.trim() || undefined
  if (resourcePage === "datasets" || primitiveType?.startsWith("data.")) return extra.storageLocation?.trim() || undefined
  return undefined
}

function resourceSyncRequiredInputKey(resourcePage?: PrimitiveResourcePage, primitiveType?: string) {
  if (resourcePage === "models" || primitiveType?.startsWith("model.")) return "resourceSync"
  return "storage"
}

function resourceSyncUsageSteps(resourcePage?: PrimitiveResourcePage, primitiveType?: string) {
  const field = resourceSyncRequiredInputKey(resourcePage, primitiveType)
  return [
    `确认调用本原语后，先执行 resourceContract.requiredInputs 中的 ${field} 命令，将关联资源同步至本地缓存。`,
    "同步完成后读取本地资源内容（README、配置、示例脚本、权重或数据文件），再确定 checkpoint、schema、入口脚本等后续参数。",
    "在资源已本地可用且用法明确前，不要跳过同步步骤直接假设路径、格式或运行入口。",
  ]
}

function defaultOutputs(category: string) {
  if (category === "dataset") return ["typed resource adapter result", "dataset access metadata", "schema/shape hints", "provenance record"]
  if (category === "model-inference" || category === "model-training") {
    return ["typed resource adapter result", "model invocation plan", "checkpoint/config metadata", "provenance record"]
  }
  if (category === "app") return ["typed resource adapter result", "workflow launch plan", "runtime resource requirements", "provenance record"]
  return ["typed resource adapter result", "implementation reference", "provenance record"]
}

function implementationSteps(input: {
  category: string
  title: string
  resourcePage?: PrimitiveResourcePage
  primitiveType: string
  extraValues?: Record<string, string>
}) {
  const syncCommand = resourceSyncCommand(input.extraValues ?? {}, input.resourcePage, input.primitiveType)
  const syncField = resourceSyncRequiredInputKey(input.resourcePage, input.primitiveType)
  const syncSteps = syncCommand
    ? [
        `执行 requiredInputs 中的 ${syncField} 命令，完成关联资源本地同步。`,
        "同步完成后浏览本地目录，识别 README、配置、示例脚本与权重/数据文件位置。",
      ]
    : []

  if (input.category === "dataset" || input.category === "data-processing") {
    return [
      ...syncSteps,
      `读取数据集资源 ${input.title} 的 provider、format、href 和领域标签。`,
      "参考 datapipes 资产定义数据发现、下载/挂载、缓存和切片接口。",
      "输出统一 DataPipe 结果，并附带 shape/schema/provenance 元数据。",
    ]
  }
  if (input.category === "model-inference" || input.category === "model-training") {
    return [
      ...syncSteps,
      `基于本地资源内容确定模型 ${input.title} 的框架、checkpoint 路径、输入输出规格与运行约束。`,
      "参考 models 资产定义模型配置、checkpoint 加载、输入张量和后处理接口。",
      "输出统一模型调用或训练计划，并记录资源版本与 provenance。",
    ]
  }
  if (input.category === "app") {
    return [
      ...syncSteps,
      `读取应用资源 ${input.title} 的安装入口、运行环境、领域标签和 HPC/GPU 约束。`,
      "参考 contracts 资产约定科研工作流的输入、输出、日志和错误处理。",
      "输出统一工作流启动计划，并记录 runtime、entrypoint 和资源需求。",
    ]
  }
  return [
    ...syncSteps,
    `读取资源 ${input.title} 的 provider、format 和领域标签。`,
    "输出统一适配结果，并保留来源追踪信息。",
  ]
}

export function buildContract(input: {
  title: string
  description: string
  domain: string
  resourceId?: string
  primitiveType: string
  primitiveCategory: string
  intentTags: string[]
  sourcePage?: string
  sourceProvider: string
  sourceFormat: string
  resourcePage?: PrimitiveResourcePage
  extraValues?: Record<string, string>
}) {
  const slug = input.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
  const assetSkill = assetSkillForCategory(input.primitiveCategory)
  const requiredInputs = defaultRequiredInputs({
    resourceId: input.resourceId,
    domain: input.domain,
    primitiveType: input.primitiveType,
    sourceProvider: input.sourceProvider,
    sourceFormat: input.sourceFormat,
    resourcePage: input.resourcePage,
    extraValues: input.extraValues,
  })
  const hasResourceSync = !!resourceSyncCommand(input.extraValues ?? {}, input.resourcePage, input.primitiveType)
  return {
    id: slug || "primitive",
    name: input.title,
    intent: input.intentTags,
    sourceResourceIds: input.resourceId ? [input.resourceId] : [],
    primitiveType: input.primitiveType,
    primitiveCategory: input.primitiveCategory,
    agentContract: {
      assetSkill,
      purpose: input.description,
      usage: contractUsage({
        category: input.primitiveCategory,
        resourcePage: input.resourcePage,
        primitiveType: input.primitiveType,
        extraValues: input.extraValues,
      }),
      resourceContract: {
        category: input.primitiveCategory,
        sourcePage: input.sourcePage ?? input.resourcePage ?? "resource",
        sourceResourceIds: input.resourceId ? [input.resourceId] : [],
        requiredInputs,
        outputs: defaultOutputs(input.primitiveCategory),
        implementationSteps: implementationSteps({
          category: input.primitiveCategory,
          title: input.title,
          resourcePage: input.resourcePage,
          primitiveType: input.primitiveType,
          extraValues: input.extraValues,
        }),
        acceptanceCriteria: [
          "契约必须保留 sourceResourceIds，并能回溯到资源库条目。",
          ...(hasResourceSync
            ? ["若 requiredInputs 含 resourceSync/storage，必须先完成资源同步并阅读本地资源后，再生成实现计划、代码或作业配置。"]
            : []),
          "缺少下载、权重或运行入口时，必须显式返回待补充字段。",
        ],
      },
    },
  }
}

function contractUsage(input: {
  category: string
  resourcePage?: PrimitiveResourcePage
  primitiveType: string
  extraValues?: Record<string, string>
}) {
  const syncFirst = resourceSyncCommand(input.extraValues ?? {}, input.resourcePage, input.primitiveType)
    ? resourceSyncUsageSteps(input.resourcePage, input.primitiveType)
    : []

  if (input.category === "dataset" || input.category === "data-processing") {
    return [
      ...syncFirst,
      "按 resourceContract.requiredInputs 准备数据 resourceId、领域、格式和 provider。",
      "生成 DataPipe 或数据接入代码前，先校验 primitiveType 与数据资源契约是否一致。",
    ]
  }
  if (input.category === "model-inference" || input.category === "model-training") {
    return [
      ...syncFirst,
      "按 resourceContract.requiredInputs 准备 modelId、框架与推理/训练上下文。",
      "生成模型调用或训练代码前，先校验 primitiveType 与模型资源契约是否一致。",
    ]
  }
  if (input.category === "app") {
    return [
      ...syncFirst,
      "按 resourceContract.requiredInputs 准备 runtime、entrypoint 和 HPC/GPU 约束。",
      "生成工作流或远程作业前，先校验 primitiveType 与应用资源契约是否一致。",
    ]
  }
  return [
    ...syncFirst,
    "按 resourceContract.requiredInputs 准备资源 ID、领域标签、格式和运行上下文。",
    "生成或修改代码前，先校验 primitiveType、primitiveCategory 与资源契约是否一致。",
  ]
}

function defaultAdapterMode(resourcePage: PrimitiveResourcePage | undefined, primitiveType: string) {
  if (resourcePage === "datasets" || primitiveType === "data.load" || primitiveType === "data.transform") return "resource_reference"
  if (resourcePage === "models" || primitiveType.startsWith("model.")) return "model_reference"
  if (resourcePage === "apps" || primitiveType === "app.launch" || primitiveType === "workflow.compose") return "hpc_workflow"
  if (resourcePage === "frameworks") return "code_reference"
  return "resource_reference"
}

function assetSkillForCategory(category: string) {
  if (category === "app" || category === "model-inference" || category === "model-training") return "onescience-runtime"
  return "onescience-coder"
}

function inferPrimitiveType(resourcePage: PrimitiveResourcePage | undefined, tags: string[]) {
  if (resourcePage === "datasets") return "data.load"
  if (resourcePage === "frameworks") return "code.generate"
  if (resourcePage === "models") {
    if (tags.some((tag) => /train|fine-tune|微调/i.test(tag))) return "model.train"
    return "model.run"
  }
  if (resourcePage === "apps") {
    if (tags.some((tag) => /workflow|工作流/i.test(tag))) return "workflow.compose"
    return "app.launch"
  }
  if (tags.some((tag) => /data|dataset|数据/i.test(tag))) return "data.load"
  if (tags.some((tag) => /metric|评测|score/i.test(tag))) return "model.evaluate"
  if (tags.some((tag) => /app|应用/i.test(tag))) return "app.launch"
  if (tags.some((tag) => /operator|算子/i.test(tag))) return "operator.apply"
  return "code.generate"
}

function inferFrameworkDomain(resourceId?: string, tags: string[] = []) {
  const id = resourceId ?? ""
  if (id.includes("framework-training")) return "训练框架"
  if (id.includes("framework-parallel")) return "并行训练"
  if (id.includes("framework-inference")) return "推理框架"
  const category = tags.find((tag) => tag === "训练框架" || tag === "并行训练" || tag === "推理框架")
  if (category) return category
  return "其它"
}

function oneScienceApiBaseUrl(serverUrl: string) {
  try {
    return new URL(serverUrl).toString().replace(/\/$/, "")
  } catch {
    return serverUrl.replace(/\/$/, "")
  }
}
