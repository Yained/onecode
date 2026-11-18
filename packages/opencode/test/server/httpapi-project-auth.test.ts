import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import * as PlatformAuth from "../../src/platform-auth/platform-auth"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

void Log.init({ print: false })

const context = Context.empty() as Context.Context<unknown>

function request(token: string) {
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request("http://localhost/project", {
      headers: {
        "x-platform-auth-token": token,
      },
    }),
    context,
  )
}

describe("project HttpApi account isolation", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("filters project.list to the current account workspace", async () => {
    await resetDatabase()

    const session = PlatformAuth.register({
      email: `project-http-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: `project-http-${crypto.randomUUID().slice(0, 8)}`,
      password: "password123",
    })
    const root = session.workspaces[0]!.defaultEnvPath
    const otherRoot = "/data/guest_data/workspaces/other-user"
    const time = Date.now()

    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values([
          {
            id: ProjectID.make("project-http-other"),
            worktree: otherRoot,
            name: "Other user",
            time_created: time,
            time_updated: time,
            sandboxes: [`${otherRoot}/case`],
          },
          {
            id: ProjectID.make("project-http-owned"),
            worktree: root,
            name: "Current user",
            time_created: time + 1,
            time_updated: time + 1,
            sandboxes: [`${root}/case-a`, `${otherRoot}/case-b`, "/var/unrelated-case"],
          },
        ])
        .run(),
    )

    const response = await request(session.token)
    const projects = (await response.json()) as Array<{ worktree: string; sandboxes: string[] }>

    expect(response.status).toBe(200)
    expect(projects).toEqual([
      expect.objectContaining({
        worktree: root,
        sandboxes: [`${root}/case-a`],
      }),
    ])
  }, 20_000)
})
