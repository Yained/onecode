import { Catalog } from "@/catalog/index"
import { OneSkills } from "@/oneskills/index"

const removed = OneSkills.removeLegacyFlatLayout()
const indexed = Catalog.reconcile({ syncSkills: true, projectDir: process.cwd() })

console.log("OneSkills legacy migration complete")
if (removed.length === 0) console.log("- no legacy flat paths found under ~/.opencode")
else console.log("- removed:", removed.join(", "))
console.log(`- catalog: ${indexed.skillCount} skills, ${indexed.primitiveCount} primitives, ${indexed.embedded} embeddings`)
