import { PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const Auth = Schema.Struct({
  type: Schema.Literals(["config", "agent", "key", "password"]).annotate({
    description:
      "SSH authentication source. 'key' uses an uploaded private key (keyPath). 'password' uses the stored login password. 'config' and 'agent' are legacy aliases kept for stored targets.",
  }),
  keyPath: Schema.optional(Schema.String).annotate({
    description: "Path to an identity file when type is 'key'.",
  }),
  password: Schema.optional(Schema.String).annotate({
    description: "SSH login password when type is 'password'. Stored in OneCode config, not ~/.ssh/config.",
  }),
}).annotate({ identifier: "SshAuthConfig" })
export type Auth = Schema.Schema.Type<typeof Auth>

export const Submit = Schema.Struct({
  command: Schema.optional(Schema.String).annotate({
    description: "Command the agent should run on the remote host when submitting a job.",
  }),
  workdir: Schema.optional(Schema.String).annotate({
    description: "Working directory for remote submission commands. Defaults to remotePath.",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to pass to remote submission commands.",
  }),
}).annotate({ identifier: "SshSubmitConfig" })
export type Submit = Schema.Schema.Type<typeof Submit>

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable this SSH target for agent job submission.",
  }),
  host: Schema.String.annotate({
    description: "SSH host or alias. The agent may use local SSH config for aliases.",
  }),
  hostName: Schema.optional(Schema.String).annotate({
    description: "Real SSH hostname from HostName when host is an SSH config alias.",
  }),
  port: Schema.optional(PositiveInt).annotate({
    description: "SSH port. Defaults to the user's SSH config or 22.",
  }),
  username: Schema.optional(Schema.String).annotate({
    description: "SSH username. Defaults to the user's SSH config.",
  }),
  remotePath: Schema.String.annotate({
    description: "Remote workspace path where the agent should submit or run code.",
  }),
  options: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Additional SSH options such as StrictHostKeyChecking or PasswordAuthentication.",
  }),
  auth: Schema.optional(Auth).annotate({
    description: "SSH authentication configuration for agent job submission.",
  }),
  submit: Schema.optional(Submit).annotate({
    description: "Remote job submission behavior.",
  }),
}).annotate({ identifier: "SshConfig" })
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigSSH from "./ssh"
