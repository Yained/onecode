import { ServerAuth } from "@/server/auth"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { verifyCatalogToken } from "@/onescience/catalog-token"
import { Effect, Encoding, Layer, Redacted, Types } from "effect"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiError, HttpApiMiddleware } from "effect/unstable/httpapi"
import { hasFilePreviewTicketPath } from "@/server/shared/file-preview"
import { hasPtyConnectTicketURL } from "@/server/shared/pty-ticket"
import { isPublicUIPath } from "@/server/shared/public-ui"
import { Flag } from "@opencode-ai/core/flag/flag"

const AUTH_TOKEN_QUERY = "auth_token"
const PLATFORM_AUTH_TOKEN_HEADER = "x-platform-auth-token"
const UNAUTHORIZED = 401

// Avoid HttpApiSecurity alternatives here: Effect security middleware wraps the
// full handler, so a downstream failure can make the next auth alternative run
// and remap an authorized NotFound into Unauthorized.
export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  {
    provides: PlatformAuth.CurrentSession
  }
>()(
  "@opencode/ExperimentalHttpApiAuthorization",
  {
    error: HttpApiError.UnauthorizedNoContent,
  },
) {}

function emptyCredential() {
  return {
    username: "",
    password: Redacted.make(""),
  }
}

function provideCurrentSession<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  auth: PlatformAuth.CurrentSessionInfo,
): Effect.Effect<A, E, Exclude<R, PlatformAuth.CurrentSession>> {
  return effect.pipe(Effect.provideService(PlatformAuth.CurrentSession)(PlatformAuth.CurrentSession.of(auth)))
}

function platformAuthToken(
  request: HttpServerRequest.HttpServerRequest,
  credential: ServerAuth.DecodedCredentials,
) {
  return request.headers[PLATFORM_AUTH_TOKEN_HEADER] ?? Redacted.value(credential.password)
}

export function isPublicHealthPath(method: string, pathname: string) {
  return method === "GET" && (pathname === "/global/health" || pathname === "/health")
}

function isCatalogAlreadyIngestPath(method: string, pathname: string) {
  return method === "POST" && (
    pathname === "/experimental/onescience/already" ||
    pathname === "/experimental/onescience/already/scan"
  )
}

function bearerToken(request: HttpServerRequest.HttpServerRequest) {
  const match = /^Bearer\s+(\S+)/i.exec(request.headers.authorization ?? "")
  return match?.[1]
}

function publicPlatformAuthPath(method: string, pathname: string) {
  if (method === "POST" && (pathname === "/platform/auth/login" || pathname === "/platform/auth/register")) return true
  if (method === "POST" && pathname === "/platform/auth/provision") return true
  if (method === "POST" && pathname === "/platform/auth/register/email-code") return true
  if (method === "POST" && (pathname === "/platform/auth/password-reset/request" || pathname === "/platform/auth/password-reset/confirm")) return true
  // Register/forgot-password pages need this gate before login (SMTP / invite flags).
  if (method === "GET" && pathname === "/global/onescience-preset/registration") return true
  return method === "GET" && pathname === "/platform/auth/session"
}

function terminalRestrictedPath(method: string, pathname: string) {
  if (pathname.startsWith("/pty")) return true
  return method === "POST" && /\/session\/[^/]+\/shell$/.test(pathname)
}

function authenticate(
  request: HttpServerRequest.HttpServerRequest,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
) {
  // Always resolve platform session from the token header/password so tenant
  // config isolation works even when Basic auth matches server-admin credentials.
  const session = PlatformAuth.resolveSessionToken(platformAuthToken(request, credential))
  // Leaf serve is only reached through A's SSH tunnel. A strips the platform
  // token so B does not inherit control-plane isolation; do not require login.
  if (Flag.OPENCODE_WORKSPACE_ID) {
    if (ServerAuth.required(config) && !ServerAuth.authorized(credential, config)) {
      return { authorized: false as const }
    }
    return { authorized: true as const, ...(session ? { session } : {}) }
  }
  if (ServerAuth.required(config) && ServerAuth.authorized(credential, config)) {
    return { authorized: true as const, serverAdmin: true as const, ...(session ? { session } : {}) }
  }

  if (session) return { authorized: true as const, session }
  if (PlatformAuth.authRequired()) return { authorized: false as const }
  if (ServerAuth.required(config)) return { authorized: false as const }
  return { authorized: true as const }
}

function validateCredential<E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  request: HttpServerRequest.HttpServerRequest,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E | HttpApiError.Unauthorized,
  Exclude<R, PlatformAuth.CurrentSession>
> {
  const auth = authenticate(request, credential, config)
  if (!auth.authorized) return Effect.fail(new HttpApiError.Unauthorized({}))
  const url = new URL(request.url, "http://localhost")
  if (auth.session && terminalRestrictedPath(request.method, url.pathname) && !PlatformAuth.canUseTerminal(auth.session)) {
    return Effect.succeed(HttpServerResponse.empty({ status: 403 }))
  }
  return provideCurrentSession(effect, auth)
}

function rawTokenCredential(input: string, username: string) {
  return {
    username,
    password: Redacted.make(input),
  }
}

function decodeCredential(input: string, rawUsername?: string) {
  return Encoding.decodeBase64String(input)
    .asEffect()
    .pipe(
      Effect.match({
        onFailure: () => rawUsername === undefined ? emptyCredential() : rawTokenCredential(input, rawUsername),
        onSuccess: (header) => {
          const parts = header.split(":")
          if (parts.length !== 2) return rawUsername === undefined ? emptyCredential() : rawTokenCredential(input, rawUsername)
          return {
            username: parts[0],
            password: Redacted.make(parts[1]),
          }
        },
      }),
    )
}

function credentialFromRequest(request: HttpServerRequest.HttpServerRequest, config: ServerAuth.Info) {
  return credentialFromURL(new URL(request.url, "http://localhost"), request, config)
}

function credentialFromURL(url: URL, request: HttpServerRequest.HttpServerRequest, config: ServerAuth.Info) {
  const token = url.searchParams.get(AUTH_TOKEN_QUERY)
  if (token) return decodeCredential(token, config.username)
  const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
  if (match) return decodeCredential(match[1])
  return Effect.succeed(emptyCredential())
}

function validateRawCredential<E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  request: HttpServerRequest.HttpServerRequest,
  credential: ServerAuth.DecodedCredentials,
  config: ServerAuth.Info,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, Exclude<R, PlatformAuth.CurrentSession>> {
  const auth = authenticate(request, credential, config)
  if (!auth.authorized) {
    return Effect.succeed(
      HttpServerResponse.empty({
        status: UNAUTHORIZED,
      }),
    )
  }
  const url = new URL(request.url, "http://localhost")
  if (auth.session && terminalRestrictedPath(request.method, url.pathname) && !PlatformAuth.canUseTerminal(auth.session)) {
    return Effect.succeed(HttpServerResponse.empty({ status: 403 }))
  }
  return provideCurrentSession(effect, auth)
}

function authorizeHttpApi(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, PlatformAuth.CurrentSession>,
  request: HttpServerRequest.HttpServerRequest,
  config: ServerAuth.Info,
): Effect.Effect<HttpServerResponse.HttpServerResponse, HttpApiError.Unauthorized | Types.unhandled, never> {
  const url = new URL(request.url, "http://localhost")
  if (isPublicHealthPath(request.method, url.pathname)) return provideCurrentSession(effect, {})
  if (publicPlatformAuthPath(request.method, url.pathname)) return provideCurrentSession(effect, {})
  if (isCatalogAlreadyIngestPath(request.method, url.pathname)) {
    const token = bearerToken(request)
    if (token) {
      const claims = verifyCatalogToken(token)
      if (!claims) return Effect.fail(new HttpApiError.Unauthorized({}))
      return provideCurrentSession(effect, { catalogToken: claims })
    }
  }
  return Effect.flatMap(credentialFromRequest(request, config), (credential) =>
    validateCredential(effect, request, credential, config),
  )
}

function authorizeRouter(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, PlatformAuth.CurrentSession>,
  request: HttpServerRequest.HttpServerRequest,
  config: ServerAuth.Info,
): Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled, never> {
  const url = new URL(request.url, "http://localhost")
  if (isPublicUIPath(request.method, url.pathname)) return provideCurrentSession(effect, {})
  if (isPublicHealthPath(request.method, url.pathname)) return provideCurrentSession(effect, {})
  if (publicPlatformAuthPath(request.method, url.pathname)) return provideCurrentSession(effect, {})
  if (hasPtyConnectTicketURL(url)) return provideCurrentSession(effect, {})
  if (hasFilePreviewTicketPath(request.method, url.pathname)) return provideCurrentSession(effect, {})
  return Effect.flatMap(credentialFromURL(url, request, config), (credential) =>
    validateRawCredential(effect, request, credential, config),
  )
}

export const authorizationRouterMiddleware = HttpRouter.middleware<{ provides: PlatformAuth.CurrentSession }>()(
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config

    return (effect) =>
      Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) =>
        authorizeRouter(effect, request, config),
      )
  }),
)

export const authorizationLayer = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const config = yield* ServerAuth.Config
    return Authorization.of((effect) =>
      Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) =>
        authorizeHttpApi(effect, request, config),
      ),
    )
  }),
)
