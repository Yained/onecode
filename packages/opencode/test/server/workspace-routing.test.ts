import { describe, expect, test } from "bun:test"
import {
  isLocalWorkspaceRoute,
  isSessionTranscriptReadRoute,
  getWorkspaceRouteSessionID,
  stampLeafDirectoryOnProxyURL,
  workspaceProxyURL,
} from "../../src/server/shared/workspace-routing"
import { SessionID } from "../../src/session/schema"

describe("isLocalWorkspaceRoute", () => {
  test("GET /session is local", () => {
    expect(isLocalWorkspaceRoute("GET", "/session")).toBe(true)
  })

  test("POST /session is local so first-prompt create stays on the control plane", () => {
    expect(isLocalWorkspaceRoute("POST", "/session")).toBe(true)
  })

  test("GET/DELETE session records stay on the control plane", () => {
    expect(isLocalWorkspaceRoute("GET", "/session/ses_abc")).toBe(true)
    expect(isLocalWorkspaceRoute("DELETE", "/session/ses_abc")).toBe(true)
    expect(isLocalWorkspaceRoute("PATCH", "/session/ses_abc")).toBe(true)
  })

  test("live session transcript is forwarded to the bound leaf", () => {
    expect(isLocalWorkspaceRoute("GET", "/session/ses_abc/message")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/session/ses_abc/messages")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/session/ses_abc/message/msg_1")).toBe(false)
  })

  test("transcript reads are identifiable so a dead leaf can fall back to the control plane", () => {
    expect(isSessionTranscriptReadRoute("GET", "/session/ses_abc/message")).toBe(true)
    expect(isSessionTranscriptReadRoute("GET", "/session/ses_abc/messages")).toBe(true)
    expect(isSessionTranscriptReadRoute("GET", "/session/ses_abc/message/msg_1")).toBe(true)
    expect(isSessionTranscriptReadRoute("GET", "/api/session/ses_abc/message")).toBe(true)
    expect(isSessionTranscriptReadRoute("POST", "/session/ses_abc/message")).toBe(false)
    expect(isSessionTranscriptReadRoute("GET", "/session/ses_abc")).toBe(false)
  })

  test("prompt and sync routes do not spawn a leaf", async () => {
    const source = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/middleware/workspace-routing.ts", import.meta.url),
    ).text()
    expect(source).toContain("resolveTarget(workspace, { create: false, reconnect: false })")
    expect(source).not.toContain("transcript ? false : undefined")
    expect(source).not.toContain("transcript ? { create: false }")
    expect(source).toContain("readFallback")
    expect(source).toContain("const readFallback = !!localDir && transcript")
    expect(source).not.toContain("transcript || request.method === \"GET\"")
    // Unbound browser traffic must stay on A — leftover live steal froze or blanked.
    expect(source).toContain("Intentionally no leftover-live steal")
    expect(source).not.toContain("resolveLiveSshWorkspaceByDirectory")
    expect(source).toContain("Only the live client bind (header/query) may select a leaf")
    expect(source).not.toContain("?? sessionWorkspaceID")
  })

  test("session execution routes are forwarded to the remote workspace", () => {
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/prompt_async")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/prompt")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/message")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/command")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/shell")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/abort")).toBe(false)
  })

  test("/session/status is forwarded regardless of method", () => {
    expect(isLocalWorkspaceRoute("GET", "/session/status")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/session/status")).toBe(false)
  })

  test("unrecognized paths are not local", () => {
    expect(isLocalWorkspaceRoute("GET", "/config")).toBe(false)
  })

  test("control-plane sync routes stay local", () => {
    expect(isLocalWorkspaceRoute("POST", "/sync/start")).toBe(true)
    expect(isLocalWorkspaceRoute("POST", "/sync/history")).toBe(true)
  })

  test("session viewer routes stay on the control plane", () => {
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/view")).toBe(true)
    expect(isLocalWorkspaceRoute("DELETE", "/session/ses_abc/view")).toBe(true)
    expect(isLocalWorkspaceRoute("POST", "/session/ses_abc/view/heartbeat")).toBe(true)
  })

  test("file tree routes are forwarded to the remote workspace", () => {
    expect(isLocalWorkspaceRoute("GET", "/file")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/file/path-to-directory")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/file/upload")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/file/disk-space")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/find/file")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/pty")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/pty/pty_1/connect")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/pty/pty_1/connect-token")).toBe(false)
  })

  test("OneData catalog routes stay on the control plane", () => {
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/probe")).toBe(true)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/raw-source")).toBe(true)
    expect(isLocalWorkspaceRoute("GET", "/experimental/onescience/already")).toBe(true)
    expect(isLocalWorkspaceRoute("PUT", "/experimental/onescience/session/ses_1/chips")).toBe(true)
    expect(isLocalWorkspaceRoute("GET", "/experimental/onescience/data-project")).toBe(true)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/data-project")).toBe(true)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/modelscope/download")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/fs-stat")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/fs-sample")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/already")).toBe(true)
    expect(isLocalWorkspaceRoute("POST", "/experimental/onescience/already/scan")).toBe(true)
    expect(isLocalWorkspaceRoute("PUT", "/experimental/onescience/object-store-key")).toBe(true)
    expect(isLocalWorkspaceRoute("GET", "/experimental/onescience/object-store-key")).toBe(true)
    expect(isLocalWorkspaceRoute("DELETE", "/experimental/onescience/object-store-key/s3")).toBe(true)
    expect(isLocalWorkspaceRoute("PUT", "/experimental/onescience/db-connection")).toBe(true)
    expect(isLocalWorkspaceRoute("GET", "/experimental/onescience/db-connection")).toBe(true)
    expect(isLocalWorkspaceRoute("DELETE", "/experimental/onescience/db-connection/dbc_1")).toBe(true)
    expect(isLocalWorkspaceRoute("GET", "/experimental/onescience/db-connection/dbc_1/tables")).toBe(true)
  })

  test("project delete and experimental session list stay on the control plane", () => {
    expect(isLocalWorkspaceRoute("GET", "/experimental/session")).toBe(true)
    expect(isLocalWorkspaceRoute("DELETE", "/project/current")).toBe(true)
    expect(isLocalWorkspaceRoute("GET", "/project/current")).toBe(false)
    expect(isLocalWorkspaceRoute("PATCH", "/project/prj_1")).toBe(false)
  })
})

describe("getWorkspaceRouteSessionID", () => {
  test("extracts session ID from path", () => {
    const url = new URL("http://localhost/session/ses_abc123/message")
    expect(getWorkspaceRouteSessionID(url)).toBe(SessionID.make("ses_abc123"))
  })

  test("extracts session ID without trailing path", () => {
    const url = new URL("http://localhost/session/ses_xyz")
    expect(getWorkspaceRouteSessionID(url)).toBe(SessionID.make("ses_xyz"))
  })

  test("returns null for /session/status", () => {
    const url = new URL("http://localhost/session/status")
    expect(getWorkspaceRouteSessionID(url)).toBeNull()
  })

  test("returns null for non-session paths", () => {
    const url = new URL("http://localhost/config")
    expect(getWorkspaceRouteSessionID(url)).toBeNull()
  })

  test("returns null for bare /session path", () => {
    const url = new URL("http://localhost/session")
    expect(getWorkspaceRouteSessionID(url)).toBeNull()
  })
})

describe("workspaceProxyURL", () => {
  test("appends request path to target", () => {
    const result = workspaceProxyURL("http://remote:8080/base", new URL("http://localhost/config"))
    expect(result.toString()).toBe("http://remote:8080/base/config")
  })

  test("strips trailing slash on target before appending", () => {
    const result = workspaceProxyURL("http://remote:8080/base/", new URL("http://localhost/session/abc"))
    expect(result.pathname).toBe("/base/session/abc")
  })

  test("preserves query params from request but removes workspace", () => {
    const url = new URL("http://localhost/config?workspace=ws_123&keep=yes")
    const result = workspaceProxyURL("http://remote:8080/base", url)
    expect(result.searchParams.get("workspace")).toBeNull()
    expect(result.searchParams.get("keep")).toBe("yes")
  })

  test("strips the host directory param so the remote resolves its own root", () => {
    const url = new URL("http://localhost/session/abc?directory=F%3A%5Cproj&keep=yes")
    const result = workspaceProxyURL("http://remote:8080/base", url)
    expect(result.searchParams.get("directory")).toBeNull()
    expect(result.searchParams.get("keep")).toBe("yes")
  })

  test("stamps the leaf remotePath after stripping the host directory", () => {
    const url = new URL("http://localhost/pty/pty_1/connect?directory=D%3A%5Cproj&ticket=abc")
    const result = stampLeafDirectoryOnProxyURL(workspaceProxyURL("http://127.0.0.1:9/", url), {
      "x-opencode-directory": "/home/onescience2026/test_dir",
    })
    expect(result.searchParams.get("directory")).toBe("/home/onescience2026/test_dir")
    expect(result.searchParams.get("ticket")).toBe("abc")
    expect(result.pathname).toBe("/pty/pty_1/connect")
  })

  test("leaves the proxied URL unchanged when the leaf has no directory header", () => {
    const url = new URL("http://localhost/pty/pty_1/connect?directory=D%3A%5Cproj")
    const result = stampLeafDirectoryOnProxyURL(workspaceProxyURL("http://127.0.0.1:9/", url))
    expect(result.searchParams.get("directory")).toBeNull()
  })

  test("preserves hash from request", () => {
    const url = new URL("http://localhost/page#section")
    const result = workspaceProxyURL("http://remote:8080", url)
    expect(result.hash).toBe("#section")
  })

  test("works with URL object as target", () => {
    const target = new URL("http://remote:3000/api")
    const result = workspaceProxyURL(target, new URL("http://localhost/users"))
    expect(result.toString()).toBe("http://remote:3000/api/users")
  })

  test("remote proxy stamps leaf directory onto websocket and http URLs", async () => {
    const source = await Bun.file(
      new URL("../../src/server/routes/instance/httpapi/middleware/workspace-routing.ts", import.meta.url),
    ).text()
    expect(source).toContain("stampLeafDirectoryOnProxyURL(workspaceProxyURL(target.url, url), target.headers)")
    expect(source).toContain("HttpApiProxy.websocket(request, proxyURL)")
  })
})
