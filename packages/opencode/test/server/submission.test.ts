import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeHttpServer } from "@effect/platform-node"
import { createServer } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Server } from "../../src/server/server"
import path from "node:path"
import * as Submission from "../../src/server/submission"

test("submission initializes once in the host PID and closes with its scope", async () => {
  await using directory = await tmpdir()
  const root = directory.path
  const previous = process.env.ONECODE_SUBMISSION_ROOT
  const marker = path.join(root, "starts")
  await mkdir(path.join(root, "server"))
  await writeFile(path.join(root, "server/gateway.mjs"), `
    import { createServer } from 'node:http';
    import { appendFileSync } from 'node:fs';
    export async function createSubmissionServer({ upstream }) {
      appendFileSync(${JSON.stringify(marker)}, 'start\\n');
      return createServer((_req, res) => res.end(JSON.stringify({ pid: process.pid, upstream })));
    }
  `)
  process.env.ONECODE_SUBMISSION_ROOT = root
  let endpoint = ""
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const service = yield* Submission.Service
      const urls = yield* Effect.all([service.endpoint, service.endpoint], { concurrency: "unbounded" })
      expect(urls[0]).toBe(urls[1])
      endpoint = urls[0]
      expect(new URL(endpoint).port).not.toBe("8010")
      const body = yield* Effect.promise(() => fetch(endpoint).then((response) => response.json()))
      expect(body.pid).toBe(process.pid)
      expect(new URL(body.upstream).hostname).toBe("127.0.0.1")
      expect(yield* Effect.promise(() => Bun.file(marker).text())).toBe("start\n")
    }).pipe(Effect.provide(Submission.layer.pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: 0, host: "127.0.0.1" })))))))
    await expect(fetch(endpoint)).rejects.toThrow()
    const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
    try {
      const response = await fetch(new URL("/intelligent-submission/", listener.url))
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.pid).toBe(process.pid)
      expect(body.upstream).toBe(`http://127.0.0.1:${listener.port}`)
    } finally {
      await listener.stop(true)
    }
  } finally {
    if (previous === undefined) delete process.env.ONECODE_SUBMISSION_ROOT
    else process.env.ONECODE_SUBMISSION_ROOT = previous
  }
})
