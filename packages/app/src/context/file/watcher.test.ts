import { describe, expect, test } from "bun:test"
import { createDebouncedWatcherInvalidator, dirsToRefresh, invalidateFromWatcher } from "./watcher"

const baseOps = {
  normalize: (input: string) => input,
  hasFile: () => false,
  loadFile: () => {},
  node: () => undefined,
  isDirLoaded: () => false,
  isDirExpanded: () => false,
  refreshDir: () => {},
}

describe("dirsToRefresh", () => {
  test("always includes root and expanded ancestors", () => {
    const dirs = dirsToRefresh(".opencode/skills/new-skill/SKILL.md", "add", {
      ...baseOps,
      isDirExpanded: (path) => path === ".opencode",
      isDirLoaded: (path) => path === ".opencode/skills",
    })

    expect(dirs).toContain("")
    expect(dirs).toContain(".opencode")
    expect(dirs).toContain(".opencode/skills")
  })

  test("refreshes loaded parent on add even when collapsed", () => {
    const dirs = dirsToRefresh("src/new.ts", "add", {
      ...baseOps,
      isDirLoaded: (path) => path === "src",
    })

    expect(dirs).toContain("")
    expect(dirs).toContain("src")
  })

  test("handles windows separators in watcher paths", () => {
    const dirs = dirsToRefresh("src\\components\\new.ts", "add", {
      ...baseOps,
      isDirLoaded: (path) => path === "src/components",
      isDirExpanded: (path) => path === "src",
    })

    expect(dirs).toContain("")
    expect(dirs).toContain("src")
    expect(dirs).toContain("src/components")
  })

  test("refreshes changed directory when expanded", () => {
    const dirs = dirsToRefresh("src", "change", {
      ...baseOps,
      isDirExpanded: (path) => path === "src",
      node: (path) =>
        path === "src"
          ? { path: "src", type: "directory", name: "src", absolute: "/repo/src", ignored: false }
          : undefined,
    })

    expect(dirs).toEqual(["", "src"])
  })
})

describe("file watcher invalidation", () => {
  test("reloads open files and refreshes loaded parent on add", () => {
    const loads: string[] = []
    const refresh: string[] = []
    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/new.ts",
          event: "add",
        },
      },
      {
        ...baseOps,
        hasFile: (path) => path === "src/new.ts",
        loadFile: (path) => loads.push(path),
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(loads).toEqual(["src/new.ts"])
    expect(refresh).toEqual(["", "src"])
  })

  test("reloads files that are open in tabs", () => {
    const loads: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/open.ts",
          event: "change",
        },
      },
      {
        ...baseOps,
        isOpen: (path) => path === "src/open.ts",
        loadFile: (path) => loads.push(path),
        node: () => ({
          path: "src/open.ts",
          type: "file",
          name: "open.ts",
          absolute: "/repo/src/open.ts",
          ignored: false,
        }),
      },
    )

    expect(loads).toEqual(["src/open.ts"])
  })

  test("refreshes only changed loaded directory nodes", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src",
          event: "change",
        },
      },
      {
        ...baseOps,
        node: () => ({ path: "src", type: "directory", name: "src", absolute: "/repo/src", ignored: false }),
        isDirLoaded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: "src/file.ts",
          event: "change",
        },
      },
      {
        ...baseOps,
        node: () => ({
          path: "src/file.ts",
          type: "file",
          name: "file.ts",
          absolute: "/repo/src/file.ts",
          ignored: false,
        }),
        isDirExpanded: (path) => path === "src",
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual(["", "src", "", "src"])
  })

  test("ignores invalid or git watcher updates", () => {
    const refresh: string[] = []

    invalidateFromWatcher(
      {
        type: "file.watcher.updated",
        properties: {
          file: ".git/index.lock",
          event: "change",
        },
      },
      {
        ...baseOps,
        hasFile: () => true,
        loadFile: () => {
          throw new Error("should not load")
        },
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    invalidateFromWatcher(
      {
        type: "project.updated",
        properties: {},
      },
      {
        ...baseOps,
        isDirLoaded: () => true,
        refreshDir: (path) => refresh.push(path),
      },
    )

    expect(refresh).toEqual([])
  })

  test("debounces directory refresh", async () => {
    const refresh: string[] = []
    const invalidator = createDebouncedWatcherInvalidator({
      ...baseOps,
      isDirLoaded: (path) => path === "src",
      refreshDir: (path) => refresh.push(path),
    })

    invalidator.invalidate({
      type: "file.watcher.updated",
      properties: { file: "src/a.ts", event: "add" },
    })
    invalidator.invalidate({
      type: "file.watcher.updated",
      properties: { file: "src/b.ts", event: "add" },
    })

    expect(refresh).toEqual([])

    await new Promise((resolve) => setTimeout(resolve, invalidator.debounceMs + 50))
    expect(refresh.sort()).toEqual(["", "src"])
    invalidator.dispose()
  })
})
