import { Config } from "@/config/config"
import { ConfigSSH } from "@/config/ssh"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import "@/server/event"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { described } from "./metadata"
import { QueryBoolean } from "./query"
import { Project } from "@/project/project"
import { SshTargetBusyError } from "../errors"

const GlobalHealth = Schema.Struct({
  healthy: Schema.Literal(true),
  version: Schema.String,
})

const GlobalEventSchema = Schema.Struct({
  directory: Schema.String,
  project: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  payload: Schema.Union([...BusEvent.effectPayloads(), ...SyncEvent.effectPayloads()]),
}).annotate({ identifier: "GlobalEvent" })

export const GlobalUpgradeInput = Schema.Struct({
  target: Schema.optional(Schema.String),
})

const GlobalUpgradeResult = Schema.Union([
  Schema.Struct({
    success: Schema.Literal(true),
    version: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Literal(false),
    error: Schema.String,
  }),
])

export const GlobalSshTestInput = Schema.Struct({
  config: ConfigSSH.Info,
})

export const GlobalSshTestResult = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
})

export const GlobalSshWorkspacePreflightInput = Schema.Struct({
  config: ConfigSSH.Info,
  accountId: Schema.optional(Schema.String),
  projectSlug: Schema.optional(Schema.String),
  projectID: Schema.optional(Schema.String),
  remotePath: Schema.optional(Schema.String),
  progressKey: Schema.optional(Schema.String),
})

export const GlobalSshWorkspacePreflightCheck = Schema.Struct({
  id: Schema.Literals(["ssh", "remotePath", "onecode", "marker"]),
  ok: Schema.Boolean,
  skipped: Schema.optional(Schema.Boolean),
  message: Schema.String,
  detail: Schema.optional(Schema.String),
})

export const GlobalSshWorkspacePreflightResult = Schema.Struct({
  ok: Schema.Boolean,
  remotePath: Schema.String,
  checks: Schema.Array(GlobalSshWorkspacePreflightCheck),
})

export const GlobalSshConnectProgressInput = Schema.Struct({
  key: Schema.String,
})

export const GlobalSshConnectProgressStep = Schema.Struct({
  id: Schema.String,
  message: Schema.String,
  status: Schema.Literals(["pending", "current", "ok", "fail"]),
  detail: Schema.optional(Schema.String),
})

export const GlobalSshConnectProgressResult = Schema.Struct({
  steps: Schema.Array(GlobalSshConnectProgressStep),
})

export const GlobalSshConnectAbortResult = Schema.Struct({
  ok: Schema.Boolean,
})

export const GlobalSshIdentityUploadInput = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
})

export const GlobalSshConfigWriteInput = Schema.Struct({
  name: Schema.String,
  previousName: Schema.optional(Schema.String),
  config: ConfigSSH.Info,
})

export const GlobalSshIdentityUploadResult = Schema.Struct({
  keyPath: Schema.String,
})

export const GlobalSshIdentityCheckInput = Schema.Struct({
  keyPath: Schema.String,
})

export const GlobalSshIdentityCheckResult = Schema.Struct({
  exists: Schema.Boolean,
  keyPath: Schema.String,
})

export const GlobalSshIdentityIngestInput = Schema.Struct({
  keyPath: Schema.String,
})

export const GlobalSshIdentityIngestResult = Schema.Struct({
  exists: Schema.Boolean,
  ingested: Schema.Boolean,
  keyPath: Schema.String,
  reason: Schema.optional(Schema.Literals(["empty", "windows", "notFound", "invalid"])),
})

export const GlobalSshConfigWriteResult = Schema.Struct({
  path: Schema.String,
})

export const GlobalSshConfigRemoveInput = Schema.Struct({
  name: Schema.String,
})

export const GlobalSshTargetsResult = Schema.Struct({
  ssh: Schema.Record(Schema.String, ConfigSSH.Info),
  path: Schema.String,
}).annotate({ identifier: "GlobalSshTargetsResult" })

export const GlobalPathDirsQuery = Schema.Struct({
  path: Schema.optional(Schema.String),
})

export const ProjectDataDirectoryEntry = Schema.Struct({
  name: Schema.String,
  absolute: Schema.String,
}).annotate({ identifier: "ProjectDataDirectoryEntry" })

export const GlobalPaths = {
  health: "/global/health",
  event: "/global/event",
  config: "/global/config",
  dispose: "/global/dispose",
  upgrade: "/global/upgrade",
  pathDirs: "/global/path/dirs",
  session: "/global/session",
  sshTest: "/global/ssh/test",
  sshWorkspacePreflight: "/global/ssh/workspace-preflight",
  sshConnectProgress: "/global/ssh/connect-progress",
  sshConnectAbort: "/global/ssh/connect-abort",
  sshIdentity: "/global/ssh/identity",
  sshIdentityCheck: "/global/ssh/identity/check",
  sshIdentityIngest: "/global/ssh/identity/ingest",
  sshConfig: "/global/ssh/config",
  sshConfigRemove: "/global/ssh/config/remove",
  sshTargets: "/global/ssh/targets",
  projectExecution: "/global/project/execution",
  onesciencePresetStatus: "/global/onescience-preset/status",
  onesciencePresetLogin: "/global/onescience-preset/admin/login",
  onesciencePresetConfig: "/global/onescience-preset/admin/config",
  onesciencePresetReset: "/global/onescience-preset/admin/reset",
  onesciencePresetAccounts: "/global/onescience-preset/admin/accounts",
  onesciencePresetAccountStatus: "/global/onescience-preset/admin/accounts/status",
  onesciencePresetAccountDelete: "/global/onescience-preset/admin/accounts/delete",
  onesciencePresetPasswordReset: "/global/onescience-preset/admin/password-reset",
  onesciencePresetMailConfig: "/global/onescience-preset/admin/mail/config",
  onesciencePresetMailTest: "/global/onescience-preset/admin/mail/test",
  onesciencePresetRegistrationConfig: "/global/onescience-preset/admin/registration/config",
  onesciencePresetRegistrationRandomInvite: "/global/onescience-preset/admin/registration/random-invite",
  onescienceRegistrationPublic: "/global/onescience-preset/registration",
  providerProbe: "/global/provider/probe",
  providerModels: "/global/provider/models",
} as const

export const GlobalSessionListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

export const GlobalProviderProbeInput = Schema.Struct({
  baseURL: Schema.String,
  apiKey: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  modelID: Schema.optional(Schema.String),
})

export const GlobalProviderProbeResult = Schema.Struct({
  ok: Schema.Boolean,
  kind: Schema.optional(Schema.Literals(["auth", "network", "http", "timeout"])),
  message: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
})

export const GlobalProviderModelsInput = Schema.Struct({
  baseURL: Schema.String,
  apiKey: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** When apiKey is omitted, resolve the stored key for this provider (edit flow). */
  providerID: Schema.optional(Schema.String),
})

export const GlobalProviderModelsResult = Schema.Struct({
  ok: Schema.Boolean,
  models: Schema.optional(Schema.Array(Schema.String)),
  kind: Schema.optional(Schema.Literals(["auth", "network", "http", "timeout"])),
  message: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
})

export const GlobalProjectExecutionInput = Schema.Struct({
  directory: Schema.optional(Schema.String),
  projectID: Schema.optional(Schema.String),
  execution: Project.Execution,
})

export const GlobalProjectExecutionResult = Schema.Struct({
  project: Project.Info,
})

export const OnesciencePresetStatus = Schema.Struct({
  modelEnabled: Schema.Boolean,
  adminEnabled: Schema.Boolean,
  baseURL: Schema.String,
  modelID: Schema.String,
  modelName: Schema.String,
  providerName: Schema.String,
  hasApiKey: Schema.Boolean,
  glmEnabled: Schema.Boolean,
  lockedUntil: Schema.optional(Schema.Number),
  retryAfterMs: Schema.optional(Schema.Number),
})

export const OnesciencePresetLoginInput = Schema.Struct({
  password: Schema.String,
})

export const OnesciencePresetLoginResult = Schema.Struct({
  ok: Schema.Boolean,
  token: Schema.optional(Schema.String),
  lockedUntil: Schema.optional(Schema.Number),
  retryAfterMs: Schema.optional(Schema.Number),
  failures: Schema.optional(Schema.Number),
})

export const OnesciencePresetConfigView = Schema.Struct({
  baseURL: Schema.String,
  modelID: Schema.String,
  modelName: Schema.String,
  providerName: Schema.String,
  hasApiKey: Schema.Boolean,
})

export const OnesciencePresetConfigUpdateInput = Schema.Struct({
  token: Schema.String,
  baseURL: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  modelName: Schema.optional(Schema.String),
  providerName: Schema.optional(Schema.String),
  clearApiKey: Schema.optional(Schema.Boolean),
})

export const OnesciencePresetTokenInput = Schema.Struct({
  token: Schema.String,
})

export const OnesciencePresetAccountsResult = Schema.Struct({
  items: Schema.Array(PlatformAuth.Account),
})

export const OnesciencePresetPasswordResetInput = Schema.Struct({
  token: Schema.String,
  accountId: Schema.NonEmptyString,
})

export const OnesciencePresetAccountStatusInput = Schema.Struct({
  token: Schema.String,
  accountId: Schema.NonEmptyString,
  status: Schema.Union([Schema.Literal("active"), Schema.Literal("frozen")]),
})

export const OnesciencePresetAccountDeleteInput = Schema.Struct({
  token: Schema.String,
  accountId: Schema.NonEmptyString,
})

export const OnescienceRegistrationPublic = Schema.Struct({
  inviteRequired: Schema.Boolean,
  emailVerificationRequired: Schema.Boolean,
})

export const OnescienceRegistrationConfigView = Schema.Struct({
  inviteRequired: Schema.Boolean,
  fixedInvite: Schema.optional(
    Schema.Struct({
      code: Schema.String,
      expiresAt: Schema.Number,
      ttlDays: Schema.optional(Schema.Number),
    }),
  ),
  randomInvites: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      expiresAt: Schema.Number,
      usedAt: Schema.optional(Schema.Number),
    }),
  ),
})

export const OnescienceRegistrationConfigUpdateInput = Schema.Struct({
  token: Schema.String,
  inviteRequired: Schema.optional(Schema.Boolean),
  fixedCode: Schema.optional(Schema.String),
  fixedTtlDays: Schema.optional(Schema.Union([Schema.Literal(7), Schema.Literal(14), Schema.Literal(30)])),
  clearFixedInvite: Schema.optional(Schema.Boolean),
})

export const OnescienceRegistrationRandomInviteInput = Schema.Struct({
  token: Schema.String,
})

export const OnescienceRegistrationRandomInviteResult = Schema.Struct({
  code: Schema.String,
  expiresAt: Schema.Number,
})

export const OnesciencePresetMailConfigView = Schema.Struct({
  host: Schema.String,
  port: Schema.Number,
  secure: Schema.Boolean,
  user: Schema.String,
  from: Schema.String,
  testTo: Schema.String,
  hasPassword: Schema.Boolean,
  configured: Schema.Boolean,
  source: Schema.Literals(["builtin", "env", "mixed", "none"]),
})

export const OnesciencePresetMailConfigUpdateInput = Schema.Struct({
  token: Schema.String,
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  secure: Schema.optional(Schema.Boolean),
  user: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  pass: Schema.optional(Schema.String),
  testTo: Schema.optional(Schema.String),
  clearPassword: Schema.optional(Schema.Boolean),
})

export const OnesciencePresetMailTestInput = Schema.Struct({
  token: Schema.String,
  to: Schema.NonEmptyString,
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Number),
  secure: Schema.optional(Schema.Boolean),
  user: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  pass: Schema.optional(Schema.String),
})

export const OnesciencePresetMailTestResult = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
})

export const GlobalApi = HttpApi.make("global").add(
  HttpApiGroup.make("global")
    .add(
      HttpApiEndpoint.get("health", GlobalPaths.health, {
        success: described(GlobalHealth, "Health information"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.health",
          summary: "Get health",
          description: "Get health information about the OpenCode server.",
        }),
      ),
      HttpApiEndpoint.get("event", GlobalPaths.event, {
        query: Schema.Struct({
          viewerID: Schema.optional(Schema.String),
        }),
        success: GlobalEventSchema,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.event",
          summary: "Get global events",
          description: "Subscribe to global events from the OpenCode system using server-sent events.",
        }),
      ),
      HttpApiEndpoint.get("configGet", GlobalPaths.config, {
        success: described(Config.Info, "Get global config info"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.get",
          summary: "Get global configuration",
          description: "Retrieve the current global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.patch("configUpdate", GlobalPaths.config, {
        payload: Config.Info,
        success: described(Config.Info, "Successfully updated global config"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.config.update",
          summary: "Update global configuration",
          description: "Update global OpenCode configuration settings and preferences.",
        }),
      ),
      HttpApiEndpoint.post("dispose", GlobalPaths.dispose, {
        success: described(Schema.Boolean, "Global disposed"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.dispose",
          summary: "Dispose instance",
          description: "Clean up and dispose all OpenCode instances, releasing all resources.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, {
        payload: GlobalUpgradeInput,
        success: described(GlobalUpgradeResult, "Upgrade result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.upgrade",
          summary: "Upgrade opencode",
          description: "Upgrade opencode to the specified version or latest if not specified.",
        }),
      ),
      HttpApiEndpoint.get("pathDirs", GlobalPaths.pathDirs, {
        query: GlobalPathDirsQuery,
        success: described(Schema.Array(ProjectDataDirectoryEntry), "Project data directories"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.path.dirs",
          summary: "List project data directories",
          description:
            "List immediate subdirectories under the server project data root without bootstrapping a workspace instance.",
        }),
      ),
      HttpApiEndpoint.get("session", GlobalPaths.session, {
        query: GlobalSessionListQuery,
        success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.session.list",
          summary: "List sessions globally",
          description:
            "List sessions from the global database without bootstrapping a workspace instance. Optional directory filter matches session.directory.",
        }),
      ),
      HttpApiEndpoint.post("sshTest", GlobalPaths.sshTest, {
        payload: GlobalSshTestInput,
        success: described(GlobalSshTestResult, "SSH connectivity test result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.test",
          summary: "Test SSH connectivity",
          description: "Test whether the OpenCode server can connect to an SSH target and access its remote path.",
        }),
      ),
      HttpApiEndpoint.post("sshWorkspacePreflight", GlobalPaths.sshWorkspacePreflight, {
        payload: GlobalSshWorkspacePreflightInput,
        success: described(GlobalSshWorkspacePreflightResult, "SSH workspace preflight result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.workspacePreflight",
          summary: "Preflight remote workspace",
          description: "Check SSH connectivity, remote directory, workspace marker, and onecode CLI on the target host.",
        }),
      ),
      HttpApiEndpoint.post("sshConnectProgress", GlobalPaths.sshConnectProgress, {
        payload: GlobalSshConnectProgressInput,
        success: described(GlobalSshConnectProgressResult, "SSH connect progress"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.connectProgress",
          summary: "Remote workspace connect progress",
          description: "Poll the current ssh-node connect steps for a local progress key.",
        }),
      ),
      HttpApiEndpoint.post("sshConnectAbort", GlobalPaths.sshConnectAbort, {
        payload: GlobalSshConnectProgressInput,
        success: described(GlobalSshConnectAbortResult, "SSH connect abort"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.connectAbort",
          summary: "Abort remote workspace connect",
          description: "Stop the in-flight ssh-node SSH session and remote serve for a progress key.",
        }),
      ),
      HttpApiEndpoint.post("sshIdentityUpload", GlobalPaths.sshIdentity, {
        payload: GlobalSshIdentityUploadInput,
        success: described(GlobalSshIdentityUploadResult, "Uploaded SSH identity path"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.identity.upload",
          summary: "Upload SSH identity file",
          description: "Upload an identity file to the OpenCode server and return the server-side key path.",
        }),
      ),
      HttpApiEndpoint.post("sshIdentityCheck", GlobalPaths.sshIdentityCheck, {
        payload: GlobalSshIdentityCheckInput,
        success: described(GlobalSshIdentityCheckResult, "SSH identity path existence"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.identity.check",
          summary: "Check SSH identity file",
          description: "Check whether an SSH identity file path exists on the OpenCode server filesystem.",
        }),
      ),
      HttpApiEndpoint.post("sshIdentityIngest", GlobalPaths.sshIdentityIngest, {
        payload: GlobalSshIdentityIngestInput,
        success: described(GlobalSshIdentityIngestResult, "Ingested SSH identity path"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.identity.ingest",
          summary: "Ingest SSH identity file from the server filesystem",
          description:
            "If IdentityFile exists on the OneCode host, copy it into the account identity directory and return the managed path.",
        }),
      ),
      HttpApiEndpoint.post("sshConfigWrite", GlobalPaths.sshConfig, {
        payload: GlobalSshConfigWriteInput,
        success: described(GlobalSshConfigWriteResult, "Written SSH config path"),
        error: [HttpApiError.BadRequest, SshTargetBusyError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.config.write",
          summary: "Write SSH config",
          description: "Write an OpenSSH Host block for an SSH target to ~/.ssh/config.",
        }),
      ),
      HttpApiEndpoint.post("sshConfigRemove", GlobalPaths.sshConfigRemove, {
        payload: GlobalSshConfigRemoveInput,
        success: described(GlobalSshConfigWriteResult, "Updated SSH config path"),
        error: [HttpApiError.BadRequest, SshTargetBusyError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.config.remove",
          summary: "Remove SSH config",
          description: "Remove an OpenCode-managed OpenSSH Host block from ~/.ssh/config.",
        }),
      ),
      HttpApiEndpoint.get("sshTargets", GlobalPaths.sshTargets, {
        success: described(GlobalSshTargetsResult, "Managed SSH targets from OpenSSH config"),
        error: HttpApiError.Unauthorized,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.ssh.targets",
          summary: "List managed SSH targets",
          description:
            "List OneCode-managed SSH targets from the account OpenSSH config. Integration UI uses this as the durable source of truth across logout/login.",
        }),
      ),
      HttpApiEndpoint.post("projectExecution", GlobalPaths.projectExecution, {
        payload: GlobalProjectExecutionInput,
        success: described(GlobalProjectExecutionResult, "Updated project execution"),
        error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiError.Forbidden],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.project.execution",
          summary: "Set project execution environment",
          description:
            "Persist the project's execution environment on the control-plane project row. SSH bindings are immutable after the first write.",
        }),
      ),
      HttpApiEndpoint.get("onesciencePresetStatus", GlobalPaths.onesciencePresetStatus, {
        success: described(OnesciencePresetStatus, "OneScience preset status"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.status",
          summary: "OneScience preset status",
          description: "Public status for the built-in OneScience GPT preset (no secrets).",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetLogin", GlobalPaths.onesciencePresetLogin, {
        payload: OnesciencePresetLoginInput,
        success: described(OnesciencePresetLoginResult, "Admin login result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.login",
          summary: "OneScience preset admin login",
          description: "Verify the OneScience preset admin password and return a short-lived token.",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetConfigGet", GlobalPaths.onesciencePresetConfig, {
        payload: OnesciencePresetTokenInput,
        success: described(OnesciencePresetConfigView, "Preset config view"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.config.get",
          summary: "Get OneScience preset config",
          description: "Return editable OneScience preset fields (API key is never returned).",
        }),
      ),
      HttpApiEndpoint.patch("onesciencePresetConfigUpdate", GlobalPaths.onesciencePresetConfig, {
        payload: OnesciencePresetConfigUpdateInput,
        success: described(OnesciencePresetConfigView, "Updated preset config"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.config.update",
          summary: "Update OneScience preset config",
          description: "Update OneScience preset base URL / model / API key overrides.",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetReset", GlobalPaths.onesciencePresetReset, {
        payload: OnesciencePresetTokenInput,
        success: described(OnesciencePresetConfigView, "Reset preset config"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.reset",
          summary: "Reset OneScience preset overrides",
          description: "Clear admin overrides and restore compile/runtime defaults.",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetAccounts", GlobalPaths.onesciencePresetAccounts, {
        payload: OnesciencePresetTokenInput,
        success: described(OnesciencePresetAccountsResult, "Platform accounts"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.accounts",
          summary: "List platform accounts for admin password reset",
          description: "Return local platform accounts. Requires a valid OneScience preset admin token.",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetAccountStatus", GlobalPaths.onesciencePresetAccountStatus, {
        payload: OnesciencePresetAccountStatusInput,
        success: described(PlatformAuth.Account, "Updated account"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.accounts.status",
          summary: "Freeze or unfreeze a platform account",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetAccountDelete", GlobalPaths.onesciencePresetAccountDelete, {
        payload: OnesciencePresetAccountDeleteInput,
        success: described(Schema.Boolean, "Account deleted"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.accounts.delete",
          summary: "Delete a platform account after freezing it",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetPasswordReset", GlobalPaths.onesciencePresetPasswordReset, {
        payload: OnesciencePresetPasswordResetInput,
        success: described(PlatformAuth.AdminPasswordResetResult, "One-time password reset credential"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.passwordReset",
          summary: "Create admin password reset credential",
          description: "Create a one-time reset token/short code for a platform account.",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetMailConfigGet", GlobalPaths.onesciencePresetMailConfig, {
        payload: OnesciencePresetTokenInput,
        success: described(OnesciencePresetMailConfigView, "Mail config view"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.mail.config.get",
          summary: "Get SMTP mail config",
          description: "Return SMTP settings for password-reset email (password never returned).",
        }),
      ),
      HttpApiEndpoint.patch("onesciencePresetMailConfigUpdate", GlobalPaths.onesciencePresetMailConfig, {
        payload: OnesciencePresetMailConfigUpdateInput,
        success: described(OnesciencePresetMailConfigView, "Updated mail config"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.mail.config.update",
          summary: "Update SMTP mail config",
          description: "Save SMTP settings used for password-reset emails.",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetMailTest", GlobalPaths.onesciencePresetMailTest, {
        payload: OnesciencePresetMailTestInput,
        success: described(OnesciencePresetMailTestResult, "Test mail result"),
        error: [HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.mail.test",
          summary: "Send SMTP test mail",
          description: "Send a test email using the current SMTP configuration.",
        }),
      ),
      HttpApiEndpoint.get("onescienceRegistrationPublic", GlobalPaths.onescienceRegistrationPublic, {
        success: described(OnescienceRegistrationPublic, "Public registration gate"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.registration.public",
          summary: "Public registration invite requirement",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetRegistrationConfigGet", GlobalPaths.onesciencePresetRegistrationConfig, {
        payload: OnesciencePresetTokenInput,
        success: described(OnescienceRegistrationConfigView, "Registration config"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.registration.config.get",
          summary: "Get registration invite settings",
        }),
      ),
      HttpApiEndpoint.patch("onesciencePresetRegistrationConfigUpdate", GlobalPaths.onesciencePresetRegistrationConfig, {
        payload: OnescienceRegistrationConfigUpdateInput,
        success: described(OnescienceRegistrationConfigView, "Updated registration config"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.registration.config.update",
          summary: "Update registration invite settings",
        }),
      ),
      HttpApiEndpoint.post("onesciencePresetRegistrationRandomInvite", GlobalPaths.onesciencePresetRegistrationRandomInvite, {
        payload: OnescienceRegistrationRandomInviteInput,
        success: described(OnescienceRegistrationRandomInviteResult, "Random invite code"),
        error: [HttpApiError.BadRequest, HttpApiError.Unauthorized],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.onesciencePreset.registration.randomInvite",
          summary: "Create a 30-minute random invite code",
        }),
      ),
      HttpApiEndpoint.post("providerProbe", GlobalPaths.providerProbe, {
        payload: GlobalProviderProbeInput,
        success: described(GlobalProviderProbeResult, "Custom provider probe result"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.provider.probe",
          summary: "Probe custom provider endpoint",
          description: "Validate Base URL / API key reachability for an OpenAI-compatible provider.",
        }),
      ),
      HttpApiEndpoint.post("providerModels", GlobalPaths.providerModels, {
        payload: GlobalProviderModelsInput,
        success: described(GlobalProviderModelsResult, "Custom provider model list"),
        error: HttpApiError.BadRequest,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.provider.models",
          summary: "List models from a custom provider",
          description: "Fetch available model IDs from an OpenAI-compatible /models endpoint.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "global", description: "Global server routes." })),
)
