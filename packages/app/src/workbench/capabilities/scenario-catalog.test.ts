import { describe, expect, test } from "bun:test"
import {
  emptyScenarioValues,
  formatScenarioFieldDefault,
  getUserScenario,
  missingRequiredScenarioFields,
  normalizeScenarioFieldValue,
  buildScenarioParamNormalizeHint,
  renderScenarioPrompt,
  scenarioFieldKey,
  scenarioFieldLabel,
  scenarioFieldPlaceholder,
  scenarioFieldTypeError,
  scenarioFieldsForStep,
  scenarioHpcTokens,
  scenarioLookupKey,
  scenarioWorkflowSteps,
  searchDomainScenarios,
  userScenariosForResource,
  visibleScenarios,
} from "./scenario-catalog"

describe("scenario catalog", () => {
  test("maps user input vars to Chinese labels", () => {
    expect(scenarioFieldLabel({ var: "{CONDA_ENV}" })).toBe("Conda 环境")
    expect(scenarioFieldPlaceholder({ var: "{CHECKPOINT}" })).toBe("填写模型权重")
    expect(scenarioFieldPlaceholder({ var: "{DEVICE}", hint: "CPU 或 CUDA" })).toBe("CPU 或 CUDA")
    expect(scenarioFieldPlaceholder({ var: "{N}", input_type: "int", hint: "层数" })).toBe("例如：层数（整数）")
    expect(scenarioFieldPlaceholder({ var: "{N}", input_type: "int", label: "层数", hint: "正整数" })).toBe(
      "正整数（整数）",
    )
    expect(scenarioFieldPlaceholder({ var: "{N}", input_type: "int" })).toBe("填写N（整数）")
    expect(scenarioFieldPlaceholder({ var: "{NOTE}", input_type: "doc", hint: "补充说明" })).toBe(
      "例如：补充说明（文件路径）",
    )
    expect(scenarioFieldPlaceholder({ var: "{CFG}", input_type: "object" })).toBe("填写CFG（JSON 对象）")
    expect(scenarioFieldPlaceholder({ var: "{TAGS}", input_type: "list[str]" })).toBe("填写TAGS（字符串列表）")
    expect(scenarioFieldPlaceholder({ var: "{NAME}", input_type: "str", hint: "名称" })).toBe("例如：名称")
  })

  test("renders prompt placeholders from field values", () => {
    expect(renderScenarioPrompt("设备 {DEVICE}", { DEVICE: "cuda:0" })).toBe("设备 cuda:0")
    expect(renderScenarioPrompt("设备 {DEVICE}", {})).toBe("设备 {DEVICE}")
  })

  test("lists and searches domain scenarios, and links them to models", () => {
    expect(searchDomainScenarios("materials", "").length).toBeGreaterThan(0)
    expect(searchDomainScenarios("materials", "M1").some((item) => item.scenario_id === "M1")).toBe(true)
    expect(searchDomainScenarios("materials", "不存在的场景xyz")).toEqual([])
    expect(searchDomainScenarios("materials", "M 1").some((item) => item.scenario_id === "M1")).toBe(true)
    expect(userScenariosForResource({ domain: "materials", name: "MACE", id: "mace" }).map((item) => item.scenario_id)).toContain(
      "M1",
    )
    expect(userScenariosForResource({ domain: "weather", name: "MACE", id: "mace" })).toEqual([])
    expect(searchDomainScenarios("weather", "").length).toBeGreaterThan(0)
    expect(searchDomainScenarios("bio", "BIO01").some((item) => item.scenario_id === "BIO01")).toBe(true)
    expect(userScenariosForResource({ domain: "bio", name: "AlphaGenome", id: "alphagenome" }).map((item) => item.scenario_id)).toContain(
      "BIO02",
    )
  })

  test("combines filters and requires matching model for materials scenarios", () => {
    expect(
      visibleScenarios({
        domain: "materials",
        model: "",
        hpc: "",
        dataset: "",
        privateModelIds: new Set(),
      }),
    ).toEqual([])

    expect(
      visibleScenarios({
        domain: "materials",
        model: "MACE",
        hpc: "",
        dataset: "",
        privateModelIds: new Set(),
      }).length,
    ).toBeGreaterThan(0)

    expect(
      visibleScenarios({
        domain: "materials",
        model: "MACE",
        hpc: "lammps",
        dataset: "",
        privateModelIds: new Set(),
      }).length,
    ).toBeGreaterThan(0)

    expect(
      visibleScenarios({
        domain: "materials",
        model: "",
        hpc: "vasp",
        dataset: "",
        privateModelIds: new Set(),
      }).length,
    ).toBeGreaterThan(0)

    expect(
      visibleScenarios({
        domain: "weather",
        model: "MACE",
        hpc: "",
        dataset: "",
        privateModelIds: new Set(),
      }),
    ).toEqual([])
  })

  test("maps step input variables to scenario fields", () => {
    const scenario = getUserScenario("M1")
    expect(scenario).toBeTruthy()
    const step = scenarioWorkflowSteps(scenario!)[0]
    const fields = scenarioFieldsForStep(scenario!, step)
    expect(fields.map((field) => scenarioFieldKey(field))).toEqual(["SYSTEM_DESCRIPTION", "FIXED_CU_LAYERS"])
    expect(scenarioFieldLabel(fields[0]!)).toBe("体系描述")
  })

  test("prefills M1 defaults so required fields are ready to run", () => {
    const scenario = getUserScenario("M1")
    expect(scenario).toBeTruthy()
    expect(scenario!.is_onemodel).toBe(true)
    expect(scenario!.user_input.length).toBeGreaterThan(0)
    expect(scenario!.user_input.every((input) => Boolean(formatScenarioFieldDefault(input.default).trim()))).toBe(true)

    const fixed = scenario!.user_input.find((input) => scenarioFieldKey(input) === "FIXED_CU_LAYERS")
    expect(typeof fixed?.default).toBe("number")
    const dftConfig = scenario!.user_input.find((input) => scenarioFieldKey(input) === "DFT_CONFIG")
    expect(dftConfig?.default && typeof dftConfig.default === "object").toBe(true)

    const values = emptyScenarioValues(scenario!)
    expect(values.FIXED_CU_LAYERS).toBe("2")
    expect(values.DFT_FUNCTIONAL).toBe("PBE")
    expect(values.AIMD_STEPS).toBe("6000")
    expect(values.PRODUCTION_TIME_PS).toBeTruthy()
    expect(values.DFT_CONFIG).toContain('"ENCUT": 450')
    expect(values.AIMD_SOURCE).toContain("/Users/zhaoxucong/project/onecode/")
    expect(missingRequiredScenarioFields(scenario!, values)).toEqual([])
  })

  test("validates field values against input_type", () => {
    expect(scenarioFieldTypeError({ var: "{N}", input_type: "int" }, "12")).toBeUndefined()
    expect(scenarioFieldTypeError({ var: "{N}", input_type: "int" }, "12.5")).toBe("请输入整数")
    expect(scenarioFieldTypeError({ var: "{N}", input_type: "int" }, "abc")).toBe("请输入整数")
    expect(scenarioFieldTypeError({ var: "{T}", input_type: "float" }, "300.5")).toBeUndefined()
    expect(scenarioFieldTypeError({ var: "{T}", input_type: "float" }, "x")).toBe("请输入数字")
    expect(scenarioFieldTypeError({ var: "{CFG}", input_type: "object" }, '{"a":1}')).toBeUndefined()
    expect(scenarioFieldTypeError({ var: "{CFG}", input_type: "object" }, "[1]")).toContain("JSON 对象")
    expect(scenarioFieldTypeError({ var: "{L}", input_type: "list[str]" }, '["a"]')).toBeUndefined()
    expect(scenarioFieldTypeError({ var: "{L}", input_type: "list[str]" }, "[1]")).toContain("字符串数组")
    expect(scenarioFieldTypeError({ var: "{L}", input_type: "list[int]" }, "[1,2]")).toBeUndefined()
    expect(scenarioFieldTypeError({ var: "{L}", input_type: "list[int]" }, '["a"]')).toContain("整数数组")
  })

  test("normalizes common field values without forcing ambiguous input", () => {
    expect(normalizeScenarioFieldValue({ var: "{N}", input_type: "int" }, "12.0")).toBe("12")
    expect(normalizeScenarioFieldValue({ var: "{N}", input_type: "int" }, "abc")).toBe("abc")
    expect(normalizeScenarioFieldValue({ var: "{OK}", input_type: "bool" }, "是")).toBe("true")
    expect(normalizeScenarioFieldValue({ var: "{OK}", input_type: "bool" }, "否")).toBe("false")
    expect(normalizeScenarioFieldValue({ var: "{T}", input_type: "float" }, "1,234.5")).toBe("1234.5")
    const hint = buildScenarioParamNormalizeHint(
      [{ var: "{N}", input_type: "int" }],
      { N: "twelve" },
    )
    expect(hint).toContain("参数规范化")
    expect(hint).toContain("待核对字段")
    expect(hint).toContain("MISSING")
    expect(hint).toContain('"twelve"')

    const missingHint = buildScenarioParamNormalizeHint(
      [{ var: "{INITIAL_ANALYSIS}", label: "全球分析初场", required: true, input_type: "str" }],
      {},
    )
    expect(missingHint).toContain("尚未提供")
    expect(missingHint).toContain("向用户追问")
    expect(missingHint).toContain("INITIAL_ANALYSIS")
    expect(missingHint).toContain("status=MISSING")
  })

  test("links scenarios to onemodel cards only via non-empty model_ids", () => {
    expect(
      userScenariosForResource({ domain: "materials", name: "MACE", id: "mace", category: "onemodel" }).map(
        (item) => item.scenario_id,
      ),
    ).toContain("M1")

    const materialsLibrary = searchDomainScenarios("materials", "")
    expect(materialsLibrary.some((item) => item.name.includes("Cu-NxBy") || item.id?.includes("Cu-NxBy"))).toBe(true)
    expect(materialsLibrary.some((item) => !item.model_ids?.length)).toBe(true)
    expect(materialsLibrary.every((item) => /^M\d+$/i.test(item.scenario_id))).toBe(true)
    expect(
      userScenariosForResource({ domain: "materials", name: "MACE", id: "mace", category: "onemodel" }).every(
        (item) => (item.model_ids?.length ?? 0) > 0,
      ),
    ).toBe(true)

    const bio01OnRf = userScenariosForResource({ domain: "bio", name: "RFdiffusion", id: "rfdiffusion", category: "onemodel" })
    const bio01OnLa = userScenariosForResource({ domain: "bio", name: "LaProteina", id: "laproteina", category: "onemodel" })
    const bio01OnPt = userScenariosForResource({ domain: "bio", name: "PT-DiT", id: "pt_dit", category: "onemodel" })
    expect(bio01OnRf.map((item) => item.scenario_id)).toContain("BIO01")
    expect(bio01OnLa.map((item) => item.scenario_id)).toContain("BIO01")
    expect(bio01OnPt.map((item) => item.scenario_id)).toContain("BIO01")
  })

  test("links scenarios to hpc cards via scenario HPC names", () => {
    const onVasp = userScenariosForResource({ domain: "materials", name: "VASP", id: "vasp", category: "hpc" })
    const onLammps = userScenariosForResource({ domain: "materials", name: "LAMMPS", id: "lammps", category: "hpc" })

    expect(onVasp.some((item) => item.scenario_id === "M1")).toBe(true)
    expect(onVasp.some((item) => item.name.includes("Cu-NxBy") || item.id?.includes("Cu-NxBy"))).toBe(true)
    expect(onVasp.some((item) => item.name.includes("LiNiCo") || item.id?.includes("LiNiCo"))).toBe(true)
    expect(onLammps.some((item) => item.scenario_id === "M1")).toBe(true)

    // HPC card must not pick up onemodel-only scenarios without matching HPC tokens.
    expect(onVasp.every((item) => scenarioHpcTokens(item).some((token) => /vasp/i.test(token)))).toBe(true)
    expect(
      userScenariosForResource({ domain: "materials", name: "MACE", id: "mace", category: "hpc" }),
    ).toEqual([])
  })

  test("keeps materials M1 distinct from earth E1 medium-range forecast", () => {
    const materialsM1 = getUserScenario("seed-scenarios-M1")
    const earthE1 = getUserScenario("seed-scenarios-E1") ?? getUserScenario("E1")
    expect(getUserScenario("seed-scenarios-meteorology-M1")).toBeUndefined()
    expect(materialsM1?.scenario_id).toBe("M1")
    expect(materialsM1?.domain).toBe("materials")
    expect(earthE1?.scenario_id).toBe("E1")
    expect(earthE1?.domain).toBe("weather")
    expect(earthE1?.name).toContain("全球分析场驱动")
    expect(materialsM1?.name).not.toBe(earthE1?.name)
    expect(scenarioLookupKey(materialsM1!)).toBe("seed-scenarios-M1")
    expect(searchDomainScenarios("weather", "全球分析场驱动").filter((item) => item.name.includes("全球分析场驱动")).length).toBe(1)
  })

  test("exposes clickable related paper links for scenarios with papers", () => {
    const scenario = getUserScenario("BIO01") ?? searchDomainScenarios("bio", "BIO01")[0]
    expect(scenario).toBeTruthy()
    expect((scenario!.related_papers ?? []).length).toBeGreaterThan(0)
    expect((scenario!.related_papers ?? [])[0]?.url).toMatch(/^https?:\/\//)
    expect((scenario!.related_papers ?? [])[0]?.title.trim().length).toBeGreaterThan(0)
  })
})
