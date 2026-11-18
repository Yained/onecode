#!/usr/bin/env bun
/**
 * CI-only npm publish entrypoint.
 *
 * Publishes:
 *   - @onescience/onecode-web  (small CDN assets) → npm
 *   - @onescience/onecode      (tiny launcher)    → npm
 *
 * Platform binary is NOT published to npm registry. CI stages the tgz on the
 * download server; postinstall downloads the platform tgz on install and skips
 * when the same npm version is already present (optionalDependencies removed —
 * tarball URLs caused npm to re-fetch ~185MB on every global reinstall).
 *
 * Usage:
 *   bun ./script/publish-npm-ci.ts              # publish to npm (requires NPM_TOKEN)
 *   bun ./script/publish-npm-ci.ts --print-version
 */

import { $ } from "bun"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { configureNpmAuth, publishNpmDirectory, requireNpmToken } from "./npm-publish-shared.ts"
import {
  npmPublishVersionFromBase,
  publishVersionFromArgv,
  resolveNpmDistTag,
} from "./npm-publish-version.ts"
import pkg from "../package.json"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const baseVersion = pkg.version
// Choose the publish version exactly once for this CI run. onecode-web must reuse it.
const npmVersion =
  publishVersionFromArgv()?.trim() ||
  process.env.OPENCODE_NPM_PUBLISH_VERSION?.trim() ||
  npmPublishVersionFromBase(baseVersion)
const distTag = resolveNpmDistTag("latest")
const webPackage = process.env.ONECODE_WEB_ASSETS_PACKAGE?.trim() || "@onescience/onecode-web"
const cliPackage = process.env.ONECODE_NPM_CLI_PACKAGE?.trim() || "@onescience/onecode"
const binName = "onecode"
const stagingDir = path.join(dir, "dist/npm-publish/onecode")

if (process.argv.includes("--print-version")) {
  console.log(npmVersion)
  process.exit(0)
}

requireNpmToken()
configureNpmAuth()

// Freeze once: onecode-web must reuse this exact version (do not regenerate timestamp).
process.env.OPENCODE_NPM_CI = "1"
process.env.OPENCODE_NPM_PUBLISH_VERSION = npmVersion
process.env.OPENCODE_NPM_DIST_TAG = distTag

console.log("=== npm CI publish ===")
console.log(`base version: ${baseVersion}`)
console.log(`npm version:  ${npmVersion} (shared by onecode + onecode-web)`)
console.log(`dist-tag:     ${distTag}`)

console.log("\n=== onecode-web ===\n")
// Bun `$` may snapshot env at process start; pass the frozen version explicitly via argv + .env().
await $`bun ./script/publish-web-assets.ts --publish-version=${npmVersion}`.env({
  ...process.env,
  OPENCODE_NPM_CI: "1",
  OPENCODE_NPM_PUBLISH_VERSION: npmVersion,
  OPENCODE_NPM_DIST_TAG: distTag,
})

console.log("\n=== onecode CLI launcher (npm) ===\n")

const tgzBase = (process.env.ONECODE_TGZ_DOWNLOAD_BASE || "https://218.90.133.98:4443/onecode_tgz")
  .trim()
  .replace(/\/$/, "")

await $`rm -rf ${stagingDir}`
await $`mkdir -p ${stagingDir}/bin`
await $`cp -r ./bin/. ${stagingDir}/bin/`
await $`cp ./script/platform-bootstrap.mjs ${stagingDir}/platform-bootstrap.mjs`
await $`cp ./script/postinstall.mjs ${stagingDir}/postinstall.mjs`
await Bun.file(path.join(stagingDir, "LICENSE")).write(await Bun.file("../../LICENSE").text())

await Bun.file(path.join(stagingDir, "package.json")).write(
  JSON.stringify(
    {
      name: cliPackage,
      version: npmVersion,
      private: false,
      license: pkg.license,
      description: "OneScience AI coding agent for the terminal.",
      bin: {
        [binName]: `./bin/${binName}`,
      },
      scripts: {
        postinstall: "node ./postinstall.mjs",
      },
    },
    null,
    2,
  ),
)

await publishNpmDirectory({
  dir: stagingDir,
  name: cliPackage,
  version: npmVersion,
  tag: distTag,
})

console.log("\n=== npm CI publish complete ===")
console.log(`${webPackage}@${npmVersion} (${distTag})`)
console.log(`${cliPackage}@${npmVersion} (${distTag})`)
console.log(`platform tgz expected at: ${tgzBase}/onecode-${npmVersion}/onecode-linux-x64-${npmVersion}.tgz`)
