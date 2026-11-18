import { Database } from "@/storage/db"
import { and, inArray, isNull } from "drizzle-orm"
import { AIPrimitiveTable } from "./primitive.sql"
import { OneSciencePrimitiveResourceTable } from "./skill.sql"
import { OneScienceTaxonomy, type CapabilityFamilyID, type PrimitiveType } from "./taxonomy"

export type Profile = {
  id: string
  title: string
  description: string
  category: string
  capabilityFamilies: readonly CapabilityFamilyID[]
  requiredPrimitiveTypes: readonly PrimitiveType[]
  optionalPrimitiveTypes: readonly PrimitiveType[]
  executionSkills: readonly string[]
  primitiveCount: number
  resourceCount: number
  expectedArtifacts: readonly string[]
  maturity: "draft" | "beta" | "stable"
}

export function list() {
  return Database.use((db) => {
    const primitives = db.select().from(AIPrimitiveTable).where(isNull(AIPrimitiveTable.time_deleted)).all()
    const primitiveMatches = OneScienceTaxonomy.taskProfiles.map((profile) => ({
      profile,
      primitives: primitives.filter((primitive) => matchesProfile(profile, primitive.primitive_type, primitive.contract_json)),
    }))
    const primitiveIds = [...new Set(primitiveMatches.flatMap((item) => item.primitives.map((primitive) => primitive.id)))]
    const relations = primitiveIds.length === 0
      ? []
      : db
        .select()
        .from(OneSciencePrimitiveResourceTable)
        .where(and(inArray(OneSciencePrimitiveResourceTable.primitive_id, primitiveIds), isNull(OneSciencePrimitiveResourceTable.time_deleted)))
        .all()

    return {
      items: primitiveMatches.map((item): Profile => ({
        id: item.profile.id,
        title: item.profile.title,
        description: item.profile.description,
        category: item.profile.category,
        capabilityFamilies: item.profile.capabilityFamilies,
        requiredPrimitiveTypes: item.profile.requiredPrimitiveTypes,
        optionalPrimitiveTypes: item.profile.optionalPrimitiveTypes,
        executionSkills: item.profile.executionSkills,
        primitiveCount: item.primitives.length,
        resourceCount: new Set(relations.filter((relation) => item.primitives.some((primitive) => primitive.id === relation.primitive_id)).map((relation) => relation.resource_id)).size,
        expectedArtifacts: item.profile.expectedArtifacts,
        maturity: item.profile.maturity,
      })),
    }
  })
}

function matchesProfile(profile: typeof OneScienceTaxonomy.taskProfiles[number], primitiveType: string, contractJson: Record<string, unknown> | null) {
  const targetPrimitiveType = typeof contractJson?.targetPrimitiveType === "string"
    ? OneScienceTaxonomy.normalizePrimitiveType(contractJson.targetPrimitiveType)
    : OneScienceTaxonomy.normalizePrimitiveType(primitiveType)
  if (!targetPrimitiveType) return false
  return profile.requiredPrimitiveTypes.some((item) => item === targetPrimitiveType) || profile.optionalPrimitiveTypes.some((item) => item === targetPrimitiveType)
}

export * as OneScienceTaskProfile from "./task-profile"
