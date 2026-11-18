import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"

const NPM_REGISTRY = "https://registry.npmjs.org/"
const AUTH_ENV = "npm_config_//registry.npmjs.org/:_authToken"

export function requireNpmToken(): string {
  const token = process.env.NPM_TOKEN?.trim()
  if (!token) {
    console.error("NPM_TOKEN is required for npm publish")
    process.exit(1)
  }
  return token
}

export function configureNpmAuth(token = requireNpmToken()) {
  process.env.npm_config_registry = NPM_REGISTRY
  process.env[AUTH_ENV] = token
}

export async function npmPublished(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

export async function ensureNpmDistTag(name: string, version: string, tag: string) {
  const result = await $`npm dist-tag add ${name}@${version} ${tag}`.nothrow()
  if (result.exitCode !== 0) {
    console.warn(`warn: failed to set dist-tag ${tag} for ${name}@${version}`)
  }
}

export async function publishNpmDirectory(options: {
  dir: string
  name: string
  version: string
  tag: string
  packOnly?: boolean
}) {
  const { dir, name, version, tag, packOnly = false } = options

  for (const entry of await fs.readdir(dir)) {
    if (entry.endsWith(".tgz")) await fs.rm(path.join(dir, entry), { force: true })
  }

  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir).nothrow()

  await $`bun pm pack`.cwd(dir)

  if (packOnly) {
    console.log(`packed ${name}@${version} in ${dir}`)
    return
  }

  if (await npmPublished(name, version)) {
    console.log(`already published ${name}@${version}`)
    await ensureNpmDistTag(name, version, tag)
    return
  }

  await $`npm publish *.tgz --access public --tag ${tag}`.cwd(dir)
  console.log(`published ${name}@${version} (${tag})`)
}
