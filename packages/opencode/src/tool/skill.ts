import path from "path"
import { pathToFileURL } from "url"
import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Ripgrep } from "../file/ripgrep"
import { Skill } from "../skill"
import * as Tool from "./tool"
import DESCRIPTION from "./skill.txt"

export const Parameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const agents = yield* Agent.Service
    const rg = yield* Ripgrep.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const agent = yield* agents.get(ctx.agent)
          const visibleSkills = ctx.extra?.visibleSkills instanceof Set ? ctx.extra.visibleSkills : undefined
          const availableNames = visibleSkills
            ? [...visibleSkills]
            : (yield* skill.available(agent)).map((item) => item.name)
          if (!availableNames.includes(params.name)) {
            const discovered = (yield* skill.all()).some((item) => item.name === params.name)
            const reason = discovered
              ? `Skill "${params.name}" is not currently available to this agent.`
              : `Skill "${params.name}" is not currently available.`
            throw new Error(`${reason} Available skills: ${availableNames.join(", ") || "none"}`)
          }

          const beforeSkills = new Set((yield* skill.all()).map((item) => item.name))
          const info = yield* skill.get(params.name)
          if (!info) {
            throw new Error(`Skill "${params.name}" could not be loaded. Available skills: ${availableNames.join(", ") || "none"}`)
          }

          // Progressive disclosure: only when the agent actively invokes the skill
          // tool do we expose this skill's children. Loading content alone
          // (e.g. via HTTP command-list serialization) must not cascade-expand.
          yield* skill.expand(params.name)

          if (visibleSkills) {
            const afterSkills = yield* skill.all()
            for (const item of afterSkills) {
              if (!beforeSkills.has(item.name) && Permission.evaluate("skill", item.name, agent.permission).action !== "deny") {
                visibleSkills.add(item.name)
              }
            }
          }

          yield* ctx.ask({
            permission: "skill",
            patterns: [params.name],
            always: [params.name],
            metadata: {},
          })

          const dir = path.dirname(info.location)
          const base = pathToFileURL(dir).href
          const limit = 10
          const files = yield* rg.files({ cwd: dir, follow: false, hidden: true, signal: ctx.abort }).pipe(
            Stream.filter((file) => !file.includes("SKILL.md")),
            Stream.map((file) => path.resolve(dir, file)),
            Stream.take(limit),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk].map((file) => `<file>${file}</file>`).join("\n")),
          )

          return {
            title: `Loaded skill: ${info.name}`,
            output: [
              `<skill_content name="${info.name}">`,
              `# Skill: ${info.name}`,
              "",
              info.content.trim(),
              "",
              `Base directory for this skill: ${base}`,
              "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
              "Note: file list is sampled.",
              "",
              "<skill_files>",
              files,
              "</skill_files>",
              "</skill_content>",
            ].join("\n"),
            metadata: {
              name: info.name,
              dir,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
