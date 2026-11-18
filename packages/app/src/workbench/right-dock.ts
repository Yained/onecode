import { createSignal } from "solid-js"
import {
  consumeScenarioRunOpenOnSubmit,
  getScenarioRun,
  resolveScenarioRun,
  scenarioRunRevision,
} from "@/workbench/capabilities/scenario-run"

export type RightDockPane = "directory" | "viz" | "todo"

const [openRequest, setOpenRequest] = createSignal(0)
const [requestedPane, setRequestedPane] = createSignal<RightDockPane | undefined>()

export const rightDockOpenRequest = () => openRequest()
export const rightDockRequestedPane = () => requestedPane()
export const scenarioWorkflowRevision = () => scenarioRunRevision()

export function getScenarioWorkflow(key: string, sessionID?: string) {
  const run = resolveScenarioRun(key, sessionID) ?? getScenarioRun(key)
  if (!run) return
  return {
    title: run.title,
    steps: run.steps.map((step) => step.name),
    stepStatuses: run.steps.map((step) => step.status),
    openOnSubmit: run.openOnSubmit,
    phase: run.phase,
    stopReason: run.stopReason,
  }
}

export function consumeScenarioWorkflowOpenOnSubmit(key: string) {
  return consumeScenarioRunOpenOnSubmit(key)
}

export function openRightDock(pane: RightDockPane) {
  setRequestedPane(pane)
  setOpenRequest((value) => value + 1)
}

/** Ensure todo dock is open while a scenario run is active for this workspace. */
export function ensureScenarioTodoDock(key: string, sessionID?: string) {
  const run = resolveScenarioRun(key, sessionID)
  if (!run) return false
  if (run.phase === "done" || run.phase === "stopped") return false
  openRightDock("todo")
  return true
}
