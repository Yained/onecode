import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import {
  emptyScenarioValues,
  missingRequiredScenarioFields,
  normalizeScenarioValues,
  renderScenarioPrompt,
  scenarioFieldKey,
  scenarioFieldLabel,
  scenarioFieldMultiline,
  scenarioFieldPlaceholder,
  scenarioFieldRequired,
  scenarioFieldTypeError,
  scenarioFieldsForStep,
  scenarioProblemText,
  scenarioWorkflowSteps,
  type UserScenario,
} from "./scenario-catalog"

const RELATED_PAPERS_PREVIEW = 2

export function ScenarioWizardOverlay(props: {
  scenario: UserScenario
  onClose: () => void
  onSubmit: (input: { values: Record<string, string> }) => void
}) {
  const [papersExpanded, setPapersExpanded] = createSignal(false)
  const [state, setState] = createStore({
    values: emptyScenarioValues(props.scenario),
    activeStepIndex: 0,
  })

  createEffect(() => {
    setState({
      values: emptyScenarioValues(props.scenario),
      activeStepIndex: 0,
    })
    setPapersExpanded(false)
  })

  const steps = createMemo(() => scenarioWorkflowSteps(props.scenario))
  const activeStep = createMemo(() => steps()[state.activeStepIndex] ?? steps()[0])
  const activeFields = createMemo(() => {
    const step = activeStep()
    if (!step) return props.scenario.user_input
    return scenarioFieldsForStep(props.scenario, step)
  })
  const missing = createMemo(() => missingRequiredScenarioFields(props.scenario, state.values))
  const stepMissing = createMemo(() =>
    activeFields().filter((field) => {
      if (!scenarioFieldRequired(field)) return false
      return !String(state.values[scenarioFieldKey(field)] ?? "").trim()
    }),
  )
  const filledInStep = createMemo(
    () => activeFields().filter((field) => String(state.values[scenarioFieldKey(field)] ?? "").trim()).length,
  )
  const previewPrompt = createMemo(() => {
    const step = activeStep()
    const template = step?.prompt || props.scenario.ai_prompt?.template || ""
    return renderScenarioPrompt(template, state.values)
  })
  const stepOutputs = createMemo(() => activeStep()?.outputs ?? [])
  const papers = createMemo(() =>
    (props.scenario.related_papers ?? []).filter((paper) => Boolean(String(paper.url ?? "").trim())),
  )
  const visiblePapers = createMemo(() =>
    papersExpanded() ? papers() : papers().slice(0, RELATED_PAPERS_PREVIEW),
  )
  const hiddenPaperCount = createMemo(() => Math.max(0, papers().length - RELATED_PAPERS_PREVIEW))

  const setFieldValue = (fieldId: string, value: string) => {
    setState("values", fieldId, value)
  }

  const selectStep = (index: number) => {
    setState("activeStepIndex", index)
  }

  const submitWithGapsAllowed = () => {
    const normalized = normalizeScenarioValues(props.scenario.user_input, state.values)
    setState("values", normalized)
    props.onSubmit({ values: normalized })
  }

  return (
    <div class="os-client-capability-wizard-overlay" role="dialog" aria-modal="true" aria-label="场景向导">
      <button type="button" class="os-client-capability-wizard-backdrop" aria-label="关闭场景" onClick={props.onClose} />
      <section class="os-client-capability-wizard-dialog">
        <header class="os-client-capability-wizard-head">
          <button type="button" class="os-client-capability-wizard-intro-back" onClick={props.onClose}>
            返回场景列表
          </button>
          <div class="os-client-capability-wizard-head-title">
            <h2>{props.scenario.name}</h2>
            <p>{scenarioProblemText(props.scenario.problem_and_applicability)}</p>
          </div>
          <button type="button" class="os-client-capability-wizard-close" aria-label="关闭" onClick={props.onClose}>
            ×
          </button>
        </header>

        <div class="os-client-capability-wizard-columns">
          <aside class="os-client-capability-wizard-column" aria-label="工作流">
            <h3>工作流</h3>
            <p class="os-client-capability-wizard-note">点击步骤查看对应参数与产出；创建后将自动按序执行。</p>
            <ol class="os-client-capability-wizard-workflow">
              <For each={steps()}>
                {(step, index) => (
                  <li classList={{ "is-active": state.activeStepIndex === index() }}>
                    <button type="button" class="os-client-capability-wizard-step" onClick={() => selectStep(index())}>
                      <span>{index() + 1}</span>
                      <div>
                        <p>{step.name}</p>
                      </div>
                    </button>
                  </li>
                )}
              </For>
            </ol>
            <Show when={papers().length > 0}>
              <div class="os-client-capability-wizard-papers">
                <h3>相关论文</h3>
                <ul classList={{ "is-expanded": papersExpanded() && hiddenPaperCount() > 0 }}>
                  <For each={visiblePapers()}>
                    {(paper) => (
                      <li>
                        <a href={paper.url} target="_blank" rel="noopener noreferrer" title={paper.title}>
                          {paper.title}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={hiddenPaperCount() > 0}>
                  <button
                    type="button"
                    class="os-client-capability-wizard-papers-more"
                    onClick={() => setPapersExpanded((open) => !open)}
                  >
                    {papersExpanded() ? "收起" : `展开其余 ${hiddenPaperCount()} 篇`}
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={props.scenario.HPC}>
              <div class="os-client-capability-wizard-papers">
                <h3>HPC 软件</h3>
                <span>{props.scenario.HPC}</span>
              </div>
            </Show>
          </aside>

          <section class="os-client-capability-wizard-column" aria-label="补充信息">
            <div class="os-client-capability-wizard-column-head">
              <h3>本步参数</h3>
              <small>
                {state.activeStepIndex + 1}/{steps().length} · 已填 {filledInStep()}/{activeFields().length}
              </small>
            </div>
            <Show when={activeStep()}>
              {(step) => (
                <div class="os-client-capability-wizard-step-banner">
                  <strong>{step().name}</strong>
                  <Show when={step().purpose?.trim()}>
                    <p>{step().purpose}</p>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={props.scenario.system_auto_detection?.fields?.length}>
              <p class="os-client-capability-wizard-note">
                工作目录与运行环境由系统自动识别，本步只需填写下列业务参数。
              </p>
            </Show>
            <Show when={stepMissing().length > 0 || missing().length > 0}>
              <p class="os-client-capability-wizard-missing">
                还有 {missing().length} 个必填参数未填，可先创建；缺口将由智能体追问，也可点左侧步骤提前补全。
              </p>
            </Show>
            <div class="os-client-capability-wizard-fields">
              <Show
                when={activeFields().length > 0}
                fallback={<p class="os-client-capability-wizard-note">本步无需额外用户参数。</p>}
              >
                <For each={activeFields()}>
                  {(input) => {
                    const key = scenarioFieldKey(input)
                    const required = scenarioFieldRequired(input)
                    const empty = required && !String(state.values[key] ?? "").trim()
                    const typeHint =
                      String(state.values[key] ?? "").trim() && scenarioFieldTypeError(input, state.values[key] ?? "")
                    return (
                      <label
                        class="os-client-capability-wizard-field"
                        classList={{ "is-required": required, "is-gap": empty }}
                      >
                        <span>
                          {scenarioFieldLabel(input)}
                          <Show when={required}>
                            <em>*</em>
                          </Show>
                        </span>
                        <Show
                          when={scenarioFieldMultiline(input)}
                          fallback={
                            <input
                              type="text"
                              inputMode={
                                input.input_type === "int" || input.input_type === "float" ? "decimal" : undefined
                              }
                              value={state.values[key] ?? ""}
                              placeholder={scenarioFieldPlaceholder(input)}
                              onInput={(event) => setFieldValue(key, event.currentTarget.value)}
                            />
                          }
                        >
                          <textarea
                            rows={3}
                            value={state.values[key] ?? ""}
                            placeholder={scenarioFieldPlaceholder(input)}
                            onInput={(event) => setFieldValue(key, event.currentTarget.value)}
                          />
                        </Show>
                        <Show when={typeHint}>
                          <em class="os-client-capability-wizard-field-hint">{typeHint}，智能体将尝试自动修正</em>
                        </Show>
                        <Show when={empty}>
                          <em class="os-client-capability-wizard-field-hint">未填时由智能体追问</em>
                        </Show>
                      </label>
                    )
                  }}
                </For>
              </Show>
            </div>
            <div class="os-client-capability-wizard-step-nav">
              <button
                type="button"
                disabled={state.activeStepIndex <= 0}
                onClick={() => selectStep(Math.max(0, state.activeStepIndex - 1))}
              >
                上一步
              </button>
              <button
                type="button"
                disabled={state.activeStepIndex >= steps().length - 1}
                onClick={() => selectStep(Math.min(steps().length - 1, state.activeStepIndex + 1))}
              >
                下一步
              </button>
            </div>
          </section>

          <section class="os-client-capability-wizard-column" aria-label="本步产出与 Prompt">
            <div class="os-client-capability-wizard-outputs" aria-label="本步产出">
              <div class="os-client-capability-wizard-outputs-head">
                <span>本步产出</span>
                <Show when={activeStep()?.result_subfolder}>
                  <small title={activeStep()?.result_subfolder}>{activeStep()?.result_subfolder}</small>
                </Show>
              </div>
              <Show
                when={stepOutputs().length > 0}
                fallback={<p class="os-client-capability-wizard-outputs-empty">本步暂无结构化产出清单。</p>}
              >
                <ul class="os-client-capability-wizard-output-list">
                  <For each={stepOutputs()}>{(item) => <li>{item}</li>}</For>
                </ul>
              </Show>
              <Show when={activeStep()?.quality_gate}>
                <div class="os-client-capability-wizard-quality">
                  <strong>质量门禁</strong>
                  <p>{activeStep()?.quality_gate}</p>
                </div>
              </Show>
            </div>
            <div class="os-client-capability-wizard-column-head">
              <h3>本步 Prompt</h3>
              <small>第 {state.activeStepIndex + 1} 步</small>
            </div>
            <textarea class="os-client-capability-wizard-prompt" rows={12} value={previewPrompt()} readOnly />
          </section>
        </div>

        <footer class="os-client-capability-wizard-footer">
          <button type="button" onClick={props.onClose}>
            返回能力中心
          </button>
          <button type="button" data-primary="true" onClick={submitWithGapsAllowed}>
            创建任务并自动逐步执行
          </button>
        </footer>
      </section>
    </div>
  )
}
