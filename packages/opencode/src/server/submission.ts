import { Context, Effect, Layer, Scope } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { HttpServer } from "effect/unstable/http"
import { existsSync } from "node:fs"
import type { Server } from "node:http"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { configureSubmissionEnvironment } from "./submission-env"

const log = Log.create({ service: "submission" })

export class Service extends Context.Service<Service, {
  readonly endpoint: Effect.Effect<string, Error>
}>()("@onecode/Submission") {}

// Keep package assets, Python tools and account storage at their existing paths.
// Dynamic import also lets the compiled binary use the installed workspace module.
export function modulePath() {
  const configured = process.env.ONECODE_SUBMISSION_ROOT
  const roots = configured ? [configured] : [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../intelligent-submission"),
    path.resolve(path.dirname(process.execPath), "../../../../intelligent-submission"),
    ...(process.env.ONECODE_ROOT ? [path.join(process.env.ONECODE_ROOT, "packages/intelligent-submission")] : []),
  ]
  const entry = roots.map((root) => path.join(root, "server/gateway.mjs")).find(existsSync)
  if (!entry) throw new Error("智能投稿模块未安装，请设置 ONECODE_SUBMISSION_ROOT 为 packages/intelligent-submission 目录。")
  return entry
}

export async function start(upstream: string) {
  const entry = pathToFileURL(modulePath()).href
  configureSubmissionEnvironment()
  const module: { createSubmissionServer(options: { upstream: string }): Promise<Server> } = await import(entry)
  const server = await module.createSubmissionServer({ upstream })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("智能投稿模块未能初始化")
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}

export const layer = Layer.effect(Service)(Effect.gen(function* () {
  const host = yield* HttpServer.HttpServer
  const scope = yield* Effect.scope
  if (host.address._tag !== "TcpAddress") return yield* Effect.die(new Error("Submission requires a TCP listener"))
  const address = host.address
  const hostname = address.hostname === "0.0.0.0" ? "127.0.0.1" : address.hostname === "::" ? "[::1]" : address.hostname.includes(":") ? `[${address.hostname}]` : address.hostname
  const upstream = `http://${hostname}:${address.port}`
  // One initialization per host listener. No child process and no fixed 8010 port.
  const endpoint = yield* Effect.cached(Effect.gen(function* () {
    const server = yield* Effect.acquireRelease(
      Effect.tryPromise({ try: () => start(upstream), catch: (error) => error instanceof Error ? error : new Error(String(error)) }),
      (server) => Effect.promise(server.close),
    ).pipe(
      Scope.provide(scope),
      Effect.tapError((error) => Effect.sync(() => log.error("initialization failed", { message: error.message }))),
    )
    return server.endpoint
  }))
  return Service.of({ endpoint })
}))

export * as Submission from "./submission"
