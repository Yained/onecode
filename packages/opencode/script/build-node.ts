#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const presetGptKey = (process.env.ONECODE_PRESET_GPT_API_KEY ?? "").trim()
const presetGlmKey = (process.env.ONECODE_PRESET_GLM_API_KEY ?? "").trim()
const presetAdminPassword = (process.env.ONECODE_PRESET_ADMIN_PASSWORD ?? "").trim()
const smtpPass = (process.env.ONECODE_SMTP_PASS ?? "").trim()
const objectStoreMasterKey = (process.env.ONECODE_OBJECT_STORE_MASTER_KEY ?? "").trim()
const presetGptKeyLen = presetGptKey.length
const presetGlmKeyLen = presetGlmKey.length
const presetAdminPasswordLen = presetAdminPassword.length
const smtpPassLen = smtpPass.length
const objectStoreMasterKeyLen = objectStoreMasterKey.length

// Lengths only — never print secret values (CI / quiet logs).
console.log(`[preset-bake] ONECODE_PRESET_GPT_API_KEY len=${presetGptKeyLen}`)
console.log(`[preset-bake] ONECODE_PRESET_GLM_API_KEY len=${presetGlmKeyLen}`)
console.log(`[preset-bake] ONECODE_PRESET_ADMIN_PASSWORD len=${presetAdminPasswordLen}`)
console.log(`[preset-bake] ONECODE_SMTP_PASS len=${smtpPassLen}`)
console.log(`[preset-bake] ONECODE_OBJECT_STORE_MASTER_KEY len=${objectStoreMasterKeyLen}`)

if (process.env.ONECODE_PRESET_REQUIRE === "1") {
  if (presetGptKeyLen === 0 || presetAdminPasswordLen === 0 || smtpPassLen === 0) {
    throw new Error(
      "ONECODE_PRESET_REQUIRE=1 but ONECODE_PRESET_GPT_API_KEY, ONECODE_PRESET_ADMIN_PASSWORD, and/or ONECODE_SMTP_PASS is empty. " +
        "Jenkins must bind credentials into these exact env var names before docker run (see oneci desktop-pack README).",
    )
  }
}

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    ONECODE_BUILTIN_OPENALEX_API_KEY: JSON.stringify((process.env.OPENALEX_API_KEY ?? "").trim()),
    OPENCODE_MIGRATIONS: JSON.stringify(migrations),
    OPENCODE_CHANNEL: `'${Script.channel}'`,
    OPENCODE_VERSION: `'${Script.version}'`,
    // Align with standalone tgz bake-in (script/build.ts): preset admin + GPT/GLM keys.
    ONECODE_PRESET_GPT_API_KEY: JSON.stringify(presetGptKey),
    ONECODE_PRESET_GLM_API_KEY: JSON.stringify(presetGlmKey),
    ONECODE_PRESET_ADMIN_PASSWORD: JSON.stringify(presetAdminPassword),
    ONECODE_SMTP_PASS: JSON.stringify(smtpPass),
    ONECODE_OBJECT_STORE_MASTER_KEY: JSON.stringify(objectStoreMasterKey),
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

const bakeMeta = {
  gptApiKeyLen: presetGptKeyLen,
  glmApiKeyLen: presetGlmKeyLen,
  adminPasswordLen: presetAdminPasswordLen,
  smtpPassLen,
  objectStoreMasterKeyLen,
  require: process.env.ONECODE_PRESET_REQUIRE === "1",
  bakedAt: new Date().toISOString(),
  version: Script.version,
}
await fs.promises.mkdir(path.join(dir, "dist/node"), { recursive: true })
await fs.promises.writeFile(
  path.join(dir, "dist/node/preset-bake.json"),
  JSON.stringify(bakeMeta, null, 2) + "\n",
)

const buildInfo = {
  version: Script.version,
  baseVersion: JSON.parse(await Bun.file(path.join(dir, "package.json")).text()).version,
  stampedAt: new Date().toISOString(),
}
await fs.promises.writeFile(
  path.join(dir, "dist/node/onecode-build.json"),
  JSON.stringify(buildInfo, null, 2) + "\n",
)

const desktopResources = path.resolve(dir, "../desktop/resources")
await fs.promises.mkdir(desktopResources, { recursive: true })
await fs.promises.writeFile(
  path.join(desktopResources, "onecode-build.json"),
  JSON.stringify(buildInfo, null, 2) + "\n",
)

console.log(
  `[preset-bake] wrote dist/node/preset-bake.json gpt=${presetGptKeyLen} admin=${presetAdminPasswordLen} smtp=${smtpPassLen} objectStoreMasterKey=${objectStoreMasterKeyLen}`,
)
console.log(`[install-identity] ${Script.version}`)
console.log("Build complete")
