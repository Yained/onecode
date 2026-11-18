import { describe, expect, test } from "bun:test"
import {
  consumeScenarioWorkflowOpenOnSubmit,
  ensureScenarioTodoDock,
  getScenarioWorkflow,
  openRightDock,
  rightDockOpenRequest,
  rightDockRequestedPane,
} from "./right-dock"
import {
  bindScenarioRunSession,
  clearScenarioRun,
  markScenarioRunStarted,
  startScenarioRun,
} from "./capabilities/scenario-run"

describe("right dock scenario workflow", () => {
  test("reads workflow from scenario run and opens todo pane", () => {
    clearScenarioRun("dir-a")
    startScenarioRun("dir-a", {
      title: "MACE 验证",
      scenarioId: "V01",
      values: {},
      steps: [
        { step_id: "S01", name: "加载 checkpoint", promptTemplate: "p1", inputKeys: [], status: "pending" },
        { step_id: "S02", name: "单点推理", promptTemplate: "p2", inputKeys: [], status: "pending" },
      ],
    })
    expect(getScenarioWorkflow("dir-a")?.steps).toEqual(["加载 checkpoint", "单点推理"])
    expect(consumeScenarioWorkflowOpenOnSubmit("dir-a")).toBe(true)
    markScenarioRunStarted("dir-a")
    expect(consumeScenarioWorkflowOpenOnSubmit("dir-a")).toBe(false)

    const before = rightDockOpenRequest()
    openRightDock("todo")
    expect(rightDockOpenRequest()).toBe(before + 1)
    expect(rightDockRequestedPane()).toBe("todo")
  })

  test("ensureScenarioTodoDock opens while run is active and resolves by session", () => {
    clearScenarioRun("dir-b")
    clearScenarioRun("dir-b-alt")
    startScenarioRun("dir-b", {
      title: "场景",
      scenarioId: "M1",
      values: {},
      steps: [{ step_id: "S01", name: "一步", promptTemplate: "p", inputKeys: [], status: "pending" }],
    })
    markScenarioRunStarted("dir-b")
    bindScenarioRunSession("dir-b", "ses_1")

    const before = rightDockOpenRequest()
    expect(ensureScenarioTodoDock("dir-b")).toBe(true)
    expect(rightDockOpenRequest()).toBe(before + 1)
    expect(getScenarioWorkflow("dir-b-alt", "ses_1")?.title).toBe("场景")
    expect(ensureScenarioTodoDock("missing", "ses_1")).toBe(true)
  })
})
