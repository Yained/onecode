import { Effect } from "effect"
import { Server } from "../../server/server"
import { Catalog } from "@/catalog/index"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { ServerAuth } from "@/server/auth"
import { CatalogEmbeddingModel } from "@/catalog/embedding-model"
import { OneScienceCodeDefaultDirectory } from "@/onescience/code-default-directory"
import { OneScienceStartupMigrations } from "@/onescience/startup-migrations"
import { OneSkillsBootstrapBundled } from "@/oneskills/bootstrap-bundled"
import { OneSkillsPublicRefresh } from "@/oneskills/public-refresh"
import { applySshLeafServeEnv, isSshLeafServe, startSshLeafLeaseWatchdog } from "@/control-plane/adapters/ssh-leaf-lease"
import { stopAllSshNodeHeartbeats } from "@/control-plane/adapters/ssh-node"

const retiredWorkspaceGateOptions = {
  token: {
    type: "string" as const,
    describe: "deprecated and ignored (workspace HTTP gate removed; use platform login)",
  },
  password: {
    type: "string" as const,
    describe: "deprecated and ignored (use platform login)",
  },
  username: {
    type: "string" as const,
    describe: "deprecated and ignored",
  },
}

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs).options(retiredWorkspaceGateOptions),
  describe: "starts a headless opencode server",
  // Server loads instances per-request via x-opencode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    process.env.OPENCODE_CLIENT ??= "serve"
    process.env.OPENCODE_EXPERIMENTAL_WORKSPACES ??= "true"
    // SSH leaf: force HOT_RELOAD off before listen. Default serve client would
    // otherwise enable it; NFS/Lustre crawls then kill B after /global/health
    // already passed (UI: 已连接 → 立刻变回连接). Aliyun local disk also does
    // not need tree watching for remote files/PTY/send.
    if (!applySshLeafServeEnv()) {
      // Do NOT force-enable workspace file watching on non-leaf serve. Scientific
      // workspaces on NFS/Lustre often contain GBs of data; @parcel/watcher crawls
      // can stall instance bootstrap and freeze the web UI. Opt in with
      // OPENCODE_EXPERIMENTAL_FILEWATCHER=true when needed.
      process.env.OPENCODE_HOT_RELOAD ??= "true"
    }
    process.env.CATALOG_EMBEDDING_MODE ??= "model"
    if (ServerAuth.hasRetiredWorkspaceGateInput(args)) ServerAuth.logRetiredWorkspaceGateIgnored()
    ServerAuth.ensureStartupAuth()
    const opts = yield* resolveNetworkOptions(args)
    // Bind before OneSkills / DB seed work. SSH health checks only need
    // /global/health; NFS login-node seed can stall the event loop for minutes.
    const server = yield* Effect.promise(() => Server.listen(opts))
    process.stderr.write(`opencode server listening on http://${server.hostname}:${server.port}\n`)
    const codeDefaultDirectory = OneScienceCodeDefaultDirectory.ensure()
    process.stderr.write(`OneScience default code workspace: ${codeDefaultDirectory}\n`)
    startSshLeafLeaseWatchdog({ directory: codeDefaultDirectory })

    const shutdown = () => {
      stopAllSshNodeHeartbeats()
      CatalogEmbeddingModel.shutdownEmbedWorker()
    }
    process.once("SIGTERM", shutdown)
    process.once("SIGINT", shutdown)

    // Give the HTTP server a free event-loop slice so tunnel probes can get 200
    // before cpSync / DB seed freeze the process.
    yield* Effect.sleep("1000 millis")
    void (async () => {
      try {
        // SSH leaf (OPENCODE_WORKSPACE_ID): only needs files/providers/PTY.
        // Full OneScience seed (primitives/resources/scenarios/session copies,
        // OneSkills cpSync onto NFS, catalog sync) freezes the event loop for
        // minutes on scnet login nodes and makes /global/health hang.
        if (isSshLeafServe()) {
          process.stderr.write("serve: ssh-leaf lean startup (skip platform seed)\n")
          process.stderr.write("serve: ready\n")
          return
        }
        process.stderr.write("serve: bootstrap OneSkills...\n")
        await OneSkillsBootstrapBundled.run()
        OneSkillsPublicRefresh.startPublicOneskillsRefreshScheduler()
        process.stderr.write("serve: startup migrations...\n")
        await OneScienceStartupMigrations.run()
        process.stderr.write("serve: catalog bootstrap...\n")
        Catalog.bootstrap({
          projectDir: codeDefaultDirectory,
          syncSkills: Boolean(process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY),
        })
        process.stderr.write("serve: ready\n")
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        process.stderr.write(`serve: bootstrap failed: ${text}\n`)
      }
    })()

    yield* Effect.never
  }),
})
