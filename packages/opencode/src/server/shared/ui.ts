import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { OneCodeExtraPath } from "@opencode-ai/core/extra-path"
import { OneScienceCodeDefaultDirectory } from "@opencode-ai/core/onescience-code-default-directory"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { Effect, Stream } from "effect"
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import * as Submission from "../submission"
import { ProxyUtil } from "../proxy-util"

const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, Uint8Array>).catch(() => null)

export const UI_UPSTREAM = new URL(process.env.ONECODE_CDN_BASE || "https://app.opencode.ai")

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https://cdn.jsdelivr.net; media-src 'self' data:; frame-src 'self' https://player.bilibili.com; connect-src * data:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

/** CDN package paths with a file extension are real assets; the rest are SPA client routes. */
export function cdnUIFile(path: string) {
  if (path === "/" || path === "") return "index.html"
  const file = path.replace(/^\//, "")
  const base = file.split("/").pop() ?? file
  if (/\.[a-z0-9]+$/i.test(base)) return file
  return "index.html"
}

export function upstreamURL(path: string) {
  if (UI_UPSTREAM.hostname === "cdn.jsdelivr.net") {
    return new URL(cdnUIFile(path), UI_UPSTREAM).toString()
  }
  return new URL(path, UI_UPSTREAM).toString()
}

export function embeddedUI() {
  if (Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI) return Promise.resolve(null)
  return embeddedUIPromise
}

type RuntimeUIConfig = {
  platformAuthRequired?: boolean
  codeDefaultDirectory?: string
  onecodeExtraPath?: string
}

function htmlRuntimeMetaTags(runtime?: RuntimeUIConfig) {
  const tags: string[] = []
  if (runtime?.codeDefaultDirectory) {
    tags.push(
      `<meta name="onescience-code-default-directory" content="${escapedHtmlAttribute(runtime.codeDefaultDirectory)}">`,
    )
  }
  if (runtime?.onecodeExtraPath) {
    tags.push(
      `<meta name="onescience-onecode-extra-path" content="${escapedHtmlAttribute(runtime.onecodeExtraPath)}">`,
    )
  }
  if (runtime?.platformAuthRequired !== undefined) {
    tags.push(
      `<meta name="onescience-platform-auth-required" content="${runtime.platformAuthRequired ? "true" : "false"}">`,
    )
  }
  return tags.join("")
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function escapedHtmlAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function embeddedUIResponse(file: string, body: Uint8Array, runtime?: RuntimeUIConfig) {
  const mime = AppFileSystem.mimeType(file)
  const metaTags = htmlRuntimeMetaTags(runtime)
  const output =
    mime.startsWith("text/html") && metaTags
      ? new TextEncoder().encode(new TextDecoder().decode(body).replace("</head>", `${metaTags}</head>`))
      : body
  const headers = new Headers({ "content-type": mime, "content-length": String(output.byteLength) })
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(output)))
    // HTML must not be cached: it pins hashed /assets/* names. Stale HTML keeps old JS/CSS
    // after rebuild and makes UI changes look "missing" on the same port.
    headers.set("cache-control", "no-store")
  } else if (file.startsWith("assets/")) {
    headers.set("cache-control", "public, max-age=31536000, immutable")
  }
  return HttpServerResponse.raw(output, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  _fs: AppFileSystem.Interface,
  embeddedWebUI: Record<string, Uint8Array>,
  runtime?: RuntimeUIConfig,
) {
  const requestFile = requestPath.replace(/^\//, "")
  const file = embeddedWebUI[requestFile] ? requestFile : embeddedWebUI["index.html"] ? "index.html" : null
  if (!file) return Effect.succeed(notFound())

  return Effect.succeed(embeddedUIResponse(file, new Uint8Array(embeddedWebUI[file]), runtime))
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: AppFileSystem.Interface; client: HttpClient.HttpClient },
) {
  return Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost")
    const path = url.pathname
    // Route the complete submission namespace before the embedded SPA fallback.
    // Preserve Host/Origin and Authorization so the submission service verifies
    // the same platform session and origin used by the browser on port 8008.
    if (path === "/intelligent-submission" || path.startsWith("/intelligent-submission/")) {
      return yield* Effect.gen(function* () {
        const service = yield* Effect.serviceOption(Submission.Service)
        const endpoint = process.env.ONECODE_SUBMISSION_URL || (service._tag === "Some" ? yield* service.value.endpoint : undefined)
        if (!endpoint) return HttpServerResponse.jsonUnsafe({ error: "智能投稿模块未初始化，请通过 OneCode 主服务访问。" }, { status: 503 })
        const upstream = new URL(endpoint)
        upstream.pathname = path
        upstream.search = url.search
        const response = yield* services.client.execute(
          HttpClientRequest.make(request.method)(upstream.toString(), {
            headers: ProxyUtil.headers(request.headers, request.headers.host ? { host: request.headers.host } : undefined),
            body: requestBody(request),
          }),
        ).pipe(
          // The workflow owns its bounded deadline. Bun's socket idle timer must
          // not cancel the entire multi-journal request while it waits for JSON.
          Effect.provideService(FetchHttpClient.RequestInit, { timeout: false } as RequestInit & { timeout: false }),
        )
        const headers = proxyResponseHeaders(response.headers)
        headers.set("cache-control", "no-store")
        return HttpServerResponse.stream(response.stream, { status: response.status, headers })
      }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.jsonUnsafe(
        { error: "智能投稿模块初始化或请求失败，请检查 OneCode 服务日志。" }, { status: 503 },
      ))))
    }
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI())

    if (embeddedWebUI)
      return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI, {
        platformAuthRequired: PlatformAuth.authRequired(),
        codeDefaultDirectory: OneScienceCodeDefaultDirectory.resolve(),
        onecodeExtraPath: OneCodeExtraPath.root(),
      })

    const response = yield* services.client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(path), {
        headers: ProxyUtil.headers(request.headers, { host: UI_UPSTREAM.host }),
        body: requestBody(request),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)
    const servedFile = UI_UPSTREAM.hostname === "cdn.jsdelivr.net" ? cdnUIFile(path) : path.replace(/^\//, "")
    const treatAsHtml =
      response.headers["content-type"]?.includes("text/html") ||
      path === "/" ||
      path.endsWith(".html") ||
      servedFile === "index.html" ||
      servedFile.endsWith(".html")

    if (treatAsHtml) {
      const body = yield* response.text
      const metaTags = htmlRuntimeMetaTags({
        platformAuthRequired: PlatformAuth.authRequired(),
        codeDefaultDirectory: OneScienceCodeDefaultDirectory.resolve(),
        onecodeExtraPath: OneCodeExtraPath.root(),
      })
      const output = metaTags ? body.replace("</head>", `${metaTags}</head>`) : body
      headers.delete("content-length")
      headers.delete("Content-Length")
      headers.set("Content-Type", "text/html; charset=utf-8")
      headers.set("Content-Security-Policy", cspForHtml(output))
      return HttpServerResponse.text(output, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
