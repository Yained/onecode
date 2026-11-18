#!/usr/bin/env bun

import { $ } from "bun"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { publishNpmDirectory } from "./npm-publish-shared.ts"
import {
  publishVersionFromArgv,
  resolveNpmDistTag,
  resolveNpmPublishVersion,
} from "./npm-publish-version.ts"

const dir = fileURLToPath(new URL("..", import.meta.url))
const root = path.resolve(dir, "../..")
const appDir = path.join(root, "packages/app")
const appDist = path.join(appDir, "dist")
const outDir = path.join(dir, "dist/onecode-web")
const packOnly = process.argv.includes("--pack-only")

const opencodePkg = await Bun.file(path.join(dir, "package.json")).json()
const baseVersion = opencodePkg.version as string
const lockedVersion =
  publishVersionFromArgv()?.trim() || process.env.OPENCODE_NPM_PUBLISH_VERSION?.trim() || ""
// Prefer --publish-version / OPENCODE_NPM_PUBLISH_VERSION so CI never drifts from onecode.
const version = resolveNpmPublishVersion(baseVersion, lockedVersion || undefined)
const channel =
  resolveNpmDistTag(
    version.startsWith("0.0.0-") && !process.env.OPENCODE_NPM_CI ? version.split("-")[1] : undefined,
  )
const packageName = process.env.ONECODE_WEB_ASSETS_PACKAGE?.trim() || "@onescience/onecode-web"

if (process.env.OPENCODE_NPM_CI === "1") {
  if (!lockedVersion) {
    throw new Error(
      "CI onecode-web publish requires --publish-version or OPENCODE_NPM_PUBLISH_VERSION " +
        "(must match onecode; do not regenerate a new timestamp)",
    )
  }
  console.log(`onecode-web npm version: ${version} (locked to onecode publish version)`)
}

function withTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`
}

const cdnBase = withTrailingSlash(
  process.env.ONECODE_CDN_BASE?.trim() || `https://cdn.jsdelivr.net/npm/${packageName}@${version}/`,
)

process.chdir(dir)
process.env.ONECODE_CDN_BASE = cdnBase
process.env.ONECODE_APP_SOURCEMAP ??= "false"

console.log(`building web assets with base ${cdnBase}`)
await $`bun run --cwd ${appDir} build`

await $`rm -rf ${outDir}`
await $`mkdir -p ${outDir}`
await $`cp -R ${appDist}/. ${outDir}/`
await fs.copyFile(path.join(root, "LICENSE"), path.join(outDir, "LICENSE"))

const indexPath = path.join(outDir, "index.html")
const indexHtml = await fs.readFile(indexPath, "utf8")
await fs.writeFile(indexPath, indexHtml.replaceAll('content="/social-share.png"', `content="${cdnBase}social-share.png"`))

await Bun.file(path.join(outDir, "package.json")).write(
  JSON.stringify(
    {
      name: packageName,
      version: version,
      private: false,
      type: "module",
      license: "MIT",
      description: "OneCode web UI static assets for CDN delivery.",
      homepage: `https://cdn.jsdelivr.net/npm/${packageName}@${version}/index.html`,
      jsdelivr: "index.html",
      files: ["**/*"],
      sideEffects: true,
    },
    null,
    2,
  ),
)

// Isolation guard: @onescience/onecode-web must never ship Electron / desktop host assets.
async function assertNoDesktopArtifacts(dir: string) {
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()!
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const lower = entry.name.toLowerCase()
      if (lower.includes("electron") || lower.includes("electron-builder")) {
        throw new Error(`onecode-web package must not include desktop content: ${path.relative(outDir, full)}`)
      }
      if (entry.isDirectory()) stack.push(full)
    }
  }
  const pkg = await fs.readFile(path.join(outDir, "package.json"), "utf8")
  if (/electron|@opencode-ai\/desktop/i.test(pkg)) {
    throw new Error("onecode-web package.json must not reference electron or desktop packages")
  }
}
await assertNoDesktopArtifacts(outDir)

if (packOnly) {
  await publishNpmDirectory({
    dir: outDir,
    name: packageName,
    version,
    tag: channel,
    packOnly: true,
  })
} else {
  await publishNpmDirectory({
    dir: outDir,
    name: packageName,
    version,
    tag: channel,
  })
}
