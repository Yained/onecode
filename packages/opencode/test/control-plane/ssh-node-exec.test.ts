import { describe, expect, test } from "bun:test"
import {
  remoteEnsureDirAndReadMarkerScript,
  remoteEnsureLeaseWatchdogScript,
  remoteKillScript,
  remoteReclaimServeScript,
  remoteServeLogScript,
  remoteStartServeScript,
  remoteTouchLeaseScript,
  remoteRefreshLeaseScript,
  remoteWorkspaceAliveScript,
  remotePathLeafPidsCommand,
  remoteKillExtraPathLeafsScript,
  remoteWorkspacePidsCommand,
  remoteCombinedPreflightScript,
  remotePinnedKeepaliveScript,
  SERVE_READY_MARK,
  SERVE_REUSE_MARK,
  SERVE_REUSE_MISS_MARK,
  pickEphemeralPort,
  isHealthyHttpStatus,
  isInstanceReadyHttpStatus,
  LEASE_TTL_SECONDS,
  LEASE_TTL_MS,
  CONNECT_TIMEOUT_MS,
  REMOTE_SERVE_HEALTH_TIMEOUT_MS,
  REMOTE_SERVE_SPAWN_TIMEOUT_MS,
  REMOTE_LEAF_READY_TIMEOUT_MS,
  parseServeBootstrapDetail,
  serveBootstrapFailed,
  serveLogStillSeeding,
  waitForLeafReady,
  waitForServeReadyMark,
} from "../../src/control-plane/adapters/ssh-node-exec"
import { PassThrough } from "node:stream"
import http from "node:http"

describe("ssh-node remote scripts", () => {
  const script = remoteStartServeScript({
    remotePath: "/data/share/onescience/workspaces/cp/alice/proj",
    workspaceID: "wrk_1",
    port: 4123,
    marker: {
      version: 1,
      workspaceID: "wrk_1",
      controlPlaneId: "cp",
      accountId: "alice",
      projectID: "prj_1",
      createdAt: 1,
      servePort: 4123,
    },
    env: { OPENCODE_AUTH_CONTENT: '{"openai":{"type":"api","key":"k"}}' },
  })

  test("pins cwd and default directory on the remote path", () => {
    expect(script).toContain("mkdir -p '/data/share/onescience/workspaces/cp/alice/proj/.opencode-db'")
    expect(script).toContain("cd ")
    expect(script).toContain("/data/share/onescience/workspaces/cp/alice/proj")
    expect(script).toContain("OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY=")
    expect(script).toContain("OPENCODE_DB=")
    expect(script).toContain(".opencode-db/opencode.db")
    expect(script).toContain("OPENCODE_WORKSPACE_ID=")
    expect(script).toContain("OPENCODE_HOT_RELOAD=false")
    expect(script).toContain("OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true")
    expect(script).toContain("OPENCODE_EXPERIMENTAL_FILEWATCHER=false")
    expect(script).toContain("OPENCODE_TERMINAL_ISOLATION=native")
    expect(script).not.toContain("OPENCODE_PLATFORM_AUTH_REQUIRED")
    expect(script).not.toContain("ONECODE_CONTROL_PLANE_URL=")
    expect(script).toContain("wrk_1")
    expect(script).toContain("onecode serve --hostname 127.0.0.1 --port 4123")
    expect(script).toContain("bash --noprofile --norc -c")
    expect(script).not.toContain("nohup bash")
  })

  test("does not re-check the remote path when starting serve", () => {
    expect(script).not.toContain("远端路径不存在")
    expect(script).not.toContain("[ ! -d")
    expect(script).not.toContain("[ ! -w")
    expect(script).not.toContain("echo ALREADY")
    expect(script).not.toContain("/global/health")
  })

  test("can read the serve log", () => {
    expect(remoteServeLogScript("/tmp/ws")).toContain(".onescience-serve.log")
  })

  test("writes auth content and workspace marker before serve", () => {
    expect(script).toContain(".onescience-workspace.json")
    expect(script).toContain(".opencode-auth.json")
    expect(script).toContain("OPENCODE_AUTH_CONTENT=$(cat")
    expect(script).not.toContain('"key":"k"')
    expect(script).not.toContain("printf %s '{\"openai\"")
  })

  test("creates the remote directory before reading the marker", () => {
    expect(remoteEnsureDirAndReadMarkerScript("/tmp/ws")).toContain("mkdir -p '/tmp/ws'")
    expect(remoteWorkspaceAliveScript("wrk_1", { remotePath: "/tmp/ws", port: 4123 })).toContain(
      ".onescience-serve.pid",
    )
  })

  test("uses lean pid discovery without /proc environ walks", () => {
    const pids = remoteWorkspacePidsCommand("wrk_1", { remotePath: "/tmp/ws", port: 4123 })
    expect(pids).toContain(".onescience-serve.pid")
    expect(pids).not.toContain("ps -u")
    expect(pids).not.toContain("ls -1 /proc")
    expect(pids).not.toContain("environ")
    expect(pids).not.toContain("pgrep -f")
    expect(script).not.toContain("echo ALREADY")
    expect(script).not.toContain("ss -lptn")
    expect(script).not.toContain("lsof")
    expect(script).not.toContain("fuser")
    expect(script).not.toContain("kill -0")
    expect(script).toContain(".onescience-serve.pid")
    expect(script).toContain("exec onecode serve")
    expect(script).not.toContain("environ")
    expect(remoteWorkspaceAliveScript("wrk_1", { remotePath: "/tmp/ws" })).toContain("echo ALIVE")
    const kill = remoteKillScript("wrk_1", { remotePath: "/tmp/ws", port: 4123 })
    expect(kill).toContain("kill -KILL")
    expect(kill).toContain("/proc/$pid/cmdline")
    expect(kill).toContain("onecode serve")
    expect(kill).not.toMatch(/\bfi if\b/)
    expect(kill).not.toMatch(/\bkilled=0 if\b/)
    expect(kill).not.toMatch(/\bthen;\b/)
    expect(kill).not.toMatch(/\bdo;\b/)
    expect(kill).toContain("killed=0\n")
    expect(kill).not.toContain("fuser -k")
    expect(kill).not.toContain("timeout 2 fuser")
    expect(kill).not.toContain("ps -u")
    expect(kill).not.toContain("sleep 0.5")
    expect(kill).not.toContain("pkill -TERM")
    expect(kill).toContain("ps -ww")
    expect(kill).toContain("grep -F")
    expect(kill).toContain(".onescience-keepalive.sh")
    expect(kill).toContain(".onescience-serve.pid")
    expect(kill).toContain('case "$pid" in $$|$PPID|"")')
    const reclaim = remoteReclaimServeScript({ remotePath: "/tmp/ws", port: 4123, leaseToken: "tok" })
    expect(reclaim).toContain("printf %s 'tok'")
    expect(reclaim).toContain(".onescience-lease")
    expect(reclaim).toContain("/proc/$pid/cmdline")
    expect(reclaim).toContain("__KILL_LOCAL__")
    expect(reclaim).toContain("__NOT_THIS_NODE__")
    expect(reclaim).toContain("__NO_PID__")
    expect(reclaim).not.toMatch(/\bfi if\b/)
    expect(reclaim).not.toMatch(/\bthen;\b/)
    expect(reclaim).not.toContain("fuser -k")
    expect(remoteCombinedPreflightScript("/tmp/ws")).toContain("mkdir -p '/tmp/ws'")
    expect(remoteCombinedPreflightScript("/tmp/ws")).toContain("set +e")
    expect(remoteCombinedPreflightScript("/tmp/ws")).toContain("exit 0")
    expect(remoteCombinedPreflightScript("/tmp/ws", { createIfMissing: false })).not.toContain("mkdir -p '/tmp/ws'")
    expect(remoteCombinedPreflightScript("/tmp/ws", { createIfMissing: false })).toContain("[ -d '/tmp/ws' ]")
    expect(remoteEnsureLeaseWatchdogScript({ remotePath: "/tmp/ws", workspaceID: "wrk_1", port: 4123 })).not.toContain(
      "bash -lc",
    )
  })

  test("touches a lease file without spawning a remote bash watchdog", () => {
    expect(script).toContain(".onescience-lease")
    expect(script).toContain("touch ")
    expect(remoteTouchLeaseScript("/tmp/ws")).toContain("touch '/tmp/ws/.onescience-lease'")
    expect(remoteTouchLeaseScript("/tmp/ws", "tok")).toContain("printf %s 'tok'")
    expect(remoteTouchLeaseScript("/tmp/ws", "tok")).not.toContain("touch '/tmp/ws/.onescience-lease'")
    expect(remoteRefreshLeaseScript("/tmp/ws", "tok")).toContain("if [ -f '/tmp/ws/.onescience-lease' ]")
    expect(remoteRefreshLeaseScript("/tmp/ws", "tok")).toContain("echo GONE")
    expect(remoteRefreshLeaseScript("/tmp/ws", "tok")).not.toContain("mkdir")
    const watchdog = remoteEnsureLeaseWatchdogScript({
      remotePath: "/tmp/ws",
      workspaceID: "wrk_1",
      port: 4123,
    })
    expect(watchdog).toContain("touch '/tmp/ws/.onescience-lease'")
    expect(watchdog).toContain("LEASE_OK")
    expect(watchdog).toContain(".onescience-lease.pid")
    expect(watchdog).not.toContain("bash -lc")
    expect(watchdog).not.toContain("while true")
    expect(watchdog).not.toContain("WATCHDOG_ALREADY")
    expect(remoteKillScript("wrk_1", { remotePath: "/tmp/ws", port: 4123 })).toContain(".onescience-lease.pid")
    expect(remoteKillScript("wrk_1", { remotePath: "/tmp/ws", port: 4123 })).toContain(".onescience-keepalive.sh")
    expect(remoteKillScript("wrk_1", { remotePath: "/tmp/ws", port: 4123 })).not.toContain(".onescience-keepalive.owner")
    expect(remotePathLeafPidsCommand("/tmp/ws")).toContain(".onescience-serve.pid")
    expect(remotePathLeafPidsCommand("/tmp/ws")).not.toContain("environ")
    expect(remotePathLeafPidsCommand("/tmp/ws", 4123)).not.toContain("ps -u")
    expect(remoteKillExtraPathLeafsScript("/tmp/ws", 4123)).toContain(".onescience-serve.pid")
  })

  test("does not re-check a user-filled remote path on start", () => {
    const existingOnly = remoteStartServeScript({
      remotePath: "/data/alice/run-42",
      workspaceID: "wrk_1",
      port: 4123,
      marker: {
        version: 1,
        workspaceID: "wrk_1",
        controlPlaneId: "cp",
        accountId: "alice",
        projectID: "prj_1",
        createdAt: 1,
        servePort: 4123,
      },
    })
    expect(existingOnly).toContain("mkdir -p '/data/alice/run-42/.opencode-db'")
    expect(existingOnly).not.toContain("mkdir -p '/data/alice/run-42' '/data/alice/run-42/.opencode-db'")
    expect(existingOnly).not.toContain("远端路径不存在，请在远端服务器上手动创建该目录后再试")
    expect(existingOnly).not.toContain("[ ! -d")
    expect(existingOnly).not.toContain("[ ! -w")
  })

  test("injects ONECODE_CONTROL_PLANE_URL when catalog forwarding is configured", () => {
    const withUrl = remoteStartServeScript({
      remotePath: "/tmp/ws",
      workspaceID: "wrk_1",
      port: 4123,
      marker: {
        version: 1,
        workspaceID: "wrk_1",
        controlPlaneId: "cp",
        accountId: "alice",
        projectID: "prj_1",
        createdAt: 1,
        servePort: 4123,
      },
      controlPlaneUrl: "http://127.0.0.1:43111",
    })
    expect(withUrl).toContain("ONECODE_CONTROL_PLANE_URL=")
    expect(withUrl).toContain("http://127.0.0.1:43111")
    expect(withUrl).not.toContain("OPENCODE_PLATFORM_AUTH_REQUIRED")
  })
})

describe("ssh-node health status", () => {
  test("lease TTL is 180s so a blipped connect can reuse the leaf", () => {
    expect(LEASE_TTL_SECONDS).toBe(180)
    expect(LEASE_TTL_MS).toBe(180_000)
    expect(CONNECT_TIMEOUT_MS).toBe(360_000)
    expect(REMOTE_LEAF_READY_TIMEOUT_MS).toBe(240_000)
  })
  test("health probes run locally through the tunnel, not as extra SSH", async () => {
    expect(REMOTE_SERVE_HEALTH_TIMEOUT_MS).toBe(60_000)
    expect(REMOTE_SERVE_SPAWN_TIMEOUT_MS).toBe(90_000)
    const source = await Bun.file(new URL("../../src/control-plane/adapters/ssh-node-exec.ts", import.meta.url)).text()
    expect(source).toContain("waitForHealth(port")
    expect(source).toContain("waitForLeafReady")
    expect(source).toContain("waitForServeReadyMark")
    expect(source).toContain("bash --noprofile --norc -c")
    expect(source).toContain("agent: false")
    expect(source).toContain("family: 4")
    expect(source).toContain("req.setTimeout")
    expect(source).toContain('stdout: "pipe"')
    expect(source).toContain('stderr: "ignore"')
    expect(source).toContain("writeRemoteFile")
    expect(source).toContain("login: false")
    expect(source).not.toContain("remoteWaitHealthScript")
    expect(source).not.toContain("waitForRemoteHealth")
    expect(source).not.toContain("HEALTH_POLL_GAP_MS")
    expect(source).toContain("ControlMaster=no")
    expect(source).toContain("remotePinnedKeepaliveBootstrap")
    expect(source).toContain("exec bash --login")
    expect(source).toContain(".onescience-keepalive.sh")
    expect(source).not.toContain("remoteBash(input.keepScript")
    expect(source).not.toContain("nohup bash")
    const serveSource = await Bun.file(new URL("../../src/cli/cmd/serve.ts", import.meta.url)).text()
    expect(serveSource).toContain('Effect.sleep("1000 millis")')
    expect(serveSource).toContain("startSshLeafLeaseWatchdog")
    expect(serveSource).toContain("isSshLeafServe")
    expect(serveSource).toContain("applySshLeafServeEnv")
    expect(serveSource).toContain("ssh-leaf lean startup")
    expect(serveSource).toContain("skip platform seed")
    expect(serveSource.indexOf("applySshLeafServeEnv")).toBeLessThan(serveSource.indexOf("Server.listen"))
    expect(serveSource.indexOf("Server.listen")).toBeLessThan(serveSource.indexOf("OneSkillsBootstrapBundled.run"))
    expect(serveSource.indexOf("isSshLeafServe()")).toBeLessThan(serveSource.indexOf("OneSkillsBootstrapBundled.run"))
    const bootstrapSource = await Bun.file(new URL("../../src/project/bootstrap.ts", import.meta.url)).text()
    expect(bootstrapSource).toContain("isSshLeafServe")
    expect(bootstrapSource).toContain("skill.initHotReload")
    expect(bootstrapSource.indexOf("const leaf = isSshLeafServe()")).toBeLessThan(
      bootstrapSource.indexOf("fileWatcher, vcs, snapshot"),
    )
    const mcpSource = await Bun.file(new URL("../../src/mcp/index.ts", import.meta.url)).text()
    expect(mcpSource).toContain("ssh leaf: skip MCP auto-connect")
    const watcherSource = await Bun.file(new URL("../../src/file/watcher.ts", import.meta.url)).text()
    expect(watcherSource).toContain("OPENCODE_WORKSPACE_ID")
    expect(watcherSource).toContain("watchGit")
    const projectSource = await Bun.file(new URL("../../src/project/project.ts", import.meta.url)).text()
    expect(projectSource).toContain("never walk above the remote project path")
    const snapshotSource = await Bun.file(new URL("../../src/snapshot/index.ts", import.meta.url)).text()
    expect(snapshotSource).toContain("OPENCODE_WORKSPACE_ID")
    expect(snapshotSource).toContain("skip snapshots")
  })

  test("pins serve health and tunnel to one SSH session", () => {
    const keep = remotePinnedKeepaliveScript({
      remotePath: "/tmp/ws",
      workspaceID: "wrk_1",
      port: 4123,
      marker: {
        version: 1,
        workspaceID: "wrk_1",
        controlPlaneId: "cp",
        accountId: "alice",
        projectID: "prj_1",
        createdAt: 1,
        servePort: 4123,
      },
      leaseToken: "abc",
    })
    expect(keep).toContain("OWNER=$$")
    expect(keep).toContain("OWNER_FILE=")
    expect(keep).toContain(".onescience-keepalive.owner")
    expect(keep).toContain("ps -ww")
    expect(keep).toContain("grep -F")
    expect(keep).toContain(".onescience-serve.pid")
    expect(keep).toContain('case "$pid" in $$|$PPID|"")')
    expect(keep.indexOf("ps -ww")).toBeLessThan(keep.indexOf('if [ "$REUSE" -eq 0 ]'))
    expect(keep).toContain("export TMOUT=0")
    expect(keep).toContain("__KEEPALIVE_BOOT__")
    expect(keep).toContain(SERVE_READY_MARK)
    expect(keep).toContain(SERVE_REUSE_MARK)
    expect(keep).toContain("trap ")
    expect(keep).toContain("SERVE_PID=")
    expect(keep).toContain("REUSE=0")
    expect(keep).toContain('if [ "$REUSE" -eq 0 ]')
    expect(keep).toContain('if [ "$REUSE" -eq 1 ]')
    expect(keep).toContain("/proc/$pid/cmdline")
    expect(keep).toContain('readlink "/proc/$pid/cwd"')
    expect(keep).toContain(`[ "$cwd" = '/tmp/ws' ]`)
    expect(keep).not.toContain("grep -F -q '/tmp/ws' && printf '%s' \"$cmd\" | grep -F -q '--port")
    expect(keep).toContain("--port 4123")
    expect(keep).toContain("grep -E 'onecode serve|\\.onecode serve'")
    // Illegal bash after bad joins — keepalive would abort before SERVE_READY.
    expect(keep).not.toMatch(/\bfi if\b/)
    expect(keep).not.toMatch(/\bkilled=0 if\b/)
    expect(keep).not.toMatch(/\bthen;\b/)
    expect(keep).not.toMatch(/\bdo;\b/)
    expect(keep).toContain("killed=0\n")
    expect(keep).toContain("exit 0")
    expect(keep).toContain("INT TERM HUP")
    // Tunnel drop must not kill serve; lease delete / remoteKillScript does.
    expect(keep).toContain("trap 'exit 0' INT TERM HUP")
    expect(keep).toContain("trap 'true' EXIT")
    expect(keep).not.toMatch(/trap 'if \[ -n "\$SERVE_PID" \]; then pkill/)
    expect(keep).toContain("&& [ \"$(tr -d \"[:space:]\" < \"$OWNER_FILE\" 2>/dev/null)\" = \"$OWNER\" ]")
    expect(keep.indexOf("INT TERM HUP")).toBeLessThan(keep.indexOf("trap 'true' EXIT"))
    expect(keep.indexOf("trap ")).toBeLessThan(keep.indexOf("bash --noprofile --norc -c"))
    expect(keep.indexOf("REUSE=1")).toBeLessThan(keep.indexOf('if [ "$REUSE" -eq 0 ]'))
    // Fresh start clears same-port orphans before spawning.
    expect(keep.indexOf("grep -E 'onecode serve|\\.onecode serve'")).toBeLessThan(keep.indexOf("exec onecode serve"))
    expect(keep).not.toContain("nohup ")
    expect(keep).not.toContain("__HEALTH_FAIL__")
    expect(keep).not.toContain("while [ \"$i\" -lt")
    expect(keep).not.toContain("远端路径不存在")
    expect(keep).not.toContain("echo ALREADY")
    expect(keep).toContain("opencode server listening")
    expect(keep).toContain("LISTENING=0")
    expect(keep).toContain("__SERVE_LISTEN_FAIL__")
    expect(keep).toContain("fuser")
    expect(keep).toContain("sleep 0.4")
    expect(keep).toContain("while :; do ")
    expect(keep).toContain("[ -f '/tmp/ws/.onescience-lease' ] ||")
    expect(keep).toContain("printf %s 'abc'")
    expect(keep).toContain(".onescience-lease")
    expect(keep).toContain("sleep 30 & wait $! || true")
    expect(keep).not.toContain("sleep 30; done")
    expect(keep).toContain("OPENCODE_SSH_LEASE_TOKEN=")
    expect(keep).not.toContain("sk-")
    const keepAuth = remotePinnedKeepaliveScript({
      remotePath: "/tmp/ws",
      workspaceID: "wrk_1",
      port: 4123,
      marker: {
        version: 1,
        workspaceID: "wrk_1",
        controlPlaneId: "cp",
        accountId: "alice",
        projectID: "prj_1",
        createdAt: 1,
        servePort: 4123,
      },
      env: { OPENCODE_AUTH_CONTENT: '{"mk_han":{"type":"api","key":"sk-secret"}}' },
      leaseToken: "abc",
    })
    expect(keepAuth).toContain("OPENCODE_AUTH_CONTENT=$(cat")
    expect(keepAuth).not.toContain("sk-secret")
    expect(pickEphemeralPort()).toBeGreaterThanOrEqual(20_000)
    expect(pickEphemeralPort()).toBeLessThan(49_000)
  })

  test("reuseOnly keepalive never startFresh after disconnect", () => {
    const keep = remotePinnedKeepaliveScript({
      remotePath: "/tmp/ws",
      workspaceID: "wrk_1",
      port: 4123,
      marker: {
        version: 1,
        workspaceID: "wrk_1",
        controlPlaneId: "cp",
        accountId: "alice",
        projectID: "prj_1",
        createdAt: 1,
        servePort: 4123,
      },
      leaseToken: "abc",
      reuseOnly: true,
    })
    expect(keep).toContain(SERVE_REUSE_MISS_MARK)
    expect(keep).toContain(SERVE_REUSE_MARK)
    expect(keep).not.toContain("exec onecode serve")
    expect(keep).not.toContain("LISTENING=0")
    expect(keep.indexOf('if [ "$REUSE" -eq 0 ]')).toBeLessThan(keep.indexOf(SERVE_REUSE_MISS_MARK))
  })

  test("treats auth-gated health responses as the serve being up", () => {
    expect(isHealthyHttpStatus(200)).toBe(true)
    expect(isHealthyHttpStatus(401)).toBe(true)
    expect(isHealthyHttpStatus(403)).toBe(true)
    expect(isHealthyHttpStatus(404)).toBe(false)
    expect(isHealthyHttpStatus(500)).toBe(false)
    expect(isInstanceReadyHttpStatus(200)).toBe(true)
    expect(isInstanceReadyHttpStatus(401)).toBe(false)
    expect(isInstanceReadyHttpStatus(403)).toBe(false)
    expect(isInstanceReadyHttpStatus(500)).toBe(false)
  })

  test("waitForServeReadyMark resolves when stdout prints the mark", async () => {
    const stdout = new PassThrough()
    const exited = new Promise<void>(() => {})
    const ready = waitForServeReadyMark({ stdout, exited }, 1_000)
    stdout.write(`login noise\n${SERVE_READY_MARK}\n`)
    expect(await ready).toBe(false)
  })

  test("waitForServeReadyMark reports same-node serve reuse", async () => {
    const stdout = new PassThrough()
    const exited = new Promise<void>(() => {})
    const ready = waitForServeReadyMark({ stdout, exited }, 1_000)
    stdout.write(`${SERVE_REUSE_MARK}\n${SERVE_READY_MARK}\n`)
    expect(await ready).toBe(true)
  })

  test("parseServeBootstrapDetail maps the last serve log line", () => {
    expect(parseServeBootstrapDetail("serve: bootstrap OneSkills...\n")).toBe("正在准备 OneSkills")
    expect(parseServeBootstrapDetail("serve: catalog bootstrap...\n")).toBe("正在加载模型目录")
    expect(parseServeBootstrapDetail("serve: ssh-leaf lean startup (skip platform seed)\n")).toBe("远端叶子精简启动")
    expect(parseServeBootstrapDetail("serve: ready\n")).toBe("正在确认远端服务")
    expect(serveBootstrapFailed("serve: bootstrap failed: nfs timeout")).toBe("nfs timeout")
    expect(serveLogStillSeeding("serve: catalog bootstrap...\n")).toBe(true)
    expect(serveLogStillSeeding("serve: catalog bootstrap...\nserve: ready\n")).toBe(false)
    expect(serveLogStillSeeding("serve: ssh-leaf lean startup (skip platform seed)\n")).toBe(false)
    expect(serveLogStillSeeding("opencode server listening on http://127.0.0.1:4123\n")).toBe(true)
    expect(serveLogStillSeeding("opencode server listening on http://127.0.0.1:4123\nserve: ready\n")).toBe(false)
  })

  test("waitForLeafReady succeeds when /config and /file return 200", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/config" || req.url?.startsWith("/config?") || req.url === "/file" || req.url?.startsWith("/file?")) {
        res.writeHead(200)
        res.end("{}")
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      await waitForLeafReady({ port, directory: "/tmp/ws", timeoutMs: 5_000, stableMs: 0 })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  test("waitForLeafReady fails when serve bootstrap failed", async () => {
    await expect(
      waitForLeafReady({
        port: 1,
        directory: "/tmp/ws",
        timeoutMs: 2_000,
        readLog: async () => "serve: bootstrap failed: nfs timeout",
      }),
    ).rejects.toThrow("远端 serve 初始化失败")
  })

  test("waitForLeafReady does not treat a running seed as HTTP failure", async () => {
    await expect(
      waitForLeafReady({
        port: 1,
        directory: "/tmp/ws",
        timeoutMs: 2_500,
        readLog: async () => "serve: catalog bootstrap...\n",
      }),
    ).rejects.toThrow("远端环境未在时限内就绪")
  })

  test("waitForLeafReady does not treat /file 401 as instance-ready", async () => {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/config")) {
        res.writeHead(200)
        res.end("{}")
        return
      }
      if (req.url?.startsWith("/file")) {
        res.writeHead(401)
        res.end("auth")
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const port = (server.address() as { port: number }).port
    try {
      await expect(waitForLeafReady({ port, directory: "/tmp/ws", timeoutMs: 2_500 })).rejects.toThrow(
        "远端环境未在时限内就绪",
      )
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
