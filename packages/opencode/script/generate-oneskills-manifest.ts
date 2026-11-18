import path from "path"
import { existsSync, readFileSync } from "fs"
import matter from "gray-matter"
import { Glob } from "@opencode-ai/core/util/glob"

const skillsDir = process.argv[2] ?? path.join(process.env.HOME ?? "", ".opencode/oneskills/skills")
const version = process.argv[3] ?? new Date().toISOString().slice(0, 10).replaceAll("-", ".")
const out = process.argv[4] ?? path.join(path.dirname(skillsDir), "catalog/manifest.json")

if (!existsSync(skillsDir)) {
  console.error(`skills directory not found: ${skillsDir}`)
  process.exit(1)
}

const skills = Glob.scanSync("*/SKILL.md", { cwd: skillsDir, absolute: true })
  .map((file) => {
    const parsed = matter(readFileSync(file, "utf8"))
    const name = typeof parsed.data.name === "string" ? parsed.data.name : path.basename(path.dirname(file))
    const description = typeof parsed.data.description === "string" ? parsed.data.description : ""
    const tags = Array.isArray(parsed.data.tags)
      ? parsed.data.tags.filter((tag): tag is string => typeof tag === "string")
      : []
    const type = typeof parsed.data.type === "string"
      ? parsed.data.type
      : name === "onescience-orchestrator"
        ? "orchestrator"
        : undefined
    return {
      id: `skill:${name}`,
      name,
      description,
      ...(type ? { type } : {}),
      layer: typeof parsed.data.layer === "string" ? parsed.data.layer : undefined,
      tags,
      location: path.relative(path.dirname(skillsDir), file).replaceAll("\\", "/"),
      source: "official",
    }
  })
  .filter((skill) => skill.description)
  .toSorted((a, b) => a.name.localeCompare(b.name))

const manifest = {
  schema_version: 1,
  package: "oneskills",
  version,
  skills_version: version,
  generated_at: new Date().toISOString(),
  skills,
}

await Bun.write(out, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`wrote ${skills.length} skills to ${out}`)
