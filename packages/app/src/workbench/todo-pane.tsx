import { For, Show, createMemo } from "solid-js"
import type { Todo } from "@opencode-ai/sdk/v2"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showEphemeralToast } from "@opencode-ai/ui/toast"
import {
  confirmScenarioNextStep,
  getScenarioRun,
  requestScenarioContinue,
  resolveScenarioRun,
  restartScenarioRunFromStep,
  scenarioRunFieldsForStepIndex,
  scenarioRunRevision,
  updateScenarioRunValues,
  type ScenarioRunStepStatus,
} from "@/workbench/capabilities/scenario-run"
import { ScenarioStepParamsDialog } from "@/workbench/capabilities/scenario-step-params-dialog"

function toTodoStatus(status: ScenarioRunStepStatus): Todo["status"] {
  if (status === "completed") return "completed"
  if (status === "in_progress") return "in_progress"
  if (status === "failed") return "cancelled"
  return "pending"
}

function statusDot(status: Todo["status"]) {
  if (status !== "in_progress") return undefined
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="6" r="3" class="os-client-right-todo-pulse" />
    </svg>
  )
}

function dialogModeForStep(status: ScenarioRunStepStatus, canContinue: boolean) {
  if (canContinue) return "confirm" as const
  if (status === "pending") return "edit" as const
  if (status === "completed" || status === "failed" || status === "in_progress") return "rerun" as const
  return "view" as const
}

function TodoRows(props: {
  items: Array<{ content: string; status: Todo["status"]; index: number }>
  onOpen: (index: number) => void
}) {
  return (
    <ul class="os-client-right-todo-list">
      <For each={props.items}>
        {(item) => (
          <li
            class="os-client-right-todo-item is-clickable"
            data-state={item.status}
            role="button"
            tabindex="0"
            onClick={() => props.onOpen(item.index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                props.onOpen(item.index)
              }
            }}
          >
            <Checkbox
              readOnly
              checked={item.status === "completed"}
              indeterminate={item.status === "in_progress"}
              icon={statusDot(item.status)}
            >
              <span
                class="os-client-right-todo-text"
                classList={{
                  "is-done": item.status === "completed" || item.status === "cancelled",
                  "is-pending": item.status === "pending",
                }}
              >
                {item.content}
              </span>
            </Checkbox>
          </li>
        )}
      </For>
    </ul>
  )
}

export function WorkbenchTodoPane(props: {
  directoryKey: string
  sessionID?: string
  onClose: () => void
}) {
  const dialog = useDialog()
  scenarioRunRevision()
  const run = createMemo(() => resolveScenarioRun(props.directoryKey, props.sessionID) ?? getScenarioRun(props.directoryKey))
  const rows = createMemo(() => {
    const current = run()
    if (!current?.steps.length) return []
    return current.steps.map((step, index) => ({
      content: step.name,
      status: toTodoStatus(step.status),
      index,
    }))
  })
  const done = createMemo(() => rows().filter((item) => item.status === "completed").length)
  const title = createMemo(() => run()?.title || "待办")

  const openStep = (index: number) => {
    const current = resolveScenarioRun(props.directoryKey, props.sessionID) ?? getScenarioRun(props.directoryKey)
    if (!current) return
    const step = current.steps[index]
    if (!step) return
    const fields = scenarioRunFieldsForStepIndex(current, index)
    const canContinue = step.status === "pending" && current.phase === "awaiting_confirm" && current.currentIndex === index
    const mode = dialogModeForStep(step.status, canContinue)
    const aborting = step.status === "in_progress"
    const titleText =
      mode === "confirm"
        ? "确认下一步参数"
        : mode === "edit"
          ? "编辑步骤参数"
          : aborting
            ? "终止并重新执行"
            : mode === "rerun"
              ? "从此步重新执行"
              : "查看步骤参数"
    const runKey = props.directoryKey
    dialog.show(() => (
      <ScenarioStepParamsDialog
        title={titleText}
        stepName={step.name}
        fields={fields}
        values={current.values}
        mode={mode}
        firstDecision={canContinue && current.confirmMode === "unset"}
        aborting={aborting}
        rerunActionLabel={aborting ? "终止并重新执行" : "从此步重新执行"}
        reason={
          mode === "confirm"
            ? `下一步「${step.name}」可按需调整参数，确认后将自动发送并执行。`
            : mode === "edit"
              ? `可修改「${step.name}」的预填参数，保存后在执行该步时生效。`
              : aborting
                ? `将停止自动续跑并从「${step.name}」重发。已提交的外部作业需自行取消；可先修改参数再确认。`
                : mode === "rerun"
                  ? `可修改「${step.name}」参数。确认后将从该步重新执行，并重置后续步骤状态。`
                  : `「${step.name}」当前为只读，展示该步相关参数。`
        }
        canContinue={canContinue}
        onSave={(values) => {
          updateScenarioRunValues(runKey, values)
          showEphemeralToast({ title: "已保存步骤参数" })
        }}
        onConfirm={(input) => {
          const confirmed = confirmScenarioNextStep(runKey, input)
          if (!confirmed) return
          requestScenarioContinue(runKey, confirmed)
          showEphemeralToast({
            title: input.mode === "auto" ? `连续执行：${confirmed.stepName}` : `继续执行：${confirmed.stepName}`,
          })
        }}
        onSaveAndContinue={(input) => {
          updateScenarioRunValues(runKey, input.values)
          const confirmed = confirmScenarioNextStep(runKey, input)
          if (!confirmed) return
          requestScenarioContinue(runKey, confirmed)
          showEphemeralToast({
            title: input.mode === "auto" ? `连续执行：${confirmed.stepName}` : `继续执行：${confirmed.stepName}`,
          })
        }}
        onRerun={(values) => {
          const restarted = restartScenarioRunFromStep(runKey, {
            stepIndex: index,
            values,
          })
          if (!restarted) return
          requestScenarioContinue(runKey, restarted)
          showEphemeralToast({
            title: aborting ? `已终止并从该步重跑：${restarted.stepName}` : `已从该步重新执行：${restarted.stepName}`,
          })
        }}
      />
    ))
  }

  return (
    <section class="os-client-right-todo">
      <header class="os-client-right-todo-header">
        <strong title={title()}>{title()}</strong>
        <button type="button" onClick={props.onClose}>
          关闭
        </button>
      </header>
      <Show
        when={rows().length > 0}
        fallback={
          <p class="os-client-right-todo-empty">
            暂无场景工作流。从能力中心场景创建任务后，步骤会显示在这里。
          </p>
        }
      >
        <p class="os-client-right-todo-progress">
          已完成 {done()} / {rows().length}
          <Show when={run()?.stopReason}>{(reason) => <span class="os-client-right-todo-stop"> · {reason()}</span>}</Show>
        </p>
        <TodoRows items={rows()} onOpen={openStep} />
      </Show>
    </section>
  )
}
