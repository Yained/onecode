export type AIPrimitiveStatus = "draft" | "callable"

export type AIPrimitiveItem = {
  id: string
  slug?: string
  title: string
  description: string
  domain: string
  primitiveType: string
  intentTags: string[]
  sourceResourceIds?: string[]
  status: AIPrimitiveStatus
  contractJson?: Record<string, unknown>
  adapterJson?: Record<string, unknown>
  validationJson?: Record<string, unknown>
  qualityScore?: number
  owner?: string
  resources?: { id: string; page: string; title: string; relationType: string }[]
  timeCreated?: number
  timeUpdated?: number
  catalogScore?: number
}

export type AIPrimitivePageResult = { items: AIPrimitiveItem[]; nextOffset?: number; loaded?: boolean }
