import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { PtyTicket } from "@/pty/ticket"
import { handlePtyInput } from "@/pty/input"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import * as TerminalSandbox from "@/platform-auth/terminal-sandbox"
import { EffectBridge } from "@/effect/bridge"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CorsConfig, isAllowedRequestOrigin, type CorsOptions } from "@/server/cors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
} from "@/server/shared/pty-ticket"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { InstanceHttpApi } from "../api"
import * as ApiError from "../errors"
import { CursorQuery, Params, PtyPaths } from "../groups/pty"
import { WebSocketTracker } from "../websocket-tracker"

function validOrigin(request: HttpServerRequest.HttpServerRequest, opts: CorsOptions | undefined) {
  // Leaf serves are only reached through A's SSH tunnel. The browser Origin is A's
  // public URL while Host is 127.0.0.1, so same-origin / CORS checks always fail.
  if (Flag.OPENCODE_WORKSPACE_ID) return true
  return isAllowedRequestOrigin(request.headers.origin, request.headers.host, opts)
}

export const ptyHandlers = HttpApiBuilder.group(InstanceHttpApi, "pty", (handlers) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig

    const shells = Effect.fn("PtyHttpApi.shells")(function* () {
      if (Flag.OPENCODE_WORKSPACE_ID) return yield* Effect.promise(() => TerminalSandbox.shells(undefined))
      const current = yield* PlatformAuth.CurrentSession
      return yield* Effect.promise(() => TerminalSandbox.shells(current.session))
    })

    const requireTerminalAccess = Effect.fn("PtyHttpApi.requireTerminalAccess")(function* () {
      if (Flag.OPENCODE_WORKSPACE_ID) return
      const current = yield* PlatformAuth.CurrentSession
      if (PlatformAuth.canUseTerminal(current.session)) return
      return yield* new HttpApiError.Forbidden({})
    })

    const list = Effect.fn("PtyHttpApi.list")(function* () {
      yield* requireTerminalAccess()
      return yield* pty.list()
    })

    const create = Effect.fn("PtyHttpApi.create")(function* (ctx: { payload: typeof Pty.CreateInput.Type }) {
      yield* requireTerminalAccess()
      return yield* pty.create({
        ...ctx.payload,
        args: ctx.payload.args ? [...ctx.payload.args] : undefined,
        env: ctx.payload.env ? { ...ctx.payload.env } : undefined,
      })
    })

    const get = Effect.fn("PtyHttpApi.get")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* requireTerminalAccess()
      const info = yield* pty.get(ctx.params.ptyID)
      if (!info) return yield* ApiError.notFound("Session not found")
      return info
    })

    const update = Effect.fn("PtyHttpApi.update")(function* (ctx: {
      params: { ptyID: PtyID }
      payload: typeof Pty.UpdateInput.Type
    }) {
      yield* requireTerminalAccess()
      const info = yield* pty.update(ctx.params.ptyID, {
        ...ctx.payload,
        size: ctx.payload.size ? { ...ctx.payload.size } : undefined,
      })
      if (!info) return yield* ApiError.notFound("Session not found")
      return info
    })

    const remove = Effect.fn("PtyHttpApi.remove")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* requireTerminalAccess()
      yield* pty.remove(ctx.params.ptyID)
      return true
    })

    const connectToken = Effect.fn("PtyHttpApi.connectToken")(function* (ctx: { params: { ptyID: PtyID } }) {
      yield* requireTerminalAccess()
      const request = yield* HttpServerRequest.HttpServerRequest
      if (request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE || !validOrigin(request, cors))
        return yield* new HttpApiError.Forbidden({})
      if (!(yield* pty.get(ctx.params.ptyID))) return yield* ApiError.notFound("Session not found")
      const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
      return yield* tickets.issue({
        ptyID: ctx.params.ptyID,
        ...(yield* PtyTicket.scope),
        ...(current?.session?.account.id ? { accountID: current.session.account.id } : {}),
      })
    })

    return handlers
      .handle("shells", shells)
      .handle("list", list)
      .handle("create", create)
      .handle("get", get)
      .handle("update", update)
      .handle("remove", remove)
      .handle("connectToken", connectToken)
  }),
)

function sessionForTicketAccount(accountID: string): PlatformAuth.CurrentSessionInfo {
  return {
    session: {
      token: "",
      expiresAt: 0,
      account: {
        id: accountID,
        name: "",
        email: "",
        status: "active",
        timeCreated: 0,
      },
      workspaces: [],
      capabilities: { terminal: true },
    },
  }
}

export const ptyConnectRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    yield* router.add(
      "GET",
      PtyPaths.connect,
      Effect.gen(function* () {
        const params = yield* HttpRouter.schemaPathParams(Params)
        const request = yield* HttpServerRequest.HttpServerRequest
        const ticket = new URL(request.url, "http://localhost").searchParams.get(PTY_CONNECT_TICKET_QUERY)

        // Ticket WS connections clear platform auth in middleware (browsers cannot set
        // custom WS headers). Restore the issuing account so InstanceState finds the
        // same tenant partition used when the PTY was created.
        let ticketScope: PtyTicket.Scope | undefined
        if (ticket) {
          if (!validOrigin(request, cors)) return HttpServerResponse.empty({ status: 403 })
          ticketScope = yield* tickets.consume({ ticket, ptyID: params.ptyID, ...(yield* PtyTicket.scope) })
          if (!ticketScope) return HttpServerResponse.empty({ status: 403 })
        }

        const run = Effect.gen(function* () {
          if (!Flag.OPENCODE_WORKSPACE_ID) {
            const current = yield* PlatformAuth.CurrentSession
            if (!PlatformAuth.canUseTerminal(current.session)) return HttpServerResponse.empty({ status: 403 })
          }
          if (!(yield* pty.get(params.ptyID))) return HttpServerResponse.empty({ status: 404 })

          const query = yield* HttpServerRequest.schemaSearchParams(CursorQuery)
          const parsedCursor = query.cursor === undefined ? undefined : Number(query.cursor)
          const cursor =
            parsedCursor !== undefined && Number.isSafeInteger(parsedCursor) && parsedCursor >= -1
              ? parsedCursor
              : undefined
          const socket = yield* Effect.orDie(request.upgrade)
          const write = yield* socket.writer
          const closeAccepted = (event: Socket.CloseEvent) =>
            socket
              .runRaw(() => Effect.void, { onOpen: write(event).pipe(Effect.catch(() => Effect.void)) })
              .pipe(
                Effect.timeout("1 second"),
                Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
                Effect.catch(() => Effect.void),
              )
          const registered = yield* WebSocketTracker.register(write(WebSocketTracker.SERVER_CLOSING_EVENT()))
          if (!registered) {
            yield* closeAccepted(WebSocketTracker.SERVER_CLOSING_EVENT())
            return HttpServerResponse.empty()
          }
          const bridge = yield* EffectBridge.make()
          const writeScoped = (effect: Effect.Effect<void, unknown>) => {
            bridge.fork(effect.pipe(Effect.catch(() => Effect.void)))
          }
          let closed = false
          const adapter = {
            get readyState() {
              return closed ? 3 : 1
            },
            send: (data: string | Uint8Array | ArrayBuffer) => {
              if (closed) return
              writeScoped(write(data instanceof ArrayBuffer ? new Uint8Array(data) : data))
            },
            close: (code?: number, reason?: string) => {
              if (closed) return
              closed = true
              writeScoped(write(new Socket.CloseEvent(code, reason)))
            },
          }
          const handler = yield* pty.connect(params.ptyID, adapter, cursor)
          if (!handler) {
            yield* closeAccepted(new Socket.CloseEvent(4404, "session not found"))
            return HttpServerResponse.empty()
          }

          // No `pending[]`-style early-frame buffer (the legacy handler had one).
          // `request.upgrade` returns a Socket without running the WS handshake; the
          // handshake fires inside `socket.runRaw` below, AFTER `pty.connect` resolves
          // and the message callback is registered. The client therefore can't fire
          // `open` and start sending until the listener is already wired. Don't move
          // `runRaw` ahead of `pty.connect` without re-introducing a buffer.
          yield* socket
            .runRaw((message) => handlePtyInput(handler, message))
            .pipe(
              Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
              Effect.ensuring(
                Effect.sync(() => {
                  closed = true
                  handler.onClose()
                }),
              ),
              Effect.orDie,
            )
          return HttpServerResponse.empty()
        })

        if (ticketScope?.accountID) {
          return yield* run.pipe(
            Effect.provideService(PlatformAuth.CurrentSession, sessionForTicketAccount(ticketScope.accountID)),
          )
        }
        return yield* run
      }),
    )
  }),
)
