import { describe, expect, test } from "bun:test"
import {
  defaultRemotePath,
  encodeMarker,
  fingerprintDirectory,
  markerConflict,
  parseMarker,
  parseSshNodeExtra,
  projectSlugFor,
  sanitizePathSegment,
  workspaceBelongsToDirectory,
} from "../../src/control-plane/adapters/ssh-node-path"

describe("ssh-node path helpers", () => {
  test("builds a namespaced remote path", () => {
    expect(
      defaultRemotePath({
        basePath: "/data/share",
        controlPlaneId: "cp-1",
        accountId: "alice/id",
        projectSlug: "default",
      }),
    ).toBe("/data/share/onecode_remote/workspaces/cp-1/alice_id/default")
  })

  test.each(["/", "///", "/home/liuheng/", "/home/liuheng///"])(
    "preserves an absolute base directory: %s",
    (basePath) => {
      expect(
        defaultRemotePath({
          basePath,
          controlPlaneId: "cp",
          accountId: "alice",
          projectSlug: "project",
        }),
      ).toBe(
        basePath.startsWith("/home")
          ? "/home/liuheng/onecode_remote/workspaces/cp/alice/project"
          : "/onecode_remote/workspaces/cp/alice/project",
      )
    },
  )

  test("parses extra and rejects missing sshTarget", () => {
    expect(
      parseSshNodeExtra({
        sshTarget: "aliyun",
        catalogPort: 43111,
        catalogForward: true,
      }),
    ).toEqual({
      sshTarget: "aliyun",
      catalogPort: 43111,
      catalogForward: true,
    })
    expect(
      parseSshNodeExtra({
        sshTarget: "aliyun",
        remotePath: "/home/u/run",
        createRemoteDir: false,
      }),
    ).toEqual({
      sshTarget: "aliyun",
      remotePath: "/home/u/run",
      createRemoteDir: false,
    })
    expect(
      parseSshNodeExtra({
        sshTarget: "aliyun",
        accountId: "acct-1",
        progressKey: " aliyun::/data/ws ",
        ssh: { host: "aliyun", remotePath: "/home/u", username: "u" },
      }),
    ).toEqual({
      sshTarget: "aliyun",
      accountId: "acct-1",
      progressKey: "aliyun::/data/ws",
      ssh: { host: "aliyun", remotePath: "/home/u", username: "u" },
    })
  })

  test("detects marker occupancy by control plane and account", () => {
    const marker = parseMarker(
      encodeMarker({
        version: 1,
        workspaceID: "wrk_1",
        controlPlaneId: "cp-a",
        accountId: "alice",
        projectID: "prj_1",
        createdAt: 1,
      }),
    )
    expect(marker?.workspaceID).toBe("wrk_1")
    expect(markerConflict(marker, { controlPlaneId: "cp-a", accountId: "alice", projectID: "prj_1" })).toBeUndefined()
    expect(markerConflict(marker, { controlPlaneId: "cp-a", accountId: "alice", projectID: "global" })).toBeUndefined()
    expect(markerConflict(marker, { controlPlaneId: "cp-a", accountId: "alice", projectID: "prj_other" })).toBeUndefined()
    expect(markerConflict(marker, { controlPlaneId: "cp-b", accountId: "alice" })).toContain("control plane")
    expect(markerConflict(marker, { controlPlaneId: "cp-a", accountId: "bob" })).toContain("账号")
    expect(
      markerConflict(
        { ...marker!, accountId: "alice/id" },
        { controlPlaneId: "cp-a", accountId: "alice/id" },
      ),
    ).toBeUndefined()
    expect(
      markerConflict(
        { ...marker!, accountId: "alice/id" },
        { controlPlaneId: "cp-a", accountId: "alice_id" },
      ),
    ).toBeUndefined()
    expect(sanitizePathSegment("a b/c")).toBe("a_b_c")
    expect(
      parseMarker(
        encodeMarker({
          version: 1,
          workspaceID: "wrk_1",
          controlPlaneId: "cp-a",
          accountId: "alice",
          projectID: "prj_1",
          createdAt: 1,
          servePort: 4123,
        }),
      )?.servePort,
    ).toBe(4123)
  })

  test("distinguishes same-named projects by directory fingerprint", () => {
    const one = projectSlugFor("D:/work/a/frontend")
    const two = projectSlugFor("D:/work/b/frontend")
    expect(one).not.toBe(two)
    expect(one.startsWith("frontend-")).toBe(true)
    expect(two.startsWith("frontend-")).toBe(true)
    expect(projectSlugFor("D:\\work\\a\\frontend")).toBe(one)
    expect(fingerprintDirectory("D:/work/a/frontend")).toHaveLength(8)
    expect(
      defaultRemotePath({
        basePath: "/data/share",
        controlPlaneId: "cp-1",
        accountId: "alice",
        projectSlug: one,
      }),
    ).toContain(one)
  })

  test("scopes ssh-node extras to the opened project directory", () => {
    const defaultDir = "D:/data/acct/default"
    const remoteDir = "D:/data/acct/test_remote"
    expect(
      workspaceBelongsToDirectory({
        extra: { sshTarget: "aliyun", localDirectory: defaultDir },
        workspaceProjectID: "global",
        openedDirectory: defaultDir,
        openedProjectID: "proj-acct-default",
      }),
    ).toBe(true)
    expect(
      workspaceBelongsToDirectory({
        extra: { sshTarget: "aliyun", projectSlug: projectSlugFor(remoteDir) },
        workspaceProjectID: "global",
        openedDirectory: defaultDir,
        openedProjectID: "proj-acct-default",
      }),
    ).toBe(false)
    expect(
      workspaceBelongsToDirectory({
        extra: { sshTarget: "aliyun" },
        workspaceProjectID: "proj-acct-remote",
        openedDirectory: defaultDir,
        openedProjectID: "proj-acct-default",
      }),
    ).toBe(false)
  })
})
