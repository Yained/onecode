import { describe, expect, test } from "bun:test"
import { listImmediateProjectDirectories, searchProjectDirectories } from "./project-directory-browse"

describe("project-directory-browse", () => {
  const tree = {
    "/data": [{ name: "111", absolute: "/data/111" }],
    "/data/111": [{ name: "222", absolute: "/data/111/222" }],
    "/data/111/222": [{ name: "333", absolute: "/data/111/222/333" }],
  } as Record<string, Array<{ name: string; absolute: string }>>

  const list = async (directory: string) => tree[directory] ?? []

  test("listImmediateProjectDirectories only searches one level", async () => {
    await expect(listImmediateProjectDirectories(list, "/data", "333", 50)).resolves.toEqual([])
    await expect(listImmediateProjectDirectories(list, "/data", "111", 50)).resolves.toEqual(["/data/111"])
  })

  test("searchProjectDirectories finds nested folders by name", async () => {
    await expect(searchProjectDirectories(list, "/data", "333", { maxDepth: 8 })).resolves.toEqual([
      "/data/111/222/333",
    ])
  })

  test("searchProjectDirectories respects maxDepth", async () => {
    await expect(searchProjectDirectories(list, "/data", "333", { maxDepth: 1 })).resolves.toEqual([])
  })
})
