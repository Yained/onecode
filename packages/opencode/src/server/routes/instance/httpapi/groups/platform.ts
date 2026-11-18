import * as PlatformAuth from "@/platform-auth/platform-auth"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

const PlatformSessionQuery = Schema.Struct({ token: Schema.String })
const PlatformUsageQuery = Schema.Struct({
  accountId: Schema.optional(Schema.String),
  workspaceId: Schema.optional(Schema.String),
})

export class PlatformAuthApiError extends Schema.ErrorClass<PlatformAuthApiError>("PlatformAuthError")(
  {
    message: Schema.String,
    retryAfterMs: Schema.optional(Schema.Number),
    lockedUntil: Schema.optional(Schema.Number),
  },
  { httpApiStatus: 400 },
) {}

export const PlatformPaths = {
  register: "/platform/auth/register",
  provision: "/platform/auth/provision",
  requestRegistrationEmail: "/platform/auth/register/email-code",
  login: "/platform/auth/login",
  session: "/platform/auth/session",
  changePassword: "/platform/auth/change-password",
  deleteAccount: "/platform/auth/delete-account",
  requestPasswordReset: "/platform/auth/password-reset/request",
  resetPassword: "/platform/auth/password-reset/confirm",
  accounts: "/platform/admin/accounts",
  account: "/platform/admin/accounts/:id",
  quotas: "/platform/admin/quotas",
  usage: "/platform/admin/usage",
} as const

export const PlatformApi = HttpApi.make("platform")
  .add(
    HttpApiGroup.make("platform")
      .add(
        HttpApiEndpoint.post("register", PlatformPaths.register, {
          payload: PlatformAuth.RegisterPayload,
          success: described(PlatformAuth.AuthSession, "Platform auth session"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.register", summary: "Register platform account" })),
        HttpApiEndpoint.post("provision", PlatformPaths.provision, {
          payload: PlatformAuth.ProvisionPayload,
          success: described(PlatformAuth.ProvisionResult, "Idempotent provision result"),
          error: PlatformAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "platform.auth.provision",
            summary: "Provision platform account (idempotent, for embedded platforms)",
          }),
        ),
        HttpApiEndpoint.post("requestRegistrationEmail", PlatformPaths.requestRegistrationEmail, {
          payload: PlatformAuth.RequestRegistrationEmailPayload,
          success: described(PlatformAuth.RegistrationEmailRequest, "Registration email code request"),
          error: PlatformAuthApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "platform.auth.requestRegistrationEmail",
            summary: "Send registration email verification code",
          }),
        ),
        HttpApiEndpoint.post("login", PlatformPaths.login, {
          payload: PlatformAuth.LoginPayload,
          success: described(PlatformAuth.AuthSession, "Platform auth session"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.login", summary: "Login platform account" })),
        HttpApiEndpoint.get("session", PlatformPaths.session, {
          query: PlatformSessionQuery,
          success: described(PlatformAuth.AuthSession, "Platform auth session"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.session", summary: "Resolve platform session" })),
        HttpApiEndpoint.post("changePassword", PlatformPaths.changePassword, {
          payload: PlatformAuth.ChangePasswordPayload,
          success: described(Schema.Boolean, "Password changed"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.changePassword", summary: "Change account password" })),
        HttpApiEndpoint.post("deleteAccount", PlatformPaths.deleteAccount, {
          payload: Schema.Struct({}),
          success: described(Schema.Boolean, "Account deleted"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.deleteAccount", summary: "Delete current platform account" })),
        HttpApiEndpoint.post("requestPasswordReset", PlatformPaths.requestPasswordReset, {
          payload: PlatformAuth.RequestPasswordResetPayload,
          success: described(PlatformAuth.PasswordResetRequest, "Password reset request"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.requestPasswordReset", summary: "Request password reset token" })),
        HttpApiEndpoint.post("resetPassword", PlatformPaths.resetPassword, {
          payload: PlatformAuth.ResetPasswordPayload,
          success: described(Schema.Boolean, "Password reset"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.auth.resetPassword", summary: "Reset password with token" })),
        HttpApiEndpoint.get("accounts", PlatformPaths.accounts, {
          success: described(Schema.Struct({ items: Schema.Array(PlatformAuth.Account) }), "Platform accounts"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.admin.accounts", summary: "List platform accounts" })),
        HttpApiEndpoint.get("account", PlatformPaths.account, {
          params: { id: Schema.String },
          success: described(PlatformAuth.AccountDetail, "Platform account detail"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.admin.account", summary: "Get platform account detail" })),
        HttpApiEndpoint.get("quotas", PlatformPaths.quotas, {
          success: described(Schema.Struct({ items: Schema.Array(PlatformAuth.Quota) }), "Resource quotas"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.admin.quotas", summary: "List resource quotas" })),
        HttpApiEndpoint.put("quotaUpsert", PlatformPaths.quotas, {
          payload: PlatformAuth.UpdateQuotaPayload,
          success: described(PlatformAuth.Quota, "Resource quota"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.admin.quotaUpsert", summary: "Create or update resource quota" })),
        HttpApiEndpoint.get("usage", PlatformPaths.usage, {
          query: PlatformUsageQuery,
          success: described(Schema.Struct({ items: Schema.Array(PlatformAuth.Usage) }), "Resource usage"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.admin.usage", summary: "List resource usage" })),
        HttpApiEndpoint.post("usageRecord", PlatformPaths.usage, {
          payload: PlatformAuth.CreateUsagePayload,
          success: described(PlatformAuth.Usage, "Resource usage"),
          error: PlatformAuthApiError,
        }).annotateMerge(OpenApi.annotations({ identifier: "platform.admin.usageRecord", summary: "Record resource usage" })),
      )
      .annotateMerge(OpenApi.annotations({ title: "platform", description: "Platform user, account, auth, quota, and usage APIs." }))
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "opencode platform HttpApi", version: "0.0.1" }))
