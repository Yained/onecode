import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { capabilityCategories, type CapabilityResource, type CapabilityScenario } from "./catalog"
import { isCapabilityResourceAvailable } from "./model-resources"
import type { CapabilityDomainSelection } from "./selection"
import type { CatalogAlready } from "./onedata-catalog-api"
import { matchTrainableModel, trainTargetLabel, trainableModelLabel } from "./onedata-standardize"

export function listTrainableModels(domain: CapabilityDomainSelection) {
  const scoped = domain === "all" ? undefined : domain
  return (capabilityCategories(scoped).find((item) => item.id === "onemodel")?.items ?? []).filter((item) =>
    isCapabilityResourceAvailable(item),
  )
}

export function DialogOnedataTrainWithModel(props: {
  already: CatalogAlready
  domain: CapabilityDomainSelection
  trainTarget: "local" | "workspace" | "shared_root"
  workspaceId?: string
  onConfirm: (input: { resource: CapabilityResource; scenario?: CapabilityScenario }) => void
}) {
  const dialog = useDialog()
  const models = createMemo(() => listTrainableModels(props.domain))
  const [modelId, setModelId] = createSignal("")
  const [scenarioId, setScenarioId] = createSignal("")
  const [query, setQuery] = createSignal("")
  const [scenarioOpen, setScenarioOpen] = createSignal(false)
  const showDomain = () => props.domain === "all"
  let scenarioRoot: HTMLDivElement | undefined

  createEffect(() => {
    const list = models()
    if (list.length === 0) {
      setModelId("")
      setScenarioId("")
      return
    }
    if (!list.some((item) => item.id === modelId())) {
      setModelId(list[0]!.id)
      setScenarioId(list[0]!.scenarios[0]?.id ?? "")
    }
  })

  const resource = createMemo(() => models().find((item) => item.id === modelId()))
  const scenarios = createMemo(() => resource()?.scenarios ?? [])
  const filtered = createMemo(() =>
    models().filter((item) => matchTrainableModel(item, query(), showDomain())),
  )
  const scenarioLabel = createMemo(
    () => scenarios().find((item) => item.id === scenarioId())?.title ?? "选择训练场景",
  )

  createEffect(() => {
    const list = scenarios()
    if (list.length === 0) {
      setScenarioId("")
      setScenarioOpen(false)
      return
    }
    if (!list.some((item) => item.id === scenarioId())) setScenarioId(list[0]!.id)
  })

  createEffect(() => {
    if (!scenarioOpen()) return
    const onPointerDown = (event: PointerEvent) => {
      if (!scenarioRoot?.contains(event.target as Node)) setScenarioOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScenarioOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    })
  })

  const selectModel = (id: string) => {
    setModelId(id)
    const next = models().find((item) => item.id === id)
    setScenarioId(next?.scenarios[0]?.id ?? "")
    setScenarioOpen(false)
  }

  const confirm = () => {
    const selected = resource()
    if (!selected) return
    const scenario = scenarios().find((item) => item.id === scenarioId())
    props.onConfirm({ resource: selected, scenario })
    dialog.close()
  }

  return (
    <Dialog title="用于训练：选择模型" size="large" fit class="os-onedata-train-dialog">
      <div class="os-onedata-train-body">
        <p class="os-onedata-train-hint">
          已选定可训练数据「{props.already.title}」。搜索并选择模型
          {scenarios().length ? "与场景" : ""}，确认后进入对话。
        </p>

        <div class="os-onedata-train-meta">
          <div class="os-onedata-train-card">
            <span>可训练数据</span>
            <strong>
              {props.already.title} · {props.already.id}
            </strong>
            <em title={props.already.uri}>{props.already.uri}</em>
          </div>
          <div class="os-onedata-train-card">
            <span>训练位置</span>
            <strong>
              {trainTargetLabel(props.trainTarget)}
              {props.trainTarget === "workspace" && props.workspaceId ? ` · ${props.workspaceId}` : ""}
            </strong>
          </div>
        </div>

        <Show
          when={models().length > 0}
          fallback={<p class="os-onedata-train-hint">当前领域暂无可用模型，请先到能力中心安装或切换领域。</p>}
        >
          <div class="os-onedata-train-field">
            <span>模型</span>
            <input
              type="search"
              class="os-onedata-train-search"
              aria-label="搜索模型"
              placeholder="搜索模型名称、标签或领域…"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <div class="os-onedata-train-model-list" role="listbox" aria-label="可选模型">
              <Show
                when={filtered().length > 0}
                fallback={<p class="os-onedata-train-empty">没有匹配「{query().trim()}」的模型</p>}
              >
                <For each={filtered()}>
                  {(item) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.id === modelId()}
                      class="os-onedata-train-model-option"
                      classList={{ "is-selected": item.id === modelId() }}
                      onClick={() => selectModel(item.id)}
                    >
                      <strong>{trainableModelLabel(item, showDomain())}</strong>
                      <em>{item.blurb}</em>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>

          <Show when={resource()}>
            {(item) => (
              <p class="os-onedata-train-blurb">
                已选：{trainableModelLabel(item(), showDomain())}
                <Show when={item().tags.length > 0}>
                  <span> · {item().tags.slice(0, 4).join(" · ")}</span>
                </Show>
              </p>
            )}
          </Show>

          <Show when={scenarios().length > 0}>
            <div class="os-onedata-train-field">
              <span>场景</span>
              <div
                ref={scenarioRoot}
                class="os-onedata-train-select"
                data-open={scenarioOpen() ? "true" : "false"}
              >
                <button
                  type="button"
                  class="os-onedata-train-select-trigger"
                  aria-label="选择场景"
                  aria-haspopup="listbox"
                  aria-expanded={scenarioOpen()}
                  onClick={() => setScenarioOpen((open) => !open)}
                >
                  <span class="os-onedata-train-select-value">{scenarioLabel()}</span>
                  <span class="os-onedata-train-select-chevron" aria-hidden="true" />
                </button>
                <Show when={scenarioOpen()}>
                  <div class="os-onedata-train-select-menu" role="listbox" aria-label="选择场景">
                    <For each={scenarios()}>
                      {(item) => (
                        <button
                          type="button"
                          role="option"
                          aria-selected={item.id === scenarioId()}
                          class="os-onedata-train-select-option"
                          classList={{ "is-selected": item.id === scenarioId() }}
                          onClick={() => {
                            setScenarioId(item.id)
                            setScenarioOpen(false)
                          }}
                        >
                          {item.title}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </Show>

        <div class="os-onedata-train-actions">
          <button type="button" onClick={() => dialog.close()}>
            取消
          </button>
          <button type="button" class="os-onedata-action-primary" disabled={!resource()} onClick={confirm}>
            进入训练对话
          </button>
        </div>
      </div>
    </Dialog>
  )
}
