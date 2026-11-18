# Remote Code Workflow Design

## Goal

Design a remote development workflow for the OneScience `/code` page. The primary path is SSH remote development: the desktop app connects to a remote machine, starts `onecode serve` there, exposes it through a local SSH tunnel, and lets the existing `/code` UI talk to that tunneled HTTP server. MCP remains a complementary tool connection for remote actions, APIs, jobs, and deployment workflows.

The result should feel similar to VS Code Remote SSH: files, sessions, terminal commands, and AI coding operations run on the remote host while the local UI stays responsive and uses the current opencode HTTP SDK path.

## Scope

MVP includes:

- Desktop-only SSH remote server connections.
- SSH host alias support through the user's existing SSH configuration and ssh-agent.
- Remote workspace path input.
- Remote `onecode serve` startup.
- Local tunnel health checks.
- Server selection UI support for HTTP, SSH, and MCP groups.
- `/code` using the selected SSH server transparently through `conn.http.url`.

MVP does not include:

- Browser-only SSH tunneling.
- Password or private key storage in app local storage.
- Automatic remote opencode installation.
- Remote graphical file picker.
- Shared team secrets.

## Architecture

The current `/code` page already connects to an opencode HTTP server. The SSH design keeps that contract unchanged.

```text
OneScience desktop app
  -> desktop SSH manager
  -> local tunnel http://127.0.0.1:<localPort>
  -> ssh -L
  -> remote 127.0.0.1:<remotePort>
  -> onecode serve running in <remotePath>
```

The frontend should not implement SSH details. It should receive a `ServerConnection.Ssh` object whose `http.url` points at the local tunnel URL. Existing SDK creation, health checks, session APIs, file APIs, and terminal APIs can continue using HTTP.

MCP should remain separate from the main `/code` server transport. It is best used for remote tools such as deployment, cluster job submission, log queries, internal APIs, and data processing commands.

## User Workflow

1. User opens `/code`.
2. User opens the server selector.
3. User chooses `SSH 远程`.
4. User enters:
   - Connection name.
   - SSH host or SSH config alias.
   - Optional username.
   - Remote workspace path.
   - Optional advanced settings.
5. User clicks `测试连接`.
6. Desktop app validates SSH access, checks the remote path, starts `onecode serve`, creates a local tunnel, and runs an HTTP health check.
7. User clicks `保存并连接`.
8. `/code` switches to the SSH server and creates or resumes sessions against the remote workspace.

## Server Selector UI

The server selector should use a segmented control:

```text
本地/HTTP | SSH 远程 | MCP 工具
```

HTTP keeps the current behavior. SSH adds remote development servers. MCP lists tool connections and should not be presented as a full `/code` server replacement.

SSH server rows should show:

```text
生产机 DevBox
SSH  devbox  /home/user/project
状态：已连接
[进入] [重连] [编辑] [删除]
```

Supported SSH states:

- `未连接`
- `连接中`
- `已连接`
- `SSH 认证失败`
- `远端目录不可用`
- `远端 opencode 未安装`
- `远端服务启动失败`
- `隧道已断开`

## SSH Form

Basic fields:

- `连接名称`
- `SSH Host / Alias`
- `用户名`
- `远程工作目录`

Advanced fields should be collapsed by default:

- `端口`, default `22`.
- `Identity File`, optional.
- `远端 opencode 命令`, default `onecode`.
- `远端端口`, default auto.
- `启动前 Shell 命令`, optional.
- `环境变量`, optional.

The preferred authentication path is `~/.ssh/config` plus ssh-agent. Password support can be added later through the OS keychain, not through app local storage.

## Data Model

Extend the existing `ServerConnection.Ssh` shape in `packages/app/src/context/server.tsx`:

```ts
export type Ssh = {
  type: "ssh"
  host: string
  port?: number
  username?: string
  remotePath: string
  auth?: {
    type: "config" | "agent" | "key"
    keyPath?: string
  }
  startup?: {
    command?: string
    remotePort?: number
  }
  tunnel?: {
    localPort: number
    remotePort: number
    status: "connecting" | "connected" | "disconnected" | "error"
  }
  http: ServerConnection.HttpBase
  displayName?: string
}
```

`ServerConnection.key(conn)` should use a stable SSH key that includes both host and remote path, for example `ssh:<host>:<remotePath>`. This allows one remote machine to host multiple saved project connections.

## Code Modules

`packages/app/src/context/server.tsx`

- Persist SSH server entries.
- Normalize SSH server keys.
- Keep health checks based on `conn.http`.
- Allow SSH entries in add, remove, and active server flows.

`packages/app/src/components/dialog-select-server.tsx`

- Add HTTP, SSH, and MCP group navigation.
- Add SSH connection form.
- Add SSH connection status and row actions.
- Keep current HTTP add/edit behavior intact.

`packages/app/src/context/platform.tsx`

- Add optional desktop APIs:

```ts
sshConnect?(config): Promise<ServerConnection.Ssh>
sshDisconnect?(key): Promise<void>
sshStatus?(key): Promise<SshStatus>
sshLogs?(key): Promise<string[]>
```

`packages/desktop/src/preload/*`

- Expose the SSH platform APIs to the renderer.

`packages/desktop/src/main/ssh-remote.ts`

- Own SSH process lifecycle.
- Start remote `onecode serve`.
- Create and monitor local tunnels.
- Provide connection status and logs.
- Stop remote and tunnel processes when disconnected.

`packages/app/src/utils/server.ts`

- Continue creating SDKs from `server.http.url`.
- Avoid adding SSH-specific SDK behavior.

## Runtime Sequence

Connect:

```text
Renderer SSH form
  -> platform.sshConnect(config)
  -> desktop SSH manager
  -> ssh host "test -d <remotePath>"
  -> ssh host "cd <remotePath> && onecode serve --hostname 127.0.0.1 --port <remotePort>"
  -> ssh -N -L 127.0.0.1:<localPort>:127.0.0.1:<remotePort> host
  -> health check http://127.0.0.1:<localPort>
  -> return ServerConnection.Ssh
  -> set active server
  -> /code uses existing SDK path
```

Disconnect:

```text
Renderer action
  -> platform.sshDisconnect(key)
  -> desktop SSH manager stops local tunnel
  -> desktop SSH manager stops the associated remote onecode serve process when it owns that process
  -> server row status becomes 未连接
```

MCP tool use:

```text
/code session
  -> selected onecode server
  -> configured MCP server
  -> remote API / remote job / deployment tool
```

## Error Handling

Connection errors should be surfaced as actionable states instead of generic request failures:

- SSH command unavailable locally.
- Host not found.
- Authentication failed.
- Remote path missing.
- Remote `opencode` unavailable.
- Remote port unavailable.
- Local tunnel port unavailable.
- Health check timeout.

The SSH form should keep the entered values after failure so the user can adjust one field and retry.

## Security

- Remote `onecode serve` must bind to `127.0.0.1`, not `0.0.0.0`.
- Passwords and private key passphrases must not be stored in app local storage.
- Prefer SSH config and ssh-agent.
- Future password support should use OS keychain APIs in the desktop main process.
- Logs should redact credentials and avoid printing full command lines with secrets.

## Testing

Frontend tests:

- SSH server entries can be persisted and selected.
- SSH rows render status, remote path, and actions.
- HTTP server behavior remains unchanged.
- `/code` SDK creation still uses `conn.http.url`.

Desktop tests:

- SSH command arguments are built correctly.
- Tunnel lifecycle state transitions are deterministic.
- Failure states map to user-facing status labels.

Manual verification:

- Connect with an SSH config alias.
- Connect with host, user, and port.
- Open `/code` and create a session in the remote path.
- Run a terminal command and confirm it executes remotely.
- Disconnect and reconnect.

## Rollout Plan

Phase 1:

- Add SSH data model and UI.
- Add desktop SSH manager.
- Require remote `opencode` to be installed.
- Support connect, disconnect, reconnect, and health state.

Phase 2:

- Add remote opencode installer or updater.
- Add SSH logs panel.
- Add remote path history.
- Add reconnect on tunnel failure.

Phase 3:

- Add richer MCP tool grouping.
- Add SSH + MCP workflow templates.
- Add team connection templates without shared secrets.
