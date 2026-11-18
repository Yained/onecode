import { For, Show, createEffect, createSignal } from "solid-js"
import {
  modelDevelopOptionList,
  type ModelDevelopType,
  type ScientificResearchScenarioGroup,
} from "@/pages/model-develop"

export function ModelDevelopDialog(props: {
  open: boolean
  title: string
  scenarios: ScientificResearchScenarioGroup[] | undefined
  onClose: () => void
  onConfirm: (developType: ModelDevelopType, scenarioId?: string) => void
}) {
  const [selected, setSelected] = createSignal<ModelDevelopType>("training")
  const [selectedScenario, setSelectedScenario] = createSignal<string | undefined>(undefined)
  const hasScenarios = () => props.scenarios && props.scenarios.length > 0
  const availableOptions = () =>
    hasScenarios()
      ? []
      : modelDevelopOptionList.filter((option) => option.id !== "scientific-research")
  const isScientificResearch = () => hasScenarios() || selected() === "scientific-research"

  createEffect(() => {
    if (props.open) {
      setSelected("training")
      setSelectedScenario(undefined)
    }
  })

  return (
    <Show when={props.open}>
      <div class="os-modal-backdrop" role="presentation">
        <div class="os-upload-dialog" onClick={(event) => event.stopPropagation()}>
          <div class="os-upload-head">
            <div>
              <div class="os-eyebrow">选择开发内容</div>
              <h2>{props.title}</h2>
            </div>
            <button type="button" class="os-button os-button-secondary os-button-square" onClick={props.onClose}>×</button>
          </div>
          <p class="os-section-copy">
            {hasScenarios()
              ? "请选择科研复现场景，确认后将进入科研开发工作台并预填对应提示词。"
              : "请选择开发方向，确认后将进入科研开发工作台并预填对应提示词。"}
          </p>
          <Show when={!hasScenarios()}>
            <div class="os-task-radio-grid os-task-radio-grid-compact">
              <For each={availableOptions()}>
                {(option) => (
                  <label
                    data-selected={selected() === option.id}
                    onClick={() => setSelected(option.id)}
                  >
                    <input type="radio" name="model-develop-type" checked={selected() === option.id} readOnly />
                    <span>
                      <strong>{option.label}</strong>
                      {option.description}
                    </span>
                  </label>
                )}
              </For>
            </div>
          </Show>
          <Show when={hasScenarios()}>
            <div class="os-scenario-section">
              <For each={props.scenarios}>
                {(group) => (
                  <div class="os-scenario-group">
                    <div class="os-scenario-group-title">{group.label}</div>
                    <div class="os-task-radio-grid os-task-radio-grid-compact">
                      <For each={group.scenarios}>
                        {(scenario) => (
                          <label
                            data-selected={selectedScenario() === scenario.id}
                            onClick={() => setSelectedScenario(scenario.id)}
                          >
                            <input type="radio" name="model-scenario" checked={selectedScenario() === scenario.id} readOnly />
                            <span>
                              <strong>{scenario.label}</strong>
                              {scenario.description}
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <div class="os-upload-actions">
            <button type="button" class="os-button os-button-secondary" onClick={props.onClose}>取消</button>
            <button
              type="button"
              class="os-button os-button-primary"
              disabled={isScientificResearch() && !selectedScenario()}
              onClick={() => {
                if (hasScenarios()) {
                  props.onConfirm("scientific-research", selectedScenario())
                } else {
                  props.onConfirm(selected(), selectedScenario())
                }
              }}
            >
              进入开发
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
