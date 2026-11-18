import * as PlatformAuth from "@/platform-auth/platform-auth"
import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { PlatformAuthApiError } from "../groups/platform"

function platformError(error: unknown) {
  if (error instanceof PlatformAuth.LoginFailedError) {
    return new PlatformAuthApiError({
      message: error.message,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      ...(error.lockedUntil !== undefined ? { lockedUntil: error.lockedUntil } : {}),
    })
  }
  return new PlatformAuthApiError({ message: error instanceof Error ? error.message : "platform request failed" })
}

function platformEffect<A>(fn: () => A) {
  return Effect.try({ try: fn, catch: platformError })
}

export const platformHandlers = HttpApiBuilder.group(InstanceHttpApi, "platform", (handlers) =>
  Effect.gen(function* () {
    const requireServerAdmin = (current: PlatformAuth.CurrentSessionInfo) => {
      if (current.serverAdmin) return
      throw new Error("admin permission required")
    }

    const requireSession = (current: PlatformAuth.CurrentSessionInfo) => {
      if (current.session) return current.session
      throw new Error("login required")
    }

    const requireOwnAccount = (current: PlatformAuth.CurrentSessionInfo, accountID: string) => {
      const session = requireSession(current)
      if (session.account.id === accountID) return
      throw new Error("account permission denied")
    }

    const requireWorkspaceAccess = (current: PlatformAuth.CurrentSessionInfo, workspaceID: string) => {
      const session = requireSession(current)
      if (session.workspaces.some((workspace) => workspace.id === workspaceID)) return
      throw new Error("workspace permission denied")
    }

    const register = Effect.fn("PlatformHttpApi.register")(function* (ctx: { payload: PlatformAuth.RegisterPayload }) {
      return yield* platformEffect(() => PlatformAuth.register(ctx.payload))
    })

    const provision = Effect.fn("PlatformHttpApi.provision")(function* (ctx: { payload: PlatformAuth.ProvisionPayload }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* platformEffect(() => {
        PlatformAuth.assertProvisionToken(request.headers[PlatformAuth.PROVISION_TOKEN_HEADER])
        return PlatformAuth.provision(ctx.payload)
      })
    })

    const requestRegistrationEmail = Effect.fn("PlatformHttpApi.requestRegistrationEmail")(function* (ctx: {
      payload: PlatformAuth.RequestRegistrationEmailPayload
    }) {
      return yield* Effect.tryPromise({
        try: () => PlatformAuth.requestRegistrationEmailCode(ctx.payload),
        catch: platformError,
      })
    })

    const login = Effect.fn("PlatformHttpApi.login")(function* (ctx: { payload: PlatformAuth.LoginPayload }) {
      return yield* platformEffect(() => PlatformAuth.login(ctx.payload))
    })

    const session = Effect.fn("PlatformHttpApi.session")(function* (ctx: { query: { token: string } }) {
      return yield* platformEffect(() => PlatformAuth.resolveSession(ctx.query.token))
    })

    const changePassword = Effect.fn("PlatformHttpApi.changePassword")(function* (ctx: { payload: PlatformAuth.ChangePasswordPayload }) {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        requireOwnAccount(current, ctx.payload.accountId)
        return PlatformAuth.changePassword(ctx.payload)
      })
    })

    const deleteAccount = Effect.fn("PlatformHttpApi.deleteAccount")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        const session = requireSession(current)
        return PlatformAuth.deleteAccount(session)
      })
    })

    const requestPasswordReset = Effect.fn("PlatformHttpApi.requestPasswordReset")(function* (ctx: { payload: PlatformAuth.RequestPasswordResetPayload }) {
      return yield* Effect.tryPromise({
        try: () => PlatformAuth.requestPasswordReset(ctx.payload),
        catch: platformError,
      })
    })

    const resetPassword = Effect.fn("PlatformHttpApi.resetPassword")(function* (ctx: { payload: PlatformAuth.ResetPasswordPayload }) {
      return yield* platformEffect(() => PlatformAuth.resetPassword(ctx.payload))
    })

    const accounts = Effect.fn("PlatformHttpApi.accounts")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        if (current.session && !current.serverAdmin) return { items: [current.session.account] }
        requireServerAdmin(current)
        return { items: PlatformAuth.listAccounts() }
      })
    })

    const account = Effect.fn("PlatformHttpApi.account")(function* (ctx: { params: { id: string } }) {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        requireOwnAccount(current, ctx.params.id)
        return PlatformAuth.detail(ctx.params.id)
      })
    })

    const quotas = Effect.fn("PlatformHttpApi.quotas")(function* () {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        if (current.serverAdmin) return { items: PlatformAuth.listQuotas() }
        const session = requireSession(current)
        const workspaceIDs = new Set(session.workspaces.map((workspace) => workspace.id))
        return {
          items: PlatformAuth.listQuotas().filter(
            (quota) =>
              workspaceIDs.has(quota.workspaceId) &&
              (quota.accountId === undefined || quota.accountId === session.account.id),
          ),
        }
      })
    })

    const quotaUpsert = Effect.fn("PlatformHttpApi.quotaUpsert")(function* (ctx: { payload: PlatformAuth.UpdateQuotaPayload }) {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        requireServerAdmin(current)
        return PlatformAuth.upsertQuota(ctx.payload)
      })
    })

    const usage = Effect.fn("PlatformHttpApi.usage")(function* (ctx: { query: { accountId?: string; workspaceId?: string } }) {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        if (current.serverAdmin) return { items: PlatformAuth.listUsage(ctx.query) }
        const session = requireSession(current)
        if (ctx.query.workspaceId) requireWorkspaceAccess(current, ctx.query.workspaceId)
        return { items: PlatformAuth.listUsage({ accountId: session.account.id, workspaceId: ctx.query.workspaceId }) }
      })
    })

    const usageRecord = Effect.fn("PlatformHttpApi.usageRecord")(function* (ctx: { payload: PlatformAuth.CreateUsagePayload }) {
      const current = yield* PlatformAuth.CurrentSession
      return yield* platformEffect(() => {
        requireServerAdmin(current)
        return PlatformAuth.recordUsage(ctx.payload)
      })
    })

    return handlers
      .handle("register", register)
      .handle("provision", provision)
      .handle("requestRegistrationEmail", requestRegistrationEmail)
      .handle("login", login)
      .handle("session", session)
      .handle("changePassword", changePassword)
      .handle("deleteAccount", deleteAccount)
      .handle("requestPasswordReset", requestPasswordReset)
      .handle("resetPassword", resetPassword)
      .handle("accounts", accounts)
      .handle("account", account)
      .handle("quotas", quotas)
      .handle("quotaUpsert", quotaUpsert)
      .handle("usage", usage)
      .handle("usageRecord", usageRecord)
  }),
)
