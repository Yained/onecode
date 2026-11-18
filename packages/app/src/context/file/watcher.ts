import type { FileNode } from "@opencode-ai/sdk/v2"

const DEBOUNCE_MS = 400

type WatcherEvent = {
  type: string
  properties: unknown
}

export type WatcherOps = {
  normalize: (input: string) => string
  hasFile: (path: string) => boolean
  isOpen?: (path: string) => boolean
  loadFile: (path: string) => void
  node: (path: string) => FileNode | undefined
  isDirLoaded: (path: string) => boolean
  isDirExpanded: (path: string) => boolean
  refreshDir: (path: string) => void
}

export function dirsToRefresh(path: string, kind: string, ops: WatcherOps) {
  const dirs = new Set<string>([""])
  // Windows watcher events may use `\`; keep splits consistent with tree keys.
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean)
  const normalizedPath = segments.join("/")
  const node = ops.node(normalizedPath)
  const isDirectory = node?.type === "directory"

  if (kind === "add" || kind === "unlink") {
    const parent = segments.slice(0, -1).join("/")
    if (ops.isDirExpanded(parent) || ops.isDirLoaded(parent)) dirs.add(parent)
  }

  if (kind === "change" && isDirectory && (ops.isDirExpanded(normalizedPath) || ops.isDirLoaded(normalizedPath))) {
    dirs.add(normalizedPath)
  }

  const ancestors =
    kind === "change" && isDirectory ? segments : segments.length > 1 ? segments.slice(0, -1) : []
  for (let i = 0; i < ancestors.length; i++) {
    const dir = ancestors.slice(0, i + 1).join("/")
    if (ops.isDirExpanded(dir)) dirs.add(dir)
  }

  return [...dirs]
}

export function createDebouncedWatcherInvalidator(ops: WatcherOps) {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    const dirs = [...pending]
    pending.clear()
    for (const dir of dirs) {
      ops.refreshDir(dir)
    }
  }

  const schedule = (dir: string) => {
    pending.add(dir)
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  }

  const invalidate = (event: WatcherEvent) => {
    if (event.type !== "file.watcher.updated") return
    const props =
      typeof event.properties === "object" && event.properties
        ? (event.properties as Record<string, unknown>)
        : undefined
    const rawPath = typeof props?.file === "string" ? props.file : undefined
    const kind = typeof props?.event === "string" ? props.event : undefined
    if (!rawPath) return
    if (!kind) return

    const filePath = ops.normalize(rawPath)
    if (filePath.startsWith(".git/")) return

    if (ops.hasFile(filePath) || ops.isOpen?.(filePath)) {
      ops.loadFile(filePath)
    }

    for (const dir of dirsToRefresh(filePath, kind, ops)) {
      schedule(dir)
    }
  }

  const dispose = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    pending.clear()
  }

  return { invalidate, dispose, flush, debounceMs: DEBOUNCE_MS }
}

/** @deprecated Use createDebouncedWatcherInvalidator */
export function invalidateFromWatcher(event: WatcherEvent, ops: WatcherOps) {
  if (event.type !== "file.watcher.updated") return
  const props =
    typeof event.properties === "object" && event.properties ? (event.properties as Record<string, unknown>) : undefined
  const rawPath = typeof props?.file === "string" ? props.file : undefined
  const kind = typeof props?.event === "string" ? props.event : undefined
  if (!rawPath) return
  if (!kind) return

  const filePath = ops.normalize(rawPath)
  if (filePath.startsWith(".git/")) return

  if (ops.hasFile(filePath) || ops.isOpen?.(filePath)) {
    ops.loadFile(filePath)
  }

  for (const dir of dirsToRefresh(filePath, kind, ops)) {
    ops.refreshDir(dir)
  }
}
