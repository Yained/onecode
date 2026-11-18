import { describe, expect, test } from "bun:test"
import { ProjectSkillStorage } from "../src/project-skill-storage"

describe("ProjectSkillStorage", () => {
  test("detects inline and shadow project skill locations", () => {
    const directory = "/data/case"
    const pathInfo = {
      onecode_extra_path: "/data/extra",
      config: "/home/user/.config/opencode",
      project_data_root: "/data",
    }

    expect(
      ProjectSkillStorage.isProjectSkillLocation("/data/case/.opencode/skills/demo/SKILL.md", directory, pathInfo),
    ).toBe(true)
    expect(
      ProjectSkillStorage.isProjectSkillLocation(
        "/data/extra/.config/opencode/projects/case/.opencode/skills/demo/SKILL.md",
        directory,
        pathInfo,
      ),
    ).toBe(true)
    expect(
      ProjectSkillStorage.isProjectSkillLocation("/home/user/.opencode/skills/demo/SKILL.md", directory, pathInfo),
    ).toBe(false)
  })
})
