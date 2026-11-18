import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import {
  normalizeScenarioValues,
  scenarioFieldKey,
  scenarioFieldLabel,
  scenarioFieldMultiline,
  scenarioFieldPlaceholder,
  scenarioFieldTypeError,
  type ScenarioUserInput,
} from "./scenario-catalog"

export function ScenarioMissingParamsDialog(props: {
  title?: string
  reason?: string
  fields: ScenarioUserInput[]
  values: Record<string, string>
  onConfirm: (values: Record<string, string>) => void
}) {
  const dialog = useDialog()
  const [state, setState] = createStore({
    values: Object.fromEntries(props.fields.map((field) => [scenarioFieldKey(field), props.values[scenarioFieldKey(field)] ?? ""])),
  })

  const incomplete = createMemo(() =>
    props.fields.filter((field) => !String(state.values[scenarioFieldKey(field)] ?? "").trim()),
  )
  const blocked = createMemo(() => props.fields.length > 0 && incomplete().length > 0)

  return (
    <Dialog title={props.title || "补充缺失参数"} size="large" fit>
      <div class="os-client-scenario-missing-dialog">
        <p class="os-client-scenario-missing-reason">
          {props.reason || "当前步骤缺少必要参数，请补充后继续自动执行。"}
        </p>
        <Show when={props.fields.length === 0}>
          <p class="os-client-scenario-missing-reason">未识别到具体字段，请返回场景检查输入后重试本步骤。</p>
        </Show>
        <div class="os-client-scenario-missing-fields">
          <For each={props.fields}>
            {(field) => {
              const key = scenarioFieldKey(field)
              const empty = !String(state.values[key] ?? "").trim()
              const typeHint =
                String(state.values[key] ?? "").trim() && scenarioFieldTypeError(field, state.values[key] ?? "")
              return (
                <label
                  class="os-client-scenario-missing-field"
                  classList={{ "is-invalid": empty }}
                >
                  <span>{scenarioFieldLabel(field)}</span>
                  <Show
                    when={scenarioFieldMultiline(field)}
                    fallback={
                      <input
                        type="text"
                        inputMode={field.input_type === "int" || field.input_type === "float" ? "decimal" : undefined}
                        value={state.values[key] ?? ""}
                        placeholder={scenarioFieldPlaceholder(field)}
                        onInput={(event) => setState("values", key, event.currentTarget.value)}
                      />
                    }
                  >
                    <textarea
                      rows={3}
                      value={state.values[key] ?? ""}
                      placeholder={scenarioFieldPlaceholder(field)}
                      onInput={(event) => setState("values", key, event.currentTarget.value)}
                    />
                  </Show>
                  <Show when={typeHint}>
                    <em>{typeHint}，智能体将尝试自动修正</em>
                  </Show>
                  <Show when={empty}>
                    <em>必填</em>
                  </Show>
                </label>
              )
            }}
          </For>
        </div>
        <div class="os-client-scenario-missing-actions">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            稍后处理
          </Button>
          <Button
            variant="primary"
            size="large"
            disabled={blocked()}
            onClick={() => {
              props.onConfirm(normalizeScenarioValues(props.fields, state.values))
              dialog.close()
            }}
          >
            补充并继续
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
