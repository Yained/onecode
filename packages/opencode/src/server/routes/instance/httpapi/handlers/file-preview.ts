import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { FilePreviewTicket } from "@/file/preview-ticket"
import { CorsConfig, isAllowedRequestOrigin } from "@/server/cors"
import {
  FILE_PREVIEW_CSP,
  parseFilePreviewPath,
} from "@/server/shared/file-preview"
import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import path from "path"

const TicketBody = Schema.Struct({
  ticket: Schema.String,
  expires_in: Schema.Number,
})

function previewDirectory(request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  return url.searchParams.get("directory") || request.headers["x-opencode-directory"] || process.cwd()
}

function contentTypeFor(filePath: string) {
  const mime = AppFileSystem.mimeType(filePath)
  if (mime === "text/html") return "text/html; charset=utf-8"
  if (mime.startsWith("text/")) return `${mime}; charset=utf-8`
  if (mime === "application/javascript" || mime === "text/javascript" || filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8"
  }
  if (filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8"
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8"
  return mime || "application/octet-stream"
}

function htmlHeaders() {
  return {
    "Content-Security-Policy": FILE_PREVIEW_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=60",
  } as const
}

function fileHeaders(filePath: string) {
  const type = contentTypeFor(filePath)
  if (type.startsWith("text/html")) {
    return {
      "Content-Type": type,
      ...htmlHeaders(),
    }
  }
  return {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=60",
  }
}

export const filePreviewRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const tickets = yield* FilePreviewTicket.Service
    const fs = yield* AppFileSystem.Service
    const cors = yield* CorsConfig

    yield* router.add(
      "POST",
      "/file/preview/ticket",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const origin = request.headers.origin
        const host = request.headers.host
        if (origin && !isAllowedRequestOrigin(origin, host, cors)) {
          return HttpServerResponse.empty({ status: 403 })
        }
        const directory = previewDirectory(request)
        const token = yield* tickets.issue({ directory })
        return HttpServerResponse.jsonUnsafe(token satisfies typeof TicketBody.Type)
      }),
    )

    yield* router.add(
      "GET",
      "/file/preview/:ticket/*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const parsed = parseFilePreviewPath(new URL(request.url, "http://localhost").pathname)
        if (!parsed?.ticket) return HttpServerResponse.empty({ status: 404 })

        const scope = yield* tickets.peek({ ticket: parsed.ticket })
        if (!scope) return HttpServerResponse.empty({ status: 403 })

        const relative = parsed.filePath
        if (!relative) return HttpServerResponse.empty({ status: 404 })

        const full = path.resolve(scope.directory, relative)
        if (!AppFileSystem.contains(scope.directory, full)) {
          return HttpServerResponse.empty({ status: 403 })
        }

        const exists = yield* fs.existsSafe(full)
        if (!exists) return HttpServerResponse.empty({ status: 404 })

        const bytes = yield* fs.readFile(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!bytes) return HttpServerResponse.empty({ status: 404 })

        return HttpServerResponse.raw(bytes, {
          status: 200,
          headers: fileHeaders(full),
        })
      }),
    )
  }),
)
