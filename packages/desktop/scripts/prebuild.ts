#!/usr/bin/env bun
import { $ } from "bun"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
// Relative import: desktop scripts may run before workspace links are refreshed in CI containers.
import { fullInstallIdentity, ONECODE_BUILD_FILE } from "../../core/src/install-identity.ts"
import pkg from "../package.json"
import { resolveChannel } from "./utils"

const channel = resolveChannel()

// Stamp release identity unless OPENCODE_VERSION is already provided by CI.
if (!process.env.OPENCODE_VERSION?.trim()) {
  process.env.OPENCODE_VERSION = fullInstallIdentity(pkg.version)
}

const identity = process.env.OPENCODE_VERSION.trim()
const stampMatch = /^(.+)-(\d{12})$/.exec(identity)
const buildInfo = {
  version: identity,
  baseVersion: stampMatch?.[1] ?? pkg.version,
  stamp: stampMatch?.[2],
  stampedAt: new Date().toISOString(),
  channel,
}
mkdirSync("resources", { recursive: true })
writeFileSync(join("resources", ONECODE_BUILD_FILE), `${JSON.stringify(buildInfo, null, 2)}\n`)

// Bake identity into installer.nsh in-place. Sibling !include files are NOT available
// in electron-builder's makensis temp dir (warning 7000 → CI failure).
const installerNsh = join("build", "installer.nsh")
const installerSrc = readFileSync(installerNsh, "utf8")
const patched = installerSrc.replace(
  /!define ONECODE_INSTALL_IDENTITY "[^"]*"/,
  `!define ONECODE_INSTALL_IDENTITY "${identity}"`,
)
if (patched === installerSrc) {
  throw new Error(`failed to stamp ONECODE_INSTALL_IDENTITY in ${installerNsh}`)
}
writeFileSync(installerNsh, patched)
console.log(`[install-identity] wrote resources/${ONECODE_BUILD_FILE} version=${identity}`)
console.log(`[install-identity] stamped ${installerNsh}`)

await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

// pack_win_in_container may have already built node dist; rebuild keeps OPENCODE_VERSION in sync.
await $`cd ../opencode && bun script/build-node.ts`
