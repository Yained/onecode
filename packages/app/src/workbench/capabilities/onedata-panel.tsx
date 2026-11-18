import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogProjectUpload } from "@/components/dialog-project-upload"
import { codeEntryWorkspaceDirectory, codeWorkspaceRecentProjects, configuredCodeDefaultDirectory } from "@/app-routes"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { OnedataDownloadCatalog } from "@/pages/onescience"
import { useGlobalSync } from "@/context/global-sync"
import { getActiveSession } from "@/context/global-sync/active-session"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { pushSessionHandoffDraft } from "@/pages/session/handoff"
import {
  defaultPlatformProjectDirectory,
  personalWorkspaceDirectory,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { workspaceSessionHref } from "@/workbench/routes"
import {
  ONEDATA_UPLOAD_MAX_FILE_BYTES,
  ONEDATA_UPLOAD_MAX_TOTAL_BYTES,
} from "@/utils/project-upload"
import {
  catalogErrorMessage,
  deleteAlreadyDataset,
  deleteDbConnection,
  deleteRawSource,
  getSessionChips,
  listAlreadyDatasets,
  listDbConnections,
  listDbTables,
  listRawSources,
  listSshWorkspaces,
  previewRawSource,
  publishAlreadyDataset,
  putDbConnection,
  putSessionChips,
  registerRawSource,
  reingestAlreadyDataset,
  convertRawSource,
  startAlreadyTraining,
  unpublishAlreadyDataset,
  type CatalogAlready,
  type CatalogDbConnection,
  type CatalogDbEngine,
  type CatalogDbTable,
  type CatalogRaw,
} from "./onedata-catalog-api"
import { paginate, CAPABILITY_PAGE_SIZE_ONEDATA_LIST } from "./pagination"
import { CapabilityPager } from "./pager"
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
  type RawConnector,
  type WorkspaceUploadRegisterOption,
} from "./onedata-filters"
import { buildStandardizeHandoffPrompt, buildTrainWithModelHandoffPrompt, suggestAiReadyTargetDir } from "./onedata-standardize"
import { buildOnedataPreview, type OnedataPreviewModel } from "./onedata-preview"
import { OnedataPreviewPane } from "./onedata-preview-pane"
import { CapFilterSelect } from "./cap-filter-select"
import { DialogOnedataTrainWithModel } from "./onedata-train-dialog"
import { DialogOnedataAlreadyPrimitive } from "./onedata-primitive-dialog"
import type { CapabilityResource, CapabilityScenario } from "./catalog"
import type { CapabilityDomainSelection } from "./selection"

type CatalogTab = "catalog" | "raw" | "already"
type AlreadyScope = "mine" | "public"
type TrainTarget = "local" | "workspace" | "shared_root"

export function CapabilityOnedataPanel(props: {
  domain: CapabilityDomainSelection
  domainLabel: string
  copy: string
}) {
  const server = useServer()
  const sync = useGlobalSync()
  const layout = useLayout()
  const location = useLocation()
  const navigate = useNavigate()
  const dialog = useDialog()
  const search = createMemo(() => new URLSearchParams(location.search))
  const tab = createMemo<CatalogTab>(() => {
    const value = search().get("onedata")
    if (value === "already") return "already"
    if (value === "raw") return "raw"
    return "catalog"
  })
  const alreadyScope = createMemo<AlreadyScope>(() => (search().get("already") === "public" ? "public" : "mine"))
  const [rawItems, setRawItems] = createSignal<CatalogRaw[]>([])
  const [alreadyItems, setAlreadyItems] = createSignal<CatalogAlready[]>([])
  const [listLoading, setListLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [title, setTitle] = createSignal("")
  const [uri, setUri] = createSignal("")
  const [connector, setConnector] = createSignal<RawConnector>("local_fs")
  const [workspaceId, setWorkspaceId] = createSignal("")
  const [workspaces, setWorkspaces] = createSignal<Array<{ id: string; name: string }>>([])
  const [preview, setPreview] = createSignal<OnedataPreviewModel>()
  const [previewRawId, setPreviewRawId] = createSignal<string>()
  const [uploadRegisterOptions, setUploadRegisterOptions] = createSignal<WorkspaceUploadRegisterOption[]>([])
  const [selectedRaw, setSelectedRaw] = createSignal<string[]>([])
  const [joinedSessionRawIds, setJoinedSessionRawIds] = createSignal<string[]>([])
  const [joinedSessionId, setJoinedSessionId] = createSignal<string>()
  const [trainTarget, setTrainTarget] = createSignal<TrainTarget>("local")
  const [dbConnections, setDbConnections] = createSignal<CatalogDbConnection[]>([])
  const [dbSecretsConfigured, setDbSecretsConfigured] = createSignal(false)
  const [dbEngine, setDbEngine] = createSignal<CatalogDbEngine>("postgres")
  const [dbHost, setDbHost] = createSignal("")
  const [dbPort, setDbPort] = createSignal("5432")
  const [dbName, setDbName] = createSignal("")
  const [dbUser, setDbUser] = createSignal("")
  const [dbPassword, setDbPassword] = createSignal("")
  const [dbLabel, setDbLabel] = createSignal("")
  const [selectedDbConnectionId, setSelectedDbConnectionId] = createSignal("")
  const [dbTables, setDbTables] = createSignal<CatalogDbTable[]>([])
  const [selectedDbTables, setSelectedDbTables] = createSignal<string[]>([])
  const [dbTablesLoading, setDbTablesLoading] = createSignal(false)
  const [rawPage, setRawPage] = createSignal(1)
  const [alreadyPage, setAlreadyPage] = createSignal(1)

  const serverUrl = () => server.current?.http.url
  const loggedIn = () => !!storedPlatformAuthSession()
  const workspaceDirectory = createMemo(
    () =>
      codeEntryWorkspaceDirectory({
        path: sync.data.path,
        recent: codeWorkspaceRecentProjects(sync.data.project ?? []),
        lastCodeWorkspace: server.projects.lastCode(),
      }) ||
      personalWorkspaceDirectory(storedPlatformAuthSession(), server.projects.lastCode()) ||
      defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
      configuredCodeDefaultDirectory(document, sync.data.path),
  )
  const latestSessionId = createMemo(() => {
    const directory = workspaceDirectory()
    if (!directory) return undefined
    const active = getActiveSession(directory)
    if (active) return active
    const [store] = sync.child(directory, { bootstrap: false })
    return (store.session ?? []).find((item) => !item.parentID && !item.time?.archived)?.id
  })

  createEffect(() => {
    const directory = workspaceDirectory()
    if (!directory || !loggedIn()) return
    void sync.project.loadSessions(directory)
  })
  const catalogFilter = createMemo(() => capabilityDomainToDatasetFilter[props.domain])
  const intro = createMemo(() => {
    if (tab() === "raw") {
      return "登记你自己的数据源（工作区路径、公开网址、数据库表、远端路径，或从公开目录下载 / 本机上传）。可预览；经对话加工后才会进入「可训练数据」。"
    }
    if (tab() === "already") {
      if (alreadyScope() === "public") {
        return "已发布的可训练数据，可供他人使用；也可接入为自己的原始数据再加工。"
      }
      return "已标准化、可直接用于训练的数据；发布后会出现在「已公开」。"
    }
    return `${props.copy.replace(/[。.]$/, "")}。浏览可下载的公开源；下载后需到「原始数据」登记才能加工。`
  })
  const [registerFormEl, setRegisterFormEl] = createSignal<HTMLFormElement>()
  const [registerFocus, setRegisterFocus] = createSignal(false)

  const openWorkspaceUpload = () => {
    const directory = workspaceDirectory()
    if (!directory) {
      setError("请先打开个人工作区项目，再上传文件")
      return
    }
    dialog.show(() => (
      <DialogProjectUpload
        directory={directory}
        pathPrefix="onedata"
        allowEditDestination
        title="从这台电脑上传到工作区"
        destinationLabel="上传目标路径（OneCode 所在环境）"
        destinationHint="默认写到当前工作区的 onedata/ 目录。可改成服务器上其他可写路径；单文件不超过 200 MB，单次合计不超过 512 MB。上传不会自动登记。"
        maxFileBytes={ONEDATA_UPLOAD_MAX_FILE_BYTES}
        maxTotalBytes={ONEDATA_UPLOAD_MAX_TOTAL_BYTES}
        onUploadedPaths={(paths) => {
          const options = workspaceUploadRegisterOptions(directory, paths)
          if (options.length === 0) return
          setUploadRegisterOptions(options)
          const next = options[0]!
          setConnector("local_fs")
          setUri(next.uri)
          if (!title().trim()) {
            const leaf = next.label.split("/").filter(Boolean).at(-1)
            if (leaf) setTitle(leaf)
          }
          setError("")
        }}
      />
    ))
  }

  const patchQuery = (patch: Record<string, string>) => {
    const params = new URLSearchParams(location.search)
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.set("category", "onedata")
    navigate(`${location.pathname}?${params}`)
  }

  const setTab = (next: CatalogTab) => {
    setPreview(undefined)
    setPreviewRawId(undefined)
    patchQuery({ onedata: next === "catalog" ? "" : next, register: "" })
  }

  const goRegisterOwnData = () => {
    setPreview(undefined)
    setPreviewRawId(undefined)
    patchQuery({ onedata: "raw", register: "1" })
  }

  const goCatalog = () => setTab("catalog")

  let reloadSeq = 0

  const reload = async () => {
    const seq = ++reloadSeq
    const scope = alreadyScope()
    const domain = props.domain === "all" ? undefined : props.domain
    const url = serverUrl()
    if (!url || !loggedIn()) {
      if (seq !== reloadSeq) return
      setRawItems([])
      setAlreadyItems([])
      setDbConnections([])
      setDbSecretsConfigured(false)
      setListLoading(false)
      return
    }
    setError("")
    // Drop previous scope's rows immediately so 「已公开」不会先闪出「我的」私有数据。
    setAlreadyItems([])
    setListLoading(true)
    try {
      const [raw, already, spaces, connections] = await Promise.all([
        listRawSources(url, { domain }),
        listAlreadyDatasets(url, { scope, domain }),
        listSshWorkspaces(url).catch(() => [] as Array<{ id: string; type: string; name: string }>),
        listDbConnections(url).catch(() => ({ items: [] as CatalogDbConnection[], configured: false })),
      ])
      if (seq !== reloadSeq) return
      setRawItems(raw.items)
      setAlreadyItems(
        scope === "public" ? already.items.filter((item) => item.visibility === "public") : already.items,
      )
      setWorkspaces(spaces.filter((item) => item.id.startsWith("wrk_")).map((item) => ({ id: item.id, name: item.name || item.id })))
      setDbConnections(connections.items)
      setDbSecretsConfigured(connections.configured !== false)
    } catch (err) {
      if (seq !== reloadSeq) return
      setError(err instanceof Error ? err.message : "无法加载数据")
    } finally {
      if (seq === reloadSeq) setListLoading(false)
    }
  }

  createEffect(() => {
    props.domain
    tab()
    alreadyScope()
    void reload()
  })

  createEffect(() => {
    props.domain
    tab()
    alreadyScope()
    setRawPage(1)
    setAlreadyPage(1)
  })

  createEffect(() => {
    if (tab() !== "raw") return
    const params = search()
    const nextUri = params.get("rawUri")?.trim()
    const nextTitle = params.get("rawTitle")?.trim()
    if (nextUri) {
      setUri(nextUri)
      const inferred = inferConnector(nextUri)
      if (inferred) setConnector(inferred)
    }
    if (nextTitle) setTitle(nextTitle)
  })

  createEffect(() => {
    if (tab() !== "raw") return
    if (search().get("register") !== "1") return
    const form = registerFormEl()
    if (!form) return
    patchQuery({ register: "" })
    setRegisterFocus(true)
    requestAnimationFrame(() => {
      form.scrollIntoView({ behavior: "smooth", block: "start" })
    })
    const timer = window.setTimeout(() => setRegisterFocus(false), 1600)
    onCleanup(() => window.clearTimeout(timer))
  })

  const selectorItems = createMemo(() => alreadyItems().filter((item) => item.status === "ready"))

  const selectedDbConnection = createMemo(() =>
    dbConnections().find((item) => item.id === selectedDbConnectionId()),
  )

  const rawPaged = createMemo(() => paginate(rawItems(), rawPage(), CAPABILITY_PAGE_SIZE_ONEDATA_LIST))
  createEffect(() => {
    const safe = rawPaged().page
    if (safe !== rawPage()) setRawPage(safe)
  })

  const alreadyPaged = createMemo(() => paginate(alreadyItems(), alreadyPage(), CAPABILITY_PAGE_SIZE_ONEDATA_LIST))
  createEffect(() => {
    const safe = alreadyPaged().page
    if (safe !== alreadyPage()) setAlreadyPage(safe)
  })

  const rawListSections = createMemo(() => {
    const connections = dbConnections()
    const byConn = new Map<string, CatalogRaw[]>()
    const other: CatalogRaw[] = []
    for (const item of rawPaged().pageItems) {
      if (item.connector !== "database") {
        other.push(item)
        continue
      }
      const id = parseDbConnectionId(item.uri) ?? "unknown"
      const list = byConn.get(id) ?? []
      list.push(item)
      byConn.set(id, list)
    }
    const rows: Array<{ kind: "header"; key: string; label: string } | { kind: "item"; key: string; item: CatalogRaw }> = []
    for (const [id, items] of byConn) {
      rows.push({
        kind: "header",
        key: `hdr-${id}`,
        label: dbConnectionGroupLabel(
          connections.find((item) => item.id === id),
          id,
        ),
      })
      for (const item of items) rows.push({ kind: "item", key: item.id, item })
    }
    for (const item of other) rows.push({ kind: "item", key: item.id, item })
    return rows
  })

  const loadDbTables = async (connectionId: string) => {
    const url = serverUrl()
    if (!url || !connectionId) {
      setDbTables([])
      setSelectedDbTables([])
      return
    }
    setDbTablesLoading(true)
    setError("")
    try {
      const result = await listDbTables(url, connectionId)
      setDbTables(result.items)
      setSelectedDbTables([])
    } catch (err) {
      setDbTables([])
      setSelectedDbTables([])
      setError(catalogErrorMessage(err, "加载表失败"))
    } finally {
      setDbTablesLoading(false)
    }
  }

  const registerSelectedDbTables = async () => {
    const url = serverUrl()
    const connection = selectedDbConnection()
    if (!url || !connection) return
    const tables = dbTables().filter((item) => selectedDbTables().includes(dbTableKey(item)))
    if (tables.length === 0) {
      setError("请先勾选要登记的表")
      return
    }
    setBusy(true)
    setError("")
    try {
      for (const table of tables) {
        const uri = formatDbTableUri(connection.engine, connection.id, table.schema, table.name)
        await registerRawSource(url, {
          title: table.schema ? `${table.schema}.${table.name}` : `${connection.database}.${table.name}`,
          domain: props.domain === "all" ? "unspecified" : props.domain,
          uri,
          connector: "database",
        })
      }
      setSelectedDbTables([])
      await reload()
      showToast({
        variant: "success",
        title: "已登记为原始数据",
        description: `已登记 ${tables.length} 张表。`,
      })
    } catch (err) {
      setError(catalogErrorMessage(err, "登记失败"))
    } finally {
      setBusy(false)
    }
  }

  const itemMetaParts = (item: {
    format?: string
    connector?: string
    logical_bytes?: number
    status?: string
    visibility?: string
    build_method?: string
    primitive_complete?: boolean
  }) =>
    [
      item.format,
      item.connector ? connectorLabel(item.connector) : "",
      formatDataSize(item.logical_bytes),
      item.status ? alreadyStatusLabel(item.status) : "",
      item.visibility === "public" ? "已公开" : "",
      item.build_method === "agent" ? "对话加工" : "",
      item.status === "ready" && item.primitive_complete !== true ? "说明未补全" : "",
    ].filter((part): part is string => Boolean(part))

  const standardizePromptForRaw = (item: CatalogRaw) =>
    buildStandardizeHandoffPrompt({
      name: item.title.trim() || item.id,
      sourceDir: item.uri,
      targetDir: suggestAiReadyTargetDir(item.uri, item.title.trim() || item.id),
    })

  const joinRawToSession = async (rawIds: string[]) => {
    const url = serverUrl()
    const sessionId = latestSessionId()
    if (!url) {
      setError("无法连接服务器，请刷新后重试")
      return
    }
    if (!sessionId) {
      setError("请先在左侧打开或新建一个会话，再挂到会话")
      return
    }
    if (rawIds.length === 0) {
      setError("请先勾选要挂到会话的原始数据")
      return
    }
    setBusy(true)
    setError("")
    try {
      const current = await getSessionChips(url, sessionId)
      const merged = Array.from(new Set([...current.raw_ids, ...rawIds]))
      await putSessionChips(url, sessionId, merged)
      window.dispatchEvent(new Event("onedata-session-chips-changed"))
      setSelectedRaw([])
      setJoinedSessionId(sessionId)
      setJoinedSessionRawIds((curr) => Array.from(new Set([...curr, ...rawIds])))
      if (rawIds.length > 1) {
        showToast({
          variant: "success",
          title: "已挂到当前会话",
          description: `共 ${merged.length} 项。可在会话输入框内查看「原始数据」。`,
        })
      }
    } catch (err) {
      setError(catalogErrorMessage(err, "挂到会话失败"))
    } finally {
      setBusy(false)
    }
  }

  const openJoinedSession = () => {
    const directory = workspaceDirectory()
    const sessionId = joinedSessionId()
    if (!directory || !sessionId) return
    navigate(workspaceSessionHref(directory, sessionId))
  }

  /** Direct Raw → Already when the source is already trainable (not onedata_ref). */
  const convertRawDirect = async (item: CatalogRaw) => {
    if (item.connector === "onedata_ref") {
      setError("从公开 OneData 拉回的引用不能直接转换，请使用「对话加工」。")
      return
    }
    const url = serverUrl()
    if (!url) return
    setBusy(true)
    setError("")
    try {
      const already = await convertRawSource(url, item.id)
      if (previewRawId() === item.id) {
        setPreview(undefined)
        setPreviewRawId(undefined)
      }
      patchQuery({ onedata: "already", already: "mine" })
      await reload()
      showToast({
        variant: "success",
        title: "已转为可训练数据",
        description: `「${item.title}」已出现在「可训练数据 → 我的」。可补充数据说明。`,
      })
      dialog.show(() => (
        <DialogOnedataAlreadyPrimitive
          serverUrl={url}
          already={already}
          onDone={() => {
            dialog.close()
            void reload()
          }}
          onSkip={() => {
            dialog.close()
            showToast({
              variant: "default",
              title: "已跳过数据说明",
              description: "可训练数据仍可用；用于训练前可再补全说明。",
            })
          }}
        />
      ))
    } catch (err) {
      setError(catalogErrorMessage(err, "转为可训练数据失败"))
      showToast({
        variant: "error",
        title: "转为可训练数据失败",
        description: catalogErrorMessage(err, "转为可训练数据失败"),
      })
    } finally {
      setBusy(false)
    }
  }

  /** Prefill session prompt + open chat; bind raw chips best-effort (never block navigation). */
  const convertRawViaAgent = async (item: CatalogRaw) => {
    const directory = workspaceDirectory()
    if (!directory) {
      setError("请先打开个人工作区项目，再对话加工")
      showToast({ variant: "error", title: "无法打开对话", description: "未检测到工作目录，请先打开个人工作区" })
      return
    }
    const url = serverUrl()
    const sessionId = latestSessionId()
    const prompt = standardizePromptForRaw(item)
    const slug = base64Encode(directory)
    setBusy(true)
    setError("")
    try {
      // Same path as OneSkills: handoff + open project + navigate. Do this before chips.
      pushSessionHandoffDraft(slug, prompt, { rawIds: [item.id] })
      if (!sessionId) markCodeNewSessionIntent(slug)
      layout.projects.open(directory)
      server.projects.touchCode(directory)
      navigate(workspaceSessionHref(directory, sessionId))
      showToast({
        variant: "success",
        title: "已进入对话加工",
        description: "标准化提示词已预填，发送后由 Agent 处理。",
      })

      if (url && sessionId) {
        try {
          const current = await getSessionChips(url, sessionId)
          const merged = Array.from(new Set([...current.raw_ids, item.id]))
          await putSessionChips(url, sessionId, merged)
          window.dispatchEvent(new Event("onedata-session-chips-changed"))
          setSelectedRaw((curr) => curr.filter((id) => id !== item.id))
        } catch {
          // Navigation already happened; chips can be rebound from the Raw list or pending handoff.
        }
      }
    } catch (err) {
      setError(catalogErrorMessage(err, "打开对话加工失败"))
      showToast({
        variant: "error",
        title: "打开对话失败",
        description: catalogErrorMessage(err, "打开对话加工失败"),
      })
    } finally {
      setBusy(false)
    }
  }

  /** Open model picker, then prefill train prompt (model + already) and open chat. */
  const openTrainWithModel = (item: CatalogAlready) => {
    if (!workspaceDirectory()) {
      setError("请先打开个人工作区项目，再用于训练")
      showToast({ variant: "error", title: "无法用于训练", description: "未检测到工作目录，请先打开个人工作区" })
      return
    }
    if (item.status !== "ready") {
      setError("只有状态为「可训练」的数据才能用于训练")
      return
    }
    if (trainTarget() === "workspace" && !workspaceId()) {
      setError("请选择要运行训练的远端环境")
      return
    }
    const url = serverUrl()
    if (url && item.primitive_complete !== true) {
      showToast({
        variant: "default",
        title: "请先补充数据说明",
        description: "补充说明后再用于训练，便于 Agent 正确加载数据。",
      })
      dialog.show(() => (
        <DialogOnedataAlreadyPrimitive
          serverUrl={url}
          already={item}
          onDone={() => {
            dialog.close()
            void reload().then(() => {
              const refreshed = alreadyItems().find((row) => row.id === item.id) ?? { ...item, primitive_complete: true }
              openTrainWithModel(refreshed)
            })
          }}
          onSkip={() => {
            dialog.close()
            dialog.show(() => (
              <DialogOnedataTrainWithModel
                already={item}
                domain={props.domain}
                trainTarget={trainTarget()}
                workspaceId={workspaceId()}
                onConfirm={({ resource, scenario }) => void confirmTrainWithModel(item, resource, scenario)}
              />
            ))
          }}
        />
      ))
      return
    }
    dialog.show(() => (
      <DialogOnedataTrainWithModel
        already={item}
        domain={props.domain}
        trainTarget={trainTarget()}
        workspaceId={workspaceId()}
        onConfirm={({ resource, scenario }) => void confirmTrainWithModel(item, resource, scenario)}
      />
    ))
  }

  const confirmTrainWithModel = async (
    item: CatalogAlready,
    resource: CapabilityResource,
    scenario?: CapabilityScenario,
  ) => {
    const directory = workspaceDirectory()
    if (!directory) return
    const url = serverUrl()
    const sessionId = latestSessionId()
    const prompt = buildTrainWithModelHandoffPrompt({
      alreadyName: item.title.trim() || item.id,
      alreadyId: item.id,
      dataUri: item.uri,
      modelName: resource.name,
      modelId: resource.id,
      ...(scenario
        ? { scenarioTitle: scenario.title, scenarioSummary: scenario.summary }
        : {}),
      target: trainTarget(),
      ...(trainTarget() === "workspace" ? { workspaceId: workspaceId() } : {}),
    })
    const slug = base64Encode(directory)
    setBusy(true)
    setError("")
    try {
      if (url) {
        try {
          await startAlreadyTraining(url, item.id, {
            target: trainTarget(),
            ...(trainTarget() === "workspace" ? { workspace_id: workspaceId() } : {}),
          })
        } catch {
          // Still open the session; catalog handoff is optional metadata.
        }
      }
      pushSessionHandoffDraft(slug, prompt)
      if (!sessionId) markCodeNewSessionIntent(slug)
      layout.projects.open(directory)
      server.projects.touchCode(directory)
      navigate(workspaceSessionHref(directory, sessionId))
      showToast({
        variant: "success",
        title: "已进入训练对话",
        description: `已绑定「${resource.name}」与可训练数据，提示词已预填。`,
      })
    } catch (err) {
      setError(catalogErrorMessage(err, "用于训练失败"))
      showToast({
        variant: "error",
        title: "用于训练失败",
        description: catalogErrorMessage(err, "用于训练失败"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="os-client-capability-resource-panel os-onedata-catalog">
      <header class="os-client-capability-page-section-head os-client-capability-page-section-head-active">
        <p>{intro()}</p>
      </header>

      <div class="os-onedata-pipeline" role="tablist" aria-label="OneData 数据流程：获取、登记、就绪">
        <button type="button" class="os-onedata-stage-tab" aria-pressed={tab() === "catalog"} onClick={() => setTab("catalog")}>
          <span class="os-onedata-stage-index" aria-hidden="true">
            ①
          </span>
          <span class="os-onedata-stage-copy">
            <span class="os-onedata-stage-title">公开目录</span>
            <span class="os-onedata-stage-desc">获取 · 浏览下载</span>
          </span>
        </button>
        <span class="os-onedata-pipeline-sep" aria-hidden="true">
          →
        </span>
        <button type="button" class="os-onedata-stage-tab" aria-pressed={tab() === "raw"} onClick={() => setTab("raw")}>
          <span class="os-onedata-stage-index" aria-hidden="true">
            ②
          </span>
          <span class="os-onedata-stage-copy">
            <span class="os-onedata-stage-title">
              原始数据{rawItems().length ? ` ${rawItems().length}` : ""}
            </span>
            <span class="os-onedata-stage-desc">登记 · 待加工</span>
          </span>
        </button>
        <span class="os-onedata-pipeline-sep" aria-hidden="true">
          →
        </span>
        <button type="button" class="os-onedata-stage-tab" aria-pressed={tab() === "already"} onClick={() => setTab("already")}>
          <span class="os-onedata-stage-index" aria-hidden="true">
            ③
          </span>
          <span class="os-onedata-stage-copy">
            <span class="os-onedata-stage-title">
              可训练数据{alreadyItems().length ? ` ${alreadyItems().length}` : ""}
            </span>
            <span class="os-onedata-stage-desc">就绪 · 可使用</span>
          </span>
        </button>
      </div>

      <Show when={tab() === "already"}>
        <div class="os-onedata-subtabs" role="tablist" aria-label="可训练数据范围">
          <button type="button" aria-pressed={alreadyScope() === "mine"} onClick={() => patchQuery({ already: "mine" })}>
            我的
          </button>
          <button type="button" aria-pressed={alreadyScope() === "public"} onClick={() => patchQuery({ already: "public" })}>
            已公开
          </button>
        </div>
      </Show>

      <Show when={!loggedIn() && tab() !== "catalog"}>
        <p class="os-client-capability-empty">登录后才能查看和接入自己的数据。</p>
      </Show>

      <Show when={error()}>
        <p class="os-onedata-error">{error()}</p>
      </Show>

      <Show when={tab() === "catalog"}>
        <OnedataDownloadCatalog
          filter={catalogFilter()}
          domainLabel={props.domainLabel}
          onRegisterOwnData={goRegisterOwnData}
        />
      </Show>

      <Show when={tab() === "raw" && loggedIn()}>
        <form
          ref={setRegisterFormEl}
          class="os-onedata-register"
          classList={{ "is-focus-target": registerFocus() }}
          onSubmit={async (event) => {
            event.preventDefault()
            const url = serverUrl()
            if (!url) return
            setBusy(true)
            setError("")
            try {
              await registerRawSource(url, {
                title: title().trim() || uri().trim(),
                domain: props.domain === "all" ? "unspecified" : props.domain,
                uri: uri().trim(),
                connector: connector(),
                ...(connector() === "remote_workspace" ? { workspace_id: workspaceId() } : {}),
              })
              setTitle("")
              setUri("")
              setUploadRegisterOptions([])
              await reload()
            } catch (err) {
              setError(err instanceof Error ? err.message : "接入失败")
            } finally {
              setBusy(false)
            }
          }}
        >
          <strong>接入原始数据</strong>
          <p class="os-onedata-upload-hint">
            「工作区路径」是 OneCode 部署机器上的账号目录，不是你浏览器所在电脑的盘符。若数据在 Windows/Mac，请先上传到工作区，或改用公开网址 / 数据库 / 已连接远端。
          </p>
          <Show when={connector() !== "database"}>
            <div class="os-onedata-actions">
              <button type="button" disabled={busy()} onClick={openWorkspaceUpload}>
                从这台电脑上传到工作区
              </button>
            </div>
          </Show>
          <div class="os-onedata-field">
            <span>来源</span>
            <div class="os-onedata-source-pills" role="radiogroup" aria-label="数据来源">
              <button
                type="button"
                role="radio"
                aria-checked={connector() === "local_fs"}
                data-active={connector() === "local_fs" ? "true" : "false"}
                onClick={() => setConnector("local_fs")}
              >
                工作区路径
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={connector() === "http_dataset"}
                data-active={connector() === "http_dataset" ? "true" : "false"}
                onClick={() => setConnector("http_dataset")}
              >
                公开网址
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={connector() === "database"}
                data-active={connector() === "database" ? "true" : "false"}
                onClick={() => setConnector("database")}
              >
                数据库
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={connector() === "remote_workspace"}
                data-active={connector() === "remote_workspace" ? "true" : "false"}
                onClick={() => setConnector("remote_workspace")}
              >
                已连接的远端
              </button>
            </div>
          </div>
          <Show when={connector() !== "database"}>
            <label class="os-onedata-field">
              <span>名称</span>
              <input placeholder="可选，不填则使用路径或网址" value={title()} onInput={(event) => setTitle(event.currentTarget.value)} />
            </label>
            <label class="os-onedata-field">
              <span>数据位置</span>
              <input
                required
                placeholder={connectorPlaceholder(connector())}
                value={uri()}
                onInput={(event) => {
                  const next = event.currentTarget.value
                  setUri(next)
                  setUploadRegisterOptions([])
                  const inferred = inferConnector(next)
                  if (inferred) setConnector(inferred)
                }}
              />
            </label>
            <Show when={uploadRegisterOptions().length > 1}>
              <div class="os-onedata-field">
                <span>登记粒度</span>
                <CapFilterSelect
                  aria-label="登记粒度"
                  value={uri()}
                  placeholder="选择登记路径"
                  options={uploadRegisterOptions().map((item) => ({
                    value: item.uri,
                    label: item.kind === "folder" ? `整个文件夹：${item.label}` : `仅文件：${item.label}`,
                  }))}
                  onChange={(nextUri) => {
                    const option = uploadRegisterOptions().find((item) => item.uri === nextUri)
                    setUri(nextUri)
                    if (option) {
                      const leaf = option.label.split("/").filter(Boolean).at(-1)
                      if (leaf) setTitle(leaf)
                    }
                  }}
                />
              </div>
              <p class="os-onedata-upload-hint">默认登记整个文件夹为一条原始数据；若只要某个文件可预览，可改选「仅文件」。</p>
            </Show>
            <Show when={connector() === "remote_workspace"}>
              <div class="os-onedata-field">
                <span>远端环境</span>
                <Show
                  when={workspaces().length > 0}
                  fallback={<p class="os-onedata-upload-hint">还没有已连接的远端，请先在资源里添加 SSH 节点。</p>}
                >
                  <CapFilterSelect
                    aria-label="远端环境"
                    value={workspaceId()}
                    placeholder="选择已连接的远端"
                    options={workspaces().map((item) => ({ value: item.id, label: item.name }))}
                    onChange={setWorkspaceId}
                  />
                </Show>
              </div>
            </Show>
            <button type="submit" disabled={busy() || !uri().trim() || (connector() === "remote_workspace" && !workspaceId())}>
              接入
            </button>
          </Show>
        </form>

        <Show when={connector() === "database"}>
          <Show
            when={dbSecretsConfigured()}
            fallback={
              <div class="os-onedata-register os-onedata-register-nested">
                <strong>我的数据库连接</strong>
                <p class="os-onedata-upload-hint">
                  数据库接入暂未启用。服务端需配置 <code>ONECODE_OBJECT_STORE_MASTER_KEY</code>
                  （32 字节 base64）并重启后可用；若你不是管理员，请联系部署方。
                </p>
              </div>
            }
          >
          <form
            class="os-onedata-register os-onedata-register-nested"
            onSubmit={async (event) => {
              event.preventDefault()
              const url = serverUrl()
              if (!url) return
              const port = Number(dbPort().trim())
              if (!Number.isInteger(port) || port < 1 || port > 65535) {
                setError("端口须为 1–65535 的整数")
                return
              }
              setBusy(true)
              setError("")
              try {
                const saved = await putDbConnection(url, {
                  engine: dbEngine(),
                  host: dbHost().trim(),
                  port,
                  database: dbName().trim(),
                  username: dbUser().trim(),
                  password: dbPassword(),
                  ...(dbLabel().trim() ? { label: dbLabel().trim() } : {}),
                })
                setDbHost("")
                setDbName("")
                setDbUser("")
                setDbPassword("")
                setDbLabel("")
                await reload()
                setSelectedDbConnectionId(saved.id)
                await loadDbTables(saved.id)
              } catch (err) {
                setError(catalogErrorMessage(err, "保存连接失败"))
              } finally {
                setBusy(false)
              }
            }}
          >
            <strong>我的数据库连接</strong>
            <p class="os-onedata-upload-hint">先保存连接，再从表/视图多选登记为原始数据。一条原始数据对应一张表。</p>
            <div class="os-onedata-field">
              <span>引擎</span>
              <CapFilterSelect
                aria-label="数据库引擎"
                value={dbEngine()}
                placeholder="选择引擎"
                options={[
                  { value: "postgres", label: "PostgreSQL" },
                  { value: "mysql", label: "MySQL" },
                ]}
                onChange={(value) => {
                  const engine = value as CatalogDbEngine
                  setDbEngine(engine)
                  setDbPort(engine === "postgres" ? "5432" : "3306")
                }}
              />
            </div>
            <label class="os-onedata-field">
              <span>主机</span>
              <input required value={dbHost()} onInput={(event) => setDbHost(event.currentTarget.value)} />
            </label>
            <label class="os-onedata-field">
              <span>端口</span>
              <input required value={dbPort()} onInput={(event) => setDbPort(event.currentTarget.value)} />
            </label>
            <label class="os-onedata-field">
              <span>数据库</span>
              <input required value={dbName()} onInput={(event) => setDbName(event.currentTarget.value)} />
            </label>
            <label class="os-onedata-field">
              <span>用户名</span>
              <input required value={dbUser()} onInput={(event) => setDbUser(event.currentTarget.value)} />
            </label>
            <label class="os-onedata-field">
              <span>密码</span>
              <input required type="password" value={dbPassword()} onInput={(event) => setDbPassword(event.currentTarget.value)} />
            </label>
            <label class="os-onedata-field">
              <span>备注名（可选）</span>
              <input value={dbLabel()} onInput={(event) => setDbLabel(event.currentTarget.value)} placeholder="例如：文献库" />
            </label>
            <button
              type="submit"
              disabled={busy() || !dbHost().trim() || !dbName().trim() || !dbUser().trim() || !dbPassword()}
            >
              保存连接
            </button>
            <Show when={dbConnections().length > 0}>
              <ul class="os-onedata-list">
                <For each={dbConnections()}>
                  {(item) => (
                    <li>
                      <span>
                        {dbConnectionGroupLabel(item, item.id)}
                        <small>
                          {" "}
                          · {item.engine === "postgres" ? "PostgreSQL" : "MySQL"} · {item.username}
                        </small>
                      </span>
                      <div class="os-onedata-actions">
                        <button
                          type="button"
                          classList={{ "os-onedata-action-primary": selectedDbConnectionId() === item.id }}
                          disabled={busy()}
                          onClick={() => {
                            setSelectedDbConnectionId(item.id)
                            void loadDbTables(item.id)
                          }}
                        >
                          {selectedDbConnectionId() === item.id ? "已选" : "选表"}
                        </button>
                        <button
                          type="button"
                          class="os-onedata-action-danger"
                          disabled={busy()}
                          onClick={async () => {
                            if (!window.confirm(`删除数据库连接「${dbConnectionGroupLabel(item, item.id)}」？`)) return
                            const url = serverUrl()
                            if (!url) return
                            setBusy(true)
                            try {
                              await deleteDbConnection(url, item.id)
                              if (selectedDbConnectionId() === item.id) {
                                setSelectedDbConnectionId("")
                                setDbTables([])
                                setSelectedDbTables([])
                              }
                              await reload()
                            } catch (err) {
                              setError(catalogErrorMessage(err, "删除连接失败"))
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </form>

          <Show when={selectedDbConnection()}>
            {(connection) => (
              <div class="os-onedata-register os-onedata-register-nested">
                <strong>从表登记 · {dbConnectionGroupLabel(connection(), connection().id)}</strong>
                <Show when={dbTablesLoading()}>
                  <p class="os-onedata-upload-hint">正在加载表…</p>
                </Show>
                <Show when={!dbTablesLoading() && dbTables().length === 0}>
                  <p class="os-onedata-upload-hint">该连接下没有可登记的表或视图。</p>
                </Show>
                <Show when={!dbTablesLoading() && dbTables().length > 0}>
                  <ul class="os-onedata-list">
                    <For each={dbTables()}>
                      {(table) => {
                        const key = dbTableKey(table)
                        return (
                          <li>
                            <label class="os-onedata-raw-pick">
                              <input
                                type="checkbox"
                                checked={selectedDbTables().includes(key)}
                                onChange={(event) => {
                                  const on = event.currentTarget.checked
                                  setSelectedDbTables((curr) => (on ? [...curr, key] : curr.filter((id) => id !== key)))
                                }}
                              />
                              <span class="os-onedata-raw-pick-body">
                                <strong>{table.schema ? `${table.schema}.${table.name}` : table.name}</strong>
                                <small>{table.kind === "view" ? "视图" : "表"}</small>
                              </span>
                            </label>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                  <div class="os-onedata-actions">
                    <button
                      type="button"
                      class="os-onedata-action-primary"
                      disabled={busy() || selectedDbTables().length === 0}
                      onClick={() => void registerSelectedDbTables()}
                    >
                      {busy() ? "正在登记…" : "登记为原始数据"}
                    </button>
                  </div>
                </Show>
              </div>
            )}
          </Show>
          </Show>
        </Show>

        <Show
          when={rawItems().length === 0}
          fallback={
            <ul class="os-onedata-list">
              <For each={rawListSections()}>
                {(row) => (
                  <Show
                    when={row.kind === "item" ? row : undefined}
                    fallback={<li class="os-onedata-group-header">{row.kind === "header" ? row.label : ""}</li>}
                  >
                    {(entry) => {
                      const item = entry().item
                      return (
                        <li classList={{ "has-preview": previewRawId() === item.id && !!preview() }}>
                          <div class="os-onedata-raw-head">
                            <input
                              type="checkbox"
                              class="os-onedata-raw-check"
                              checked={selectedRaw().includes(item.id)}
                              onChange={(event) => {
                                const on = event.currentTarget.checked
                                setSelectedRaw((curr) => (on ? [...curr, item.id] : curr.filter((id) => id !== item.id)))
                              }}
                            />
                            <span class="os-onedata-raw-pick-body">
                              <span class="os-onedata-card-title-row">
                                <strong>{item.title}</strong>
                                <Show when={joinedSessionRawIds().includes(item.id) && joinedSessionId() && workspaceDirectory()}>
                                  <button type="button" class="os-onedata-card-open" onClick={openJoinedSession}>
                                    打开
                                  </button>
                                </Show>
                              </span>
                              <span class="os-onedata-card-chips">
                                <For each={itemMetaParts(item)}>{(part) => <span class="os-onedata-card-chip">{part}</span>}</For>
                              </span>
                              <small>{item.uri}</small>
                            </span>
                          </div>
                          <div class="os-onedata-actions">
                            <button
                              type="button"
                              class="os-onedata-action-primary"
                              onClick={async () => {
                                const url = serverUrl()
                                if (!url) return
                                if (previewRawId() === item.id && preview()) {
                                  setPreview(undefined)
                                  setPreviewRawId(undefined)
                                  return
                                }
                                try {
                                  const result = await previewRawSource(url, item.id, workspaceId() || undefined)
                                  setPreviewRawId(item.id)
                                  setPreview(buildOnedataPreview(result, { title: item.title, format: item.format }))
                                } catch (err) {
                                  setError(catalogErrorMessage(err, "预览失败"))
                                }
                              }}
                            >
                              {previewRawId() === item.id && preview() ? "收起预览" : "预览"}
                            </button>
                            <button
                              type="button"
                              disabled={busy() || !latestSessionId() || joinedSessionRawIds().includes(item.id)}
                              title={
                                !latestSessionId()
                                  ? "请先在左侧打开或新建一个会话"
                                  : joinedSessionRawIds().includes(item.id)
                                    ? "已挂到当前会话"
                                    : "把此项挂到当前会话，不跳转"
                              }
                              onClick={() => void joinRawToSession([item.id])}
                            >
                              {joinedSessionRawIds().includes(item.id) ? "已加入" : "挂到会话"}
                            </button>
                            <Show when={item.connector !== "onedata_ref"}>
                              <button
                                type="button"
                                disabled={busy()}
                                title="可选：物化后登记为可训练数据"
                                onClick={() => void convertRawDirect(item)}
                              >
                                {busy() ? "正在转换…" : "转为可训练数据"}
                              </button>
                            </Show>
                            <button
                              type="button"
                              class="os-onedata-action-primary"
                              disabled={busy() || !workspaceDirectory()}
                              title={
                                !workspaceDirectory()
                                  ? "请先打开个人工作区项目"
                                  : item.connector === "onedata_ref"
                                    ? "拉回的数据需在对话中用 OneScience 技能标准化，不能直接登记为可训练数据"
                                    : "预填标准化提示词到会话，由 Agent 使用 OneScience 技能处理后再回写可训练数据"
                              }
                              onClick={() => void convertRawViaAgent(item)}
                            >
                              {busy() ? "正在打开…" : "去对话加工"}
                            </button>
                            <button
                              type="button"
                              class="os-onedata-action-danger"
                              disabled={busy()}
                              onClick={async () => {
                                if (!window.confirm(`删除原始数据「${item.title}」？此操作不可恢复。`)) return
                                const url = serverUrl()
                                if (!url) return
                                setBusy(true)
                                try {
                                  await deleteRawSource(url, item.id)
                                  setSelectedRaw((curr) => curr.filter((id) => id !== item.id))
                                  setJoinedSessionRawIds((curr) => curr.filter((id) => id !== item.id))
                                  if (previewRawId() === item.id) {
                                    setPreview(undefined)
                                    setPreviewRawId(undefined)
                                  }
                                  await reload()
                                } catch (err) {
                                  setError(catalogErrorMessage(err, "删除失败"))
                                } finally {
                                  setBusy(false)
                                }
                              }}
                            >
                              删除
                            </button>
                          </div>
                          <Show when={previewRawId() === item.id && preview()}>
                            {(model) => (
                              <OnedataPreviewPane
                                model={model()}
                                onClose={() => {
                                  setPreview(undefined)
                                  setPreviewRawId(undefined)
                                }}
                              />
                            )}
                          </Show>
                        </li>
                      )
                    }}
                  </Show>
                )}
              </For>
            </ul>
          }
        >
          <p class="os-client-capability-empty">
            还没有原始数据。可
            <button type="button" class="os-onedata-stage-link" onClick={goCatalog}>
              从公开目录获取
            </button>
            ，从这台电脑上传到工作区，或填写工作区路径 / 公开网址 / 已连接数据库中的表 / 已连接远端路径。工作区路径须在账号目录内（通常是 …/workspaces/你的账号/…）。
          </p>
        </Show>
        <CapabilityPager
          page={rawPaged().page}
          totalPages={rawPaged().totalPages}
          total={rawPaged().total}
          onPageChange={setRawPage}
        />

        <Show when={rawItems().length > 0}>
          <div class="os-onedata-chip-row">
            <button
              type="button"
              class="os-onedata-chip-btn"
              disabled={!latestSessionId() || selectedRaw().length === 0 || busy()}
              title={
                !latestSessionId()
                  ? "请先在左侧打开或新建一个会话"
                  : selectedRaw().length === 0
                    ? "请先勾选上方列表中的原始数据"
                    : "把选中的原始数据挂到当前会话，供对话加工"
              }
              onClick={() => void joinRawToSession(selectedRaw())}
            >
              {busy() ? "正在挂入…" : "把选中的原始数据挂到当前会话"}
            </button>
            <Show when={!latestSessionId()}>
              <span class="os-onedata-chip-hint">需要先有一个当前工程下的会话。请在左侧打开或新建会话后再回来点这里。</span>
            </Show>
            <Show when={latestSessionId() && selectedRaw().length === 0}>
              <span class="os-onedata-chip-hint">勾选上方列表中的原始数据后可点击</span>
            </Show>
          </div>
        </Show>
      </Show>

      <Show when={tab() === "already" && loggedIn()}>
        <Show when={selectorItems().length > 0}>
          <div class="os-onedata-actions">
            <div class="os-onedata-field">
              <span>训练位置</span>
              <CapFilterSelect
                aria-label="训练位置"
                value={trainTarget()}
                placeholder="选择训练位置"
                options={[
                  { value: "local", label: "当前执行环境" },
                  { value: "workspace", label: "已连接的远端" },
                  { value: "shared_root", label: "平台共享盘" },
                ]}
                onChange={(value) => setTrainTarget(value as TrainTarget)}
              />
            </div>
            <Show when={trainTarget() === "workspace"}>
              <div class="os-onedata-field">
                <span>远端环境</span>
                <Show
                  when={workspaces().length > 0}
                  fallback={<p class="os-onedata-upload-hint">还没有已连接的远端。</p>}
                >
                  <CapFilterSelect
                    aria-label="训练远端环境"
                    value={workspaceId()}
                    placeholder="选择远端环境"
                    options={workspaces().map((space) => ({ value: space.id, label: space.name }))}
                    onChange={setWorkspaceId}
                  />
                </Show>
              </div>
            </Show>
          </div>
        </Show>
        <Show
          when={alreadyItems().length === 0}
          fallback={
            <ul class="os-onedata-list">
              <For each={alreadyPaged().pageItems}>
                {(item) => (
                  <li>
                    <strong>{item.title}</strong>
                    <span class="os-onedata-card-chips">
                      <For each={itemMetaParts(item)}>{(part) => <span class="os-onedata-card-chip">{part}</span>}</For>
                    </span>
                    <small>{item.uri}</small>
                    <div class="os-onedata-actions">
                      <Show when={alreadyScope() === "mine" && item.status === "ready" && item.primitive_complete !== true}>
                        <button
                          type="button"
                          class="os-onedata-action-primary"
                          disabled={busy()}
                          onClick={() => {
                            const url = serverUrl()
                            if (!url) return
                            dialog.show(() => (
                              <DialogOnedataAlreadyPrimitive
                                serverUrl={url}
                                already={item}
                                onDone={() => {
                                  dialog.close()
                                  void reload()
                                }}
                                onSkip={() => dialog.close()}
                              />
                            ))
                          }}
                        >
                          补充说明
                        </button>
                      </Show>
                      <Show when={alreadyScope() === "mine" && item.status === "ready" && item.visibility !== "public"}>
                        <button
                          type="button"
                          class="os-onedata-action-primary"
                          title={publishBlockedReason(item) ?? "发布后会出现在「已公开」，供他人使用"}
                          disabled={busy() || !canPublishAlreadyItem(item)}
                          onClick={async () => {
                            const blocked = publishBlockedReason(item)
                            if (blocked) {
                              setError(blocked)
                              return
                            }
                            const url = serverUrl()
                            if (!url) return
                            setBusy(true)
                            try {
                              await publishAlreadyDataset(url, item.id)
                              patchQuery({ already: "public" })
                              await reload()
                              showToast({ variant: "success", title: "已发布", description: "可在「已公开」中查看" })
                            } catch (err) {
                              setError(catalogErrorMessage(err, "发布失败"))
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          发布
                        </button>
                      </Show>
                      <Show when={alreadyScope() === "mine" && item.visibility === "public"}>
                        <button
                          type="button"
                          disabled={busy()}
                          onClick={async () => {
                            const url = serverUrl()
                            if (!url) return
                            setBusy(true)
                            try {
                              await unpublishAlreadyDataset(url, item.id)
                              await reload()
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "取消发布失败")
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          取消发布
                        </button>
                      </Show>
                      <Show when={alreadyScope() === "public"}>
                        <button
                          type="button"
                          class="os-onedata-action-primary"
                          disabled={busy()}
                          onClick={async () => {
                            const url = serverUrl()
                            if (!url) return
                            setBusy(true)
                            try {
                              await reingestAlreadyDataset(url, item.id)
                              patchQuery({ onedata: "raw" })
                              await reload()
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "再次接入失败")
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          接入为我的原始数据
                        </button>
                      </Show>
                      <Show when={item.status === "ready"}>
                        <button
                          type="button"
                          class="os-onedata-action-primary"
                          disabled={busy() || !workspaceDirectory()}
                          title={
                            !workspaceDirectory()
                              ? "请先打开个人工作区项目"
                              : "选择模型后预填训练提示词到会话"
                          }
                          onClick={() => openTrainWithModel(item)}
                        >
                          {busy() ? "正在打开…" : "用于训练"}
                        </button>
                      </Show>
                      <Show when={alreadyScope() === "mine"}>
                        <button
                          type="button"
                          class="os-onedata-action-danger"
                          disabled={busy()}
                          onClick={async () => {
                            if (!window.confirm(`删除可训练数据「${item.title}」？此操作不可恢复。`)) return
                            const url = serverUrl()
                            if (!url) return
                            setBusy(true)
                            try {
                              await deleteAlreadyDataset(url, item.id)
                              await reload()
                            } catch (err) {
                              setError(catalogErrorMessage(err, "删除失败"))
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          删除
                        </button>
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          }
        >
          <p class="os-client-capability-empty">
            {listLoading()
              ? "加载中…"
              : alreadyScope() === "public"
                ? "还没有已公开的可训练数据。发布后会出现在这里，他人可拉回再加工。"
                : (
                  <>
                    还没有可训练数据。请先
                    <button type="button" class="os-onedata-stage-link" onClick={goRegisterOwnData}>
                      去登记原始数据
                    </button>
                    并转化，或
                    <button type="button" class="os-onedata-stage-link" onClick={goCatalog}>
                      从公开目录获取
                    </button>
                    。
                  </>
                )}
          </p>
        </Show>
        <CapabilityPager
          page={alreadyPaged().page}
          totalPages={alreadyPaged().totalPages}
          total={alreadyPaged().total}
          onPageChange={setAlreadyPage}
        />
      </Show>
    </section>
  )
}

function parseDbConnectionId(uri: string) {
  return /^(?:postgres|mysql):\/\/(dbc_[A-Za-z0-9]+)\//i.exec(uri.trim())?.[1]
}

function dbConnectionGroupLabel(connection: CatalogDbConnection | undefined, connectionId: string) {
  if (!connection) return connectionId
  return connection.label?.trim() || `${connection.host}/${connection.database}`
}

function dbTableKey(table: CatalogDbTable) {
  return table.schema ? `${table.schema}.${table.name}` : table.name
}

function formatDbTableUri(engine: CatalogDbEngine, connectionId: string, schema: string, table: string) {
  if (engine === "postgres") return `postgres://${connectionId}/${schema}.${table}`
  return `mysql://${connectionId}/${table}`
}
