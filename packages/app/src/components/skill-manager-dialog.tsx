import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show, createEffect, createMemo, createSignal, on, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { displayName } from "@/pages/layout/helpers"
import {
  deleteUserSkill,
  listSkillRepos,
  SkillRepoManager,
  SkillUploadForm,
  type SkillManagerTab,
  type SkillRepoConfig,
} from "@/pages/onescience-skill-management"
import { canDeleteUserSkill, listUserUploadedSkills, splitSkillScopes } from "@/pages/onescience-skill-scope"
import {
  filterPlatformAccountProjects,
  isDefaultPlatformProject,
  isPlatformAuthRequired,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import { shouldUseNativeProjectPicker } from "@/utils/project-picker"
import { CapabilityPager } from "@/workbench/capabilities/pager"
import { paginate } from "@/workbench/capabilities/pagination"

/** Compact skill rows per column page. */
const SKILL_LIST_PAGE_SIZE = 10

type SkillItem = {
  name: string
  description?: string
  location: string
}

export const skillManagerTabs = [
  { id: "list" as const, label: "技能列表", hint: "浏览项目与全局已发现技能" },
  { id: "repo" as const, label: "配置仓库", hint: "同步 Git 仓库与 OneSkills 来源" },
  { id: "upload" as const, label: "上传技能", hint: "安装自定义 SKILL 到项目或全局" },
] as const

export function SkillManagerPanel(props: {
  directory?: string
  /** When true, withhold tenant paths and skill lists until the user signs in. */
  loginRequired?: boolean
  initialTab?: SkillManagerTab
  tab?: SkillManagerTab
  onTabChange?: (tab: SkillManagerTab) => void
  /** dialog keeps modal chrome; page-body embeds in capability-center layout */
  variant?: "dialog" | "page" | "page-body"
  onClose?: () => void
}) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const server = useServer()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const variant = () => props.variant ?? "dialog"
  const loginRequired = () =>
    props.loginRequired ?? (isPlatformAuthRequired() && !storedPlatformAuthSession())
  const [skills, setSkills] = createSignal<SkillItem[]>([])
  const [repos, setRepos] = createSignal<readonly SkillRepoConfig[]>([])
  const [skillsLoading, setSkillsLoading] = createSignal(false)
  const [reposLoading, setReposLoading] = createSignal(false)
  const [skillsLoaded, setSkillsLoaded] = createSignal(false)
  const [reposLoaded, setReposLoaded] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [updatedAt, setUpdatedAt] = createSignal<Date>()
  const [internalTab, setInternalTab] = createSignal<SkillManagerTab>(props.initialTab ?? "list")
  const tab = () => props.tab ?? internalTab()
  const setTab = (next: SkillManagerTab) => {
    props.onTabChange?.(next)
    if (props.tab === undefined) setInternalTab(next)
  }
  const [deleting, setDeleting] = createSignal<string>()
  const loading = () => skillsLoading() || reposLoading()

  const clearTenantSkillState = () => {
    setSkills([])
    setRepos([])
    setSkillsLoaded(false)
    setReposLoaded(false)
    setUpdatedAt(undefined)
    setError(undefined)
  }

  const loadSkills = async () => {
    if (loginRequired()) {
      clearTenantSkillState()
      return
    }
    if (skillsLoading()) return
    setSkillsLoading(true)
    try {
      const response = await sdk.client.app.skills({ directory: props.directory })
      setSkills([...(response.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)))
      setSkillsLoaded(true)
      setUpdatedAt(new Date())
      setError(undefined)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "技能同步失败")
    } finally {
      setSkillsLoading(false)
    }
  }

  const loadRepos = async (syncRepos = false) => {
    if (loginRequired()) {
      setRepos([])
      setReposLoaded(false)
      return
    }
    const current = server.current
    const path = props.directory
    if (!current || !path) {
      setRepos([])
      setReposLoaded(true)
      return
    }
    if (reposLoading()) return
    setReposLoading(true)
    try {
      const result = await listSkillRepos(current.http.url, path, syncRepos)
      setRepos(result.items)
      setReposLoaded(result.loaded)
      setError(undefined)
    } catch {
      setRepos([])
      setReposLoaded(false)
    } finally {
      setReposLoading(false)
    }
  }

  const load = async (syncAll = false) => {
    if (loginRequired()) {
      clearTenantSkillState()
      return
    }
    await Promise.all([loadSkills(), loadRepos(syncAll)])
  }

  const ensureTabData = (current: SkillManagerTab) => {
    if (loginRequired()) {
      clearTenantSkillState()
      return
    }
    if (current === "list" || current === "upload") {
      if (!skillsLoaded() && !skillsLoading()) void loadSkills()
      if (current === "list" && !reposLoaded() && !reposLoading()) void loadRepos()
      return
    }
    if (current === "repo" && !reposLoaded() && !reposLoading()) void loadRepos()
  }

  const projectRoot = createMemo(() => (loginRequired() ? undefined : normalizePath(props.directory)))
  const globalRoot = createMemo(() => (loginRequired() ? undefined : normalizePath(sync.data.path.home)))
  const pathInfo = createMemo(() => sync.data.path)
  const scopedSkills = createMemo(() =>
    loginRequired()
      ? { project: [] as SkillItem[], global: [] as SkillItem[] }
      : splitSkillScopes(skills(), projectRoot(), globalRoot(), pathInfo(), repos()),
  )
  const projectSkills = () => scopedSkills().project
  const globalSkills = () => scopedSkills().global
  const directory = () => (loginRequired() ? "" : (props.directory ?? ""))
  const projectLabel = createMemo(() => {
    const path = projectRoot()
    if (!path) return "未选择项目"
    const project = filterPlatformAccountProjects(layout.projects.list(), storedPlatformAuthSession()).find(
      (item) => normalizePath(item.worktree) === path,
    )
    if (project && !isDefaultPlatformProject(storedPlatformAuthSession(), project.worktree)) {
      return displayName(project)
    }
    return path
  })
  const totalSkills = createMemo(() => projectSkills().length + globalSkills().length)

  const uploadedSkills = createMemo(() =>
    loginRequired() ? [] : listUserUploadedSkills(skills(), projectRoot(), globalRoot(), pathInfo()),
  )

  const removeSkill = (item: SkillItem, tone: "project" | "global") => {
    const current = server.current
    const path = directory()
    if (!current || !path) return
    if (!canDeleteUserSkill(item, tone, projectRoot(), globalRoot(), pathInfo())) return
    if (!window.confirm(`确定删除技能「${item.name}」吗？此操作不可恢复。`)) return
    setDeleting(item.name)
    setError(undefined)
    void deleteUserSkill(current.http.url, path, item.name, tone)
      .then(() => load(true))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "删除技能失败")
      })
      .finally(() => setDeleting(undefined))
  }

  onMount(() => {
    if (loginRequired()) {
      clearTenantSkillState()
      return
    }
    const initial = props.initialTab ?? "list"
    if (initial === "upload") {
      void loadSkills()
      return
    }
    if (initial === "repo") {
      void loadRepos()
      return
    }
    void Promise.all([loadSkills(), loadRepos()])
  })

  createEffect(() => {
    if (loginRequired()) {
      clearTenantSkillState()
      return
    }
    ensureTabData(tab())
  })

  createEffect(
    on(
      () => directory(),
      (path, previous) => {
        if (!path || path === previous || loginRequired()) return
        setSkillsLoaded(false)
        setReposLoaded(false)
        ensureTabData(tab())
      },
    ),
  )

  const applyProjectDirectory = (next: string) => {
    layout.projects.open(next)
    server.projects.touchCode(next)
  }

  async function chooseProjectDirectory() {
    const nativePicker = platform.openDirectoryPickerDialog
    function resolve(result: string | string[] | null) {
      const picked = Array.isArray(result) ? result[0] : result
      if (!picked) return
      applyProjectDirectory(picked)
    }

    if (
      nativePicker &&
      shouldUseNativeProjectPicker({
        hasNativePicker: !!nativePicker,
        isLocalServer: !!server.isLocal(),
        hasPlatformSession: !!storedPlatformAuthSession(),
      })
    ) {
      const result = await nativePicker({ title: "选择项目目录", multiple: false })
      resolve(result)
      return
    }

    dialog.show(() => <DialogSelectDirectory onSelect={resolve} />, () => resolve(null))
  }

  const pageBody = () => variant() === "page-body"

  return (
    <section
      classList={{
        "os-upload-dialog os-skill-manager-dialog": variant() === "dialog",
        "os-client-skills-panel": variant() === "page",
        "os-client-capability-resource-panel os-client-skills-panel-body os-skill-manager-page-body": pageBody(),
      }}
      role={variant() === "dialog" ? "dialog" : undefined}
      aria-modal={variant() === "dialog" ? "true" : undefined}
      aria-label="技能管理"
      onClick={variant() === "dialog" ? (event) => event.stopPropagation() : undefined}
    >
      <Show when={variant() === "dialog"}>
        <header class="os-skill-manager-hero">
          <div class="os-skill-manager-hero-copy">
            <h2>技能管理</h2>
            <p>管理项目与全局技能，配置仓库并上传自定义 SKILL</p>
          </div>
          <div class="os-skill-manager-hero-actions">
            <button
              type="button"
              class="os-skill-manager-refresh"
              data-loading={loading() ? "true" : undefined}
              disabled={loading() || loginRequired()}
              onClick={() => void load(true)}
            >
              <span class="os-skill-manager-refresh-icon" aria-hidden="true">
                <Icon name="refresh" size="small" />
              </span>
              <span>{loading() ? "同步中" : "刷新"}</span>
            </button>
            <Show when={props.onClose}>
              <button
                type="button"
                class="os-skill-manager-close"
                onClick={() => props.onClose?.()}
                aria-label="关闭技能管理"
              >
                ×
              </button>
            </Show>
          </div>
        </header>
      </Show>

      <Show when={variant() === "dialog"}>
        <nav class="os-skill-manager-segments" aria-label="技能管理视图">
          <For each={skillManagerTabs}>
            {(item) => (
              <button
                type="button"
                class="os-skill-manager-segment"
                data-active={tab() === item.id}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
      </Show>

      <Show when={variant() === "page"}>
        <div class="os-client-skills-toolbar">
          <nav class="os-skill-manager-segments" aria-label="技能管理视图">
            <For each={skillManagerTabs}>
              {(item) => (
                <button
                  type="button"
                  class="os-skill-manager-segment"
                  data-active={tab() === item.id}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </nav>
          <button
            type="button"
            class="os-skill-manager-refresh"
            data-loading={loading() ? "true" : undefined}
            disabled={loading() || loginRequired()}
            onClick={() => void load(true)}
          >
            <span class="os-skill-manager-refresh-icon" aria-hidden="true">
              <Icon name="refresh" size="small" />
            </span>
            <span>{loading() ? "同步中" : "刷新"}</span>
          </button>
        </div>
      </Show>

      <div class="os-skill-manager-body">
        <Show when={pageBody()}>
          <header class="os-client-capability-page-section-head os-client-capability-page-section-head-active">
            <p>{skillManagerTabs.find((item) => item.id === tab())?.hint}</p>
            <button
              type="button"
              class="os-client-skills-refresh"
              data-loading={loading() ? "true" : undefined}
              disabled={loading() || loginRequired()}
              onClick={() => void load(true)}
            >
              {loading() ? "同步中" : "刷新"}
            </button>
          </header>
        </Show>
        <Show when={loginRequired()}>
          <div class="os-skill-manager-empty os-client-skills-need-project">登录后查看个人技能与目录</div>
        </Show>
        <Show when={!loginRequired() && !directory()}>
          <div class="os-skill-manager-empty os-client-skills-need-project">
            登录并打开个人项目后，可管理仓库配置与上传技能。当前仍可浏览已发现的全局技能列表。
          </div>
        </Show>
        <Show when={!loginRequired() && tab() === "list"}>
          <div class="os-skill-manager-metrics">
            <article class="os-skill-manager-metric">
              <span>已发现技能</span>
              <strong>{skillsLoading() && !skillsLoaded() ? "—" : totalSkills()}</strong>
            </article>
            <article class="os-skill-manager-metric">
              <span>项目技能</span>
              <strong>{skillsLoading() && !skillsLoaded() ? "—" : projectSkills().length}</strong>
            </article>
            <article class="os-skill-manager-metric">
              <span>全局技能</span>
              <strong>{skillsLoading() && !skillsLoaded() ? "—" : globalSkills().length}</strong>
            </article>
            <article class="os-skill-manager-metric os-skill-manager-metric-wide">
              <span>上次同步</span>
              <strong>{updatedAt()?.toLocaleTimeString() ?? "等待同步"}</strong>
            </article>
          </div>
          <Show when={error()}>{(message) => <div class="os-skill-manager-alert">{message()}</div>}</Show>
          <div class="os-skill-manager-paths">
            <span>
              <em>项目</em>
              {projectRoot() || "未选择项目"}
            </span>
            <span>
              <em>用户</em>
              {globalRoot() || "未读取到用户目录"}
            </span>
          </div>
          <div class="os-skill-manager-grid">
            <SkillColumn
              tone="project"
              title="项目技能"
              copy="当前项目 skills、已配置的项目仓库与 OneSkills 覆盖项。"
              items={projectSkills()}
              loading={skillsLoading() && !skillsLoaded()}
              empty="暂无项目技能，可在「上传技能」中安装到当前项目。"
              canDelete={(item) => canDeleteUserSkill(item, "project", projectRoot(), globalRoot(), pathInfo())}
              deleting={deleting()}
              onDelete={(item) => removeSkill(item, "project")}
            />
            <SkillColumn
              tone="global"
              title="全局技能"
              copy="用户目录与内置来源下的跨项目共享技能。"
              items={globalSkills()}
              loading={skillsLoading() && !skillsLoaded()}
              empty="暂无全局技能，可上传为个人全局技能。"
              canDelete={(item) => canDeleteUserSkill(item, "global", projectRoot(), globalRoot(), pathInfo())}
              deleting={deleting()}
              onDelete={(item) => removeSkill(item, "global")}
            />
          </div>
        </Show>
        <Show when={!loginRequired() && tab() === "repo" && directory()}>
          <SkillProjectPathBar
            label={projectLabel()}
            path={projectRoot() ?? directory()}
            onSwitch={() => void chooseProjectDirectory()}
          />
          <SkillRepoManager
            directory={directory()}
            repos={repos()}
            loaded={reposLoaded()}
            loading={reposLoading()}
            onChanged={() => load(true)}
          />
        </Show>
        <Show when={!loginRequired() && tab() === "upload" && directory()}>
          <Show when={error()}>{(message) => <div class="os-skill-manager-alert">{message()}</div>}</Show>
          <SkillProjectPathBar
            label={projectLabel()}
            path={projectRoot() ?? directory()}
            onSwitch={() => void chooseProjectDirectory()}
          />
          <SkillUploadForm
            directory={directory()}
            uploaded={uploadedSkills()}
            loaded={skillsLoaded()}
            loading={skillsLoading()}
            deleting={deleting()}
            onCreated={() => void load(true)}
            onDelete={(item) => removeSkill(item, item.scope)}
          />
        </Show>
      </div>
    </section>
  )
}

export function SkillManagerDialog(props: { directory?: string; initialTab?: SkillManagerTab }) {
  const dialog = useDialog()
  return (
    <div class="os-modal-backdrop" role="presentation">
      <SkillManagerPanel
        directory={props.directory}
        initialTab={props.initialTab}
        variant="dialog"
        onClose={() => dialog.close()}
      />
    </div>
  )
}

function SkillProjectPathBar(props: { label: string; path: string; onSwitch: () => void }) {
  return (
    <div class="os-skill-manager-project-bar">
      <div class="os-skill-manager-project-bar-copy">
        <span class="os-skill-manager-project-bar-label">当前项目</span>
        <strong title={props.path}>{props.label}</strong>
        <code title={props.path}>{props.path}</code>
      </div>
      <button type="button" class="os-skill-manager-project-bar-switch" onClick={props.onSwitch}>
        切换项目
      </button>
    </div>
  )
}

function SkillColumn(props: {
  tone: "project" | "global"
  title: string
  copy: string
  items: SkillItem[]
  loading: boolean
  empty: string
  canDelete: (item: SkillItem) => boolean
  deleting?: string
  onDelete: (item: SkillItem) => void
}) {
  const [page, setPage] = createSignal(1)
  createEffect(
    on(
      () => props.items.length,
      () => setPage(1),
    ),
  )
  const paged = createMemo(() => paginate(props.items, page(), SKILL_LIST_PAGE_SIZE))

  return (
    <section class="os-skill-manager-column" data-tone={props.tone}>
      <div class="os-skill-manager-column-head">
        <div class="os-skill-manager-column-title">
          <h3>{props.title}</h3>
          <p>{props.copy}</p>
        </div>
        <span class="os-skill-manager-count">{props.loading ? "…" : props.items.length}</span>
      </div>
      <div class="os-skill-manager-list">
        <Show
          when={!props.loading}
          fallback={
            <div class="os-skill-manager-skeleton-grid">
              <For each={Array.from({ length: 4 })}>{() => <div class="os-skill-manager-skeleton" />}</For>
            </div>
          }
        >
          <Show when={props.items.length > 0} fallback={<div class="os-skill-manager-empty">{props.empty}</div>}>
            <For each={paged().pageItems}>
              {(item) => (
                <SkillCard
                  item={item}
                  tone={props.tone}
                  deletable={props.canDelete(item)}
                  deleting={props.deleting === item.name}
                  onDelete={() => props.onDelete(item)}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>
      <Show when={!props.loading && paged().totalPages > 1}>
        <div class="os-skill-manager-pager">
          <CapabilityPager
            page={paged().page}
            totalPages={paged().totalPages}
            total={paged().total}
            onPageChange={setPage}
          />
        </div>
      </Show>
    </section>
  )
}

function SkillCard(props: {
  item: SkillItem
  tone: "project" | "global"
  deletable: boolean
  deleting: boolean
  onDelete: () => void
}) {
  const [hover, setHover] = createSignal(false)
  const [anchor, setAnchor] = createSignal<DOMRect>()
  let card: HTMLElement | undefined

  const builtIn = () => props.item.location === "<built-in>"
  const description = () => props.item.description?.trim() || "暂无描述"
  const locationLabel = () => (builtIn() ? "内置技能" : props.item.location.replace(/\\/g, "/"))

  const openTip = () => {
    if (!card) return
    setAnchor(card.getBoundingClientRect())
    setHover(true)
  }
  const closeTip = () => setHover(false)

  const tipStyle = createMemo(() => {
    const box = anchor()
    if (!box) return {}
    const gap = 8
    const width = Math.min(Math.max(box.width, 260), 420)
    const left = Math.min(Math.max(12, box.left), window.innerWidth - width - 12)
    const below = box.bottom + gap
    const spaceBelow = window.innerHeight - below
    if (spaceBelow < 120 && box.top > spaceBelow) {
      return {
        left: `${left}px`,
        bottom: `${window.innerHeight - box.top + gap}px`,
        width: `${width}px`,
      }
    }
    return {
      left: `${left}px`,
      top: `${below}px`,
      width: `${width}px`,
    }
  })

  return (
    <>
      <article
        ref={(el) => {
          card = el
        }}
        class="os-skill-manager-card"
        tabindex="0"
        onMouseEnter={openTip}
        onMouseLeave={closeTip}
        onFocusIn={openTip}
        onFocusOut={closeTip}
      >
        <div class="os-skill-manager-card-top">
          <div class="os-skill-manager-card-title">
            <strong title={props.item.name}>{props.item.name}</strong>
            <span class="os-skill-manager-pill">{builtIn() ? "内置" : "SKILL.md"}</span>
          </div>
          <div class="os-skill-manager-card-actions">
            <Show when={props.deletable}>
              <button
                class="os-button os-button-secondary os-skill-manager-delete"
                type="button"
                disabled={props.deleting}
                aria-label={`删除技能 ${props.item.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTip()
                  props.onDelete()
                }}
              >
                {props.deleting ? "删除中…" : "删除"}
              </button>
            </Show>
            <span class="os-skill-manager-scope" data-tone={props.tone}>
              {props.tone === "project" ? "项目" : "全局"}
            </span>
          </div>
        </div>
      </article>
      <Show when={hover() && anchor()}>
        <Portal>
          <div class="os-skill-manager-card-popover" role="tooltip" style={tipStyle()}>
            <strong>{props.item.name}</strong>
            <p>{description()}</p>
            <code title={props.item.location}>{locationLabel()}</code>
          </div>
        </Portal>
      </Show>
    </>
  )
}

function normalizePath(value: string | undefined) {
  return value?.replace(/\\/g, "/").replace(/\/+$/, "")
}
