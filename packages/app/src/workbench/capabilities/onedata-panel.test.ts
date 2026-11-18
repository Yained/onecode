import { describe, expect, test } from "bun:test"
import {
  alreadyStatusLabel,
  capabilityDomainToDatasetFilter,
  connectorLabel,
  connectorPlaceholder,
  formatDataSize,
  inferConnector,
  canPublishAlreadyItem,
  publishBlockedReason,
  workspaceUploadRegisterOptions,
  workspaceUploadRegisterUri,
} from "./onedata-filters"
import { buildStandardizeHandoffPrompt, buildTrainWithModelHandoffPrompt, matchTrainableModel, suggestAiReadyTargetDir } from "./onedata-standardize"

describe("onedata panel", () => {
  test("maps capability domains onto the dataset catalog filters", () => {
    expect(capabilityDomainToDatasetFilter).toEqual({
      all: "全部",
      weather: "地球科学",
      materials: "材料化学",
      bio: "生命科学",
      fluid: "流体仿真",
    })
  })

  test("builds name + source + target handoff for standardize", () => {
    expect(suggestAiReadyTargetDir("/data/era5", "ERA5")).toBe("/data/era5-ai-ready")
    expect(suggestAiReadyTargetDir("/data/era5.csv", "ERA5")).toBe("/data/era5-ai-ready")
    expect(suggestAiReadyTargetDir("https://example.com/x", "Remote")).toBe("onedata/ai-ready/Remote")
    const prompt = buildStandardizeHandoffPrompt({
      name: "ERA5",
      sourceDir: "/data/era5",
      targetDir: "/data/era5-ai-ready",
    })
    expect(prompt).toContain("数据集名称：ERA5")
    expect(prompt).toContain("source dir（原始数据）：/data/era5")
    expect(prompt).toContain("target dir（AI Ready）：/data/era5-ai-ready")
    expect(prompt).toContain("dataset_report")
    expect(prompt).toContain("register_dataset_primitive")
    expect(prompt).toContain("already_id")
    expect(prompt).toContain("target_dir")
  })

  test("builds train-with-model handoff with model, already id and target", () => {
    const prompt = buildTrainWithModelHandoffPrompt({
      alreadyName: "sample.csv",
      alreadyId: "alr_demo",
      dataUri: "/data/sample.csv",
      modelName: "GraphCast",
      modelId: "graphcast",
      scenarioTitle: "微调",
      scenarioSummary: "用可训练数据微调模型",
      target: "local",
    })
    expect(prompt).toContain("模型：GraphCast（graphcast）")
    expect(prompt).toContain("场景：微调")
    expect(prompt).toContain("可训练数据 ID：alr_demo")
    expect(prompt).toContain("数据路径：/data/sample.csv")
    expect(prompt).toContain("训练位置：当前执行环境")
    expect(prompt).toContain("datasetRefs")
  })

  test("matches trainable models by keyword tokens", () => {
    const item = {
      id: "aardvark-weather",
      name: "Aardvark-Weather",
      domain: "weather",
      tags: ["observation-driven", "forecast"],
      blurb: "端到端观测驱动全球天气预报模型",
    }
    expect(matchTrainableModel(item, "aardvark", true)).toBe(true)
    expect(matchTrainableModel(item, "地球 forecast", true)).toBe(true)
    expect(matchTrainableModel(item, "materials", true)).toBe(false)
  })

  test("uses user-facing labels instead of registry identifiers", () => {
    expect(connectorLabel("local_fs")).toBe("工作区")
    expect(connectorLabel("http_dataset")).toBe("公开网址")
    expect(connectorLabel("database")).toBe("数据库")
    expect(connectorLabel("remote_workspace")).toBe("远端环境")
    expect(alreadyStatusLabel("ready")).toBe("可训练")
    expect(alreadyStatusLabel("pending")).toBe("未就绪")
    expect(connectorPlaceholder("local_fs")).toBe("服务器上可访问的绝对路径（账号工作区或其他有权限的目录）")
    expect(connectorPlaceholder("database")).toBe("已连接数据库中的表")
    expect(inferConnector("https://example.com/data.nc")).toBe("http_dataset")
    expect(inferConnector("postgres://dbc_x/public.t")).toBe("database")
    expect(inferConnector("mysql://dbc_x/papers")).toBe("database")
    expect(inferConnector("/home/data/sample.csv")).toBeUndefined()
    expect(formatDataSize(1536)).toBe("1.5 KB")
    expect(canPublishAlreadyItem({ connector: "local_fs", uri: "/ws/a", status: "ready" })).toBe(true)
    expect(canPublishAlreadyItem({ connector: "remote_workspace", uri: "/remote", status: "ready" })).toBe(false)
    expect(canPublishAlreadyItem({ connector: "database", uri: "postgres://dbc_x/public.t", status: "ready" })).toBe(false)
    expect(publishBlockedReason({ connector: "onedata_ref", uri: "onedata://alr_x" })).toContain("拉回")
    expect(publishBlockedReason({ connector: "database", uri: "postgres://dbc_x/public.t" })).toBeTruthy()
    expect(publishBlockedReason({ uri: "postgres://dbc_x/public.t" })).toBeTruthy()
    expect(publishBlockedReason({ uri: "mysql://dbc_x/papers" })).toBeTruthy()
    expect(workspaceUploadRegisterUri("/ws/acct", ["onedata/a.csv"])).toBe("/ws/acct/onedata/a.csv")
    expect(workspaceUploadRegisterUri("/ws/acct", ["onedata/era5/a.csv", "onedata/era5/b.csv"])).toBe(
      "/ws/acct/onedata/era5",
    )
    expect(workspaceUploadRegisterOptions("/ws/acct", ["onedata/era5/a.csv", "onedata/era5/b.csv"])).toEqual([
      { kind: "folder", label: "onedata/era5", uri: "/ws/acct/onedata/era5" },
      { kind: "file", label: "onedata/era5/a.csv", uri: "/ws/acct/onedata/era5/a.csv" },
      { kind: "file", label: "onedata/era5/b.csv", uri: "/ws/acct/onedata/era5/b.csv" },
    ])
  })

  test("shows the public catalog as the default OneData view and keeps it off the registry tabs", async () => {
    const source = await Bun.file(new URL("./onedata-panel.tsx", import.meta.url)).text()
    const catalog = await Bun.file(new URL("../../pages/onescience.tsx", import.meta.url)).text()

    expect(source).toContain("OnedataDownloadCatalog")
    expect(source).toContain("公开目录")
    expect(source).toContain("原始数据")
    expect(source).toContain("可训练数据")
    expect(source).toContain("CapabilityPager")
    expect(source).toContain("paginate(rawItems()")
    expect(source).toContain("paginate(alreadyItems()")
    expect(source).toContain("CAPABILITY_PAGE_SIZE_ONEDATA_LIST")
    expect(source).toContain("浏览可下载的公开源")
    expect(source).toContain("下载后需到「原始数据」登记才能加工")
    expect(source).toContain("经对话加工后才会进入「可训练数据」")
    expect(source).toContain("发布后会出现在「已公开」")
    expect(source).toContain("也可接入为自己的原始数据再加工")
    expect(source).toContain("os-onedata-pipeline")
    expect(source).toContain("获取 · 浏览下载")
    expect(source).toContain("登记 · 待加工")
    expect(source).toContain("就绪 · 可使用")
    expect(source).toContain("goRegisterOwnData")
    expect(source).toContain("onRegisterOwnData")
    expect(source).toContain("从公开目录获取")
    expect(source).toContain("去登记原始数据")
    expect(source).toContain('register: "1"')
    expect(source).toContain("is-focus-target")
    expect(source).toContain('tab() === "catalog"')
    expect(source).toContain("<Show when={tab() === \"catalog\"}>")
    expect(source).toContain("capabilityDomainToDatasetFilter[props.domain]")
    expect(source).not.toContain("选择数据（只读）")
    expect(source).not.toContain("datasetRefs")
    expect(source).not.toContain("alr_")
    expect(source).not.toContain("种子 id")
    expect(source).not.toContain("个人对象存储 Key")
    expect(source).not.toContain(">Already<")
    expect(source).not.toContain("转为 Already")
    expect(source).not.toContain("作业目标：远端")
    expect(source).not.toContain("发布原语")
    expect(source).toContain("把选中的原始数据挂到当前会话")
    expect(source).toContain("joinRawToSession(selectedRaw())")
    expect(source).toContain("convertRawViaAgent")
    expect(source).toContain("convertRawDirect")
    expect(source).toContain("convertRawSource")
    expect(source).toContain("pushSessionHandoffDraft")
    expect(source).toContain("buildStandardizeHandoffPrompt")
    expect(source).toContain("suggestAiReadyTargetDir")
    expect(source).toContain("standardizePromptForRaw")
    expect(source).toContain("openTrainWithModel")
    expect(source).toContain("confirmTrainWithModel")
    expect(source).toContain("buildTrainWithModelHandoffPrompt")
    expect(source).toContain("DialogOnedataTrainWithModel")
    expect(source).toContain("用于训练")
    expect(source).not.toContain("startTrainingViaAgent")
    expect(source).not.toContain("buildTrainingHandoffPrompt")
    expect(source).not.toContain(">开始训练<")
    expect(source).not.toContain("previewAlreadyDataset")
    expect(source).toContain("reloadSeq")
    expect(source).toContain('item.visibility === "public"')
    expect(source).toContain("加载中…")
    expect(source).toContain("loadSessions(directory)")
    expect(source).toContain("joinedSessionRawIds")
    expect(source).toContain("已加入")
    expect(source).toContain("挂到会话")
    expect(source).toContain("去对话加工")
    expect(source).toContain("os-onedata-card-open")
    expect(source).toContain("打开")
    expect(source).toContain("workspaceSessionHref")
    expect(source).toContain("showToast")
    expect(source).not.toContain("打开会话查看")
    expect(source).not.toContain("加入对话")
    expect(source).not.toContain("科研开发")
    expect(source).toContain("可在会话输入框内查看「原始数据」")
    expect(source).toContain("onedata-session-chips-changed")
    expect(source).toContain("转为可训练数据")
    expect(source).not.toContain("加入对话加工")
    expect(source).toContain("canPublishAlreadyItem")
    expect(source).toContain("publishBlockedReason")
    expect(source).toContain("rawIds")
    expect(source).toContain('item.connector !== "onedata_ref"')
    expect(source).toContain("workspaceUploadRegisterOptions")
    expect(source).toContain("登记粒度")
    expect(source).toContain("整个文件夹")
    expect(source).toContain("OnedataPreviewPane")
    expect(source).toContain("previewRawId")
    expect(source).toContain("has-preview")
    expect(source).toContain("收起预览")
    expect(source).toContain("buildOnedataPreview")
    expect(source).toContain("os-onedata-source-pills")
    expect(source).toContain("allowEditDestination")
    expect(source).toContain("CapFilterSelect")
    expect(source).toContain("工作区路径")
    expect(source).toContain("deleteRawSource")
    expect(source).toContain("deleteAlreadyDataset")
    expect(source).toContain("rawUri")
    expect(source).toContain("从这台电脑上传到工作区")
    expect(source).toContain("200 MB")
    expect(source).toContain("maxFileBytes")
    expect(source).toContain("ONEDATA_UPLOAD_MAX_FILE_BYTES")
    expect(source).toContain("工作区路径")
    expect(source).toContain("已连接数据库中的表")
    expect(source).toContain("数据库")
    expect(source).toContain("dbSecretsConfigured")
    expect(source).toContain("数据库接入暂未启用")
    expect(source).toContain("ONECODE_OBJECT_STORE_MASTER_KEY")
    expect(source).toContain('connector() === "database"')
    expect(source).toContain("listDbConnections")
    expect(source).toContain("putDbConnection")
    expect(source).toContain("deleteDbConnection")
    expect(source).toContain("listDbTables")
    expect(source).toContain("登记为原始数据")
    expect(source).not.toContain(">对象存储<")
    expect(source).not.toContain("云厂商")
    expect(source).not.toContain("listObjectStoreKeys")
    expect(source).not.toContain("putObjectStoreKey")
    expect(source).not.toContain("deleteObjectStoreKey")
    expect(source).not.toContain("objectStoreProviderLabel")
    expect(source).not.toContain(">本机文件<")
    expect(source).not.toContain('option value="local">本机<')
    expect(catalog).toContain("export function OnedataDownloadCatalog")
    expect(catalog).toContain("downloadOnly")
    expect(catalog).toContain("去原始数据登记")
    expect(catalog).toContain("没有合适的？去登记自己的数据")
    expect(catalog).toContain("onRegisterOwnData")
    expect(catalog).toContain('register: "1"')
    expect(catalog).toContain("CAPABILITY_PAGE_SIZE_RESOURCE")
    expect(catalog).toContain("CapabilityPager")
    expect(catalog).toContain("paginate(items()")
    expect(catalog).toContain("paged().pageItems")
    expect(catalog).not.toContain("registerRawSource(")
  })
})
