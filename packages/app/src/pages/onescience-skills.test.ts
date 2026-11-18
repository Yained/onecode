import { describe, expect, mock, test } from "bun:test"

mock.module("@solidjs/router", () => ({
  A: "a",
  useLocation: () => ({ pathname: "/skills" }),
  useNavigate: () => () => {},
}))

mock.module("@opencode-ai/ui/icon", () => ({
  Icon: () => null,
}))

describe("OneScience skills page", () => {
  test("loads task profiles from the experimental endpoint", async () => {
    const requests: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      requests.push(String(url))
      return Response.json({
        items: [
          {
            id: "paper-reproduction",
            title: "论文复现",
            description: "从论文、代码、数据和指标出发复现实验结果。",
            category: "reproduce",
            capabilityFamilies: ["resource.discovery", "training"],
            requiredPrimitiveTypes: ["dataset", "model.train"],
            optionalPrimitiveTypes: ["profile"],
            executionSkills: ["onescience-coder", "onescience-runtime"],
            primitiveCount: 2,
            resourceCount: 1,
            expectedArtifacts: ["reproduction_report"],
            maturity: "draft",
          },
        ],
      })
    }) as unknown as typeof fetch
    const { listOneScienceTaskProfiles } = await import("./onescience")

    const result = await listOneScienceTaskProfiles("http://localhost:4444")

    expect(result.loaded).toBe(true)
    expect(result.items.map((item) => item.id)).toEqual(["paper-reproduction"])
    expect(requests).toEqual(["http://localhost:4444/experimental/onescience/task-profile"])
  })

  test("shows onehub resource previews on the workspace home page", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()
    const homeSource = source.slice(source.indexOf("export function WorkspaceHomePage"), source.indexOf("function SkillsDynamicPage"))
    const hubSource = source.slice(source.indexOf("const workspaceHomeHubSections"), source.indexOf("function findResourceItemByTitle"))

    expect(source).toContain("function SkillTaskProfileGrid")
    expect(homeSource).not.toContain("科研提示词助手")
    expect(homeSource).not.toContain("SkillTaskProfileGrid")
    expect(homeSource).not.toContain("TaskCreateDialog")
    expect(homeSource).toContain("WorkspaceHomeHubSections")
    expect(hubSource).toContain("全球再分析")
    expect(hubSource).toContain("Nanotube")
    expect(hubSource).toContain("proteinmpnn")
    expect(hubSource).toContain("CFDBench数据集")
    expect(hubSource).toContain("FuXi")
    expect(hubSource).toContain("SimpleFold")
    expect(hubSource).toContain("Transolver")
    expect(hubSource).toContain("SPECFEM3D")
    expect(hubSource).toContain("ABACUS")
    expect(hubSource).toContain("AutoDock-GPU")
    expect(hubSource).toContain("nekRS")
    const hubSectionsSource = source.slice(source.indexOf("export function WorkspaceHomeHubSections"), source.indexOf("export function WorkspaceHomePage"))
    expect(hubSectionsSource).toContain("查看全部")
    expect(hubSectionsSource).toContain('name="chevron-right"')
    expect(source).toContain('workspaceCapabilitiesCategoryHref("onedata")')
    expect(source).toContain('workspaceCapabilitiesCategoryHref("onemodel")')
    expect(source).toContain('workspaceCapabilitiesCategoryHref("hpc")')
    expect(style).toContain(".onescience-workspace .os-home-hub-section")
    expect(style).toContain(".onescience-workspace .os-home-hub-more")
  })

  test("splits performance optimization into model analysis and operator optimization profiles", async () => {
    const taxonomy = await Bun.file(new URL("../../../opencode/src/onescience/taxonomy.ts", import.meta.url)).text()

    expect(taxonomy).toContain('id: "model-performance-analysis"')
    expect(taxonomy).toContain('title: "模型性能分析"')
    expect(taxonomy).toContain('id: "operator-performance-optimization"')
    expect(taxonomy).toContain('title: "Kernel性能优化"')
    expect(taxonomy).toContain("优化热点 Kernel 并复测。")
    expect(taxonomy).toContain("kernel_profile_report")
    expect(taxonomy).not.toContain('id: "performance-optimization"')
    expect(taxonomy.indexOf('id: "model-performance-analysis"')).toBeLessThan(taxonomy.indexOf('id: "operator-performance-optimization"'))
  })


  test("links domain workbench cards to SCNet model hubs", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const homeSource = source.slice(source.indexOf("export function WorkspaceHomePage"), source.indexOf("function SkillsDynamicPage"))

    expect(homeSource).toContain("领域工作台")
    expect(source).toContain("https://www.scnet.cn/ui/aihub/models/easyscience2024/onescience-matchem-models")
    expect(source).toContain("https://www.scnet.cn/ui/aihub/models/easyscience2024/OneScience-Earth-Model")
    expect(source).toContain("https://www.scnet.cn/ui/aihub/models/easyscience2024/OneScience-CFD-models")
    expect(source).toContain("https://www.scnet.cn/ui/aihub/models/easyscience2024/OneScience-Bio-Al4S")
    expect(source).toContain("材料化学")
    expect(source).toContain("地球科学")
    expect(source).toContain("流体力学")
    expect(source).toContain("生命科学")
  })

  test("keeps task profile cards compact", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()
    const taskGridSource = source.slice(source.indexOf("function SkillTaskProfileGrid"), source.indexOf("function ResourceLoadingGrid"))

    expect(taskGridSource).toContain("item.title")
    expect(taskGridSource).toContain("item.description")
    expect(taskGridSource).toContain("os-skill-task-arrow")
    expect(taskGridSource).toContain('viewBox="0 0 16 16"')
    expect(taskGridSource).not.toContain("item.primitiveCount")
    expect(taskGridSource).not.toContain("原语")
    expect(taskGridSource).not.toContain("选择")
    expect(taskGridSource).not.toContain("os-skill-task-action")
    expect(taskGridSource).not.toContain("item.maturity")
    expect(taskGridSource).not.toContain("Capability 链")
    expect(taskGridSource).not.toContain("必需原语")
    expect(taskGridSource).not.toContain("可选原语")
    expect(taskGridSource).not.toContain("预期产物")
    expect(style).not.toContain(".onescience-workspace .os-skill-task-section")
    expect(style).not.toContain(".onescience-workspace .os-skill-task-chip-list")
  })

  test("loads uploaded resources by database pages", async () => {
    const requests: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      requests.push(String(url))
      return Response.json({
        items: [
          {
            id: "custom-datasets-1",
            page: "datasets",
            title: "上传数据集",
            copy: "数据库分页资源",
            domain: "地球科学",
            tags: [],
            provider: "OneScience",
            size: "数据集",
            format: "SQLite",
            source: "onescience",
            metricLabel: "规模",
            action: "下载",
            timeCreated: 1,
            timeUpdated: 1,
          },
        ],
        nextOffset: 24,
      })
    }) as unknown as typeof fetch
    const { listUploadedResources, resetUploadedResourceCache } = await import("./onescience")

    resetUploadedResourceCache()
    const first = await listUploadedResources("http://localhost:4444", "datasets", { limit: 24, offset: 0 })
    const cached = await listUploadedResources("http://localhost:4444", "datasets", { limit: 24, offset: 0 })
    const second = await listUploadedResources("http://localhost:4444", "datasets", { limit: 24, offset: 24 })

    expect(first.items.map((item) => item.title)).toEqual(["上传数据集"])
    expect(cached.nextOffset).toBe(24)
    expect(second.nextOffset).toBe(24)
    expect(requests).toEqual([
      "http://localhost:4444/experimental/onescience/resource?page=datasets&limit=24&offset=0",
      "http://localhost:4444/experimental/onescience/resource?page=datasets&limit=24&offset=24",
    ])
  })

  test("queries uploaded resources by selected domain", async () => {
    const requests: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      requests.push(String(url))
      return Response.json({ items: [], nextOffset: undefined })
    }) as unknown as typeof fetch
    const { listUploadedResources, resetUploadedResourceCache } = await import("./onescience")

    resetUploadedResourceCache()
    await listUploadedResources("http://localhost:4444", "datasets", { domain: "地球科学", limit: 24, offset: 0 })

    expect(requests).toEqual([
      "http://localhost:4444/experimental/onescience/resource?page=datasets&limit=24&offset=0&domain=%E5%9C%B0%E7%90%83%E7%A7%91%E5%AD%A6",
    ])
  })

  test("drops non-numeric nextOffset so resource pages can show end-of-list", async () => {
    globalThis.fetch = mock(async () => Response.json({ items: [], nextOffset: null })) as unknown as typeof fetch
    const { listUploadedResources, resetUploadedResourceCache } = await import("./onescience")

    resetUploadedResourceCache()
    const result = await listUploadedResources("http://localhost:4444", "frameworks", { limit: 24, offset: 0, customOnly: true })

    expect(result.items).toEqual([])
    expect(result.nextOffset).toBeUndefined()
    expect("nextOffset" in result).toBe(false)
  })

  test("updates and deletes uploaded resources through item endpoints", async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return init?.method === "DELETE"
        ? Response.json(true)
        : Response.json({
            id: "custom-datasets-1",
            page: "datasets",
            title: "更新数据集",
            copy: "更新后的数据库资源",
            domain: "材料化学",
            tags: ["material"],
            provider: "OneScience",
            size: "数据集",
            format: "SQLite",
            source: "onescience",
            metricLabel: "规模",
            action: "下载",
            timeCreated: 1,
            timeUpdated: 2,
          })
    }) as unknown as typeof fetch
    const { updateUploadedResource, deleteUploadedResource } = await import("./onescience")

    await updateUploadedResource("http://localhost:4444", "datasets", "custom-datasets-1", {
      title: "更新数据集",
      copy: "更新后的数据库资源",
      domain: "材料化学",
      tags: ["material"],
      provider: "OneScience",
      size: "数据集",
      format: "SQLite",
      source: "onescience",
    })
    await deleteUploadedResource("http://localhost:4444", "datasets", "custom-datasets-1")

    expect(requests.map((request) => [request.url, request.init?.method])).toEqual([
      ["http://localhost:4444/experimental/onescience/resource/custom-datasets-1", "PATCH"],
      ["http://localhost:4444/experimental/onescience/resource/custom-datasets-1", "DELETE"],
    ])
    expect(requests[0]?.init?.body).toBe(JSON.stringify({
      title: "更新数据集",
      copy: "更新后的数据库资源",
      domain: "材料化学",
      tags: ["material"],
      provider: "OneScience",
      size: "数据集",
      format: "SQLite",
      source: "onescience",
    }))
  })

  test("loads skills from catalog search", async () => {
    const requests: string[] = []
    const bodies: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      requests.push(target)
      if (init?.body) bodies.push(String(init.body))
      if (target.includes("/catalog/search")) {
        return Response.json({
          items: [
            {
              id: "skill:onescience-coder",
              kind: "skill",
              name: "onescience-coder",
              title: "onescience-coder",
              description: "coder skill",
              category: "执行层",
              tags: ["onescience"],
              source: "official",
              status: "callable",
              score: 1,
            },
          ],
          total: 1,
        })
      }
      return Response.json({ items: [], total: 0 })
    }) as unknown as typeof fetch
    const { listOneScienceSkills } = await import("./onescience")

    const result = await listOneScienceSkills("http://localhost:4444", { limit: 50 })

    expect(result.loaded).toBe(true)
    expect(result.items.map((item) => item.id)).toEqual(["onescience-coder"])
    expect(result.items[0]?.action).toBe("开发")
    expect(requests.some((url) => url.includes("/catalog/search"))).toBe(true)
    expect(bodies.some((body) => body.includes('"officialOnly":true'))).toBe(true)
    expect(requests.some((url) => url.includes("/experimental/onescience/skill?"))).toBe(false)
  })

  test("filters catalog primitive search results by UI category client-side", async () => {
    const bodies: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (!target.includes("/catalog/search")) return Response.json({ items: [], total: 0 })
      bodies.push(String(init?.body ?? ""))
      return Response.json({
        items: [
          { id: "primitive-data-earth-era5-loader", kind: "primitive", name: "data-earth-era5-loader", title: "ERA5 Data Loader", description: "ERA5", category: "data.load", tags: ["weather"], status: "callable", score: 0.9 },
          { id: "primitive-model-graphcast-runner", kind: "primitive", name: "model-graphcast-runner", title: "GraphCast Forecast Runner", description: "GraphCast", category: "model.run", tags: ["weather"], status: "callable", score: 0.8 },
        ],
        total: 2,
      })
    }) as unknown as typeof fetch
    const { searchPrimitivesViaCatalog } = await import("./onescience-catalog")

    const dataset = await searchPrimitivesViaCatalog("http://localhost:4444", { q: "ERA5", category: "dataset", limit: 50 })
    const all = await searchPrimitivesViaCatalog("http://localhost:4444", { q: "ERA5", limit: 50 })

    expect(dataset.items.map((item) => item.id)).toEqual([])
    expect(all.items.map((item) => item.id)).toEqual(["primitive-data-earth-era5-loader"])
    expect(bodies.every((body) => !JSON.parse(body).category)).toBe(true)
  })

  test("drops weak catalog primitive matches below the top score", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (!String(url).includes("/catalog/search")) return Response.json({ items: [], total: 0 })
      return Response.json({
        items: [
          { id: "primitive-data-earth-era5-loader", kind: "primitive", name: "data-earth-era5-loader", title: "ERA5 Data Loader", description: "ERA5", category: "data.load", tags: ["weather"], status: "callable", score: 0.032 },
          { id: "primitive-model-alphafold-runner", kind: "primitive", name: "model-alphafold-runner", title: "AlphaFold Structure Prediction", description: "protein", category: "model.run", tags: ["protein"], status: "callable", score: 0.004 },
        ],
        total: 2,
      })
    }) as unknown as typeof fetch
    const { searchPrimitivesViaCatalog } = await import("./onescience-catalog")

    const result = await searchPrimitivesViaCatalog("http://localhost:4444", { q: "ERA5", limit: 50 })

    expect(result.items.map((item) => item.id)).toEqual(["primitive-data-earth-era5-loader"])
  })

  test("keeps semantic weather matches when the query has no literal hits", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (!String(url).includes("/catalog/search")) return Response.json({ items: [], total: 0 })
      return Response.json({
        items: [
          { id: "primitive-model-fuxi-runner", kind: "primitive", name: "model-fuxi-runner", title: "FuXi Forecast Runner", description: "weather forecasting", category: "model.run", tags: ["weather"], status: "callable", score: 0.03 },
          { id: "primitive-model-alphafold-structure-prediction", kind: "primitive", name: "model-alphafold-runner", title: "AlphaFold Structure Prediction", description: "protein", category: "model.run", tags: ["protein"], status: "callable", score: 0.004 },
        ],
        total: 2,
      })
    }) as unknown as typeof fetch
    const { searchPrimitivesViaCatalog } = await import("./onescience-catalog")

    const result = await searchPrimitivesViaCatalog("http://localhost:4444", { q: "weather forecasting", limit: 50 })

    expect(result.items.map((item) => item.id)).toEqual(["primitive-model-fuxi-runner"])
  })

  test("maps catalog primitive search results to dataset and model categories", async () => {
    const { catalogEntryToPrimitiveItem, primitiveCategoryFromItem } = await import("./onescience-catalog")

    const era5 = catalogEntryToPrimitiveItem({
      id: "primitive-data-earth-era5-loader",
      kind: "primitive",
      name: "data-earth-era5-loader",
      title: "ERA5 Data Loader",
      description: "ERA5 loader",
      category: "data.load",
      tags: ["weather", "reanalysis"],
      status: "callable",
      score: 0.91,
    })
    const graphcast = catalogEntryToPrimitiveItem({
      id: "primitive-model-graphcast-runner",
      kind: "primitive",
      name: "model-graphcast-runner",
      title: "GraphCast Forecast Runner",
      description: "GraphCast runner",
      category: "model.run",
      tags: ["weather", "forecasting"],
      status: "callable",
      score: 0.88,
    })

    expect(primitiveCategoryFromItem(era5)).toBe("data-processing")
    expect(primitiveCategoryFromItem(graphcast)).toBe("model-inference")
  })

  test("paginates primitive database reads when loading the full catalog", async () => {
    const requests: string[] = []
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      requests.push(String(url))
      const experimental = requests.filter((item) => item.includes("/experimental/onescience/primitive?"))
      if (experimental.length === 1) return Response.json({ items: [{ id: "primitive-dataset-era5", title: "ERA5", description: "dataset", domain: "地球科学", primitiveType: "data.load", intentTags: [], status: "callable", contractJson: { primitiveCategory: "dataset" } }], nextOffset: 100 })
      if (experimental.length === 2) return Response.json({ items: [{ id: "primitive-model-pangu", title: "Pangu", description: "model", domain: "地球科学", primitiveType: "model.run", intentTags: [], status: "callable", contractJson: { primitiveCategory: "model-inference" } }], nextOffset: 200 })
      if (experimental.length === 3) return Response.json({ items: [{ id: "primitive-model-train", title: "Training", description: "training", domain: "地球科学", primitiveType: "model.train", intentTags: [], status: "callable", contractJson: { primitiveCategory: "model-training" } }], nextOffset: null })
      return Response.json({ items: [], nextOffset: undefined })
    }) as unknown as typeof fetch
    const { listAIPrimitives } = await import("./onescience")

    const result = await listAIPrimitives("http://localhost:4444")

    expect(result.items.map((item) => item.id)).toEqual(["primitive-dataset-era5", "primitive-model-pangu", "primitive-model-train"])
    expect(requests.some((url) => url.includes("/catalog/"))).toBe(false)
    expect(requests.filter((url) => url.includes("/experimental/onescience/primitive?"))).toEqual([
      "http://localhost:4444/experimental/onescience/primitive?status=callable&summary=true&limit=100&offset=0",
      "http://localhost:4444/experimental/onescience/primitive?status=callable&summary=true&limit=100&offset=100",
      "http://localhost:4444/experimental/onescience/primitive?status=callable&summary=true&limit=100&offset=200",
    ])
  })

  test("renders editable resource cards with an edit menu after the source badge", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(source).toContain("onChanged={refetchUploaded}")
    expect(source).toContain("onEdit={openEditResource}")
    expect(source).toContain("function ResourceCard(props: {")
    expect(source).toContain("onChanged?: () => void")
    expect(source).toContain("onEdit?: (item: UploadedResource) => void")
    expect(source).toContain("workspaceDirectory?: string")
    expect(source).toContain("<ResourceCardMenu page={props.page} item={props.item} onChanged={props.onChanged} onEdit={props.onEdit} />")
    expect(source).toContain("const canEdit = () => canEditResource(props.item)")
    expect(source).toContain("const canDelete = () => canDeleteUploadedResource(props.item)")
    expect(source).toContain("canDeleteUploadedResource")
    expect(source).toContain("isOrphanUploadedResource")
    expect(source).toContain("disabled={!canEdit()}")
    expect(source).toContain("<Show when={canDelete()}>")
    expect(source).toContain('title={canEdit() ? undefined : "登录后可修改"}')
    expect(source).toContain('<div class="os-card-heading-actions">')
    const headingActions = source.slice(
      source.indexOf('<div class="os-card-heading-actions">'),
      source.indexOf('<div class="os-card-heading-actions">') + 500,
    )
    expect(headingActions.indexOf('os-source-badge')).toBeLessThan(headingActions.indexOf("<ResourceCardMenu"))
    expect(source).toContain("aria-label={`${props.item.title} 编辑菜单`}")
    expect(source).toContain('<path d="M5 5.25h6M5 8h6M5 10.75h6" stroke="currentColor" stroke-linecap="round" stroke-width="1.75"')
    expect(style).toContain(".onescience-workspace .os-card-menu-trigger")
    expect(style).toContain("height: 1.55rem;")
    expect(style).toContain("height: 1.08rem;")
    expect(style).toContain(".os-card-menu-popover button:disabled")
    expect(source).toContain("修改")
    expect(source).toContain("删除")
    expect(source).toContain('title={canUpload() ? undefined : "登录后使用"}')
    expect(source).toContain("disabled={!canUpload()}")
  })

  test("maps dataset primitive publish button states when oneskills occupies datapipe slot", async () => {
    const { datasetPrimitivePublishAction } = await import("./onescience-catalog")

    expect(datasetPrimitivePublishAction({
      dataProcessingCallableId: "oneskills-era5-datapipe",
      datasetDraftId: "draft-dataset-era5",
    })).toEqual({
      disabled: false,
      label: "发布数据集原语",
      draftId: "draft-dataset-era5",
      publishSlot: "dataset",
      initialPrimitiveType: "data.load",
    })
    expect(datasetPrimitivePublishAction({
      datasetCallableId: "callable-dataset",
      dataProcessingCallableId: "oneskills-era5-datapipe",
    })).toEqual({
      disabled: true,
      label: "查看原语",
      draftId: undefined,
      publishSlot: undefined,
      initialPrimitiveType: undefined,
    })
    expect(datasetPrimitivePublishAction({
      datasetDraftId: "draft-dataset",
      dataProcessingDraftId: "draft-processing",
    })).toEqual({
      disabled: false,
      label: "发布原语",
      draftId: "draft-dataset",
      publishSlot: "dataset",
      initialPrimitiveType: "data.load",
    })
  })

  test("maps model primitive publish button states", async () => {
    const { modelPrimitivePublishAction } = await import("./onescience-catalog")

    expect(modelPrimitivePublishAction({})).toEqual({
      disabled: false,
      label: "发布原语",
      draftId: undefined,
      publishSlot: "inference",
      initialPrimitiveType: "model.run",
    })
    expect(modelPrimitivePublishAction({ inferenceDraftId: "draft-infer" })).toEqual({
      disabled: false,
      label: "发布原语",
      draftId: "draft-infer",
      publishSlot: "inference",
      initialPrimitiveType: "model.run",
    })
    expect(modelPrimitivePublishAction({ modelCallableId: "callable-model" })).toEqual({
      disabled: false,
      label: "发布原语",
      draftId: undefined,
      publishSlot: "inference",
      initialPrimitiveType: undefined,
    })
    expect(modelPrimitivePublishAction({ inferenceCallableId: "callable-infer" })).toEqual({
      disabled: false,
      label: "发布训练原语",
      draftId: undefined,
      publishSlot: "training",
      initialPrimitiveType: "model.train",
    })
    expect(modelPrimitivePublishAction({
      inferenceCallableId: "callable-infer",
      inferenceDraftId: "stale-infer-draft",
    }).label).toBe("发布训练原语")
    expect(modelPrimitivePublishAction({ trainingCallableId: "callable-train" })).toEqual({
      disabled: false,
      label: "发布推理原语",
      draftId: undefined,
      publishSlot: "inference",
      initialPrimitiveType: "model.run",
    })
    expect(modelPrimitivePublishAction({
      inferenceCallableId: "callable-infer",
      trainingDraftId: "draft-train",
    }).initialPrimitiveType).toBe("model.train")
    expect(modelPrimitivePublishAction({
      trainingCallableId: "callable-train",
      inferenceDraftId: "draft-infer",
    }).initialPrimitiveType).toBe("model.run")
    expect(modelPrimitivePublishAction({
      modelCallableId: "callable-model",
      inferenceCallableId: "callable-infer",
      trainingCallableId: "callable-train",
    })).toEqual({
      disabled: true,
      label: "查看原语",
      draftId: undefined,
      publishSlot: undefined,
      initialPrimitiveType: undefined,
    })
    expect(modelPrimitivePublishAction({ inferenceCallableId: "callable-infer" }).disabled).toBe(false)
    expect(modelPrimitivePublishAction({
      modelCallableId: "callable-model",
      inferenceCallableId: "callable-infer",
      trainingCallableId: "callable-train",
    }).disabled).toBe(true)
  })

  test("hides already-published primitive types from the publish dialog options", async () => {
    const { availablePublishPrimitiveTypes } = await import("../components/onescience/PrimitiveCreateDialog")
    const all = [
      { value: "model", label: "模型原语" },
      { value: "model.run", label: "模型推理原语" },
      { value: "model.train", label: "模型训练原语" },
    ]
    expect(availablePublishPrimitiveTypes(all, ["model"]).map((item) => item.value)).toEqual(["model.run", "model.train"])
    expect(availablePublishPrimitiveTypes(all, ["model", "model.run"], "model").map((item) => item.value)).toEqual(["model", "model.train"])
  })

  test("places primitive conversion with card actions and removes resource counters", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    const cardBody = source.slice(source.indexOf("function ResourceCard"), source.indexOf("function editableResourceFromCard"))
    const pageBody = source.slice(source.indexOf("function ResourcePage"), source.indexOf("function skillBelongsToGroup"))

    expect(cardBody).not.toContain("↓ 12.5k")
    expect(cardBody).not.toContain("☆ 2.8k")
    expect(cardBody).toContain('class="os-card-actions os-card-action-row"')
    expect(cardBody).toContain('props.page !== "skills"')
    expect(cardBody).toContain('canCreatePrimitive')
    expect(cardBody).toContain('props.page === "datasets"')
    expect(cardBody).toContain('props.page === "models"')
    expect(cardBody).toContain('props.page === "apps"')
    expect(cardBody).toContain('showPrimaryAction')
    expect(cardBody).toContain('props.page === "skills" ? openSkillDevelop : openDevelop')
    expect(cardBody).toContain("skillDevelopHandoff")
    expect(cardBody).toContain("resourcePage={primitiveResourcePage()}")
    expect(cardBody).toContain("onPublishPrimitive")
    expect(cardBody).toContain("queueMicrotask(openPrimitivePublish)")
    expect(cardBody).toContain("primitiveLinkReady")
    expect(cardBody).toContain("showPrimitiveViewAction")
    expect(cardBody).toContain("primitiveViewCallableId")
    expect(pageBody).toContain("lookupPrimitivesByResources")
    expect(pageBody).toContain("loadingPrimitiveLinkIds")
    expect(pageBody).toContain("primitiveLinkReadyFor")
    expect(pageBody).toContain("primitivePublishTarget")
    expect(pageBody).toContain("setPrimitivePublishTarget")
    expect(cardBody).toContain("resourcePrimitivePublishAction")
    expect(cardBody).toContain("canPublishPrimitive")
    expect(cardBody).toContain('return "请先登录"')
    expect(cardBody).toContain("canDownloadDataset")
    expect(cardBody).toContain("datasetDownloadDisabled")
    expect(cardBody).toContain("primitivePublishLabel()")
    expect(cardBody).toContain("查看原语")
    expect(cardBody).toContain('class="os-card-link-cover"')
    expect(cardBody).toContain("os-resource-card-unavailable")
    expect(cardBody).toContain("data-modelscope-available")
    expect(pageBody).toContain("sortResourceItemsByModelScopeAvailability")
    expect(style).toContain(".os-card-link-cover")
    expect(style).toContain(".os-resource-card-unavailable")
    expect(style).toContain(".onescience-workspace .os-card-action-row")
    expect(style).toContain("justify-content: flex-start;")
  })

  test("keeps OneSkills cards free of hard-bound primitive strips", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    const overview = source.slice(source.indexOf("const SKILL_LAYER_PREVIEW_COUNT"), source.indexOf("function ResourceLoadingGrid"))
    const resourceCopy = source.slice(source.indexOf("function ResourceCopy"), source.indexOf("const resourceFilterIds"))

    expect(source).toContain("export function SkillsPage()")
    expect(source).not.toContain("function SkillPrimitiveNames")
    expect(source).toContain("listOneScienceSkills")
    expect(source).toContain("listCatalogSkills")
    expect(source).toContain("skillDevelopHandoff")
    expect(source).not.toContain("SkillPrimitiveBinding")
    expect(source).not.toContain("item.primitives")
    expect(overview).not.toContain("<SkillPrimitiveNames")
    expect(overview).not.toContain('<AgentRegistryPanel title="可使用原语" />')
    expect(overview).not.toContain("<PrimitiveCard")
    expect(source).not.toContain("Agent 可调用原语")
    expect(source).toContain('plain={isSkillCard()}')
    expect(resourceCopy).toContain("props.plain")
    expect(resourceCopy).toContain("os-resource-card-copy")
    expect(source).toContain('props.page !== "frameworks" && props.page !== "skills"')
    expect(overview).toContain("os-skills-overview")
    expect(overview).toContain("os-skills-card-overview")
    expect(overview).toContain("function SkillLayerSection")
    expect(overview).toContain("os-skill-card-grid-2")
    expect(overview).toContain("os-skill-card-grid-1")
    expect(overview).toContain("os-skills-fixed-row")
    expect(overview).toContain("FIXED_SINGLE_SKILL_LAYER_IDS")
    expect(overview).toContain("os-skill-group-count")
    expect(overview).toContain("SKILL_LAYER_PREVIEW_COUNT")
    expect(overview).toContain("展开其余")
    expect(overview).not.toContain("os-skills-list-overview")
    expect(overview).not.toContain("os-skill-list")
    expect(overview).not.toContain("os-skills-overview-row")
    expect(overview).not.toContain("packSkillOverviewRows")
    expect(overview).not.toContain("os-skill-flow")
    expect(source).toContain("os-skill-tile-card")
    expect(source).toContain("skillCardContent")
  })

  test("renders OneSkills as a two-column card grid with layer preview expand", async () => {
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(style).toContain(".os-skills-card-overview")
    expect(style).toContain(".os-skill-card-grid-2")
    expect(style).toContain(".os-skill-card-grid-1")
    expect(style).toContain(".os-skills-fixed-row")
    expect(style).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))")
    expect(style).toContain(".os-skill-tile-card")
    expect(style).toContain(".os-skill-layer-expand")
    expect(style).toContain("box-shadow: none")
    expect(style).not.toContain(".os-skills-list-overview")
    expect(style).not.toContain(".os-skill-row-card")
    expect(source).toContain("const SKILL_LAYER_PREVIEW_COUNT = 4")
    expect(source).toContain('FIXED_SINGLE_SKILL_LAYER_IDS = new Set(["orchestrator", "resource"])')
  })

  test("exposes OneSkills release upgrade action on the skills page", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const skillsPage = source.slice(source.indexOf("function SkillsDynamicPage"), source.indexOf("function resourceHighlightMatches"))

    expect(skillsPage).toContain("upgradeOneSkills")
    expect(skillsPage).toContain("formatOneSkillsUpgradeError")
    expect(skillsPage).toContain("更新 OneSkills")
    expect(skillsPage).toContain("更新中...")
    expect(skillsPage).toContain("canManageSkills")
    expect(skillsPage).toContain("storedPlatformAuthSession()")
    expect(skillsPage).toContain('title={canManageSkills() ? undefined : "登录后使用"}')
    expect(skillsPage).toContain("disabled={!canManageSkills() || updating()}")
    expect(skillsPage).toContain("原语已回退内置 seed")
    expect(skillsPage).toContain("原语已同步磁盘 oneskills")
    expect(skillsPage).toContain("setLoaded(true)")
    expect(skillsPage).not.toContain("setLoaded(result.loaded === true)")
  })

  test("workspace shell mounts Toast.Region outside /code so skill upgrades can toast", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const shell = source.slice(source.indexOf("export function WorkspaceShell"), source.indexOf("function useCodePromptHref"))
    expect(shell).toContain("Toast.Region")
    expect(shell).toContain('!location.pathname.startsWith("/code")')
  })

  test("finishes OneSkills loading even when catalog search fails", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const skillsPage = source.slice(source.indexOf("function SkillsDynamicPage"), source.indexOf("function resourceHighlightMatches"))
    expect(skillsPage).toContain("if (!current)")
    expect(skillsPage).toContain("setItems([])")
    expect(skillsPage).toContain("setLoaded(true)")
  })

  test("uses a source-aware primitive creation dialog with contract preview", async () => {
    const source = await Bun.file(new URL("../components/onescience/PrimitiveCreateDialog.tsx", import.meta.url)).text()
    const { publishProfile, validatePublishForm } = await import("../components/onescience/PrimitiveCreateDialog")

    expect(source).toContain("sourceTitle")
    expect(source).toContain("从资源「")
    expect(source).not.toContain("来源摘要")
    expect(source).not.toContain("执行 Skill")
    expect(source).toContain("能力契约")
    expect(source).toContain("发布原语")
    expect(source).toContain("发布中...")
    expect(source).toContain("contractPreview")
    expect(source).toContain("adapterJson")
    expect(source).toContain("publishAIPrimitive")
    expect(source).toContain("publishProfile")
    expect(source).toContain("validatePublishForm")
    expect(source).toContain("extraFields")
    expect(source).toContain("storageLocation")
    expect(source).toContain("dataSchema")
    expect(source).toContain("checkpointPath")
    expect(source).toContain("showExtraFields")
    expect(source).toContain("lockedModelPrimitiveType")
    expect(source).toContain("os-field-select-static")
    expect(source).toContain("tabindex={-1}")
    expect(source).toContain("请先选择原语类型")
    expect(source).toContain("hint.href")
    expect(source).toContain("resourcePage")
    expect(source).toContain("数据集原语字段")
    expect(source).toContain("模型推理原语字段")
    expect(source).toContain("应用启动原语字段")
    expect(source).toContain("AI框架原语字段")
    expect(source).toContain("框架原语")
    expect(source).toContain("sectionHint")
    expect(source).not.toContain("资源契约必填输入")
    expect(source).not.toContain("模型契约必填输入")
    expect(source).not.toContain("应用契约必填输入")
    expect(source).toContain("defaultRequiredInputs")
    expect(source).toContain("os-field-required")
    expect(source).not.toContain("适配器模式")
    expect(source).not.toContain("保存为草稿")
    expect(source).not.toContain("fixed inset-0 bg-black")

    expect(publishProfile("datasets", "data.load").sectionTitle).toBe("数据集原语字段")
    expect(publishProfile("datasets", "data.transform").sectionTitle).toBe("数据处理原语字段")
    expect(publishProfile("models", "model").sectionTitle).toBe("模型原语字段")
    expect(publishProfile("models", "model.run").sectionTitle).toBe("模型推理原语字段")
    expect(publishProfile("models", "model.train").sectionTitle).toBe("模型训练原语字段")
    expect(publishProfile("apps", "app.launch").sectionTitle).toBe("应用启动原语字段")
    expect(publishProfile("datasets", "data.load").primitiveTypes.map((item) => item.label)).toEqual(["数据集原语", "数据处理原语"])
    expect(publishProfile("models", "model.run").primitiveTypes.map((item) => item.label)).toEqual(["模型原语", "模型推理原语", "模型训练原语"])
    expect(publishProfile("datasets", "data.load").extraFields.every((field) => !field.required)).toBe(true)
    expect(publishProfile("datasets", "data.load").extraFields.map((field) => field.key)).toEqual(["storageLocation", "dataSchema", "accessMethod", "authHint"])
    expect(publishProfile("datasets", "data.load").extraFields.find((field) => field.key === "storageLocation")?.label).toBe("获取方式")
    expect(source).toContain("datasetDownloadMethod")
    expect(source).toContain("modelDownloadMethod")
    expect(publishProfile("models", "model.run").extraFields.find((field) => field.key === "modelAcquisitionMethod")?.label).toBe("资源同步命令")
    expect(source).toContain("applyModelPrimitiveTypeChange")
    expect(source).toContain("stripOppositeModelExtra")
    expect(source.slice(source.indexOf("const applyModelPrimitiveTypeChange"), source.indexOf("const resourcePage = createMemo"))).not.toContain('setIntentTags("")')
    expect(source).not.toContain('setExtraValues(prefilledExtraValues({ format: sourceFormat(), page: "models" }))')
    expect(publishProfile("datasets", "data.transform").extraFields.map((field) => field.key)).toContain("transformOutput")
    expect(publishProfile("models", "").extraFields).toEqual([])
    expect(publishProfile("models", "model.run").extraFields.every((field) => !field.required)).toBe(true)
    expect(publishProfile("models", "model.run").extraFields.map((field) => field.key)).toEqual(["modelAcquisitionMethod", "checkpointPath", "framework", "inputSpec", "outputSpec", "datasetRefs"])
    expect(publishProfile("models", "model.train").extraFields.map((field) => field.key)).toEqual(["modelAcquisitionMethod", "datasetRefs", "framework", "baseCheckpoint", "outputCheckpointDir", "trainingConfigHint"])
    expect(publishProfile("apps", "app.launch").extraFields.map((field) => field.key)).toEqual(["runtime", "entrypoint", "resourceRequirements", "containerImage", "inputArtifacts"])
    expect(publishProfile("apps", "app.launch").primitiveTypes.map((item) => item.value)).toEqual(["app.launch"])
    expect(publishProfile("frameworks", "code.generate").sectionTitle).toBe("AI框架原语字段")
    expect(publishProfile("frameworks", "code.generate").primitiveTypes).toEqual([{ value: "code.generate", label: "框架原语" }])
    expect(publishProfile("frameworks", "code.generate").extraFields.map((field) => field.key)).toEqual(["installEntry", "hardwareSupport", "frameworkLanguage", "adapterRepo"])
    expect(validatePublishForm({
      title: "GraphCast",
      description: "run graphcast",
      domain: "地球科学",
      primitiveType: "",
      intentTags: "forecast",
      extraValues: {},
      resourcePage: "models",
    })).toBe("请选择原语类型")
    expect(validatePublishForm({
      title: "PyTorch",
      description: "framework primitive",
      domain: "训练框架",
      primitiveType: "",
      intentTags: "pytorch",
      extraValues: {},
      resourcePage: "frameworks",
    })).toBeUndefined()
    expect(validatePublishForm({
      title: "GraphCast",
      description: "run graphcast",
      domain: "地球科学",
      primitiveType: "model.run",
      intentTags: "forecast",
      extraValues: {},
      resourcePage: "models",
    })).toBeUndefined()

    const { buildContract } = await import("../components/onescience/PrimitiveCreateDialog")
    const modelContract = buildContract({
      title: "FengWu",
      description: "weather forecast",
      domain: "地球科学",
      resourceId: "modelhub-fengwu",
      primitiveType: "model.run",
      primitiveCategory: "model-inference",
      intentTags: ["forecast"],
      sourceProvider: "FuXi",
      sourceFormat: "PyTorch",
      resourcePage: "models",
      extraValues: {
        modelAcquisitionMethod: "modelscope download --model OneScience/FengWu --cache_dir modelscope/hub/models",
      },
    })
    expect(modelContract.agentContract.usage[0]).toContain("resourceSync")
    expect(modelContract.agentContract.resourceContract.implementationSteps[0]).toContain("resourceSync")
    expect(modelContract.agentContract.resourceContract.acceptanceCriteria.some((line: string) => line.includes("资源同步"))).toBe(true)

    const bareContract = buildContract({
      title: "Manual",
      description: "manual model",
      domain: "其它",
      primitiveType: "model.run",
      primitiveCategory: "model-inference",
      intentTags: [],
      sourceProvider: "local",
      sourceFormat: "PyTorch",
      resourcePage: "models",
      extraValues: {},
    })
    expect(bareContract.agentContract.usage[0]).not.toContain("resourceSync")
  })

  test("renders readable agent contract assets in primitive contract dialog", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).toContain("function AgentContractView")
    expect(source).toContain("智能体契约")
    expect(source).toContain("matchedAssets")
    expect(source).toContain("资产契约")
    expect(source).toContain("源码契约 JSON")
  })

  test("opens resource edits from a page-level dialog instead of inside each card", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).toContain("const [editingResource, setEditingResource] = createSignal<UploadedResource>()")
    expect(source).toContain("const openEditResource = (item: UploadedResource) => {")
    expect(source).toContain("setEditingResource(item)")
    expect(source).toContain("open={editOpen()}")
    expect(source).toContain("initial={editingResource()}")
    expect(source).toContain("props.onEdit?.(item)")
    expect(source).toContain('import { Portal } from "solid-js/web"')
    expect(source).toContain("<Portal>")

    const menuBody = source.slice(source.indexOf("function ResourceCardMenu"), source.indexOf("export function InfraPage"))
    expect(menuBody).not.toContain("<ResourceUploadDialog")
    expect(menuBody).not.toContain("const [editOpen, setEditOpen] = createSignal(false)")
  })

  test("styles the resource edit dialog controls with visible fields and readable actions", async () => {
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()

    expect(style).toContain(".os-upload-dialog input:not([type=\"hidden\"]):not([type=\"radio\"]):not([type=\"checkbox\"]),")
    expect(style).toContain("box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.06);")
    expect(style).toContain(".os-upload-dialog input:not([type=\"radio\"]):not([type=\"checkbox\"]):focus,")
    expect(style).toContain("outline: 3px solid rgba(173, 40, 48, 0.16);")
    expect(style).toContain(".os-upload-dialog input::placeholder,")
    expect(style).toContain("color: #64748b;")
    expect(style).toContain(".os-upload-actions .os-button-primary")
    expect(style).toContain("background: #971F27;")
    expect(style).toContain("width: 100%;")
    expect(style).toContain("max-width: 100%;")
    expect(style).toContain("text-overflow: ellipsis;")
    expect(style).toContain("overflow-wrap: anywhere;")
  })

  test("limits resource upload field length and clamps card overflow text", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const style = await Bun.file(new URL("../index.css", import.meta.url)).text()
    const { resourceFieldLimits, parseResourceTags, resourceFieldLengthError, clampResourceFieldValue } = await import("./onescience")

    expect(resourceFieldLimits.title).toBe(64)
    expect(resourceFieldLimits.copy).toBe(120)
    expect(resourceFieldLimits.size).toBe(48)
    expect(resourceFieldLimits.format).toBe(48)
    expect(resourceFieldLimits.tags).toBe(100)
    expect(resourceFieldLimits.tagItem).toBe(36)
    expect(resourceFieldLimits.href).toBe(512)
    expect(source).toContain("maxLength={resourceFieldLimits.title}")
    expect(source).toContain("maxLength={resourceFieldLimits.copy}")
    expect(source).toContain("maxLength={resourceFieldLimits.size}")
    expect(source).toContain("maxLength={resourceFieldLimits.format}")
    expect(source).toContain("maxLength={resourceFieldLimits.tags}")
    expect(source).toContain("maxLength={resourceFieldLimits.href}")
    expect(source).toContain("os-field-count")
    expect(source).toContain("{copy().length}/{resourceFieldLimits.copy}")
    expect(source).toContain("applyResourceFieldPaste")
    expect(source).toContain("resourceFieldLengthError")
    expect(source).toContain("parseResourceTags(tags())")
    expect(parseResourceTags(`${"a".repeat(50)}, tag-two`)).toEqual(["a".repeat(36), "tag-two"])
    expect(clampResourceFieldValue("x".repeat(10), 5)).toBe("xxxxx")
    expect(resourceFieldLengthError({
      title: "ok",
      copy: "y".repeat(resourceFieldLimits.copy + 1),
      size: "ok",
      format: "ok",
      tags: "",
      href: "",
    })).toContain(`描述最多 ${resourceFieldLimits.copy} 字`)
    expect(style).toContain(".os-field-count")
    expect(style).toContain(".os-delete-dialog .os-upload-head h2")
    expect(style).toContain("-webkit-line-clamp: 3;")
    expect(style).toContain(".os-meta-list > span")
    expect(style).toContain(".os-meta-text")
    expect(style).toContain(".os-tag")
    expect(style).toContain("min-width: 0;")
    expect(source).toContain('class="os-meta-text"')
  })

  test("uses database results only for models datasets and apps pages", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).toContain('const databaseOnlyResourcePages = new Set<ResourceKey>(["datasets", "models", "apps"])')
    expect(source).toContain("const databaseOnly = createMemo(() => databaseOnlyResourcePages.has(props.page))")
    expect(source).toContain("if (databaseOnly() && uploadedLoaded()) return mergeResourcePageItems(builtIn, customItems)")
    expect(source).toContain("if (!resourceReady() || databaseOnly()) return")
    expect(source).toContain("function resourceMergeKey(item: { id: string; title: string })")
    expect(source).toContain("return item.title")
  })

  test("refetches uploaded resources when selected domain changes", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).toContain("let uploadedRequestId = 0")
    expect(source).toContain("const requestedDomain = selectedFilter() === \"全部\" ? undefined : selectedFilter()")
    expect(source).toContain("if (requestId !== uploadedRequestId) return")
    expect(source).toContain("createEffect(on(selectedFilter, () => {")
    expect(source).toContain("createEffect(on(searchQuery, () => {")
    expect(source).toContain("void refetchUploaded()")
  })

  test("keeps rendered resource cards mounted while database pages append", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).not.toContain("setVisibleItems([])")
    expect(source).not.toContain("setVisibleCount(0)")
    expect(source).not.toContain("setVisibleCount(cached ?? 0)")
    expect(source).toContain('const cacheKey = createMemo(() => `${props.page}:${selectedFilter()}:${searchQuery().trim().toLowerCase()}`)')
    expect(source).not.toContain('const cacheKey = createMemo(() => `${props.page}:${selectedFilter()}:${items().length}`)')
  })

  test("filters resource items by search query", async () => {
    const { searchResourceItems, resourcePages } = await import("./onescience")
    const items = resourcePages.models.items
    const graphcast = searchResourceItems("GraphCast", items)

    expect(graphcast.length).toBeGreaterThan(0)
    expect(graphcast.every((item) => item.title.toLowerCase().includes("graphcast") || item.copy.toLowerCase().includes("graphcast") || item.tags.some((tag) => tag.toLowerCase().includes("graphcast")))).toBe(true)
    expect(searchResourceItems("", items)).toHaveLength(items.length)
  })

  test("adds use-primitive action to callable primitive cards", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const cardBody = source.slice(source.indexOf("function PrimitiveCard"), source.indexOf("function PrimitiveContractDialog"))

    expect(cardBody).toContain("使用原语")
    expect(cardBody).toContain('props.item.status === "callable"')
    expect(cardBody).toContain("PrimitiveUseDialog")
  })

  test("uses a searchable input on OneHub resource pages", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const pageBody = source.slice(source.indexOf("function ResourcePage"), source.indexOf("function SkillsPage"))

    expect(pageBody).toContain("searchResourceItems")
    expect(pageBody).toContain('type="search"')
    expect(pageBody).toContain("setSearchQuery")
    expect(pageBody).toContain("requestedQuery")
  })

  test("dedupes uploaded resource pages by id when repeated loads append", async () => {
    const { appendUniqueResourceItems } = await import("./onescience")

    expect(
      appendUniqueResourceItems(
        [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
        [
          { id: "b", title: "B duplicate" },
          { id: "c", title: "C" },
        ],
      ).map((item) => item.title),
    ).toEqual(["A", "B", "C"])
  })

  test("merges built-in science models by title instead of shared category ids", async () => {
    const { mergeResourcePageItems } = await import("./onescience")

    expect(
      mergeResourcePageItems(
        [
          { id: "modelhub", title: "GraphCast", copy: "", tags: [], provider: "", size: "", format: "", metricLabel: "", action: "" },
          { id: "modelhub-fourcastnet", title: "FourCastNet", copy: "", tags: [], provider: "", size: "", format: "", metricLabel: "", action: "" },
          { id: "life", title: "AlphaFold", copy: "", tags: [], provider: "", size: "", format: "", metricLabel: "", action: "" },
        ],
        [],
      ).map((item) => item.title),
    ).toEqual(["GraphCast", "FourCastNet", "AlphaFold"])
  })

  test("continues loading while the resource sentinel remains visible", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).toContain("const [loadMoreVisible, setLoadMoreVisible] = createSignal(false)")
    expect(source).toContain("setLoadMoreVisible(entries.some((entry) => entry.isIntersecting))")
    expect(source).toContain("const visible = loadMoreVisible()")
    expect(source).toContain("if (!visible) return")
    expect(source).toContain('const root = target.closest(".os-workspace-main")')
  })

  test("renders AI primitives in scroll-triggered batches", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const component = source.slice(source.indexOf("function PrimitiveCatalogPanel"), source.indexOf("function PrimitiveFactoryPanel"))

    expect(component).toContain("const primitiveBatchSize = 24")
    expect(component).toContain("const [visibleCount, setVisibleCount] = createSignal(0)")
    expect(component).toContain("const renderedItems = createMemo(() => filteredItems().slice(0, visibleCount()))")
    expect(component).toContain("const [loadMoreRef, setLoadMoreRef] = createSignal<HTMLDivElement>()")
    expect(component).toContain("new IntersectionObserver")
    expect(component).toContain('ref={setLoadMoreRef}')
    expect(component).toContain("<For each={renderedItems()}")
    expect(component).not.toContain("<For each={filteredItems()}")
    expect(component).toContain("when={filteredItems().length > 0}")
    expect(component).toContain("暂无我创建的原语")
    expect(component).toContain("最近 7 天暂无新原语")
    expect(component).toContain("暂无可展示的原语")
    expect(component).toContain("highlightId?: string")
    expect(component).toContain("scrollIntoView")
    expect(component).toContain("highlighted={highlightedId() === item.id}")
  })

  test("lets the primitive factory delete user-created drafts", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const component = source.slice(source.indexOf("function aiPrimitiveDeletable"), source.indexOf("function AgentRegistryPanel"))
    const catalog = source.slice(source.indexOf("function PrimitiveCatalogPanel"), source.indexOf("function aiPrimitiveDeletable"))
    const resourcePage = source.slice(source.indexOf("function ResourcePage"), source.indexOf("function SkillsSystemOverview"))

    expect(component).toContain('if (item.owner === "system") return false')
    expect(component).toContain('item.id.startsWith("primitive-resource-")')
    expect(component).toContain('item.id.startsWith("primitive-resource-custom-")')
    expect(component).toContain("currentResourceAccountId()")
    expect(component).toContain("if (!item.owner) return true")
    expect(component).toContain("isUserCreatedPrimitiveId(item.id)")
    expect(component).toContain("factoryPrimitiveDeletable(item)")
    expect(component).toContain("aiPrimitiveDeletable(item)")
    expect(component).toContain("isFactoryOwnedOrSharedPrimitive(item)")
    expect(component).toContain("deleteAIPrimitive(current.http.url, item.id)")
    expect(component).toContain("删除后将从原语工厂队列中移除")
    expect(component).toContain("factoryStageHint(selectedStage())")
    expect(component).toContain("isFactoryQueueItemVisible")
    expect(component).toContain("queueItems()")
    expect(component).toContain("setUseItem(item)")
    expect(component).toContain("setPublishTarget({")
    expect(component).toContain("finishPrimitivePublish(navigate, item")
    expect(component).not.toContain('navigate(primitiveCatalogHref({ id: item.id, openUse: true }))')
    expect(component).not.toContain("factoryDraftResourceTarget(item)")
    expect(component).not.toContain('navigate(primitiveCatalogHref({ id: item.id, scope: "mine" }))')
    expect(component).not.toContain('item.status === "draft" && (item.owner === "platform" || item.owner === "local") return true')
    expect(catalog).toContain("openUse?: boolean")
    expect(catalog).toContain("setUseItem(item)")
    expect(catalog).toContain("PrimitiveUseDialog")
    expect(resourcePage).toContain("publishRequested()")
    expect(resourcePage).toContain("clearPublishQueryParams")
    expect(resourcePage).toContain("draftIdFromQuery()")
    expect(resourcePage).toContain("primitiveTypeFromQuery()")
    expect(resourcePage).toContain("publishSlotFromPrimitiveType")
    expect(resourcePage).toContain("Keep publish query params while the dialog is open")
    expect(resourcePage).not.toContain("if (!renderedItems().some((entry) => entry.id === item.id)) return")
  })

  test("lists skills from catalog with develop action", async () => {
    const { filterResourceItems, oneskillsGithubRepo, skillSystemGroups, resourcePages } = await import("./onescience")

    expect(oneskillsGithubRepo).toBe("https://github.com/onescience-ai/OneSkills")
    expect(resourcePages.skills.items).toEqual([])
    expect(resourcePages.skills.filters).toEqual(["全部", "编排层", "资源层", "专家层", "执行层"])
    expect(skillSystemGroups.map((group) => group.title)).toEqual(["编排层", "资源层", "专家层", "执行层"])
    const skillItems = [
      { id: "onescience-coder", title: "代码实现", copy: "coder", tags: ["executor"], provider: "OneSkills", size: "skill", format: "SKILL.md", href: undefined, metricLabel: "规模", action: "开发", layer: "执行层" },
      { id: "onescience-research-workflow", title: "科研工作流", copy: "workflow", tags: ["expert"], provider: "OneSkills", size: "skill", format: "SKILL.md", href: undefined, metricLabel: "规模", action: "开发", layer: "专家层" },
    ]
    expect(filterResourceItems("skills", "执行层", skillItems).map((item) => item.id)).toEqual(["onescience-coder"])
  })

  test("lists HPC apps with MatChem install links", async () => {
    const { resourcePages } = await import("./onescience")

    expect(resourcePages.apps.title).toBe("应用库")
    expect(resourcePages.apps.filters).toEqual(["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"])
    expect(resourcePages.apps.count).toBe("共 37 个应用：材料化学 9，生命科学 9，流体仿真 4，其它 15")
    expect(resourcePages.apps.items).toHaveLength(37)
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("ABACUS")
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("LAMMPS")
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("VASP")
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("CP2K")
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("DeePMD-kit")
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("MatPL")
    expect(resourcePages.apps.items.map((item) => item.title)).toContain("OpenFOAM")
    expect(resourcePages.apps.items.find((item) => item.id === "lammps")?.href).toBe(
      "https://gitee.com/onescience-ai/onescience/blob/main/examples/matchem/README.md",
    )
    expect(resourcePages.apps.items.find((item) => item.id === "deepmd-kit")?.tags).not.toContain("PyTorch")
    expect(resourcePages.apps.items.find((item) => item.id === "deepmd-kit")?.tags).not.toContain("TensorFlow")
  })

  test("sorts model and dataset cards with modelscope availability first", async () => {
    const {
      filterResourceItems,
      isModelScopeResourceAvailable,
      resourcePages,
      sortResourceItemsByModelScopeAvailability,
    } = await import("./onescience")

    const materialDatasets = filterResourceItems("datasets", "材料化学", resourcePages.datasets.items)
    const sortedMaterialDatasets = sortResourceItemsByModelScopeAvailability("datasets", materialDatasets)
    const availableDatasetCount = materialDatasets.filter((item) => isModelScopeResourceAvailable("datasets", item)).length
    expect(availableDatasetCount).toBeGreaterThan(0)
    expect(sortedMaterialDatasets.slice(0, availableDatasetCount).every((item) => isModelScopeResourceAvailable("datasets", item))).toBe(true)
    expect(sortedMaterialDatasets.slice(availableDatasetCount).every((item) => !isModelScopeResourceAvailable("datasets", item))).toBe(true)

    const earthModels = filterResourceItems("models", "地球科学", resourcePages.models.items)
    const sortedEarthModels = sortResourceItemsByModelScopeAvailability("models", earthModels)
    const availableModelCount = earthModels.filter((item) => isModelScopeResourceAvailable("models", item)).length
    expect(availableModelCount).toBeGreaterThan(0)
    expect(sortedEarthModels.slice(0, availableModelCount).every((item) => isModelScopeResourceAvailable("models", item))).toBe(true)
    expect(sortedEarthModels.slice(availableModelCount).every((item) => !isModelScopeResourceAvailable("models", item))).toBe(true)
    expect(sortedEarthModels.some((item) => item.title === "GraphCast")).toBe(true)
    expect(isModelScopeResourceAvailable("models", sortedEarthModels.find((item) => item.title === "GraphCast")!)).toBe(false)

    const allModels = sortResourceItemsByModelScopeAvailability("models", resourcePages.models.items)
    expect(allModels.findIndex((item) => item.title === "FengWu")).toBeLessThan(allModels.findIndex((item) => item.title === "GraphCast"))

    const allDatasets = sortResourceItemsByModelScopeAvailability("datasets", resourcePages.datasets.items)
    expect(allDatasets.findIndex((item) => item.id === "material-ms-nanotube")).toBeLessThan(allDatasets.findIndex((item) => item.id === "earth-era5"))

    const seededDataset = {
      id: "seed-datasets-earth-era5",
      page: "datasets" as const,
      title: "全球再分析",
      copy: "seed",
      domain: "地球科学",
      tags: ["地球科学"],
      provider: "ECMWF/C3S",
      size: "GRIB/NetCDF",
      format: "GRIB/NetCDF",
      source: "third-party" as const,
      metricLabel: "数据源",
      action: "下载",
    }
    expect(isModelScopeResourceAvailable("datasets", seededDataset)).toBe(false)

    const customDataset = { ...seededDataset, id: "custom-datasets-demo", source: "local" as const }
    expect(isModelScopeResourceAvailable("datasets", customDataset)).toBe(true)

    expect(sortResourceItemsByModelScopeAvailability("apps", resourcePages.apps.items)).toBe(resourcePages.apps.items)
  })

  test("filters resource cards by selected top tab", async () => {
    const { datasetDocLinks, filterResourceItems, getResourceSource, modelLinks, resourcePages, searchResourceItems } = await import("./onescience")

    expect(filterResourceItems("apps", "材料化学", resourcePages.apps.items).map((item) => item.title)).toEqual([
      "ABACUS",
      "GPUMD",
      "HOOMD-blue",
      "LAMMPS",
      "VASP",
      "CP2K",
      "DeePMD-kit",
      "MatPL",
      "NWChem",
    ])
    expect(filterResourceItems("apps", "流体仿真", resourcePages.apps.items).map((item) => item.title)).toEqual([
      "nekRS",
      "OpenFOAM",
      "PyFR",
      "SPARTA",
    ])
    expect(resourcePages.datasets.count).toBe("共 150 个高质量数据集：地球科学 50，材料化学 20，生命科学 47，流体仿真 33")
    expect(resourcePages.datasets.filters).toEqual(["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"])
    expect(resourcePages.datasets.items).toHaveLength(150)
    expect(filterResourceItems("datasets", "地球科学", resourcePages.datasets.items)).toHaveLength(50)
    expect(filterResourceItems("datasets", "流体仿真", resourcePages.datasets.items)).toHaveLength(33)
    expect(filterResourceItems("datasets", "材料化学", resourcePages.datasets.items)).toHaveLength(20)
    expect(filterResourceItems("datasets", "生命科学", resourcePages.datasets.items)).toHaveLength(47)
    expect(filterResourceItems("datasets", "其它", resourcePages.datasets.items)).toHaveLength(0)
    expect(resourcePages.models.filters).toEqual(["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"])
    expect(resourcePages.models.count).toBe("共 135 个预训练模型：地球科学 59，材料化学 14，生命科学 19，流体仿真 43")
    expect(resourcePages.models.items).toHaveLength(135)
    expect(filterResourceItems("models", "地球科学", resourcePages.models.items)).toHaveLength(59)
    expect(filterResourceItems("models", "材料化学", resourcePages.models.items)).toHaveLength(14)
    expect(filterResourceItems("models", "生命科学", resourcePages.models.items)).toHaveLength(19)
    expect(filterResourceItems("models", "流体仿真", resourcePages.models.items)).toHaveLength(43)
    expect(filterResourceItems("models", "其它", resourcePages.models.items)).toHaveLength(0)
    expect(resourcePages.cases.filters).toEqual(["全部", "地球科学", "材料化学", "生命科学", "流体仿真", "其它"])
    expect(filterResourceItems("cases", "地球科学", resourcePages.cases.items)).toHaveLength(6)
    expect(filterResourceItems("cases", "材料化学", resourcePages.cases.items)).toHaveLength(3)
    expect(filterResourceItems("cases", "生命科学", resourcePages.cases.items)).toHaveLength(2)
    expect(filterResourceItems("cases", "流体仿真", resourcePages.cases.items)).toHaveLength(4)
    expect(filterResourceItems("cases", "其它", resourcePages.cases.items)).toHaveLength(1)
    expect(filterResourceItems("cases", "其它", resourcePages.cases.items)[0]?.title).toBe("AIFS 论文复现")
    const { resourceFilterFromHash, resourceHashFromFilter, resourceListEmptyMessage } = await import("./onescience")
    expect(resourceFilterFromHash("cases", "#earth", resourcePages.cases.filters)).toBe("地球科学")
    expect(resourceFilterFromHash("cases", "#material", resourcePages.cases.filters)).toBe("材料化学")
    expect(resourceHashFromFilter("cases", "地球科学")).toBe("earth")
    expect(resourceHashFromFilter("cases", "材料化学")).toBe("material")
    expect(resourceListEmptyMessage("cases", "材料化学", "")).toContain("暂无案例")
    expect(resourceListEmptyMessage("models", "其它", "")).toContain("暂无模型")
    expect(resourceListEmptyMessage("apps", "其它", "")).toContain("暂无应用")
    expect(resourceListEmptyMessage("cases", "材料化学", "")).toContain("暂无案例")
    expect(resourceListEmptyMessage("cases", "其它", "")).not.toContain("上传")
    expect(resourceListEmptyMessage("datasets", "地球科学", "era5")).toContain("未找到")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("GraphCast")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("OneForecast")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("StormCast")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("GlobalSurgeML")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("FireCubeNet")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("WoFS-StormCal")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("ClimateBench")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("CausalModelEvaluation")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("FourCastNet_v2")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("FuXi_v21")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("Mattergen")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("Equiformer_v3")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("eSEN")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("NequIP")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("GFNO")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("FNO")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("AlphaFold")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("Galerkin Transformer")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("MatRIS")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("MeshGraphNet")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("CFDBench")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("BENO")
    expect(resourcePages.models.items.map((item) => item.title)).toContain("Medgemma")
    expect(resourcePages.models.items.map((item) => item.title)).not.toContain("MedGemma")
    expect(resourcePages.models.items.map((item) => item.title)).not.toContain("AFNO")
    expect(resourcePages.models.items.map((item) => item.title)).not.toContain("PointNe")
    expect(resourcePages.models.items.map((item) => item.title)).not.toContain("Neural-Solver-Library")
    expect(resourcePages.models.items.map((item) => item.title)).not.toContain("MGN")
    expect(resourcePages.models.items.find((item) => item.title === "GraphCast")?.tags).not.toContain("地球科学")
    expect(resourcePages.models.items.find((item) => item.title === "PointNetCFD")?.tags).toContain("point-cloud")
    expect(getResourceSource(resourcePages.apps.items.find((item) => item.id === "lammps")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(getResourceSource(resourcePages.datasets.items.find((item) => item.id === "earth-era5")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(getResourceSource(resourcePages.models.items.find((item) => item.title === "FNO")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(getResourceSource(resourcePages.models.items.find((item) => item.title === "BENO")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(getResourceSource(resourcePages.models.items.find((item) => item.title === "MeshGraphNet")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(getResourceSource(resourcePages.models.items.find((item) => item.title === "GraphDOP")!)).toEqual({
      label: "论文资料",
      tone: "paper",
    })
    expect(modelLinks.GraphCast).toEqual({
      github: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/graphcast",
      docs: "https://gitee.com/onescience-ai/onescience/tree/main/examples/earth/graphcast",
      paper: "https://www.science.org/doi/10.1126/science.adi2336",
    })
    expect(modelLinks.FNO?.docs).toBe("https://gitee.com/onescience-ai/onescience/tree/main/examples/cfd/CFD_Benchmark")
    expect(modelLinks.AlphaFold?.docs).toBe("https://gitee.com/onescience-ai/onescience/blob/main/examples/biosciences/alphafold/README.md")
    expect(modelLinks.MACE?.docs).toBe("https://gitee.com/onescience-ai/onescience/tree/main/examples/matchem")
    expect(resourcePages.datasets.items.find((item) => item.id === "earth-era5")?.href).toBe(
      "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels",
    )
    expect(datasetDocLinks["earth-era5"]).toBe("https://confluence.ecmwf.int/display/CKB/ERA5%3A+data+documentation")
    expect(datasetDocLinks["earth-era5"]).not.toBe(resourcePages.datasets.items.find((item) => item.id === "earth-era5")?.href)
    expect(Object.keys(datasetDocLinks)).toHaveLength(124)
    expect(resourcePages.datasets.items.find((item) => item.id === "fluid-cfdbench")?.title).toBe("CFDBench数据集")
    expect(resourcePages.datasets.items.find((item) => item.id === "fluid-rpb-cno")?.title).toBe("RPB 数据集")
    expect(resourcePages.datasets.items.find((item) => item.id === "fluid-fno")?.title).toBe("FNO 数据集")
    expect(resourcePages.datasets.items.find((item) => item.id === "fluid-pointnet-cfd")?.title).toBe("PointNetCFD 数据集")
    expect(resourcePages.datasets.items.find((item) => item.id === "fluid-beno")?.action).toBe("下载")
    expect(getResourceSource(resourcePages.datasets.items.find((item) => item.id === "fluid-beno")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(getResourceSource(resourcePages.datasets.items.find((item) => item.id === "material-ms-hfo2")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(resourcePages.datasets.items.find((item) => item.id === "material-ms-pbe")?.title).toBe("pbe_pbesol_phonon")
    expect(getResourceSource(resourcePages.datasets.items.find((item) => item.id === "material-ms-pbe")!)).toEqual({
      label: "OneScience",
      tone: "onescience",
    })
    expect(resourcePages.datasets.items.find((item) => item.id === "material-ms-hfo2")?.size).toBe("extxyz")
    expect(resourcePages.datasets.items.find((item) => item.id === "material-mptrj")?.action).toBe("下载")
    expect(resourcePages.datasets.items.find((item) => item.id === "life-pdb")?.title).toBe("PDB结构库")
    expect(searchResourceItems("ESM-2", resourcePages.datasets.items).map((item) => item.id)).toContain("life-ms-esm2")
    expect(searchResourceItems("AlphaFold3", resourcePages.datasets.items).map((item) => item.id)).toContain("life-ms-alphafold3")
    expect(searchResourceItems("Protenix数据集", resourcePages.datasets.items).map((item) => item.id)).toContain("life-ms-protenix")
    expect(datasetDocLinks["life-pdb"]).toBe("https://www.rcsb.org/docs/")
  })

  test("maps dataset nav hash fragments to filter tabs", async () => {
    const { resourceFilterFromHash, resourceHashFromFilter, resourcePages } = await import("./onescience")
    const filters = resourcePages.datasets.filters

    expect(resourceFilterFromHash("datasets", "#earth", filters)).toBe("地球科学")
    expect(resourceFilterFromHash("datasets", "#life", filters)).toBe("生命科学")
    expect(resourceFilterFromHash("datasets", "#drug", filters)).toBe("生命科学")
    expect(resourceFilterFromHash("datasets", "#material", filters)).toBe("材料化学")
    expect(resourceFilterFromHash("datasets", "#fluid", filters)).toBe("流体仿真")
    expect(resourceFilterFromHash("datasets", "#general", filters)).toBe("其它")
    expect(resourceFilterFromHash("datasets", "", filters)).toBeUndefined()
    expect(resourceHashFromFilter("datasets", "地球科学")).toBe("earth")
    expect(resourceHashFromFilter("datasets", "生命科学")).toBe("life")
    expect(resourceHashFromFilter("datasets", "全部")).toBe("")
  })

  test("lists documentation cards from the document index", async () => {
    const { filterResourceItems, resourcePages } = await import("./onescience")

    expect(resourcePages.docs.title).toBe("文档与下载中心")
    expect(resourcePages.docs.count).toBe("共 18 个文档资源：用户手册 13，插件 4，发版记录 1")
    expect(resourcePages.docs.filters).toEqual(["全部", "用户手册", "插件", "发版记录"])
    expect(resourcePages.docs.items).toHaveLength(18)
    expect(filterResourceItems("docs", "用户手册", resourcePages.docs.items)).toHaveLength(13)
    expect(filterResourceItems("docs", "插件", resourcePages.docs.items)).toHaveLength(4)
    expect(filterResourceItems("docs", "发版记录", resourcePages.docs.items)).toHaveLength(1)
    expect(resourcePages.docs.items.find((item) => item.id === "插件介绍-md")?.href).toBe(
      "https://gitee.com/liuzonglei0713/document/blob/master/插件/插件介绍.md",
    )
    expect(resourcePages.docs.items.find((item) => item.id === "release-version-record")?.title).toBe("发版版本记录")
    expect(resourcePages.docs.items.find((item) => item.id === "使用手册-v0-3-1-oneskills-user-guide-codex-md")?.title).toBe(
      "OneSkills Codex 使用手册（Markdown）",
    )
    expect(resourcePages.docs.items.find((item) => item.id === "使用手册-v0-3-1-oneskills-user-guide-codex-md")?.copy).toBe(
      "说明在 Codex 环境中使用 OneSkills 的安装、配置和工作流执行方法。",
    )
    expect(resourcePages.docs.items.find((item) => item.id === "使用手册-v0-3-1-oneskills-user-guide-codex-md")?.href).toBe(
      "https://gitee.com/liuzonglei0713/document/blob/master/用户手册/使用手册/v0.3.1/OneSkills-User-Guide-Codex.md",
    )
  })

  test("maps framework nav hash fragments to filter tabs", async () => {
    const { resourceFilterFromHash, resourceHashFromFilter, resourcePages } = await import("./onescience")
    const filters = resourcePages.frameworks.filters

    expect(resourceFilterFromHash("frameworks", "#aiframe", filters)).toBe("训练框架")
    expect(resourceFilterFromHash("frameworks", "#scaleframe", filters)).toBe("并行训练")
    expect(resourceFilterFromHash("frameworks", "#inferframe", filters)).toBe("推理框架")
    expect(resourceHashFromFilter("frameworks", "推理框架")).toBe("inferframe")
  })

  test("lists AI frameworks from the framework index", async () => {
    const { filterResourceItems, resourcePages } = await import("./onescience")

    expect(resourcePages.frameworks.title).toBe("AI框架")
    expect(resourcePages.frameworks.count).toBe("共 9 个 AI 框架：训练框架 5，并行训练 2，推理框架 2")
    expect(resourcePages.frameworks.filters).toEqual(["全部", "训练框架", "并行训练", "推理框架"])
    expect(resourcePages.frameworks.items).toHaveLength(9)
    expect(filterResourceItems("frameworks", "训练框架", resourcePages.frameworks.items)).toHaveLength(5)
    expect(filterResourceItems("frameworks", "并行训练", resourcePages.frameworks.items)).toHaveLength(2)
    expect(filterResourceItems("frameworks", "推理框架", resourcePages.frameworks.items)).toHaveLength(2)
    expect(resourcePages.frameworks.items.map((item) => item.title)).toEqual([
      "PyTorch深度学习框架",
      "JAX高性能数值计算库",
      "NVIDIA TransformerEngine",
      "verl大语言模型训练框架",
      "OneScience 科研计算与数据科学平台",
      "DeepSpeed分布式训练优化库",
      "Megatron-LM大规模模型并行训练框架",
      "vLLM高性能LLM推理引擎",
      "SGLang大语言模型服务框架",
    ])
    expect(resourcePages.frameworks.items.find((item) => item.title === "PyTorch深度学习框架")?.format).toBe("CPU/GPU")
    expect(resourcePages.frameworks.items.find((item) => item.title === "DeepSpeed分布式训练优化库")?.href).toBe(
      "https://das.sourcefind.cn:55011/portal/#/installation?id=e5892d54-6b3b-11ef-b472-005056904552&type=frame",
    )
    expect(resourcePages.frameworks.items.find((item) => item.title === "Megatron-LM大规模模型并行训练框架")?.tags).toContain("FlagOS")
    expect(resourcePages.frameworks.items.find((item) => item.title === "NVIDIA TransformerEngine")?.links?.map((link) => link.label)).toEqual(["DCU", "FlagOS"])
    expect(resourcePages.frameworks.items.find((item) => item.title === "OneScience 科研计算与数据科学平台")?.links?.map((link) => link.label)).toEqual(["Gitee/GitHub"])
  })

  test("derives homepage asset metrics from resource catalog counts", async () => {
    const { buildHomeAssetMetrics, resourcePages } = await import("./onescience")
    const metrics = buildHomeAssetMetrics()
    const metricsWithOverride = buildHomeAssetMetrics({ primitiveCount: 42 })
    const metricsWithCatalogOverride = buildHomeAssetMetrics({
      modelsCount: 125,
      datasetsCount: 145,
      appsCount: 38,
    })

    expect(metrics.metrics[0]?.value).toBe(String(resourcePages.models.items.length))
    expect(metrics.metrics[1]?.value).toBe(String(resourcePages.datasets.items.length))
    expect(metrics.metrics[2]?.value).toBe("0")
    expect(metricsWithOverride.metrics[2]?.value).toBe("42")
    expect(metricsWithCatalogOverride.metrics[0]?.value).toBe("125")
    expect(metricsWithCatalogOverride.metrics[1]?.value).toBe("145")
    expect(metricsWithCatalogOverride.metricLinks[0]?.value).toBe("38")
    expect(metrics.metricLinks[0]?.value).toBe(String(resourcePages.apps.items.length))
    expect(metrics.metricLinks[1]?.value).toBe(String(resourcePages.frameworks.items.length))
    expect(metrics.metricLinks[2]?.value).toBe(String(resourcePages.operators.items.length))
  })

  test("formats resource catalog totals from built-in plus custom counts", async () => {
    const {
      buildMergedCatalogCounts,
      countResourceItemsByDomain,
      filterResourceItems,
      formatResourceCatalogCount,
      formatResourceCatalogSummary,
      formatResourceCatalogTotal,
      mergeResourceDomainCounts,
      resourceItemCatalogDomain,
      resourcePages,
    } = await import("./onescience")

    const merged = buildMergedCatalogCounts({
      datasets: 1,
      models: 0,
      apps: 2,
      frameworks: 1,
      byDomain: {
        datasets: { 地球科学: 1 },
        models: {},
        apps: { 其它: 2 },
        frameworks: { 训练框架: 1 },
      },
    })
    expect(merged.datasets).toBe(resourcePages.datasets.items.length + 1)
    expect(merged.apps).toBe(resourcePages.apps.items.length + 2)
    expect(merged.frameworks).toBe(resourcePages.frameworks.items.length + 1)

    const datasetsCount = formatResourceCatalogCount("datasets", merged.datasets)
    expect(datasetsCount).toContain(`共 ${merged.datasets} 个`)
    expect(formatResourceCatalogTotal("models", merged.models)).toContain(`共 ${merged.models} 个预训练模型`)

    const builtIn = countResourceItemsByDomain("datasets", resourcePages.datasets.items)
    const withUpload = mergeResourceDomainCounts(builtIn, { 地球科学: 1 })
    const summary = formatResourceCatalogSummary("datasets", withUpload)
    expect(summary).toContain(`共 ${resourcePages.datasets.items.length + 1} 个高质量数据集`)
    expect(summary).toContain(`地球科学 ${(builtIn["地球科学"] ?? 0) + 1}`)

    const modelSample = resourcePages.models.items.find((item) => item.id.startsWith("modelhub-") || item.id === "modelhub")
      ?? resourcePages.models.items[0]
    expect(resourceItemCatalogDomain("models", modelSample)).not.toBe("其它")
    const modelCounts = countResourceItemsByDomain("models", resourcePages.models.items)
    expect(modelCounts["其它"] ?? 0).toBeLessThan(resourcePages.models.items.length)
    expect((modelCounts["地球科学"] ?? 0) + (modelCounts["材料化学"] ?? 0) + (modelCounts["生命科学"] ?? 0) + (modelCounts["流体仿真"] ?? 0))
      .toBeGreaterThan(0)

    const otherItems = filterResourceItems("datasets", "其它", resourcePages.datasets.items)
    expect(otherItems).toHaveLength(builtIn["其它"] ?? 0)

    const frameworkCounts = countResourceItemsByDomain("frameworks", resourcePages.frameworks.items)
    expect(formatResourceCatalogSummary("frameworks", frameworkCounts)).toContain("训练框架")
    expect(formatResourceCatalogSummary("frameworks", mergeResourceDomainCounts(frameworkCounts, { 训练框架: 1 })))
      .toContain(`共 ${resourcePages.frameworks.items.length + 1} 个AI 框架`)
  })

  test("rebuilds catalog summary after custom domain counts change", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    expect(source).toContain("formatResourceCatalogSummary(pageKey, merged)")
    expect(source).toContain("resourceCustomCounts()?.byDomain?.[pageKey]")
    expect(source).toContain("builtInCatalogDomainCounts")
    expect(source).toContain("refreshResourceCustomCounts")
    expect(source).toContain('catalogSummaryPages.has(props.page)')
    expect(source).toContain("itemMatchesResourceFilter")
  })

  test("loads homepage catalog counts from a lightweight custom-count API", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()

    expect(source).toContain("fetchCatalogMetrics")
    expect(source).toContain("/experimental/onescience/catalog-metrics")
    expect(source).toContain("readCatalogMetricsCache")
    expect(source).toContain("fetchCallablePrimitiveTotal")
    expect(source).toContain('fetchCatalogMetrics(serverUrl, { refresh: true })')
    expect(source).toContain('fetchCallablePrimitiveTotal(serverUrl, { refresh: true })')
    expect(source).not.toContain("homeMetricsLoaded")
    expect(source).not.toContain("defer: true")
    expect(source).toContain("onescience:catalog-metrics-invalidated")
    expect(source).toContain("deleteAIPrimitive")
    expect(source).toMatch(/deleteAIPrimitive[\s\S]*invalidatePrimitiveCatalogCaches\(\)/)
    expect(source).not.toContain("loadAllUploadedResources")
    expect(source).not.toContain("resourceCatalogChangedEvent")
    expect(source).toContain('customOnly: props.page === "frameworks" ? true : undefined')
    expect(source).toContain("const hasMoreUploadedItems = createMemo(() => pageSupportsUpload() && typeof uploadedNextOffset() === \"number\")")
    expect(source).toContain("const loadMoreStatus = createMemo(() => {")
    expect(source).toContain("{loadMoreStatus()}")
    expect(source).toContain("const isInitialLoading = createMemo(() => !resourceReady())")
  })

  test("shows page-specific hints for resource upload type and format fields", async () => {
    const { resourceUploadFieldHints, resourceUploadProfile, resourceProviderKindFromInitial, resourceProviderOptions } = await import("./onescience")

    expect(resourceUploadFieldHints("datasets").typePlaceholder).toContain("等")
    expect(resourceUploadFieldHints("datasets").formatPlaceholder).toContain("Zarr 等")
    expect(resourceUploadFieldHints("models").typePlaceholder).toContain("PyTorch")
    expect(resourceUploadFieldHints("apps").formatPlaceholder).toContain("Docker")
    expect(resourceUploadProfile("datasets").title).toBe("新增数据集资源")
    expect(resourceUploadProfile("models").typeLabel).toBe("推理框架")
    expect(resourceUploadProfile("apps").formatLabel).toBe("运行环境")
    expect(resourceUploadProfile("datasets").description).toContain("数据加载")
    expect(resourceUploadProfile("models").description).toContain("模型推理")
    expect(resourceUploadProfile("apps").description).toContain("应用启动原语")
    expect(resourceProviderOptions.map((option) => option.label)).toEqual(["OneScience", "第三方", "论文资料", "本地入口"])
    expect(resourceProviderKindFromInitial({ source: "paper", provider: "OneScience" })).toBe("paper")
  })

  test("aligns OneSkills navigation cards with skill layer sections", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const oneSkillsNav = source.slice(source.indexOf('label: "OneSkills"'), source.indexOf('label: "案例"'))
    expect(oneSkillsNav).toContain("skillSystemGroups.map")
    expect(oneSkillsNav).toContain('workspaceCapabilitiesCategoryHref("oneskills")')
    expect(oneSkillsNav).not.toContain("Workflow")
    expect(oneSkillsNav).not.toContain("Skill Router")
    expect(source).toContain("function skillLayerIdFromHash")
    expect(source).toContain("highlightedLayer={highlightedLayer()}")
    expect(source).toContain('id={props.group.id}')
    expect(source).toContain('"os-skill-group-highlighted"')
  })

  test("aligns OneModel navigation cards with capability center onemodel", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const oneModelNav = source.slice(source.indexOf('label: "OneModel"'), source.indexOf('label: "OneData"'))
    expect(oneModelNav).toContain('title: "全部模型"')
    expect(oneModelNav).toContain('workspaceCapabilitiesCategoryHref("onemodel")')
    expect(oneModelNav).toContain('workspaceCapabilitiesCategoryHref("onemodel", "materials")')
    expect(oneModelNav).toContain('workspaceCapabilitiesCategoryHref("onemodel", "weather")')
    expect(oneModelNav).toContain('workspaceCapabilitiesCategoryHref("onemodel", "bio")')
    expect(oneModelNav).toContain('workspaceCapabilitiesCategoryHref("onemodel", "fluid")')
    const productNav = source.slice(source.indexOf("const productNav"), source.indexOf("] as const", source.indexOf("const productNav")))
    expect(productNav.indexOf('label: "OneModel"')).toBeLessThan(productNav.indexOf('label: "OneData"'))
    expect(productNav.indexOf('label: "OneData"')).toBeLessThan(productNav.indexOf('label: "OneSkills"'))
    expect(productNav).not.toContain('label: "OneInfra"')
  })

  test("aligns OneData navigation cards with dataset domain tabs", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const oneDataNav = source.slice(source.indexOf('label: "OneData"'), source.indexOf('label: "OneSkills"'))
    expect(oneDataNav).toContain('title: "全部数据集"')
    expect(oneDataNav).toContain('title: "地球科学"')
    expect(oneDataNav).toContain('title: "生命科学"')
    expect(oneDataNav).toContain('workspaceCapabilitiesCategoryHref("onedata")')
    expect(oneDataNav).not.toContain("通用AI数据")
    expect(oneDataNav).not.toContain("数据处理工具")
    expect(oneDataNav).not.toContain("数据组件")
    expect(oneDataNav).not.toContain("药物研发数据")
  })

  test("aligns cases navigation cards with domain tabs", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const casesNav = source.slice(source.indexOf('label: "案例"'), source.indexOf('label: "文档&下载"'))
    expect(casesNav).toContain('title: "全部案例"')
    expect(casesNav).toContain('title: "地球科学"')
    expect(casesNav).toContain('title: "材料化学"')
    expect(casesNav).toContain('workspaceHomeHref("open")')
    expect(casesNav).toContain('workspaceCaseDomainHref("earth")')
    expect(casesNav).toContain('workspaceCaseDomainHref("material")')
    expect(casesNav).not.toContain("FourCastNet 训练验证")
    expect(casesNav).not.toContain("#case-fourcastnet")
    expect(casesNav).toContain("机器学习势函数训练、第一性原理计算与材料性质预测")
  })

  test("opens home case showcases through shared cases browse flow", async () => {
    const source = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    const caseRow = source.slice(source.indexOf("function CaseShowcaseRow"), source.indexOf("const achievements"))

    expect(caseRow).toContain('class="os-case-row"')
    expect(caseRow).toContain("openSharedCaseSession")
    expect(caseRow).toContain("props.item.sessionId")
    expect(caseRow).toContain("CaseMissingDialog")
    expect(caseRow).toContain("restoreSharedPresetCase")
    expect(caseRow).toContain('result === "missing"')
    expect(caseRow).toContain("ensureSessions:")
    expect(caseRow).not.toContain("openProject:")
    expect(caseRow).not.toContain("server.projects.open(directory)")
    const onescienceSource = await Bun.file(new URL("./onescience.tsx", import.meta.url)).text()
    expect(onescienceSource).toContain("forkPresetCase")
    expect(onescienceSource).toContain("restoreSharedPresetCase")
    expect(onescienceSource).toContain("presetCaseSessionAvailable")
    expect(onescienceSource).toContain("基于此开发")
    expect(onescienceSource).toContain("// Chat-only browse: do not switch the user's current project / workspace.")
    expect(caseRow).not.toContain("caseShowcaseHref")
    expect(source).not.toContain("href={caseShowcaseHref(item)}")
  })
})
