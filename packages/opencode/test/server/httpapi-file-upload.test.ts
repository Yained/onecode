import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

const tmpdirEffect = (options: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file upload HttpApi", () => {
  it.live(
    "uploads a file into the project directory via multipart form",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      const body = new FormData()
      body.set("path", "uploads/hello.txt")
      body.set("overwrite", "true")
      body.set("file", new Blob(["hello upload"], { type: "text/plain" }), "hello.txt")

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
            body,
          }),
        ),
      )

      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/hello.txt", status: "written" })

      const written = yield* Effect.promise(() =>
        Bun.file(path.join(tmp.path, "uploads", "hello.txt")).text(),
      )
      expect(written).toBe("hello upload")
    }),
  )

  it.live(
    "uploads unicode file paths into the project directory",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      const body = new FormData()
      body.set("path", "uploads/AI科学训练超节点需求分析.md")
      body.set("overwrite", "true")
      body.set("file", new Blob(["需求分析"], { type: "text/markdown" }), "AI科学训练超节点需求分析.md")

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
            body,
          }),
        ),
      )

      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/AI科学训练超节点需求分析.md", status: "written" })

      const written = yield* Effect.promise(() =>
        Bun.file(path.join(tmp.path, "uploads", "AI科学训练超节点需求分析.md")).text(),
      )
      expect(written).toBe("需求分析")
    }),
  )

  it.live(
    "skips existing uploads when overwrite is false",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })

      const firstBody = new FormData()
      firstBody.set("path", "uploads/existing.txt")
      firstBody.set("overwrite", "true")
      firstBody.set("file", new Blob(["old"], { type: "text/plain" }), "existing.txt")

      const firstResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
            body: firstBody,
          }),
        ),
      )
      expect(firstResponse.status).toBe(200)

      const secondBody = new FormData()
      secondBody.set("path", "uploads/existing.txt")
      secondBody.set("overwrite", "false")
      secondBody.set("file", new Blob(["new"], { type: "text/plain" }), "existing.txt")

      const secondResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
            body: secondBody,
          }),
        ),
      )

      expect(secondResponse.status).toBe(200)
      const json = (yield* Effect.promise(() => secondResponse.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/existing.txt", status: "skipped" })

      const written = yield* Effect.promise(() => Bun.file(path.join(tmp.path, "uploads", "existing.txt")).text())
      expect(written).toBe("old")
    }),
  )

  it.live(
    "uploads through Server.listen Node HTTP (IncomingMessage source)",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const listener = yield* Effect.acquireRelease(
        Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0 })),
        (server) => Effect.promise(() => server.stop(true)),
      )

      const body = new FormData()
      body.set("path", "uploads/node.txt")
      body.set("overwrite", "true")
      body.set("file", new Blob(["node upload"], { type: "text/plain" }), "node.txt")

      const response = yield* Effect.promise(() =>
        fetch(new URL(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, listener.url), {
          method: "POST",
          headers: {
            "x-opencode-directory": encodeURIComponent(tmp.path),
          },
          body,
        }),
      )

      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/node.txt", status: "written" })

      const written = yield* Effect.promise(() => Bun.file(path.join(tmp.path, "uploads", "node.txt")).text())
      expect(written).toBe("node upload")
    }),
  )

  it.live(
    "uploads unicode multipart filenames through Server.listen",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const listener = yield* Effect.acquireRelease(
        Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0 })),
        (server) => Effect.promise(() => server.stop(true)),
      )

      const body = new FormData()
      body.set("path", "uploads/AI科学训练超节点需求分析.md")
      body.set("overwrite", "true")
      body.set("file", new Blob(["node unicode upload"], { type: "text/markdown" }), "AI科学训练超节点需求分析.md")

      const response = yield* Effect.promise(() =>
        fetch(new URL(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, listener.url), {
          method: "POST",
          headers: {
            "x-opencode-directory": encodeURIComponent(tmp.path),
          },
          body,
        }),
      )

      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/AI科学训练超节点需求分析.md", status: "written" })

      const written = yield* Effect.promise(() =>
        Bun.file(path.join(tmp.path, "uploads", "AI科学训练超节点需求分析.md")).text(),
      )
      expect(written).toBe("node unicode upload")
    }),
  )

  it.live(
    "uploads application/json files through Server.listen without Missing file",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const listener = yield* Effect.acquireRelease(
        Effect.promise(() => Server.listen({ hostname: "127.0.0.1", port: 0 })),
        (server) => Effect.promise(() => server.stop(true)),
      )

      const body = new FormData()
      body.set("path", "uploads/sample.json")
      body.set("overwrite", "true")
      // Browsers set this MIME for .json; Effect used to treat it as a form Field.
      body.set("file", new Blob(['{"ok":true}'], { type: "application/json" }), "sample.json")

      const response = yield* Effect.promise(() =>
        fetch(new URL(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, listener.url), {
          method: "POST",
          headers: {
            "x-opencode-directory": encodeURIComponent(tmp.path),
          },
          body,
        }),
      )

      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/sample.json", status: "written" })
      const written = yield* Effect.promise(() => Bun.file(path.join(tmp.path, "uploads", "sample.json")).text())
      expect(written).toBe('{"ok":true}')
    }),
  )

  it.live(
    "rejects uploads/ files larger than 100MB while allowing other project paths under 512MB",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const oversized = new Uint8Array(100 * 1024 * 1024 + 1)

      const promptBody = new FormData()
      promptBody.set("path", "uploads/too-big.bin")
      promptBody.set("overwrite", "true")
      promptBody.set("file", new Blob([oversized], { type: "application/octet-stream" }), "too-big.bin")

      const promptResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
            body: promptBody,
          }),
        ),
      )
      expect(promptResponse.status).toBe(413)

      // Just under prompt limit but on a non-uploads path should still succeed.
      const projectBody = new FormData()
      projectBody.set("path", "data/ok.bin")
      projectBody.set("overwrite", "true")
      projectBody.set(
        "file",
        new Blob([new Uint8Array(100 * 1024 * 1024 + 1)], { type: "application/octet-stream" }),
        "ok.bin",
      )
      const projectResponse = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/upload?directory=${encodeURIComponent(tmp.path)}`, {
            method: "POST",
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
            body: projectBody,
          }),
        ),
      )
      expect(projectResponse.status).toBe(200)
    }),
  )

  it.live(
    "deletes uploads/ files via DELETE /file/upload",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const target = path.join(tmp.path, "uploads", "remove-me.txt")
      yield* Effect.promise(async () => {
        await Bun.write(target, "temporary")
      })

      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(
            `/file/upload?directory=${encodeURIComponent(tmp.path)}&path=${encodeURIComponent("uploads/remove-me.txt")}`,
            {
              method: "DELETE",
              headers: {
                "x-opencode-directory": encodeURIComponent(tmp.path),
              },
            },
          ),
        ),
      )
      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { path: string; status: string }
      expect(json).toEqual({ path: "uploads/remove-me.txt", status: "deleted" })
      expect(yield* Effect.promise(() => Bun.file(target).exists())).toBe(false)
    }),
  )

  it.live(
    "reports available disk space",
    Effect.gen(function* () {
      const tmp = yield* tmpdirEffect({ config: { formatter: false, lsp: false } })
      const response = yield* Effect.promise(() =>
        Promise.resolve(
          app().request(`/file/disk-space?directory=${encodeURIComponent(tmp.path)}`, {
            headers: {
              "x-opencode-directory": encodeURIComponent(tmp.path),
            },
          }),
        ),
      )
      expect(response.status).toBe(200)
      const json = (yield* Effect.promise(() => response.json())) as { availableBytes?: number }
      if (json.availableBytes !== undefined) {
        expect(json.availableBytes).toBeGreaterThan(0)
      }
    }),
  )
})
