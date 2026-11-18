import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useRouteParams } from "@/hooks/use-route-params"
import { getFilename } from "@opencode-ai/core/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useGlobalSync } from "./global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { boundWorkspaceID, isRemoteWorkspaceBindGrace, isSshFileTreePending, isTransientRemoteLeafError, remoteWorkspaceRevision } from "@/components/onescience/remote-workspace"
import { runtimeEnvironmentRevision } from "@/components/onescience/runtime-environment"
import { createPathHelpers } from "./file/path"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { createFileTreeStore } from "./file/tree-store"
import { createDebouncedWatcherInvalidator } from "./file/watcher"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

let lastListToastAt = 0
const LIST_ERROR_TOAST_COOLDOWN_MS = 30_000

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const globalSync = useGlobalSync()
    const params = useRouteParams()
    const language = useLanguage()
    const layout = useLayout()

    const scope = createMemo(() => sdk.directory)
    // Tree identity includes the live ssh-node so a late bind does not keep A's listing.
    const treeScope = createMemo(() => {
      remoteWorkspaceRevision()
      return `${scope()}\0${boundWorkspaceID(scope()) ?? ""}`
    })
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

    const inflight = new Map<string, Promise<void>>()
    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope: treeScope,
      normalizeDir: path.normalizeDir,
      list: async (dir) => {
        remoteWorkspaceRevision()
        runtimeEnvironmentRevision()
        const current = sdk.directory
        // Never list A's identity folder for an SSH project — wait for the leaf bind.
        if (!globalSync.bootstrapped) return Promise.resolve([])
        if (current && isSshFileTreePending(current)) {
          return Promise.resolve([])
        }
        const load = () => sdk.client.file.list({ path: dir }).then((x) => x.data ?? [])
        try {
          return await load()
        } catch (error) {
          const message = errorMessage(error, "")
          // Fresh bind: leaf often returns Unexpected server error while sqlite/NFS settles.
          if (current && boundWorkspaceID(current) && isTransientRemoteLeafError(message)) {
            const attempts = isRemoteWorkspaceBindGrace(current) ? 3 : 2
            let lastError: unknown = error
            for (let attempt = 1; attempt < attempts; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
              try {
                return await load()
              } catch (retryError) {
                lastError = retryError
                if (!isTransientRemoteLeafError(errorMessage(retryError, ""))) throw retryError
              }
            }
            throw lastError
          }
          throw error
        }
      },
      onError: (message) => {
        // SSH disconnected / pending: listing is skipped or hits a dead tunnel — not user-facing.
        if (isSshFileTreePending(scope())) return
        if (!boundWorkspaceID(scope()) && /Transport error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(message)) {
          return
        }
        // Right after connect, leaf 500s are expected; retry above — do not spam toasts.
        if (boundWorkspaceID(scope()) && isRemoteWorkspaceBindGrace(scope()) && isTransientRemoteLeafError(message)) {
          return
        }
        const now = Date.now()
        if (now - lastListToastAt < LIST_ERROR_TOAST_COOLDOWN_MS) return
        lastListToastAt = now
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description:
            boundWorkspaceID(scope()) && isTransientRemoteLeafError(message)
              ? language.t("toast.file.remoteNotReady.description")
              : message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      evictContentLru(keep, (target) => {
        if (!store.file[target]) return
        setStore(
          "file",
          target,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      treeScope()
      inflight.clear()
      resetFileContentLru()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: string) => {
      if (!file) return
      if (store.file[file]) return
      setStore("file", file, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: string, content: FileState["content"]) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: string, message: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.error = message
        }),
      )
      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    const load = (input: string, options?: { force?: boolean }) => {
      const file = path.normalize(input)
      if (!file) return Promise.resolve()

      const directory = treeScope()
      const key = `${directory}\n${file}`
      ensure(file)

      const current = store.file[file]
      if (!options?.force && current?.loaded) return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setLoading(file)

      const promise = sdk.client.file
        .read({ path: file })
        .then((x) => {
          if (treeScope() !== directory) return
          const content = x.data
          setLoaded(file, content)

          if (!content) return
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))
        })
        .catch((e) => {
          if (treeScope() !== directory) return
          setLoadError(file, errorMessage(e, language.t("error.chain.unknown")))
        })
        .finally(() => {
          inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    const write = (input: string, content: string) => {
      const filePath = path.normalize(input)
      if (!filePath) return Promise.resolve()

      const directory = treeScope()
      ensure(filePath)

      const saved = { type: "text" as const, content }

      return sdk.client.file
        .write({ path: filePath, content })
        .then(() => {
          if (treeScope() !== directory) return
          setLoaded(filePath, saved)
          touchFileContent(filePath, approxBytes(saved))
          evictContent(new Set([filePath]))
        })
        .catch((e: unknown) => {
          if (treeScope() !== directory) return
          setLoadError(filePath, errorMessage(e, language.t("error.chain.unknown")))
          showToast({
            variant: "error",
            title: language.t("toast.file.loadFailed.title"),
            description: errorMessage(e, language.t("error.chain.unknown")),
          })
        })
    }

    const search = (query: string, dirs: "true" | "false") =>
      sdk.client.find.files({ query, dirs }).then(
        (x) => (x.data ?? []).map(path.normalize),
        () => [],
      )

    const watcher = createDebouncedWatcherInvalidator({
      normalize: path.normalize,
      hasFile: (file) => Boolean(store.file[file]),
      isOpen: (file) => tabs.all().some((tab) => path.pathFromTab(tab) === file),
      loadFile: (file) => {
        void load(file, { force: true })
      },
      node: tree.node,
      isDirLoaded: tree.isLoaded,
      isDirExpanded: tree.isExpanded,
      refreshDir: (dir) => {
        void tree.listDir(dir, { force: true, auto: true })
      },
    })

    const stop = sdk.event.listen((e) => {
      watcher.invalidate(e.details)
    })

    // Poll only directories the user already opened (single-level readdir each).
    // Replaces reliance on whole-workspace filewatchers for large scientific trees.
    const TREE_POLL_MS = 15_000
    createEffect(() => {
      treeScope()
      const timer = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return
        void tree.refreshAll({ auto: true })
      }, TREE_POLL_MS)
      onCleanup(() => clearInterval(timer))
    })

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = store.file[file]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    function withPath(input: string, action: (file: string) => unknown) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withPath(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withPath(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withPath(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withPath(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withPath(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withPath(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop()
      watcher.dispose()
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      tab: path.tab,
      pathFromTab: path.pathFromTab,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        refreshAll: tree.refreshAll,
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      get,
      load,
      write,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string) => search(query, "false"),
      searchFilesAndDirectories: (query: string) => search(query, "true"),
    }
  },
})
