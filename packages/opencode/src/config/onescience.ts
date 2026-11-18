import { PositiveInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

const Remote = Schema.Struct({
  host: Schema.optional(Schema.String),
  hostname: Schema.optional(Schema.String),
  port: Schema.optional(PositiveInt),
  user: Schema.optional(Schema.String),
  strict_host_key_checking: Schema.optional(Schema.String),
  password_authentication: Schema.optional(Schema.String),
  identity_file: Schema.optional(Schema.String),
  remote_work_dir: Schema.optional(Schema.String),
}).annotate({ identifier: "OneScienceRemoteConfig" })

const ExecutionProfile = Schema.Struct({
  execution_mode: Schema.optional(Schema.String),
  access_mode: Schema.optional(Schema.String),
  runtime_profile_ref: Schema.optional(Schema.String),
  install_profile_ref: Schema.optional(Schema.String),
}).annotate({ identifier: "OneScienceExecutionProfileConfig" })

const Target = Schema.Struct({
  scheduler_type: Schema.optional(Schema.String),
  platform_type: Schema.optional(Schema.String),
  cpu_arch: Schema.optional(Schema.String),
  cpu_vendor: Schema.optional(Schema.String),
  accelerator_kind: Schema.optional(Schema.String),
  accelerator_vendor: Schema.optional(Schema.String),
  node_scope: Schema.optional(Schema.String),
}).annotate({ identifier: "OneScienceTargetConfig" })

const Environment = Schema.Struct({
  cpu: Schema.optional(
    Schema.Struct({
      arch: Schema.optional(Schema.String),
      vendor: Schema.optional(Schema.String),
    }),
  ),
  accelerator_defaults: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}).annotate({ identifier: "OneScienceEnvironmentConfig" })

const Cluster = Schema.Struct({
  partition: Schema.optional(Schema.String),
  nodes: Schema.optional(PositiveInt),
  gpus_per_node: Schema.optional(PositiveInt),
  cpus_per_task: Schema.optional(PositiveInt),
  memory: Schema.optional(Schema.String),
  time_limit: Schema.optional(Schema.String),
  gpu_type: Schema.optional(Schema.String),
  ntasks_per_node: Schema.optional(PositiveInt),
}).annotate({ identifier: "OneScienceClusterConfig" })

const Conda = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  env_name: Schema.optional(Schema.String),
  activate_script: Schema.optional(Schema.String),
}).annotate({ identifier: "OneScienceCondaConfig" })

const Resources = Schema.Struct({
  gpu_type: Schema.optional(Schema.String),
  cpu_memory_ratio: Schema.optional(PositiveInt),
  disk_space: Schema.optional(Schema.String),
}).annotate({ identifier: "OneScienceResourcesConfig" })

const Logs = Schema.Struct({
  remote_dir: Schema.optional(Schema.String),
  local_dir: Schema.optional(Schema.String),
  include_patterns: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  wait_for_completion: Schema.optional(Schema.Boolean),
  sync_after_completion: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "OneScienceLogsConfig" })

const Submission = Schema.Struct({
  confirm_before_first_submit: Schema.optional(Schema.Boolean),
  reuse_confirmation_in_workflow: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "OneScienceSubmissionConfig" })

const Script = Schema.Struct({
  path: Schema.optional(Schema.String),
  generate: Schema.optional(Schema.Boolean),
  template: Schema.optional(Schema.String),
  job_name: Schema.optional(Schema.String),
  code_path: Schema.optional(Schema.String),
  env_vars: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  work_dir: Schema.optional(Schema.String),
}).annotate({ identifier: "OneScienceScriptConfig" })

export const Info = Schema.Struct({
  runtime: Schema.Struct({
    mode: Schema.optional(Schema.String),
    backend_id: Schema.String,
    remote: Remote,
    execution_profile: Schema.optional(ExecutionProfile),
    target: Target,
    environment: Environment,
    cluster: Cluster,
    modules: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
    conda: Conda,
    resources: Resources,
    logs: Schema.optional(Logs),
    submission: Schema.optional(Submission),
    script: Script,
  }).annotate({ identifier: "OneScienceRuntimeConfig" }),
}).annotate({ identifier: "OneScienceConfig" })
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigOneScience from "./onescience"
