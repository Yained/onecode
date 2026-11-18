import { describe, expect, test } from "bun:test"
import {
  beginScenarioRuntimeInstall,
  confirmScenarioNextStep,
  getScenarioRun,
  handleScenarioRunIdle,
  markScenarioRunStarted,
  moveScenarioRun,
  parseMissingParamKeys,
  parseMissingRuntimes,
  parseScenarioStepVerdict,
  restartScenarioRunFromStep,
  resumeScenarioRunAfterParams,
  seedScenarioSessionTitle,
  startScenarioRun,
  updateScenarioRunValues,
} from "./scenario-run"

function expectStepPrompt(actual: string | undefined, body: string) {
  expect(actual?.startsWith(body)).toBe(true)
  expect(actual).toContain("参数规范化")
}

describe("scenario step verdict", () => {
  test("parses conclusion tokens", () => {
    expect(parseScenarioStepVerdict("G. 结论：PASS，可进入下一步")).toBe("pass")
    expect(parseScenarioStepVerdict("结论: BLOCKED\n原因：缺参")).toBe("blocked")
    expect(parseScenarioStepVerdict("最终 REJECT")).toBe("reject")
  })

  test("extracts missing keys", () => {
    expect(
      parseMissingParamKeys("A. 用户输入：\n- {ENCUT}: MISSING\n- DEVICE: ok", ["ENCUT", "DEVICE", "MACE_MODEL"]),
    ).toEqual(["ENCUT"])
  })
})

describe("scenario run idle handler", () => {
  test("asks to confirm next step params after first PASS", () => {
    startScenarioRun("run-a", {
      title: "demo",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        { step_id: "S01", name: "一步", promptTemplate: "step1 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S02", name: "二步", promptTemplate: "step2 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
      ],
    })
    markScenarioRunStarted("run-a")
    const result = handleScenarioRunIdle("run-a", {
      assistantMessageID: "a1",
      assistantText: "G. 结论：PASS",
    })
    expect(result.action).toBe("confirm_next")
    if (result.action !== "confirm_next") return
    expect(result.stepName).toBe("二步")
    expect(result.firstDecision).toBe(true)
    expect(getScenarioRun("run-a")?.phase).toBe("awaiting_confirm")
    expect(getScenarioRun("run-a")?.currentIndex).toBe(1)

    const confirmed = confirmScenarioNextStep("run-a", {
      values: { ENCUT: "420" },
      mode: "auto",
    })
    expect(confirmed?.stepName).toBe("二步")
    expectStepPrompt(confirmed?.prompt, "step2 420")
    expect(getScenarioRun("run-a")?.confirmMode).toBe("auto")
    expect(getScenarioRun("run-a")?.phase).toBe("running")
  })

  test("auto-advances without confirm when confirmMode is auto", () => {
    startScenarioRun("run-a2", {
      title: "demo",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        { step_id: "S01", name: "一步", promptTemplate: "step1 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S02", name: "二步", promptTemplate: "step2 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S03", name: "三步", promptTemplate: "step3 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
      ],
    })
    markScenarioRunStarted("run-a2")
    handleScenarioRunIdle("run-a2", {
      assistantMessageID: "b1",
      assistantText: "G. 结论：PASS",
    })
    confirmScenarioNextStep("run-a2", { values: {}, mode: "auto" })
    const result = handleScenarioRunIdle("run-a2", {
      assistantMessageID: "b2",
      assistantText: "G. 结论：PASS",
    })
    expect(result.action).toBe("next")
    if (result.action !== "next") return
    expect(result.stepName).toBe("三步")
    expectStepPrompt(result.prompt, "step3 400")
  })

  test("keeps confirming each step when mode is per_step", () => {
    startScenarioRun("run-a3", {
      title: "demo",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        { step_id: "S01", name: "一步", promptTemplate: "step1 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S02", name: "二步", promptTemplate: "step2 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S03", name: "三步", promptTemplate: "step3 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
      ],
    })
    markScenarioRunStarted("run-a3")
    handleScenarioRunIdle("run-a3", {
      assistantMessageID: "c1",
      assistantText: "G. 结论：PASS",
    })
    confirmScenarioNextStep("run-a3", { values: {}, mode: "per_step" })
    const result = handleScenarioRunIdle("run-a3", {
      assistantMessageID: "c2",
      assistantText: "G. 结论：PASS",
    })
    expect(result.action).toBe("confirm_next")
    if (result.action !== "confirm_next") return
    expect(result.stepName).toBe("三步")
    expect(result.firstDecision).toBe(false)
  })

  test("restarts from a completed step and resets later steps", () => {
    startScenarioRun("run-restart", {
      title: "demo",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        { step_id: "S01", name: "一步", promptTemplate: "step1 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S02", name: "二步", promptTemplate: "step2 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S03", name: "三步", promptTemplate: "step3 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
      ],
    })
    markScenarioRunStarted("run-restart")
    handleScenarioRunIdle("run-restart", {
      assistantMessageID: "r1",
      assistantText: "G. 结论：PASS",
    })
    confirmScenarioNextStep("run-restart", { values: {}, mode: "auto" })
    handleScenarioRunIdle("run-restart", {
      assistantMessageID: "r2",
      assistantText: "G. 结论：PASS",
    })
    expect(getScenarioRun("run-restart")?.steps.map((step) => step.status)).toEqual([
      "completed",
      "completed",
      "in_progress",
    ])

    const restarted = restartScenarioRunFromStep("run-restart", {
      stepIndex: 0,
      values: { ENCUT: "500" },
    })
    expect(restarted?.stepName).toBe("一步")
    expectStepPrompt(restarted?.prompt, "step1 500")
    expect(getScenarioRun("run-restart")?.currentIndex).toBe(0)
    expect(getScenarioRun("run-restart")?.phase).toBe("running")
    expect(getScenarioRun("run-restart")?.steps.map((step) => step.status)).toEqual([
      "in_progress",
      "pending",
      "pending",
    ])
    expect(getScenarioRun("run-restart")?.values.ENCUT).toBe("500")
  })

  test("aborts an in-progress step and restarts with new params", () => {
    startScenarioRun("run-abort", {
      title: "demo",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        { step_id: "S01", name: "一步", promptTemplate: "step1 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
        { step_id: "S02", name: "二步", promptTemplate: "step2 {ENCUT}", inputKeys: ["ENCUT"], status: "pending" },
      ],
    })
    markScenarioRunStarted("run-abort")
    expect(getScenarioRun("run-abort")?.steps[0]?.status).toBe("in_progress")

    const aborted = restartScenarioRunFromStep("run-abort", {
      stepIndex: 0,
      values: { ENCUT: "520" },
    })
    expect(aborted?.stepName).toBe("一步")
    expectStepPrompt(aborted?.prompt, "step1 520")
    expect(getScenarioRun("run-abort")?.steps.map((step) => step.status)).toEqual(["in_progress", "pending"])
    expect(getScenarioRun("run-abort")?.values.ENCUT).toBe("520")
  })

  test("requests params on BLOCKED with MISSING", () => {
    startScenarioRun("run-b", {
      title: "demo",
      scenarioId: "M1",
      values: {},
      steps: [
        {
          step_id: "S01",
          name: "一步",
          promptTemplate: "step1 {FIXED_CU_LAYERS}",
          inputKeys: ["FIXED_CU_LAYERS"],
          status: "pending",
        },
      ],
    })
    markScenarioRunStarted("run-b")
    expect(getScenarioRun("run-b")?.phase).toBe("running")

    const result = handleScenarioRunIdle("run-b", {
      assistantMessageID: "a2",
      assistantText: "A. {FIXED_CU_LAYERS}: MISSING\nG. 结论：BLOCKED",
    })
    expect(result).toEqual({
      action: "need_params",
      keys: ["FIXED_CU_LAYERS"],
      reason: "缺少必要参数，请补充后继续",
    })

    updateScenarioRunValues("run-b", { FIXED_CU_LAYERS: "2" })
    const resumed = resumeScenarioRunAfterParams("run-b")
    expect(resumed?.prompt).toContain("2")
  })

  test("requests runtime install on BLOCKED VASP environment", () => {
    startScenarioRun("run-c", {
      title: "demo",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        {
          step_id: "S02",
          name: "VASP",
          promptTemplate: "run vasp {ENCUT}",
          inputKeys: ["ENCUT"],
          status: "pending",
        },
      ],
    })
    markScenarioRunStarted("run-c")
    const result = handleScenarioRunIdle("run-c", {
      assistantMessageID: "a3",
      assistantText: "B. 系统识别：VASP_RUNTIME 未找到可执行文件\nG. 结论：BLOCKED",
    })
    expect(result.action).toBe("need_runtime")
    if (result.action !== "need_runtime") return
    expect(result.resourceIds).toContain("vasp")

    const install = beginScenarioRuntimeInstall("run-c", result.resourceIds)
    expect(install?.resourceId).toBe("vasp")
    expect(install?.prompt).toContain("https://")
    expect(getScenarioRun("run-c")?.phase).toBe("installing_runtime")
  })

  test("detects missing lammps runtime text", () => {
    expect(parseMissingRuntimes("无法识别可用的 LAMMPS 可执行文件，结论 BLOCKED")).toContain("lammps")
  })

  test("moves scenario run when switching workspace directory", () => {
    startScenarioRun("dir-old", {
      title: "迁移场景",
      scenarioId: "M1",
      values: { ENCUT: "400" },
      steps: [
        { step_id: "S01", name: "一步", promptTemplate: "step1", inputKeys: [], status: "pending" },
        { step_id: "S02", name: "二步", promptTemplate: "step2", inputKeys: [], status: "pending" },
      ],
    })
    markScenarioRunStarted("dir-old")
    expect(moveScenarioRun("dir-old", "dir-new")).toBe(true)
    expect(getScenarioRun("dir-old")).toBeUndefined()
    expect(getScenarioRun("dir-new")?.title).toBe("迁移场景")
    expect(getScenarioRun("dir-new")?.phase).toBe("running")
    expect(getScenarioRun("dir-new")?.openOnSubmit).toBe(true)
    expect(getScenarioRun("dir-new")?.values.ENCUT).toBe("400")
  })

  test("seeds scenario name onto the session title once", async () => {
    startScenarioRun("seed-a", {
      title: "MACE 训练 smoke 验证",
      scenarioId: "M1",
      values: {},
      steps: [{ step_id: "S01", name: "一步", promptTemplate: "long prompt", inputKeys: [], status: "pending" }],
    })
    const titles: string[] = []
    expect(
      seedScenarioSessionTitle("seed-a", "ses_1", async (title) => {
        titles.push(title)
      }),
    ).toBe(true)
    expect(titles).toEqual(["MACE 训练 smoke 验证"])
    expect(getScenarioRun("seed-a")?.titleSeeded).toBe(true)
    expect(getScenarioRun("seed-a")?.sessionID).toBe("ses_1")
    expect(
      seedScenarioSessionTitle("seed-a", "ses_1", async (title) => {
        titles.push(title)
      }),
    ).toBe(false)
    expect(titles).toEqual(["MACE 训练 smoke 验证"])
  })
})
