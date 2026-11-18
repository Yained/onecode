#!/usr/bin/env bun
import { Catalog } from "@/catalog/index"
import { getPath } from "@/storage/db"
import { migrateStaticPrimitives } from "@/onescience/primitive-migration"

const projectDir = process.argv[2] ?? process.env.OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY ?? "/data/app/onescience"

migrateStaticPrimitives()
Catalog.reconcile({ syncSkills: true, projectDir })
const embedded = await Catalog.embedCatalogAsync({ mode: "model" })
console.log(
  JSON.stringify({
    embedded,
    projectDir,
    db: getPath(),
    model: process.env.CATALOG_EMBEDDING_MODEL,
    cache: process.env.CATALOG_EMBEDDING_CACHE,
  }),
)
