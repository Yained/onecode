import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ServerAuth } from "../../src/server/auth"
import { authorizationRouterMiddleware } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { cdnUIFile, serveEmbeddedUIEffect, serveUIEffect } from "../../src/server/shared/ui"
import { Server } from "../../src/server/server"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

describe("cdnUIFile", () => {
  test("maps SPA client routes to index.html and keeps asset paths", () => {
    expect(cdnUIFile("/")).toBe("index.html")
    expect(cdnUIFile("/skills")).toBe("index.html")
    expect(cdnUIFile("/code")).toBe("index.html")
    expect(cdnUIFile("/assets/app.js")).toBe("assets/app.js")
    expect(cdnUIFile("/favicon.ico")).toBe("favicon.ico")
  })
})

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      OPENCODE_DISABLE_EMBEDDED_WEB_UI: Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI,
      OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
      OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
      submissionURL: process.env.ONECODE_SUBMISSION_URL,
      envPassword: process.env.OPENCODE_SERVER_PASSWORD,
      envUsername: process.env.OPENCODE_SERVER_USERNAME,
    }

    process.env.ONECODE_SUBMISSION_URL = "http://127.0.0.1:8010"
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = original.OPENCODE_DISABLE_EMBEDDED_WEB_UI
        Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
        Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
        restoreEnv("ONECODE_SUBMISSION_URL", original.submissionURL)
        restoreEnv("OPENCODE_SERVER_PASSWORD", original.envPassword)
        restoreEnv("OPENCODE_SERVER_USERNAME", original.envUsername)
      }),
    )
  }),
)

const it = testEffect(Layer.mergeAll(testStateLayer, AppFileSystem.defaultLayer))

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input?.password,
            OPENCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            ExperimentalHttpApiServer.context,
          ),
        ),
      )
    },
  }
}

function uiApp(input?: { password?: string; username?: string; client?: Layer.Layer<HttpClient.HttpClient> }) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        yield* router.add("*", "/*", (request) => serveUIEffect(request, { fs, client }))
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
      Layer.provide([
        AppFileSystem.defaultLayer,
        input?.client ?? httpClient(new Response("ui")),
        HttpServer.layerServices,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            OPENCODE_SERVER_PASSWORD: input?.password,
            OPENCODE_SERVER_USERNAME: input?.username,
          }),
        ),
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise(() =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            ExperimentalHttpApiServer.context,
          ),
        ),
      )
    },
  }
}

function httpClient(response: Response, onRequest?: (request: HttpClientRequest.HttpClientRequest) => void) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      onRequest?.(request)
      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )
}

function responseText(response: Response) {
  return Effect.promise(() => response.text())
}

describe("HttpApi UI fallback", () => {
  it.live("serves the web UI through the experimental backend", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true
      let proxiedUrl: string | undefined

      const response = yield* uiApp({
        client: httpClient(
          new Response("<html>opencode</html>", { headers: { "content-type": "text/html" } }),
          (request) => {
            proxiedUrl = request.url
          },
        ),
      }).request("/")

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/html")
      expect(yield* responseText(response)).toBe("<html>opencode</html>")
      expect(proxiedUrl).toBe("https://app.opencode.ai/")
    }),
  )

  it.live("strips upstream transfer encoding headers from proxied assets", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true
      let proxiedUrl: string | undefined

      const response = yield* Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/assets/app.js")), {
          fs,
          client,
        })
      }).pipe(
        Effect.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              proxiedUrl = request.url
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("console.log('ok')", {
                    headers: {
                      "content-encoding": "br",
                      "content-length": "999",
                      "content-type": "text/javascript",
                    },
                  }),
                ),
              )
            }),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(proxiedUrl).toBe("https://app.opencode.ai/assets/app.js")
      expect(response.headers.get("content-encoding")).toBeNull()
      expect(response.headers.get("content-length")).not.toBe("999")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('ok')")
    }),
  )

  // Regression for #25698 (Ope): upstream `transfer-encoding: chunked` was
  // forwarded through the proxy while the proxy itself re-frames the body,
  // causing browsers to fail with `ERR_INVALID_CHUNKED_ENCODING`.
  it.live("strips upstream transfer-encoding header from proxied assets", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        return yield* serveUIEffect(HttpServerRequest.fromWeb(new Request("http://localhost/")), {
          fs,
          client,
        })
      }).pipe(
        Effect.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response("<html>opencode</html>", {
                    headers: {
                      "transfer-encoding": "chunked",
                      "content-type": "text/html",
                    },
                  }),
                ),
              ),
            ),
          ),
        ),
        Effect.map(HttpServerResponse.toWeb),
      )

      expect(response.status).toBe(200)
      expect(response.headers.get("transfer-encoding")).toBeNull()
      expect(yield* responseText(response)).toBe("<html>opencode</html>")
    }),
  )

  it.live("serves embedded UI assets from compiled bytes", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
        "/assets/app.js",
        {
          ...fs,
          existsSafe: () => Effect.die("embedded UI should not rely on filesystem access checks"),
          readFile: () => Effect.die("embedded UI should not read compiled bytes from filesystem paths"),
        },
        { "assets/app.js": new TextEncoder().encode("console.log('embedded')") },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('embedded')")
    }),
  )

  it.live("allows embedded UI terminal wasm and theme preload CSP", () =>
    Effect.gen(function* () {
      const script = 'document.documentElement.dataset.theme = "dark"'

      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
        "/",
        {
          ...fs,
          readFile: () => Effect.die("embedded UI should not read compiled bytes from filesystem paths"),
        },
        {
          "index.html": new TextEncoder().encode(
            `<html><head><script id="oc-theme-preload-script">${script}</script></head></html>`,
          ),
        },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      const csp = response.headers.get("content-security-policy") ?? ""
      expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'")
      expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`)
      expect(csp).toContain("frame-src 'self' https://player.bilibili.com")
      expect(csp).toContain("connect-src * data:")
    }),
  )

  it.live("injects configurable OneScience runtime metadata into embedded HTML", () =>
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
        "/",
        {
          ...fs,
          readFile: () => Effect.die("embedded UI should not read compiled bytes from filesystem paths"),
        },
        {
          "index.html": new TextEncoder().encode("<html><head><title>OneScience</title></head><body></body></html>"),
        },
        { codeDefaultDirectory: "/data/app/onescience", onecodeExtraPath: "/data/hanmk/privated_data" },
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      const html = yield* responseText(response)
      expect(html).toContain(
        '<meta name="onescience-code-default-directory" content="/data/app/onescience">',
      )
      expect(html).toContain(
        '<meta name="onescience-onecode-extra-path" content="/data/hanmk/privated_data">',
      )
      expect(html).not.toContain('name="onescience-auth-required"')
    }),
  )

  it.live("keeps matched API routes ahead of the UI fallback", () =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() => Promise.resolve(Server.Default().app.request("/session/ses_nope")))

      expect(response.status).toBe(404)
    }),
  )

  it.live("serves the home page without auth when a server password is set", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({
        password: "secret",
        username: "opencode",
        client: httpClient(new Response("<html>home</html>", { headers: { "content-type": "text/html" } })),
      }).request("/")

      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe("<html>home</html>")
    }),
  )

  it.live("requires server password for protected UI routes", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({ password: "secret", username: "opencode" }).request("/session")

      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBeNull()
    }),
  )

  it.live("serves app shell routes without auth when a server password is set", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      for (const path of ["/auth", "/home", "/code", "/code/L3Jvb3Qvb3BlbmNvZGUvb25lY29kZQ/session", "/datasets"]) {
        const response = yield* uiApp({
          password: "secret",
          username: "opencode",
          client: httpClient(new Response("<html>app</html>", { headers: { "content-type": "text/html" } })),
        }).request(path)

        expect(response.status).toBe(200)
        expect(yield* responseText(response)).toBe("<html>app</html>")
      }
    }),
  )

  it.live("accepts auth token for the web UI", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({
        password: "secret",
        username: "opencode",
        client: httpClient(new Response("<html>opencode</html>", { headers: { "content-type": "text/html" } })),
      }).request(`/?auth_token=${btoa("opencode:secret")}`)

      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe("<html>opencode</html>")
    }),
  )

  it.live("accepts basic auth for the web UI", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      const response = yield* uiApp({ password: "secret", username: "opencode" }).request("/", {
        headers: { authorization: `Basic ${btoa("opencode:secret")}` },
      })

      expect(response.status).toBe(200)
    }),
  )

  // Regression for #25698 (Ope): the browser fetches the PWA manifest and
  // its icons via flows that don't carry app-managed credentials (the
  // `<link rel="manifest">` request is not under page-auth control), so the
  // server returning 401 breaks PWA install. These specific public assets
  // should bypass auth.
  it.live("serves public browser assets without auth even when a server password is set", () =>
    Effect.gen(function* () {
      Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI = true

      for (const path of [
        "/assets/app.js",
        "/favicon.svg",
        "/favicon.ico",
        "/favicon-v3.svg",
        "/favicon-v3.ico",
        "/favicon-96x96.png",
        "/favicon-96x96-v3.png",
        "/apple-touch-icon.png",
        "/apple-touch-icon-v3.png",
        "/site.webmanifest",
        "/web-app-manifest-192x192.png",
        "/web-app-manifest-512x512.png",
      ]) {
        const response = yield* uiApp({
          password: "secret",
          username: "opencode",
          client: httpClient(new Response("ok")),
        }).request(path)
        expect(response.status).not.toBe(401)
      }
    }),
  )

  it.live("allows web UI preflight without auth", () =>
    Effect.gen(function* () {
      const response = yield* app({ password: "secret", username: "opencode" }).request("/", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    }),
  )
})


describe("intelligent submission routing", () => {
  it.live("forwards submission API requests without falling back to the platform HTML", () =>
    Effect.gen(function* () {
      let proxied: HttpClientRequest.HttpClientRequest | undefined
      const response = yield* uiApp({
        password: "test-secret", username: "opencode",
        client: httpClient(new Response("[]", { headers: { "content-type": "application/json" } }), (request) => { proxied = request }),
      }).request("/intelligent-submission/api/projects?limit=5", { headers: { authorization: `Basic ${btoa("opencode:test-secret")}`, host: "platform.test:8008" } })
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("application/json")
      expect(yield* responseText(response)).toBe("[]")
      expect(proxied?.url).toBe("http://127.0.0.1:8010/intelligent-submission/api/projects?limit=5")
      expect(proxied?.headers.authorization).toBe(`Basic ${btoa("opencode:test-secret")}`)
      expect(proxied?.headers.host).toBe("platform.test:8008")
    }),
  )
  it.live("keeps long submission requests alive while preserving workflow cancellation", () =>
    Effect.gen(function* () {
      const client = Layer.succeed(HttpClient.HttpClient, HttpClient.make((request, _url, signal, fiber) =>
        Effect.gen(function* () {
          const options = fiber.context.mapUnsafe.get(FetchHttpClient.RequestInit.key)
          expect((options as RequestInit & { timeout?: boolean }).timeout).toBe(false)
          expect(signal).toBeInstanceOf(AbortSignal)
          yield* Effect.sleep("20 millis")
          return HttpClientResponse.fromWeb(request, new Response('{"done":true}'))
        }),
      ))
      const response = yield* uiApp({ client }).request("/intelligent-submission/api/projects/test/review-flow", { method: "POST", body: "{}" })
      expect(response.status).toBe(200)
      expect(yield* responseText(response)).toBe('{"done":true}')
    }),
  )
  it.live("allows frame and static assets while protecting submission project APIs", () =>
    Effect.gen(function* () {
      const server = uiApp({ password: "test-secret", client: httpClient(new Response("submission", { headers: { "content-type": "text/html" } })) })
      expect((yield* server.request("/intelligent-submission/?embed=1")).status).toBe(200)
      expect((yield* server.request("/intelligent-submission/assets/app.js")).status).toBe(200)
      expect((yield* server.request("/intelligent-submission/api/projects")).status).toBe(401)
      expect((yield* server.request("/intelligent-submission/api/projects", { method: "POST" })).status).toBe(401)
    }),
  )
  it.live("forwards multipart uploads with their origin and content type", () =>
    Effect.gen(function* () {
      let proxied: HttpClientRequest.HttpClientRequest | undefined
      const response = yield* uiApp({
        client: httpClient(new Response("{}", { status: 201, headers: { "content-type": "application/json" } }), (request) => { proxied = request }),
      }).request("/intelligent-submission/api/analyze", {
        method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", origin: "http://platform.test:8008", host: "platform.test:8008" }, body: "--test--",
      })
      expect(response.status).toBe(201)
      expect(proxied?.method).toBe("POST")
      expect(proxied?.headers.origin).toBe("http://platform.test:8008")
      expect(proxied?.headers["content-type"]).toBe("multipart/form-data; boundary=test")
      expect(proxied?.body._tag).toBe("Stream")
    }),
  )
})
