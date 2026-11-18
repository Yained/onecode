import type { ConfigSSH } from "@/config/ssh"
import { controlPlaneId } from "../control-plane-id"
import {
  defaultRemotePath,
  markerConflict,
  parseMarker,
} from "./ssh-node-path"
import { runRemote, remoteCombinedPreflightScript, REMOTE_HOME_SCRIPT } from "./ssh-node-exec"
import {
  beginPreflightProgress,
  finishConnectProgress,
  markPreflightStep,
  type PreflightStepId,
} from "./ssh-node-progress"

export type WorkspacePreflightCheck = {
  id: "ssh" | "remotePath" | "onecode" | "marker"
  ok: boolean
  skipped?: boolean
  message: string
  detail?: string
}

export type WorkspacePreflightResult = {
  ok: boolean
  remotePath: string
  checks: WorkspacePreflightCheck[]
  /** Raw marker JSON from the combined preflight (when present). */
  markerText?: string
}

export type RemotePreflightRunner = (
  command: string,
  timeout?: number,
) => Promise<{ code: number; stdout: string; stderr: string }>

function skip(
  id: WorkspacePreflightCheck["id"],
  message: string,
  detail?: string,
): WorkspacePreflightCheck {
  return { id, ok: true, skipped: true, message, detail }
}

function stripPreflightMarkers(text: string) {
  return text
    .replace(
      /__SSH_OK__|__PATH_OK__|__PATH_FAIL__|__MARKER_NONE__|__MARKER_END__|__MARKER__|__ONECODE_OK__|__ONECODE_MISSING__/g,
      "",
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

function failMessage(result: { stdout: string; stderr: string }, fallback: string) {
  return stripPreflightMarkers(result.stderr) || stripPreflightMarkers(result.stdout) || fallback
}

/** CI publish stamp in the ssh-node adapter (CST YYYYMMDDHHmm). Remote serve must be this stamp or newer. */
export const SSH_NODE_MIN_ONECODE = {
  major: 1,
  minor: 14,
  patch: 50,
  // Picker must await global catalog only (not hung instance /provider).
  date: 20260919,
  time: 1559,
} as const

export function sshNodeMinOnecodeLabel() {
  return `${SSH_NODE_MIN_ONECODE.major}.${SSH_NODE_MIN_ONECODE.minor}.${SSH_NODE_MIN_ONECODE.patch}-${SSH_NODE_MIN_ONECODE.date}${String(SSH_NODE_MIN_ONECODE.time).padStart(4, "0")}`
}

/** Shown when remote onecode is missing or below the ssh-node minimum. */
export const ONECODE_INSTALL_HINT =
  "npm install -g @onescience/onecode@latest --allow-scripts=@onescience/onecode"

const VERSION_RE = /(\d+)\.(\d+)\.(\d+)(?:-(\d{8})(\d{4})?)?/

function minOnecodeStamp() {
  return SSH_NODE_MIN_ONECODE.date * 10_000 + SSH_NODE_MIN_ONECODE.time
}

function withInstallHint(message: string) {
  return `${message}\n请在远端服务器执行：${ONECODE_INSTALL_HINT}`
}

function versionNeedMessage(prefix: string) {
  return withInstallHint(`${prefix}需要不低于 ${sshNodeMinOnecodeLabel()} 的 OneCode 版本`)
}

export function evaluateOnecodeVersion(raw: string | undefined) {
  const text = raw?.trim() ?? ""
  const match = text.match(VERSION_RE)
  if (!match) {
    return {
      ok: false,
      message: text
        ? versionNeedMessage(`远端 onecode 版本无法识别（${text}），远端 workspace `)
        : withInstallHint(
            `远端找不到 onecode 版本号，请升级到不低于 ${sshNodeMinOnecodeLabel()} 的 OneCode 版本`,
          ),
    }
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const date = match[4] ? Number(match[4]) : undefined
  const time = match[5] ? Number(match[5]) : 0
  const stamp = date === undefined ? undefined : date * 10_000 + time
  const newerBase =
    major > SSH_NODE_MIN_ONECODE.major ||
    (major === SSH_NODE_MIN_ONECODE.major && minor > SSH_NODE_MIN_ONECODE.minor) ||
    (major === SSH_NODE_MIN_ONECODE.major &&
      minor === SSH_NODE_MIN_ONECODE.minor &&
      patch > SSH_NODE_MIN_ONECODE.patch)
  const sameBase =
    major === SSH_NODE_MIN_ONECODE.major &&
    minor === SSH_NODE_MIN_ONECODE.minor &&
    patch === SSH_NODE_MIN_ONECODE.patch
  const ok = newerBase || (sameBase && stamp !== undefined && stamp >= minOnecodeStamp())
  if (ok) {
    return { ok: true, message: `onecode ${text}` }
  }
  return {
    ok: false,
    message: versionNeedMessage(`远端 onecode 版本过低（${text}），远端 workspace `),
  }
}

function parseCombinedPreflightStdout(stdout: string, stderr = "") {
  // Login-node bashrc often dumps motd / module noise on stderr and exits
  // non-zero after our markers. Read both streams; newlines may be flattened.
  const text = `${stdout}\n${stderr}`.replace(/\r/g, "")
  const sshOk = text.includes("__SSH_OK__")
  const pathOk = text.includes("__PATH_OK__")
  const pathFail = text.includes("__PATH_FAIL__")
  let markerText: string | undefined
  if (text.includes("__MARKER_NONE__")) {
    markerText = "__NONE__"
  } else {
    const start = text.search(/__MARKER__\n?/)
    const end = text.search(/\n?__MARKER_END__/)
    if (start >= 0 && end > start) {
      const header = text.slice(start).match(/^__MARKER__\n?/)?.[0] ?? "__MARKER__\n"
      markerText = text.slice(start + header.length, end).trim()
    }
  }
  const onecodeMissing = text.includes("__ONECODE_MISSING__")
  const onecodeOk = text.includes("__ONECODE_OK__")
  const versionMatch = text.match(VERSION_RE)
  const version = versionMatch?.[0]
  return { sshOk, pathOk, pathFail, markerText, onecodeMissing, onecodeOk, version }
}

/**
 * Single SSH round-trip for login nodes (ssh + path + marker + onecode).
 * Avoids 4 sequential SSH sessions on busy shared hosts.
 */
export async function runWorkspacePreflightChecks(input: {
  remotePath: string
  controlPlaneId: string
  accountId: string
  projectID?: string
  createIfMissing?: boolean
  run: RemotePreflightRunner
  onStep?: (id: PreflightStepId) => void
}): Promise<{ checks: WorkspacePreflightCheck[]; markerText?: string }> {
  const checks: WorkspacePreflightCheck[] = []
  const remotePath = input.remotePath
  const onStep = input.onStep
  const createIfMissing = input.createIfMissing !== false

  onStep?.("ssh")
  const result = await input.run(remoteCombinedPreflightScript(remotePath, { createIfMissing }), 40_000)
  const parsed = parseCombinedPreflightStdout(result.stdout, result.stderr)
  // Markers mean the remote shell started. Do not treat a later bashrc/`set -e`
  // non-zero exit as an SSH failure (common on scnet login nodes).
  const sshOk = parsed.sshOk
  checks.push({
    id: "ssh",
    ok: sshOk,
    message: sshOk ? "SSH 连通" : failMessage(result, "SSH 连接失败"),
  })
  if (!sshOk) {
    checks.push(
      skip("remotePath", "未检查远端目录", remotePath),
      skip("marker", "未检查标记文件"),
      skip("onecode", "未检测 onecode"),
    )
    return { checks }
  }

  onStep?.("remotePath")
  const pathOk = parsed.pathOk && !parsed.pathFail
  const pathFailMessage = createIfMissing
    ? "远端目录不可写或创建失败"
    : "远端路径不存在，请在远端服务器上手动创建该目录后再试"
  checks.push({
    id: "remotePath",
    ok: pathOk,
    message: pathOk ? (createIfMissing ? "远端目录可写" : "远端目录可访问") : failMessage(result, pathFailMessage),
    detail: remotePath,
  })
  if (!pathOk) {
    checks.push(skip("marker", "未检查标记文件"), skip("onecode", "未检测 onecode"))
    return { checks }
  }

  onStep?.("marker")
  const marker = parsed.markerText && parsed.markerText !== "__NONE__" ? parseMarker(parsed.markerText) : undefined
  const conflict = markerConflict(marker, {
    controlPlaneId: input.controlPlaneId,
    accountId: input.accountId,
    projectID: input.projectID,
  })
  checks.push({
    id: "marker",
    ok: !conflict,
    message: conflict || "目录未被占用",
  })
  if (conflict) {
    checks.push(skip("onecode", "未检测 onecode"))
    return { checks, markerText: parsed.markerText }
  }

  onStep?.("onecode")
  if (parsed.onecodeMissing || !parsed.onecodeOk) {
    checks.push({
      id: "onecode",
      ok: false,
      message: withInstallHint("远端找不到 onecode 命令，请先在远端服务器上安装 OneCode CLI"),
    })
    return { checks, markerText: parsed.markerText }
  }
  const evaluated = evaluateOnecodeVersion(parsed.version)
  checks.push({
    id: "onecode",
    ok: evaluated.ok,
    message: evaluated.message,
  })
  return { checks, markerText: parsed.markerText }
}

export function failedPreflightMessage(checks: WorkspacePreflightCheck[]) {
  const failed = checks.find((item) => !item.skipped && !item.ok)
  return failed?.message?.trim() || "远端环境检测未通过，无法连接"
}

export async function workspacePreflight(input: {
  config: ConfigSSH.Info
  accountId?: string
  projectSlug?: string
  projectID?: string
  remotePath?: string
  progressKey?: string
  createIfMissing?: boolean
}): Promise<WorkspacePreflightResult> {
  const accountId = (input.accountId || "local").trim() || "local"
  const planeId = controlPlaneId()
  const progressKey = input.progressKey?.trim() || ""
  const userPath = input.remotePath?.trim()
  // Always try to create the remote path when the user supplied one; only bail if mkdir -p fails.
  const createIfMissing = input.createIfMissing !== false
  beginPreflightProgress(progressKey)
  try {
    let remotePath = userPath
    if (!remotePath) {
      markPreflightStep(progressKey, "ssh")
      // scnet login-node bashrc often exceeds a short timeout; $HOME does not need it.
      const home = await runRemote(input.config, REMOTE_HOME_SCRIPT, 20_000, { login: false })
      const resolved = home.stdout.trim()
      if (home.code !== 0 || !resolved.startsWith("/")) {
        const message = home.stderr.trim() || home.stdout.trim() || "无法解析远端 $HOME，留空路径时需要可用的家目录"
        finishConnectProgress(progressKey, false)
        return {
          ok: false,
          remotePath: "",
          checks: [
            { id: "ssh", ok: false, message },
            skip("remotePath", "未检查远端目录"),
            skip("marker", "未检查标记文件"),
            skip("onecode", "未检测 onecode"),
          ],
        }
      }
      remotePath = defaultRemotePath({
        basePath: resolved,
        controlPlaneId: planeId,
        accountId,
        projectSlug: input.projectSlug || "default",
      })
    }
    const checks = await runWorkspacePreflightChecks({
      remotePath,
      controlPlaneId: planeId,
      accountId,
      projectID: input.projectID,
      createIfMissing,
      run: (command, timeout) => runRemote(input.config, command, timeout),
      onStep: (id) => markPreflightStep(progressKey, id),
    })
    const ok = checks.checks.filter((item) => !item.skipped).every((item) => item.ok)
    finishConnectProgress(progressKey, ok)
    return {
      ok,
      remotePath,
      checks: checks.checks,
      markerText: checks.markerText,
    }
  } catch (error) {
    finishConnectProgress(progressKey, false)
    const message = error instanceof Error ? error.message : "预检失败"
    return {
      ok: false,
      remotePath: userPath || "",
      checks: [
        { id: "ssh", ok: false, message },
        skip("remotePath", "未检查远端目录", userPath),
        skip("marker", "未检查标记文件"),
        skip("onecode", "未检测 onecode"),
      ],
    }
  }
}
