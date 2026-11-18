export function readmeRawUrl(sourceUrl: string) {
  const url = new URL(sourceUrl)

  if (url.hostname === "gitee.com") {
    const blob = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
    if (blob) {
      const [, owner, repo, branch, path] = blob
      return `https://gitee.com/${owner}/${repo}/raw/${branch}/${path.endsWith("README.md") ? path : `${path}/README.md`}`
    }

    const tree = url.pathname.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/)
    if (tree) {
      const [, owner, repo, branch, path] = tree
      return `https://gitee.com/${owner}/${repo}/raw/${branch}/${path}/README.md`
    }
  }

  if (url.hostname === "github.com") {
    const blob = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
    if (blob) {
      const [, owner, repo, branch, path] = blob
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.endsWith("README.md") ? path : `${path}/README.md`}`
    }

    const tree = url.pathname.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/)
    if (tree) {
      const [, owner, repo, branch, path] = tree
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/README.md`
    }

    const root = url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/)
    if (root) {
      const [, owner, repo] = root
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`
    }
  }

  return undefined
}

export async function fetchReadme(sourceUrl: string) {
  const rawUrl = readmeRawUrl(sourceUrl)
  if (!rawUrl) throw new Error(`unsupported repository url: ${sourceUrl}`)

  const response = await fetch(rawUrl, { headers: { Accept: "text/plain" } })
  if (!response.ok) throw new Error(`failed to fetch readme: ${response.status}`)

  const content = await response.text()
  if (!content.trim()) throw new Error("readme is empty")
  return content
}

export * as OneScienceReadme from "./readme"
