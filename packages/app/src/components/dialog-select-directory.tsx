import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { List } from "@opencode-ai/ui/list"
import type { ListRef } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import {
  listProjectDataDirectories,
  relativeProjectDataPath,
} from "@/utils/project-data-dirs"
import { clampToProjectDataRoot, isWithinProjectDataRoot, projectDataRoot } from "@/utils/project-folder"
import {
  defaultPlatformWorkspaceDirectory,
  filterPlatformAccountProjects,
  isDefaultPlatformProject,
  isDefaultProjectWorktree,
  storedPlatformAuthSession,
} from "@/utils/platform-auth"
import {
  listImmediateProjectDirectories,
} from "@/utils/project-directory-browse"
import { authTokenFromCredentials } from "@/utils/server"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
  onCreateFolder?: () => void
}

type Row = {
  absolute: string
  search: string
  group: "recent" | "folders"
}

function cleanInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

function normalizePath(input: string) {
  const v = input.replaceAll("\\", "/")
  if (v.startsWith("//") && !v.startsWith("///")) return "//" + v.slice(2).replace(/\/+/g, "/")
  return v.replace(/\/+/g, "/")
}

function normalizeDriveRoot(input: string) {
  const v = normalizePath(input)
  if (/^[A-Za-z]:$/.test(v)) return v + "/"
  return v
}

function trimTrailing(input: string) {
  const v = normalizeDriveRoot(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v
  return v.replace(/\/+$/, "")
}

function joinPath(base: string | undefined, rel: string) {
  const b = trimTrailing(base ?? "")
  const r = trimTrailing(rel).replace(/^\/+/, "")
  if (!b) return r
  if (!r) return b
  if (b.endsWith("/")) return b + r
  return b + "/" + r
}

function rootOf(input: string) {
  const v = normalizeDriveRoot(input)
  if (v.startsWith("//")) return "//"
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const i = v.lastIndexOf("/")
  if (i <= 0) return "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)
  return v.slice(0, i)
}

function modeOf(input: string) {
  const raw = normalizeDriveRoot(input.trim())
  if (!raw) return "relative" as const
  if (raw.startsWith("~")) return "tilde" as const
  if (rootOf(raw)) return "absolute" as const
  return "relative" as const
}

function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}

function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  if (modeOf(input) === "absolute") return full
  return tildeOf(full, home) || full
}

function toRow(absolute: string, home: string, group: Row["group"]): Row {
  const full = trimTrailing(absolute)
  const tilde = tildeOf(full, home)
  const withSlash = (value: string) => {
    if (!value) return ""
    if (value.endsWith("/")) return value
    return value + "/"
  }

  const search = Array.from(
    new Set([full, withSlash(full), tilde, withSlash(tilde), getFilename(full)].filter(Boolean)),
  ).join("\n")
  return { absolute: full, search, group }
}

function uniqueRows(rows: Row[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.absolute)) return false
    seen.add(row.absolute)
    return true
  })
}

function isWorkspaceRootListing(query: string) {
  const value = cleanInput(query)
  if (!value) return true
  const raw = normalizeDriveRoot(value)
  if (raw.endsWith("/")) return false
  if (raw.startsWith("~") || !!rootOf(raw) || raw.includes("/")) return false
  return true
}

function splitBrowsePath(absolute: string, root: string) {
  const base = clampToProjectDataRoot(root, root)
  const full = clampToProjectDataRoot(absolute, root)
  if (full === base) return { directory: base, path: "" }
  return { directory: base, path: full.slice(base.length + 1) }
}

function useDirectorySearch(args: {
  sdk: ReturnType<typeof useGlobalSDK>
  start: () => string | undefined
  home: () => string
  /** UI clamp root — platform accounts use personal workspace. */
  root: () => string
  /** Server list root for /global/path/dirs (ONECODE_EXTRA_PATH / project_data_root). */
  apiRoot: () => string
  fetch?: typeof fetch
  headers?: () => Record<string, string> | undefined
}) {
  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()
  let current = 0

  const withinRoot = (directory: string) => clampToProjectDataRoot(directory, args.root())

  const scoped = (value: string) => {
    const base = args.start()
    if (!base) return

    const root = args.root()
    const raw = normalizeDriveRoot(value)
    if (!raw) return { directory: withinRoot(trimTrailing(base)), path: "" }

    const h = args.home()
    if (raw === "~") return { directory: withinRoot(trimTrailing(h || base)), path: "" }
    if (raw.startsWith("~/")) {
      const absolute = joinPath(h || base, raw.slice(2))
      if (isWithinProjectDataRoot(absolute, root)) return splitBrowsePath(absolute, root)
      return { directory: withinRoot(trimTrailing(base)), path: "" }
    }

    const driveRoot = rootOf(raw)
    if (driveRoot) {
      const absolute = trimTrailing(raw)
      if (isWithinProjectDataRoot(absolute, root)) return splitBrowsePath(absolute, root)
      return { directory: withinRoot(trimTrailing(base)), path: "" }
    }
    return { directory: withinRoot(trimTrailing(base)), path: raw }
  }

  const dirs = async (dir: string) => {
    const key = withinRoot(trimTrailing(dir))
    const existing = cache.get(key)
    if (existing) return existing

    // API always lists under project_data_root; browse UI is clamped to workspace.
    const relative = relativeProjectDataPath(args.apiRoot(), key)
    if (relative === undefined && trimTrailing(key).toLowerCase() !== trimTrailing(args.apiRoot()).toLowerCase()) {
      cache.set(key, Promise.resolve([]))
      return []
    }
    const request = listProjectDataDirectories(args.sdk, relative ?? "", {
      fetch: args.fetch,
      headers: args.headers?.(),
    }).then((nodes) =>
      nodes
        .filter((node) => !node.name.startsWith("."))
        .filter((node) => isWithinProjectDataRoot(node.absolute, args.root()))
        .map((node) => ({
          name: node.name,
          absolute: trimTrailing(normalizeDriveRoot(node.absolute)),
        })),
    )

    cache.set(key, request)
    return request
  }

  const match = async (dir: string, query: string, limit: number) => {
    return listImmediateProjectDirectories(dirs, withinRoot(dir), query, limit)
  }

  const list = async (filter: string) => {
    const token = ++current
    const active = () => token === current

    const value = cleanInput(filter)
    const scopedInput = scoped(value)
    if (!scopedInput) return [] as string[]

    const raw = normalizeDriveRoot(value)
    const isPath = raw.startsWith("~") || !!rootOf(raw) || raw.includes("/")
    const query = normalizeDriveRoot(scopedInput.path)

    if (!isPath) {
      // Immediate children only — List already fuzzy-filters client-side.
      // Avoid recursive depth-8 scans on every keystroke.
      const results = await match(scopedInput.directory, "", 50)
      if (!active()) return []
      return results.slice(0, 50)
    }

    const endsWithSlash = raw.endsWith("/")
    const parts = query
      .replace(/^\/+/, "")
      .replace(/\/+$/, "")
      .split("/")
      .filter((x) => x && x !== ".")

    const cap = 12
    const branch = 4
    const navigate = async (segments: string[], start: string[]) => {
      let paths = start
      for (const part of segments) {
        if (!active()) return [] as string[]
        if (part === "..") {
          paths = paths.map((p) => withinRoot(parentOf(p)))
          continue
        }

        const next = (await Promise.all(paths.map((p) => match(p, part, branch)))).flat()
        if (!active()) return []
        paths = Array.from(new Set(next)).slice(0, cap)
        if (paths.length === 0) return [] as string[]
      }
      return paths
    }

    const rootPaths = [scopedInput.directory]

    if (endsWithSlash) {
      const resolved = await navigate(parts, rootPaths)
      if (resolved.length === 0) return [] as string[]

      const children = (await Promise.all(resolved.map((p) => match(p, "", 50)))).flat()
      if (!active()) return []
      return Array.from(new Set(children)).slice(0, 50)
    }

    const head = parts.slice(0, -1)
    const tail = parts[parts.length - 1] ?? ""
    const resolved = await navigate(head, rootPaths)
    if (resolved.length === 0) return [] as string[]

    const out = (await Promise.all(resolved.map((p) => match(p, tail, 50)))).flat()
    if (!active()) return []
    return Array.from(new Set(out)).slice(0, 50)
  }

  return { list }
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const layout = useLayout()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()

  const [filter, setFilter] = createSignal("")
  let list: ListRef | undefined

  const missingBase = createMemo(() => !(sync.data.path.home || sync.data.path.directory))
  const [fallbackPath] = createResource(
    () => (missingBase() ? true : undefined),
    async () => {
      return sdk.client.path
        .get()
        .then((x) => x.data)
        .catch(() => undefined)
    },
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || fallbackPath()?.home || "")
  const dataRoot = createMemo(() => {
    const path = sync.data.path.project_data_root ? sync.data.path : fallbackPath()
    return projectDataRoot(path)
  })
  const accountWorkspaceRoot = createMemo(() => defaultPlatformWorkspaceDirectory(storedPlatformAuthSession()))
  const browseRoot = createMemo(() => {
    const accountRoot = accountWorkspaceRoot()
    if (accountRoot) return accountRoot
    return dataRoot()
  })
  const start = createMemo(() => browseRoot())

  const directories = useDirectorySearch({
    sdk,
    home,
    start,
    root: browseRoot,
    apiRoot: browseRoot,
    fetch: platform.fetch,
    headers: () => {
      if (storedPlatformAuthSession()) return undefined
      const http = server.current?.http
      if (!http?.password) return undefined
      return {
        Authorization: `Basic ${authTokenFromCredentials({ username: http.username, password: http.password })}`,
      }
    },
  })

  // Prefetch workspace children as soon as the dialog opens so the list is ready
  // without blocking on "加载中" when recent projects can already be shown.
  const [rootDirs] = createResource(
    () => browseRoot() || undefined,
    async () => directories.list(""),
  )

  const recentProjects = createMemo(() => {
    const root = browseRoot()
    const workspaceRoot = accountWorkspaceRoot()
    const session = storedPlatformAuthSession()
    const byWorktree = new Map(sync.data.project.map((project) => [project.worktree, project]))
    const opened = layout.projects.list()
    const openedUser = opened.filter(
      (project) =>
        !isDefaultPlatformProject(session, project.worktree) && !isDefaultProjectWorktree(project.worktree),
    )
    // After cache clear the sidebar open-list is empty; fall back to control-plane catalog.
    const source =
      openedUser.length > 0
        ? openedUser
        : filterPlatformAccountProjects(sync.data.project, session).map((project) => ({
            worktree: project.worktree,
            name: project.name,
          }))
    const projects = source
      .filter((project) => isWithinProjectDataRoot(project.worktree, root))
      .filter((project) => !workspaceRoot || project.worktree !== workspaceRoot)
      // `default` is the sidebar「未分类」bucket — not a user-facing project to open.
      .filter(
        (project) =>
          !isDefaultPlatformProject(session, project.worktree) && !isDefaultProjectWorktree(project.worktree),
      )

    return projects
      .map((project, index) => ({
        project,
        at: byWorktree.get(project.worktree)?.time?.updated ?? byWorktree.get(project.worktree)?.time?.created ?? 0,
        index,
      }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .slice(0, 5)
      .map(({ project }) => {
        const meta = byWorktree.get(project.worktree)
        const row = toRow(project.worktree, home(), "recent")
        const name = project.name || meta?.name || getFilename(project.worktree)
        return {
          ...row,
          search: `${row.search}\n${name}`,
        }
      })
  })

  const recentPaths = createMemo(() => new Set(recentProjects().map((row) => row.absolute.toLowerCase())))

  const isHiddenDefaultProject = (absolute: string) => {
    const session = storedPlatformAuthSession()
    return isDefaultPlatformProject(session, absolute) || isDefaultProjectWorktree(absolute)
  }

  const mergeRows = (query: string, results: string[]) => {
    const browsing = query.endsWith("/")
    const atWorkspaceRoot = isWorkspaceRootListing(query)
    const directoryRows = results
      .map((absolute) => {
        const row = toRow(absolute, home(), "folders")
        if (!browsing) return row
        return { ...row, search: `${row.search}\n${query}` }
      })
      .filter((row) => !atWorkspaceRoot || !recentPaths().has(row.absolute.toLowerCase()))
      .filter((row) => !atWorkspaceRoot || !isHiddenDefaultProject(row.absolute))
    return uniqueRows([...recentProjects(), ...directoryRows])
  }

  const items = (value: string): Row[] | Promise<Row[]> => {
    const query = cleanInput(value)

    // Workspace-root view: prefer sync data so recent projects appear immediately.
    // List fuzzy-filters client-side; no need to re-hit the API on every keystroke.
    if (isWorkspaceRootListing(query)) {
      const cached = rootDirs()
      if (cached) return mergeRows(query, cached)
      if (recentProjects().length > 0) return recentProjects()
      return directories.list("").then((results) => mergeRows(query, results))
    }

    return directories.list(query).then((results) => mergeRows(query, results))
  }

  function resolve(absolute: string) {
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  function rowMeta(absolute: string) {
    const path = displayPath(absolute, filter(), home())
    const name = getFilename(path) || path
    const parent = getDirectory(path)
    return { path, name, parent }
  }

  return (
    <Dialog
      title={props.title ?? language.t("command.project.open")}
      class="os-client-project-picker"
      size="normal"
    >
      <div class="os-client-project-picker-body">
        <Show when={props.onCreateFolder}>
          {(onCreateFolder) => (
            <button
              type="button"
              class="os-client-project-picker-create"
              onClick={() => onCreateFolder()()}
            >
              <Icon name="plus" size="small" class="os-client-project-picker-create-icon" />
              <span>{language.t("command.project.createFolder")}</span>
            </button>
          )}
        </Show>
        <List
          class="os-client-project-picker-list"
          search={{ placeholder: language.t("dialog.directory.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.directory.empty")}
          loadingMessage={language.t("common.loading")}
          items={items}
          key={(x) => x.absolute}
          filterKeys={["search"]}
          groupBy={(item) => item.group}
          sortGroupsBy={(a, b) => {
            if (a.category === b.category) return 0
            return a.category === "recent" ? -1 : 1
          }}
          groupHeader={(group) => {
            if (group.category === "recent") return language.t("home.recentProjects")
            return recentProjects().length > 0
              ? language.t("dialog.directory.other")
              : language.t("dialog.directory.browse")
          }}
          ref={(r) => (list = r)}
          onFilter={(value) => setFilter(cleanInput(value))}
          onKeyEvent={(e, item) => {
            if (e.key !== "Tab") return
            if (e.shiftKey) return
            if (!item) return

            e.preventDefault()
            e.stopPropagation()

            const value = displayPath(item.absolute, filter(), home())
            list?.setFilter(value.endsWith("/") ? value : value + "/")
          }}
          onSelect={(path) => {
            if (!path) return
            resolve(path.absolute)
          }}
        >
          {(item) => {
            const meta = rowMeta(item.absolute)
            return (
              <div class="os-client-project-picker-row">
                <span class="os-client-project-picker-row-icon" aria-hidden="true">
                  <FileIcon node={{ path: item.absolute, type: "directory" }} class="size-4" />
                </span>
                <span class="os-client-project-picker-row-text">
                  <span class="os-client-project-picker-row-name">{meta.name}</span>
                  <Show when={meta.parent && meta.parent !== "./" && meta.parent !== "/"}>
                    <span class="os-client-project-picker-row-path">{meta.parent}</span>
                  </Show>
                </span>
              </div>
            )
          }}
        </List>
      </div>
    </Dialog>
  )
}
