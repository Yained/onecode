import { getAdapter } from "@/control-plane/adapters"
import { WorkspaceID } from "@/control-plane/schema"
import type { Target } from "@/control-plane/types"
import { Workspace } from "@/control-plane/workspace"
import { EffectBridge } from "@/effect/bridge"
import { Session } from "@/session/session"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { HttpApiProxy } from "./proxy"
import * as Fence from "@/server/shared/fence"
import { isLocalWorkspaceRoute, isSessionTranscriptReadRoute, stampLeafDirectoryOnProxyURL, workspaceProxyURL } from "@/server/shared/workspace-routing"
import { canAccessRemoteWorkspace, extraAccountId } from "@/server/shared/remote-workspace-access"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Data, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiMiddleware } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"

// Query fields this middleware reads from the URL. Spread into every
// endpoint query schema in groups that apply WorkspaceRoutingMiddleware,
// otherwise HttpApi rejects requests carrying these params with 400.
// HttpApiMiddleware in effect-smol cannot declare query params today —
// remove this once upstream supports middleware-declared query schemas.
export const WorkspaceRoutingQueryFields = {
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
}

export const WorkspaceRoutingQuery = Schema.Struct(WorkspaceRoutingQueryFields)

type RemoteTarget = Extract<Target, { type: "remote" }>

type RequestPlan = Data.TaggedEnum<{
  MissingWorkspace: { readonly workspaceID: WorkspaceID }
  Forbidden: { readonly message: string }
  Local: { readonly directory: string; readonly workspaceID?: WorkspaceID }
  Remote: {
    readonly request: HttpServerRequest.HttpServerRequest
    readonly workspace: Workspace.Info
    readonly target: RemoteTarget
    readonly url: URL
    readonly fallbackDirectory?: string
  }
}>
const RequestPlan = Data.taggedEnum<RequestPlan>()

export class WorkspaceRouteContext extends Context.Service<
  WorkspaceRouteContext,
  {
    readonly directory: string
    readonly workspaceID?: WorkspaceID
  }
>()("@opencode/ExperimentalHttpApiWorkspaceRouteContext") {}

export class WorkspaceRoutingMiddleware extends HttpApiMiddleware.Service<
  WorkspaceRoutingMiddleware,
  {
    provides: WorkspaceRouteContext
    requires: Session.Service
  }
>()("@opencode/ExperimentalHttpApiWorkspaceRouting") {}

function requestURL(request: HttpServerRequest.HttpServerRequest): URL {
  return new URL(request.url, "http://localhost")
}

function configuredWorkspaceID(): WorkspaceID | undefined {
  return Flag.OPENCODE_WORKSPACE_ID ? WorkspaceID.make(Flag.OPENCODE_WORKSPACE_ID) : undefined
}

function requestWorkspaceID(request: HttpServerRequest.HttpServerRequest, url: URL): WorkspaceID | undefined {
  const header = request.headers["x-opencode-workspace"]
  const raw = url.searchParams.get("workspace") || (typeof header === "string" ? header : undefined)
  if (!raw?.trim() || !raw.startsWith("wrk")) return
  try {
    return WorkspaceID.make(raw)
  } catch {
    return
  }
}

function selectedWorkspaceID(url: URL, request: HttpServerRequest.HttpServerRequest): WorkspaceID | undefined {
  // Only the live client bind (header/query) may select a leaf.
  // Never fall back to session.workspace_id: after disconnect / cache-clear that
  // retunneled ≤60s on /session/status and froze HTTP/1.1.
  // Never invent a leaf from leftover "connected" rows either — see planRequest.
  return requestWorkspaceID(request, url)
}

/** Browser SDK sets `x-opencode-directory` to encodeURIComponent(path). Decode before resolve. */
function decodeDirectoryParam(value: string | undefined): string | undefined {
  if (!value?.trim()) return
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function requestedDirectory(request: HttpServerRequest.HttpServerRequest, url: URL): string | undefined {
  // Query is normally already decoded by URLSearchParams; header often arrives still encoded.
  return (
    decodeDirectoryParam(url.searchParams.get("directory") ?? undefined) ||
    decodeDirectoryParam(request.headers["x-opencode-directory"])
  )
}

function defaultDirectory(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  session?: PlatformAuth.AuthSession,
): string | undefined {
  return PlatformAuth.resolveDirectoryForSession(session, requestedDirectory(request, url))
}

function shouldStayOnControlPlane(request: HttpServerRequest.HttpServerRequest, url: URL): boolean {
  return isLocalWorkspaceRoute(request.method, url.pathname) || url.pathname.startsWith("/console")
}

function resolveWorkspace(
  id: WorkspaceID | undefined,
  envWorkspaceID: WorkspaceID | undefined,
): Effect.Effect<Workspace.Info | void, never, Workspace.Service> {
  if (!id || envWorkspaceID) return Effect.void
  return Workspace.Service.use((workspace) => workspace.get(id))
}

function missingWorkspaceResponse(id: WorkspaceID): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.text(`Workspace not found: ${id}`, {
    status: 500,
    contentType: "text/plain; charset=utf-8",
  })
}

function forbiddenResponse(message: string): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.text(message, {
    status: 403,
    contentType: "text/plain; charset=utf-8",
  })
}

function resolveTarget(workspace: Workspace.Info, opts?: { create?: boolean; reconnect?: boolean }): Effect.Effect<Target> {
  const adapter = getAdapter(workspace.projectID, workspace.type)
  return EffectBridge.fromPromise(() => adapter.target(workspace, opts))
}

const log = Log.create({ service: "workspace-routing" })

function proxyRemote(
  client: HttpClient.HttpClient,
  request: HttpServerRequest.HttpServerRequest,
  workspace: Workspace.Info,
  target: RemoteTarget,
  url: URL,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, Socket.WebSocketConstructor | Workspace.Service> {
  return Effect.gen(function* () {
    const syncing = yield* Workspace.Service.use((svc) => svc.isSyncing(workspace.id))
    if (!syncing) {
      // The tunnel/leaf can still be up after SSE/history marked the
      // listener unhealthy. 503 here blanks send ("无法获取会话") while
      // the UI already shows 已连接.
      log.warn("proxying remote workspace without an active sync fiber", {
        workspaceID: workspace.id,
        path: url.pathname,
      })
    }
    const proxyURL = stampLeafDirectoryOnProxyURL(workspaceProxyURL(target.url, url), target.headers)
    const headers = request.headers as Record<string, string>
    if (headers["upgrade"]?.toLowerCase() === "websocket") return yield* HttpApiProxy.websocket(request, proxyURL)
    const response = yield* HttpApiProxy.http(client, proxyURL, target.headers, request)
    const sync = Fence.parse(new Headers(response.headers))
    if (sync) {
      // The leaf already applied the mutation. Do not turn a 2xx into 503 just
      // because this control plane has not caught up — that blanks the timeline.
      // Do not block the HTTP response either: after a fresh SSH connect, A's
      // event sequence often lags the leaf, so waitForSync sat on TIMEOUT
      // (5s) and the composer looked dead until the fence gave up.
      yield* Fence.waitEffect(workspace.id, sync).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            log.warn("sync fence wait failed", {
              workspaceID: workspace.id,
              error: error instanceof Error ? error.message : String(error),
            })
          }),
        ),
        Effect.forkDetach,
      )
    }
    return response
  })
}

function planWorkspaceRequest(
  request: HttpServerRequest.HttpServerRequest,
  url: URL,
  workspace: Workspace.Info,
  session?: PlatformAuth.AuthSession,
): Effect.Effect<RequestPlan, never, Workspace.Service> {
  return Effect.gen(function* () {
    const transcript = isSessionTranscriptReadRoute(request.method, url.pathname)
    // Never spawn a second leaf from a chat/tool request. Connect is the only
    // path that should call adapter.create; a dead tunnel must surface so the
    // user reconnects instead of leaving 127.0.0.1 leftovers.
    // Always reconnect:false — any probe (status/agent/file, not only transcript)
    // with a dead tunnel used to retunnel ≤60s and freeze cache-clear F5 / first
    // remote-session click on HTTP/1.1.
    const target = yield* resolveTarget(workspace, { create: false, reconnect: false }).pipe(
      Effect.catch(() => Effect.succeed(undefined as Target | undefined)),
    )
    if (!target) {
      const localDir = requestedDirectory(request, url) ?? defaultDirectory(request, url, session)
      // Dead tunnel: never retunnel. Transcripts may read A's copy so cache-clear /
      // 未连接 still paints the timeline. /file must not fall back — that lists A's
      // identity folder and makes first-connect waitForWorkspaceFileList a false OK.
      const readFallback = !!localDir && transcript
      if (readFallback) {
        return RequestPlan.Local({ directory: localDir, workspaceID: undefined })
      }
      return RequestPlan.MissingWorkspace({ workspaceID: workspace.id })
    }
    if (target.type === "remote") {
      const localDir = requestedDirectory(request, url)
      if (
        !canAccessRemoteWorkspace({
          sessionAccountId: session?.account.id,
          platformWorkspaceIds: session?.workspaces.map((item) => item.id),
          workspaceId: workspace.id,
          extraAccountId: extraAccountId(workspace.extra),
          localDirectoryAllowed: Boolean(localDir && PlatformAuth.canAccessPath(session, localDir)),
        })
      ) {
        return RequestPlan.Forbidden({ message: "Workspace routing is not available for this account" })
      }
      return RequestPlan.Remote({
        request,
        workspace,
        target,
        url,
        fallbackDirectory: localDir ?? defaultDirectory(request, url, session),
      })
    }
    if (!PlatformAuth.canAccessPath(session, target.directory)) {
      return RequestPlan.Forbidden({ message: "Directory is outside the current account workspace" })
    }
    return RequestPlan.Local({ directory: target.directory, workspaceID: workspace.id })
  })
}

function planRequest(request: HttpServerRequest.HttpServerRequest): Effect.Effect<RequestPlan, never, Workspace.Service> {
  return Effect.gen(function* () {
    const url = requestURL(request)
    const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
    const envWorkspaceID = configuredWorkspaceID()
    let workspaceID = selectedWorkspaceID(url, request)
    const workspace = yield* resolveWorkspace(workspaceID, envWorkspaceID)

    if (workspaceID && workspace === undefined && !envWorkspaceID) {
      // Leaf sqlite has no control-plane workspace rows; a stale client
      // pointer should not 500 every session GET/POST (that blanks the timeline).
      workspaceID = undefined
    }

    // Intentionally no leftover-live steal when the client omits x-opencode-workspace.
    // After cache-clear / 未连接, adopting a leftover "connected" ssh-node for
    // /session/status|/agent|/file (or transcript) either retunneled/froze HTTP/1.1
    // or returned an empty leaf copy and blanked the timeline. Connected clients
    // always send the header; unbound traffic stays on the control plane until 连接.

    if (workspace !== undefined && !envWorkspaceID && !shouldStayOnControlPlane(request, url)) {
      return yield* planWorkspaceRequest(request, url, workspace, current?.session)
    }

    const directory = defaultDirectory(request, url, current?.session)
    if (!directory) return RequestPlan.Forbidden({ message: "Directory is outside the current account workspace" })
    // Local routes run on this process. Do not inherit the client's remote
    // workspace binding — that stamps Session.workspace_id without replaying
    // the session onto the leaf, so later prompt_async 404s on B.
    return RequestPlan.Local({ directory, workspaceID: envWorkspaceID })
  })
}

function routeWorkspace<E>(
  client: HttpClient.HttpClient,
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
  plan: RequestPlan,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, Socket.WebSocketConstructor | Workspace.Service> {
  return RequestPlan.$match(plan, {
    MissingWorkspace: ({ workspaceID }) => Effect.succeed(missingWorkspaceResponse(workspaceID)),
    Forbidden: ({ message }) => Effect.succeed(forbiddenResponse(message)),
    Remote: ({ request, workspace, target, url, fallbackDirectory }) =>
      Effect.gen(function* () {
        const response = yield* proxyRemote(client, request, workspace, target, url)
        if (
          !fallbackDirectory ||
          !isSessionTranscriptReadRoute(request.method, url.pathname) ||
          (response.status < 500 && response.status !== 404)
        ) {
          return response
        }
        // Leaf sqlite is the live copy, but the control plane already replays
        // the same events over SSE. When the tunnel is down the UI must still
        // be able to read that local copy — otherwise a finished remote task
        // vanishes until the user reconnects.
        log.warn("serving control-plane transcript after leaf read failed", {
          workspaceID: workspace.id,
          path: url.pathname,
          status: response.status,
        })
        return yield* effect.pipe(
          Effect.provideService(
            WorkspaceRouteContext,
            WorkspaceRouteContext.of({ directory: fallbackDirectory, workspaceID: undefined }),
          ),
        )
      }),
    Local: ({ directory, workspaceID }) =>
      effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory, workspaceID }))),
  })
}

function routeHttpApiWorkspace<E>(
  client: HttpClient.HttpClient,
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, WorkspaceRouteContext>,
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  E,
  Workspace.Service | HttpServerRequest.HttpServerRequest | Socket.WebSocketConstructor
> {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const plan = yield* planRequest(request)
    return yield* routeWorkspace(client, effect, plan)
  })
}

export const workspaceRoutingLayer = Layer.effect(
  WorkspaceRoutingMiddleware,
  Effect.gen(function* () {
    const makeWebSocket = yield* Socket.WebSocketConstructor
    const workspace = yield* Workspace.Service
    const client = yield* HttpClient.HttpClient
    return WorkspaceRoutingMiddleware.of((effect) =>
      routeHttpApiWorkspace(client, effect).pipe(
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket),
        Effect.provideService(Workspace.Service, workspace),
      ),
    )
  }),
)

export const workspaceRouterMiddleware = HttpRouter.middleware<{ provides: WorkspaceRouteContext }>()(
  Effect.gen(function* () {
    const makeWebSocket = yield* Socket.WebSocketConstructor
    const workspace = yield* Workspace.Service
    const client = yield* HttpClient.HttpClient
    return (effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const plan = yield* planRequest(request)
        return yield* routeWorkspace(client, effect, plan)
      }).pipe(
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket),
        Effect.provideService(Workspace.Service, workspace),
      )
  }),
)
