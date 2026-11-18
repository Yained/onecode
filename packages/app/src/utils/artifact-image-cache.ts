const cache = new Map<string, string>()

export function getCachedArtifactImage(path: string) {
  return cache.get(path)
}

export function setCachedArtifactImage(path: string, url: string) {
  cache.set(path, url)
}
