import fuzzysort from "fuzzysort"

export const PROJECT_DIRECTORY_SEARCH_MAX_DEPTH = 8
export const PROJECT_DIRECTORY_SEARCH_LIMIT = 50

export type DirectoryEntry = { name: string; absolute: string }

export type DirectoryLister = (directory: string) => Promise<DirectoryEntry[]>

export async function listImmediateProjectDirectories(
  listDirectories: DirectoryLister,
  directory: string,
  query: string,
  limit: number,
) {
  const items = await listDirectories(directory)
  if (!query) return items.slice(0, limit).map((item) => item.absolute)
  return fuzzysort.go(query, items, { key: "name", limit }).map((item) => item.obj.absolute)
}

export async function searchProjectDirectories(
  listDirectories: DirectoryLister,
  root: string,
  query: string,
  options?: { limit?: number; maxDepth?: number },
) {
  const limit = options?.limit ?? PROJECT_DIRECTORY_SEARCH_LIMIT
  const maxDepth = options?.maxDepth ?? PROJECT_DIRECTORY_SEARCH_MAX_DEPTH
  if (!query) return listImmediateProjectDirectories(listDirectories, root, "", limit)

  const results: string[] = []
  const visited = new Set<string>()
  let frontier = [root]

  for (let depth = 0; depth < maxDepth && frontier.length > 0 && results.length < limit; depth++) {
    const next: string[] = []
    for (const directory of frontier) {
      const items = await listDirectories(directory)
      for (const item of items) {
        if (visited.has(item.absolute)) continue
        visited.add(item.absolute)
        if (fuzzysort.single(query, item.name)) {
          results.push(item.absolute)
          if (results.length >= limit) return results
        }
        next.push(item.absolute)
      }
    }
    frontier = next
  }

  return results
}
