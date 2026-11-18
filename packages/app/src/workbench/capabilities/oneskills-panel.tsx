import { base64Encode } from "@opencode-ai/core/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { codeEntryWorkspaceDirectory, configuredCodeDefaultDirectory, codeWorkspaceRecentProjects } from "@/app-routes"
import { markCodeNewSessionIntent } from "@/code-session-navigation"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLayout } from "@/context/layout"
import { useServer } from "@/context/server"
import { listCatalogSkills, skillSystemGroups } from "@/pages/onescience-catalog"
import { SkillDetailDialog } from "@/pages/onescience-skill-detail-dialog"
import { formatOneSkillsUpgradeError, upgradeOneSkills } from "@/pages/onescience-skill-management"
import { skillDevelopHandoff } from "@/pages/skill-develop"
import { pushSessionHandoffDraft } from "@/pages/session/handoff"
import {
  defaultPlatformProjectDirectory,
  personalWorkspaceDirectory,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { requirePersonalSpace } from "@/workbench/require-auth"
import { domainFromSearch, readStoredCapabilitySelection } from "./selection"
import { workspaceCapabilitiesCategoryHref, workspaceSessionHref } from "@/workbench/routes"

const SKILL_LAYER_PREVIEW_COUNT = 4
const FIXED_SINGLE_SKILL_LAYER_IDS = new Set(["orchestrator", "resource"])

type SkillCatalogItem = Awaited<ReturnType<typeof listCatalogSkills>>["items"][number]

function skillBelongsToGroup(item: SkillCatalogItem, group: (typeof skillSystemGroups)[number]) {
  return item.layer === group.title || item.tags.includes(group.title) || item.tags.includes(group.id)
}

function workspaceDirectory(input: {
  path: Parameters<typeof codeEntryWorkspaceDirectory>[0]["path"]
  recent: Parameters<typeof codeEntryWorkspaceDirectory>[0]["recent"]
  lastCodeWorkspace?: string
}) {
  return (
    codeEntryWorkspaceDirectory(input) ||
    personalWorkspaceDirectory(storedPlatformAuthSession(), input.lastCodeWorkspace) ||
    defaultPlatformProjectDirectory(storedPlatformAuthSession()) ||
    configuredCodeDefaultDirectory(document, input.path)
  )
}

function CapabilitySkillCard(props: {
  item: SkillCatalogItem
  layerId?: string
  canDevelop: boolean
  onOpen: () => void
  onDevelop: () => void
}) {
  const tags = () =>
    props.item.tags
      .filter((tag) => tag !== props.item.layer && tag !== props.item.provider)
      .slice(0, 3)

  return (
    <article
      class="os-client-capability-card os-client-capability-skill-card"
      data-layer={props.layerId}
      onClick={props.onOpen}
    >
      <div class="os-client-capability-skill-card-head">
        <h4>{props.item.title}</h4>
      </div>
      <p>{props.item.copy}</p>
      <div class="os-client-capability-meta">
        <span class="os-client-capability-skill-provider">{props.item.provider}</span>
        <For each={tags()}>{(tag) => <span>{tag}</span>}</For>
      </div>
      <div class="os-client-capability-actions">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            props.onOpen()
          }}
        >
          <span class="os-wb-cap-chip-label">详情</span>
        </button>
        <button
          type="button"
          data-primary="true"
          title={props.canDevelop ? undefined : "登录后使用"}
          onClick={(event) => {
            event.stopPropagation()
            props.onDevelop()
          }}
        >
          <span class="os-wb-cap-chip-label">开发</span>
        </button>
      </div>
    </article>
  )
}

function CapabilitySkillLayerSection(props: {
  group: (typeof skillSystemGroups)[number]
  items: readonly SkillCatalogItem[]
  compact?: boolean
  canDevelop: boolean
  onOpen: (item: SkillCatalogItem) => void
  onDevelop: (item: SkillCatalogItem) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const total = () => props.items.length
  const hiddenCount = () => Math.max(0, total() - SKILL_LAYER_PREVIEW_COUNT)
  const visibleItems = () =>
    expanded() || hiddenCount() === 0 ? props.items : props.items.slice(0, SKILL_LAYER_PREVIEW_COUNT)
  const isFixedSingleLayer = () => FIXED_SINGLE_SKILL_LAYER_IDS.has(props.group.id)

  return (
    <section
      id={props.group.id}
      class="os-client-capability-oneskills-section"
      classList={{ "is-compact": props.compact }}
      data-layer={props.group.id}
    >
      <header class="os-client-capability-oneskills-section-head">
        <div class="os-client-capability-oneskills-section-title">
          <h3>{props.group.title}</h3>
          <Show when={total() > 0}>
            <span>{total()}</span>
          </Show>
        </div>
        <p>{props.group.copy}</p>
      </header>
      <Show when={total() > 0} fallback={<p class="os-client-capability-empty">当前分类暂无技能卡片。</p>}>
        <div
          classList={{
            "os-client-capability-page-grid": !isFixedSingleLayer(),
            "os-client-capability-oneskills-compact-grid": isFixedSingleLayer(),
          }}
        >
          <For each={visibleItems()}>
            {(item) => (
              <CapabilitySkillCard
                item={item}
                layerId={props.group.id}
                canDevelop={props.canDevelop}
                onOpen={() => props.onOpen(item)}
                onDevelop={() => props.onDevelop(item)}
              />
            )}
          </For>
        </div>
        <Show when={!isFixedSingleLayer() && hiddenCount() > 0}>
          <button
            type="button"
            class="os-client-capability-oneskills-expand"
            aria-expanded={expanded()}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded() ? "收起" : `展开其余 ${hiddenCount()} 个`}
          </button>
        </Show>
      </Show>
    </section>
  )
}

export function CapabilityOneSkillsPanel() {
  const location = useLocation()
  const navigate = useNavigate()
  const server = useServer()
  const sync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const layout = useLayout()
  const [items, setItems] = createSignal<readonly SkillCatalogItem[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [updating, setUpdating] = createSignal(false)
  const [updateError, setUpdateError] = createSignal<string>()
  const [detailOpen, setDetailOpen] = createSignal(false)
  const [detailItem, setDetailItem] = createSignal<SkillCatalogItem | undefined>()
  const canManageSkills = createMemo(() => Boolean(storedPlatformAuthSession()?.account.id))
  const directory = createMemo(() =>
    workspaceDirectory({
      path: sync.data.path,
      recent: codeWorkspaceRecentProjects(sync.data.project),
      lastCodeWorkspace: server.projects.lastCode(),
    }),
  )

  const reloadSkills = async () => {
    const current = server.current
    if (!current) {
      setItems([])
      setLoaded(true)
      return
    }
    const result = await listCatalogSkills(current.http.url, { limit: 100 })
    setItems(result.loaded ? result.items : [])
    setLoaded(true)
  }

  onMount(() => {
    // Align URL like skills tabs so requirePersonalSpace's default current-page redirect
    // can restore this oneskills view after login cancel. Keep the current domain tab.
    const domain = domainFromSearch(location.search) ?? readStoredCapabilitySelection()?.domainId ?? "all"
    navigate(workspaceCapabilitiesCategoryHref("oneskills", domain), { replace: true })
    void reloadSkills()
    const off = globalSDK.event.listen((event) => {
      if (event.name !== "global") return
      if (String(event.details.type) !== "oneskills.upgraded") return
      void reloadSkills()
    })
    onCleanup(off)
  })

  const groupItemsFor = (group: (typeof skillSystemGroups)[number]) =>
    items().filter((item) => skillBelongsToGroup(item, group))

  const skillsGroups = () => skillSystemGroups.filter((group) => groupItemsFor(group).length > 0)
  const skillsLayout = () => {
    const groups = skillsGroups()
    return {
      pair: groups.filter((group) => FIXED_SINGLE_SKILL_LAYER_IDS.has(group.id)),
      rest: groups.filter((group) => !FIXED_SINGLE_SKILL_LAYER_IDS.has(group.id)),
    }
  }

  const openDetail = (item: SkillCatalogItem) => {
    setDetailItem(item)
    setDetailOpen(true)
  }

  const closeDetail = () => {
    setDetailOpen(false)
    setDetailItem(undefined)
  }

  const startDevelop = (item: SkillCatalogItem) => {
    if (
      !requirePersonalSpace({
        navigate,
        action: { type: "prompt", prompt: "" },
        isLoggedIn: canManageSkills(),
      })
    ) {
      return
    }
    const dir = directory()
    if (!dir) {
      showToast({ variant: "error", title: "无法开发", description: "未检测到工作目录" })
      return
    }
    const handoff = skillDevelopHandoff({
      id: item.id,
      title: item.title,
      copy: item.copy,
      layer: item.layer,
      tags: item.tags,
      provider: item.provider,
    })
    const slug = base64Encode(dir)
    pushSessionHandoffDraft(slug, handoff.prompt, { skill: handoff.skill })
    markCodeNewSessionIntent(slug)
    layout.projects.open(dir)
    server.projects.touchCode(dir)
    setDetailOpen(false)
    setDetailItem(undefined)
    showToast({ variant: "success", title: `已为你创建「${item.title}」开发任务` })
    navigate(workspaceSessionHref(dir))
  }

  const handleUpgrade = async () => {
    if (!canManageSkills()) return
    const current = server.current
    if (!current) {
      const message = formatOneSkillsUpgradeError("更新 OneSkills 失败：请先连接平台服务")
      setUpdateError(message)
      showToast({ variant: "error", title: "更新失败", description: message })
      return
    }
    setUpdating(true)
    setUpdateError(undefined)
    try {
      const result = await upgradeOneSkills(current.http.url)
      await reloadSkills()
      const skillSummary = result.version
        ? `版本 ${result.version} · ${result.skillCount} 个技能`
        : `${result.skillCount} 个技能`
      const seedSummary =
        result.seedSource === "bundled" && result.seedFallbackReason
          ? "原语已回退内置 seed"
          : result.seedSource === "disk"
            ? "原语已同步磁盘 oneskills"
            : undefined
      showToast({
        variant: "success",
        title: "OneSkills 已更新",
        description: seedSummary ? `${skillSummary} · ${seedSummary}` : skillSummary,
      })
    } catch (error) {
      const message = formatOneSkillsUpgradeError(
        error instanceof Error ? error.message : "更新 OneSkills 失败",
      )
      setUpdateError(message)
      showToast({ variant: "error", title: "更新失败", description: message })
    } finally {
      setUpdating(false)
    }
  }

  return (
    <section class="os-client-capability-resource-panel os-client-capability-oneskills-panel">
      <header class="os-client-capability-oneskills-toolbar">
        <div class="os-client-capability-oneskills-toolbar-copy">
          <p>按 OneSkills 分层浏览官方技能，查看详情或进入开发。</p>
          <Show when={loaded() && items().length > 0}>
            <span class="os-client-capability-oneskills-count">{items().length} 个技能</span>
          </Show>
        </div>
        <div class="os-client-capability-oneskills-actions">
          <Show when={updateError()}>
            <p class="os-client-capability-oneskills-error">{updateError()}</p>
          </Show>
          <span class="inline-flex" title={canManageSkills() ? undefined : "登录后使用"}>
            <button
              type="button"
              class="os-client-capability-oneskills-upgrade"
              disabled={!canManageSkills() || updating()}
              onClick={() => void handleUpgrade()}
            >
              <span class="os-wb-cap-chip-label">{updating() ? "更新中..." : "更新 OneSkills"}</span>
            </button>
          </span>
        </div>
      </header>

      <Show when={loaded()} fallback={<p class="os-client-capability-empty">正在加载 OneSkills 技能...</p>}>
        <Show
          when={items().length > 0}
          fallback={<p class="os-client-capability-empty">暂无可展示的 OneSkills 技能，请先安装或更新技能。</p>}
        >
          <div class="os-client-capability-oneskills-overview">
            <Show when={skillsLayout().pair.length > 0}>
              <div class="os-client-capability-oneskills-top-row">
                <For each={skillsLayout().pair}>
                  {(group) => (
                    <CapabilitySkillLayerSection
                      group={group}
                      items={groupItemsFor(group)}
                      compact
                      canDevelop={canManageSkills()}
                      onOpen={openDetail}
                      onDevelop={startDevelop}
                    />
                  )}
                </For>
              </div>
            </Show>
            <For each={skillsLayout().rest}>
              {(group) => (
                <CapabilitySkillLayerSection
                  group={group}
                  items={groupItemsFor(group)}
                  canDevelop={canManageSkills()}
                  onOpen={openDetail}
                  onDevelop={startDevelop}
                />
              )}
            </For>
          </div>
        </Show>
      </Show>

      <SkillDetailDialog
        variant="workbench"
        item={detailItem()}
        open={detailOpen()}
        serverUrl={server.current?.http.url}
        onClose={closeDetail}
        onDevelop={() => {
          const item = detailItem()
          if (!item) return
          closeDetail()
          startDevelop(item)
        }}
      />
    </section>
  )
}
