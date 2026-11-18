import { authenticatedFetch } from "@/utils/authenticated-fetch"
import { oneScienceApiBaseUrl } from "@/pages/onescience-catalog"
import type { CapabilityDomain } from "./catalog"
import { hydrateScenarioCatalog, type UserScenario } from "./scenario-catalog"

type ScenarioApiItem = UserScenario & {
  id?: string
  domain: CapabilityDomain
  model_ids?: string[]
}

export async function fetchScenarioCatalog(serverUrl: string, input?: { domain?: string; q?: string }) {
  const items: ScenarioApiItem[] = []
  let offset = 0
  for (;;) {
    const query = new URLSearchParams()
    if (input?.domain && input.domain !== "all") query.set("domain", input.domain)
    if (input?.q?.trim()) query.set("q", input.q.trim())
    query.set("limit", "200")
    query.set("offset", String(offset))
    const response = await authenticatedFetch(
      `${oneScienceApiBaseUrl(serverUrl)}/experimental/onescience/scenario?${query}`,
    )
    if (!response.ok) throw new Error(`scenario catalog failed: ${response.status}`)
    const body = (await response.json()) as { items?: ScenarioApiItem[]; nextOffset?: number }
    const page = (body.items ?? []).map((item) => ({
      ...item,
      // Preserve empty model_ids so scenarios stay library-only until authors link models.
      model_ids: item.model_ids ?? [],
    }))
    items.push(...page)
    if (body.nextOffset == null || page.length === 0) break
    offset = body.nextOffset
  }
  hydrateScenarioCatalog(items)
  return items
}
