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
  scenarioFieldRequired,
  scenarioFieldTypeError,
  type ScenarioUserInput,
} from "./scenario-catalog"
import type { ScenarioConfirmMode } from "./scenario-run"

function modeMeta(mode: "confirm" | "edit" | "view" | "rerun", aborting?: boolean) {
  if (mode === "confirm") return { tone: "confirm", label: "确认下一步" }
  if (mode === "edit") return { tone: "edit", label: "编辑参数" }
  if (mode === "rerun") return { tone: aborting ? "abort" : "rerun", label: aborting ? "终止重跑" : "从此步重跑" }
  return { tone: "view", label: "只读查看" }
}

export function ScenarioStepParamsDialog(props: {
  title: string
  reason?: string
  stepName: string
  fields: ScenarioUserInput[]
  values: Record<string, string>
  /** confirm = between-step gate; edit = todo pending; view = read-only; rerun = completed/failed restart */
  mode: "confirm" | "edit" | "view" | "rerun"
  /** When mode is confirm and this is the first mode choice after step 1 */
  firstDecision?: boolean
  onConfirm?: (input: {
    values: Record<string, string>
    mode: Exclude<ScenarioConfirmMode, "unset">
  }) => void
  onSave?: (values: Record<string, string>) => void
  /** When editing the awaiting step from todo, continue with chosen mode */
  onSaveAndContinue?: (input: {
    values: Record<string, string>
    mode: Exclude<ScenarioConfirmMode, "unset">
  }) => void
  onRerun?: (values: Record<string, string>) => void
  canContinue?: boolean
  /** Primary action label when mode is rerun */
  rerunActionLabel?: string
  /** Highlight abort tone for in-progress restart */
  aborting?: boolean
}) {
  const dialog = useDialog()
  const [state, setState] = createStore({
    values: Object.fromEntries(
      props.fields.map((field) => [scenarioFieldKey(field), props.values[scenarioFieldKey(field)] ?? ""]),
    ),
  })
  const readOnly = () => props.mode === "view"
  const meta = () => modeMeta(props.mode, props.aborting)
  const incomplete = createMemo(() =>
    props.fields.filter((field) => {
      if (!scenarioFieldRequired(field)) return false
      return !String(state.values[scenarioFieldKey(field)] ?? "").trim()
    }),
  )
  const reason = () =>
    props.reason ||
    (props.mode === "confirm"
      ? `下一步「${props.stepName}」可按需调整参数；未填必填可由智能体追问，确认后将自动发送并执行。`
      : props.mode === "rerun"
        ? `可修改「${props.stepName}」参数，并从该步重新执行后续流程。`
        : `步骤「${props.stepName}」的参数。`)

  const confirmValues = () => normalizeScenarioValues(props.fields, state.values)
  return (
    <Dialog title={props.title} size="large" fit class="os-client-scenario-step-params">
      <div class="os-client-scenario-step-params-body" data-mode={props.mode} data-tone={meta().tone}>
        <header class="os-client-scenario-step-params-intro">
          <div class="os-client-scenario-step-params-intro-copy">
            <span class="os-client-scenario-step-params-badge" data-tone={meta().tone}>
              {meta().label}
            </span>
            <strong title={props.stepName}>{props.stepName}</strong>
            <p>{reason()}</p>
          </div>
          <Show when={props.fields.length > 0}>
            <div class="os-client-scenario-step-params-count">
              <em>{props.fields.length}</em>
              <span>个参数</span>
            </div>
          </Show>
        </header>

        <Show when={props.fields.length === 0}>
          <div class="os-client-scenario-step-params-empty">本步无需额外用户参数。</div>
        </Show>

        <div class="os-client-scenario-step-params-fields">
          <For each={props.fields}>
            {(field) => {
              const key = scenarioFieldKey(field)
              const required = scenarioFieldRequired(field)
              const empty = !readOnly() && required && !String(state.values[key] ?? "").trim()
              const typeHint =
                !readOnly() &&
                String(state.values[key] ?? "").trim() &&
                scenarioFieldTypeError(field, state.values[key] ?? "")
              return (
                <label
                  class="os-client-scenario-step-params-field"
                  classList={{
                    "is-required": required,
                    "is-invalid": empty,
                    "is-readonly": readOnly(),
                  }}
                >
                  <div class="os-client-scenario-step-params-field-head">
                    <span>
                      {scenarioFieldLabel(field)}
                      <Show when={required && !readOnly()}>
                        <i>*</i>
                      </Show>
                    </span>
                  </div>
                  <Show when={field.hint}>
                    <p class="os-client-scenario-step-params-hint">{field.hint}</p>
                  </Show>
                  <Show
                    when={scenarioFieldMultiline(field)}
                    fallback={
                      <input
                        type="text"
                        inputMode={field.input_type === "int" || field.input_type === "float" ? "decimal" : undefined}
                        value={state.values[key] ?? ""}
                        placeholder={scenarioFieldPlaceholder(field)}
                        disabled={readOnly()}
                        readOnly={readOnly()}
                        onInput={(event) => setState("values", key, event.currentTarget.value)}
                      />
                    }
                  >
                    <textarea
                      rows={field.input_type === "object" || String(field.input_type || "").startsWith("list") ? 5 : 3}
                      value={state.values[key] ?? ""}
                      placeholder={scenarioFieldPlaceholder(field)}
                      disabled={readOnly()}
                      readOnly={readOnly()}
                      onInput={(event) => setState("values", key, event.currentTarget.value)}
                    />
                  </Show>
                  <Show when={typeHint}>
                    <em class="os-client-scenario-step-params-hint-soft">{typeHint}，智能体将尝试自动修正</em>
                  </Show>
                  <Show when={empty}>
                    <em class="os-client-scenario-step-params-hint-soft">未填时由智能体追问</em>
                  </Show>
                </label>
              )
            }}
          </For>
        </div>

        <Show when={!readOnly() && incomplete().length > 0}>
          <p class="os-client-scenario-step-params-warn">
            还有 {incomplete().length} 个必填参数未填写，可先继续，由智能体追问。
          </p>
        </Show>

        <footer class="os-client-scenario-step-params-actions">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {readOnly() ? "关闭" : "稍后"}
          </Button>
          <div class="os-client-scenario-step-params-actions-main">
            <Show when={props.mode === "edit"}>
              <Button
                variant="ghost"
                size="large"
                onClick={() => {
                  props.onSave?.(confirmValues())
                  dialog.close()
                }}
              >
                保存
              </Button>
              <Show when={props.canContinue}>
                <Button
                  variant="secondary"
                  size="large"
                  onClick={() => {
                    props.onSaveAndContinue?.({ values: confirmValues(), mode: "per_step" })
                    dialog.close()
                  }}
                >
                  保存并继续
                </Button>
                <Button
                  variant="primary"
                  size="large"
                  onClick={() => {
                    props.onSaveAndContinue?.({ values: confirmValues(), mode: "auto" })
                    dialog.close()
                  }}
                >
                  保存并连续执行
                </Button>
              </Show>
            </Show>
            <Show when={props.mode === "rerun"}>
              <Button
                variant="primary"
                size="large"
                onClick={() => {
                  props.onRerun?.(confirmValues())
                  dialog.close()
                }}
              >
                {props.rerunActionLabel || "从此步重新执行"}
              </Button>
            </Show>
            <Show when={props.mode === "confirm"}>
              <Button
                variant="secondary"
                size="large"
                onClick={() => {
                  props.onConfirm?.({ values: confirmValues(), mode: "per_step" })
                  dialog.close()
                }}
              >
                {props.firstDecision ? "每步确认参数" : "确认并继续"}
              </Button>
              <Button
                variant="primary"
                size="large"
                onClick={() => {
                  props.onConfirm?.({ values: confirmValues(), mode: "auto" })
                  dialog.close()
                }}
              >
                {props.firstDecision ? "连续执行后续步骤" : "确认并连续执行"}
              </Button>
            </Show>
          </div>
        </footer>
      </div>
    </Dialog>
  )
}
