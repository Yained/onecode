import { Schema } from "effect"

export const ManifestSkill = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  type: Schema.optional(Schema.String),
  layer: Schema.optional(Schema.String),
  tags: Schema.Array(Schema.String),
  location: Schema.String,
  source: Schema.optional(Schema.String),
})

export const Manifest = Schema.Struct({
  schema_version: Schema.Number,
  package: Schema.String,
  version: Schema.optional(Schema.String),
  skills_version: Schema.optional(Schema.String),
  generated_at: Schema.optional(Schema.String),
  skills: Schema.Array(ManifestSkill),
})

export type ManifestSkill = typeof ManifestSkill.Type
export type Manifest = typeof Manifest.Type

export function decodeManifest(input: unknown) {
  return Schema.decodeUnknownSync(Manifest)(input)
}

export function indexByName(manifest: Manifest) {
  return new Map(manifest.skills.map((skill) => [skill.name, skill]))
}

export * as OneSkillsManifest from "./manifest"
