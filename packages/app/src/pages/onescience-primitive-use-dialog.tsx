import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import {
  primitiveCategoryForUse,
  primitiveDevelopPrompt,
  primitiveUseScenarios,
  type PrimitiveUseItem,
} from "@/pages/primitive-develop"

export function PrimitiveUseDialog(props: {
  item: PrimitiveUseItem
  open: boolean
  onClose: () => void
  onSubmit: (text: string) => void
}) {
  const category = createMemo(() => primitiveCategoryForUse(props.item))
  const scenarios = createMemo(() => primitiveUseScenarios(category()))
  const [scenarioId, setScenarioId] = createSignal("")
  const [parameters, setParameters] = createSignal<Record<string, string>>({})
  const [notes, setNotes] = createSignal("")

  const selectedScenario = createMemo(() => scenarios().find((entry) => entry.id === scenarioId()))
  const preview = createMemo(() => {
    const id = scenarioId()
    if (!id) return ""
    return primitiveDevelopPrompt(props.item, { scenarioId: id, parameters: parameters(), notes: notes() })
  })

  createEffect(() => {
    if (!props.open) return
    const first = scenarios()[0]
    setScenarioId(first?.id ?? "")
    setParameters({})
    setNotes("")
  })

  const setParameter = (key: string, value: string) => {
    setParameters((current) => ({ ...current, [key]: value }))
  }

  const submit = (event: SubmitEvent) => {
    event.preventDefault()
    const text = preview().trim()
    if (!text || !scenarioId()) return
    props.onSubmit(text)
  }

  return (
    <Show when={props.open}>
      <div class="os-modal-backdrop" role="presentation">
        <form class="os-upload-dialog os-primitive-use-dialog" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
          <div class="os-upload-head">
            <div>
              <div class="os-eyebrow">使用 AI 原语</div>
              <h2>{props.item.title}</h2>
              <p>选择使用场景并补充参数，提交后将预填到科研开发对话。</p>
            </div>
            <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
          </div>

          <section class="os-primitive-dialog-section">
            <h3>{primitiveUseSectionTitle(category())}</h3>
            <div class="os-primitive-use-scenarios" role="radiogroup" aria-label="原语使用场景">
              <For each={scenarios()}>
                {(scenario) => (
                  <label class="os-primitive-use-scenario" data-active={scenarioId() === scenario.id}>
                    <input
                      type="radio"
                      name="primitive-use-scenario"
                      checked={scenarioId() === scenario.id}
                      onChange={() => setScenarioId(scenario.id)}
                    />
                    <span class="os-primitive-use-scenario-body">
                      <strong>{scenario.label}</strong>
                      <span>{scenario.description}</span>
                    </span>
                  </label>
                )}
              </For>
            </div>
          </section>

          <Show when={selectedScenario()?.parameterFields?.length}>
            <section class="os-primitive-dialog-section">
              <h3>运行参数（可选）</h3>
              <div class="os-primitive-dialog-grid">
                <For each={selectedScenario()?.parameterFields ?? []}>
                  {(field) => (
                    <label>
                      <span class="os-field-label">{field.label}</span>
                      <input
                        value={parameters()[field.id] ?? ""}
                        placeholder={field.placeholder}
                        onInput={(event) => setParameter(field.id, event.currentTarget.value)}
                      />
                    </label>
                  )}
                </For>
              </div>
            </section>
          </Show>

          <label>
            <span class="os-field-label">补充说明（可选）</span>
            <textarea
              rows={3}
              value={notes()}
              onInput={(event) => setNotes(event.currentTarget.value)}
              placeholder="补充你的数据路径、实验目标、硬件环境或其它约束"
            />
          </label>

          <details class="os-primitive-contract-preview">
            <summary>预览将发送的提示词</summary>
            <pre>{preview()}</pre>
          </details>

          <div class="os-upload-actions">
            <button type="button" class="os-button os-button-secondary" onClick={props.onClose}>取消</button>
            <button class="os-button os-button-primary" type="submit" disabled={!scenarioId() || !preview().trim()}>提交到科研开发</button>
          </div>
        </form>
      </div>
    </Show>
  )
}

function primitiveUseSectionTitle(category: string) {
  if (category === "dataset") return "选择数据使用场景"
  if (category === "model-inference") return "选择模型推理场景"
  if (category === "model-training") return "选择模型训练场景"
  if (category === "app") return "选择应用运行场景"
  if (category === "evaluation") return "选择评估场景"
  if (category === "data-processing") return "选择数据处理场景"
  return "选择使用场景"
}
