import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createServer } from "node:net"
import type { ServerConnection } from "@opencode-ai/app"

export type SshConnectConfig = {
  host: string
  port?: number
  username?: string
  remotePath: string
  displayName?: string
  auth?: {
    type: "config" | "agent" | "key" | "password"
    keyPath?: string
  }
  startup?: {
    command?: string
    remotePort?: number
  }
}

export type SshRuntimeStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "auth_failed"
  | "missing_directory"
  | "missing_opencode"
  | "server_failed"
  | "tunnel_failed"
  | "error"

export type SshStatus = {
  key: string
  status: SshRuntimeStatus
  message?: string
}

type CommandPlan = {
  command: "ssh"
  args: string[]
}

type PortPlan = {
  localPort: number
  remotePort: number
}

type RunningConnection = {
  conn: ServerConnection.Ssh
  status: SshRuntimeStatus
  logs: string[]
  serverProcess?: ChildProcessWithoutNullStreams
  tunnelProcess?: ChildProcessWithoutNullStreams
}

export function sshConnectionKey(config: Pick<SshConnectConfig, "host" | "remotePath">) {
  return `ssh:${config.host}:${config.remotePath}`
}

export function sshStatusLabel(status: SshRuntimeStatus) {
  return (
    {
      disconnected: "未连接",
      connecting: "连接中",
      connected: "已连接",
      auth_failed: "SSH 认证失败",
      missing_directory: "远端目录不可用",
      missing_opencode: "远端 onecode 未安装",
      server_failed: "远端服务启动失败",
      tunnel_failed: "隧道已断开",
      error: "连接失败",
    } satisfies Record<SshRuntimeStatus, string>
  )[status]
}

export function planSshConnection(config: SshConnectConfig, ports: PortPlan) {
  const base = sshBaseArgs(config)
  const target = sshTarget(config)
  const command = config.startup?.command?.trim() || "onecode"
  const remoteCommand = `cd ${shellQuote(config.remotePath)} && ${command} serve --hostname 127.0.0.1 --port ${ports.remotePort}`

  return {
    key: sshConnectionKey(config),
    http: { url: `http://127.0.0.1:${ports.localPort}` },
    checkDirectory: {
      command: "ssh",
      args: [...base, target, `test -d ${shellQuote(config.remotePath)}`],
    } satisfies CommandPlan,
    checkOpencode: {
      command: "ssh",
      args: [...base, target, `command -v ${remoteExecutable(command)}`],
    } satisfies CommandPlan,
    startServer: {
      command: "ssh",
      args: [...base, target, remoteCommand],
    } satisfies CommandPlan,
    tunnel: {
      command: "ssh",
      args: [...base, "-N", "-L", `127.0.0.1:${ports.localPort}:127.0.0.1:${ports.remotePort}`, target],
    } satisfies CommandPlan,
  }
}

export function createSshRemoteManager() {
  const connections = new Map<string, RunningConnection>()

  async function connect(config: SshConnectConfig): Promise<ServerConnection.Ssh> {
    const localPort = await findPort()
    const remotePort = config.startup?.remotePort ?? localPort
    const plan = planSshConnection(config, { localPort, remotePort })
    const existing = connections.get(plan.key)
    if (existing) disconnect(plan.key)

    const running: RunningConnection = {
      status: "connecting",
      logs: [],
      conn: {
        type: "ssh",
        host: config.host,
        port: config.port,
        username: config.username,
        remotePath: config.remotePath,
        displayName: config.displayName,
        auth: config.auth,
        startup: { ...config.startup, remotePort },
        tunnel: { localPort, remotePort, status: "connecting" },
        http: plan.http,
      },
    }
    connections.set(plan.key, running)

    await exec(plan.checkDirectory).catch((err) => {
      running.status = classifySshError(err.stderr || err.message, "missing_directory")
      throw new Error(sshStatusLabel(running.status))
    })
    await exec(plan.checkOpencode).catch((err) => {
      running.status = classifySshError(err.stderr || err.message, "missing_opencode")
      throw new Error(sshStatusLabel(running.status))
    })

    running.serverProcess = spawnCommand(plan.startServer, running)
    running.tunnelProcess = spawnCommand(plan.tunnel, running)
    running.status = "connected"
    running.conn.tunnel = { localPort, remotePort, status: "connected" }
    return running.conn
  }

  function disconnect(key: string) {
    const running = connections.get(key)
    if (!running) return
    running.serverProcess?.kill()
    running.tunnelProcess?.kill()
    running.status = "disconnected"
    running.conn.tunnel = running.conn.tunnel ? { ...running.conn.tunnel, status: "disconnected" } : undefined
    connections.delete(key)
  }

  function status(key: string): SshStatus {
    const running = connections.get(key)
    return { key, status: running?.status ?? "disconnected" }
  }

  function logs(key: string) {
    return connections.get(key)?.logs ?? []
  }

  function disconnectAll() {
    for (const key of connections.keys()) disconnect(key)
  }

  return { connect, disconnect, disconnectAll, status, logs }
}

function sshBaseArgs(config: SshConnectConfig) {
  return [
    ...(config.port ? ["-p", String(config.port)] : []),
    ...(config.auth?.type === "key" && config.auth.keyPath ? ["-i", config.auth.keyPath] : []),
  ]
}

function sshTarget(config: SshConnectConfig) {
  return config.username ? `${config.username}@${config.host}` : config.host
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function remoteExecutable(command: string) {
  const parts = command.split(/\s+/).filter(Boolean)
  const index = parts.findIndex((part) => part.includes("onecode") || part.includes("opencode"))
  return index === -1 ? parts[0] ?? "onecode" : parts[index]
}

function exec(plan: CommandPlan) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(plan.command, plan.args, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function spawnCommand(plan: CommandPlan, running: RunningConnection) {
  const child = spawn(plan.command, plan.args)
  child.stdout.on("data", (data) => running.logs.push(String(data)))
  child.stderr.on("data", (data) => running.logs.push(String(data)))
  child.on("exit", () => {
    if (running.status === "disconnected") return
    running.status = plan.args.includes("-N") ? "tunnel_failed" : "server_failed"
    running.conn.tunnel = running.conn.tunnel ? { ...running.conn.tunnel, status: "error" } : undefined
  })
  return child
}

function classifySshError(message: string, fallback: SshRuntimeStatus) {
  const lower = message.toLowerCase()
  if (lower.includes("permission denied") || lower.includes("authentication")) return "auth_failed"
  if ((lower.includes("onecode") || lower.includes("opencode")) && lower.includes("not found")) return "missing_opencode"
  return fallback
}

function findPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port)
          return
        }
        reject(new Error("Unable to allocate local SSH tunnel port"))
      })
    })
  })
}
