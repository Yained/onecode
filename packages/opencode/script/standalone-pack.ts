#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import pkg from "../package.json"
import { fileURLToPath } from "url"
import { fullInstallIdentity, ONECODE_BUILD_FILE } from "@opencode-ai/core/install-identity"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const skipBuild = process.argv.includes("--skip-build")
if (!process.env.OPENCODE_VERSION?.trim()) {
  // Release packs always include CST stamp so OneSkills refresh can detect rebuilds.
  process.env.OPENCODE_VERSION = skipBuild ? pkg.version : fullInstallIdentity(pkg.version)
}
process.env.OPENCODE_CHANNEL ??= "latest"
process.env.OPENCODE_OFFLINE ??= "1"

const { Script } = await import("@opencode-ai/script")

const baseline = process.argv.includes("--baseline")
const skipEmbedding = process.argv.includes("--no-bundle-embedding")
const platformArg = process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1]
const embeddingSrc = process.argv.find((arg) => arg.startsWith("--embedding-src="))?.split("=", 2)[1]?.trim()
if (embeddingSrc) process.env.CATALOG_EMBEDDING_SRC = embeddingSrc

if (process.platform !== "linux" || process.arch !== "x64") {
  console.error("standalone-pack is intended to run on linux x64 build hosts")
  process.exit(1)
}

if (!skipBuild) {
  if (baseline && skipEmbedding) await $`bun ./script/build.ts --single --skip-install --baseline`
  else if (baseline) await $`bun ./script/build.ts --single --skip-install --baseline --bundle-embedding`
  else if (skipEmbedding) await $`bun ./script/build.ts --single --skip-install`
  else await $`bun ./script/build.ts --single --skip-install --bundle-embedding`
}

const platformDir = platformArg
  ? path.join("dist", platformArg.replace(/^dist\//, ""))
  : (
      await Array.fromAsync(new Bun.Glob(`${pkg.name}-linux-x64*/package.json`).scan({ cwd: "./dist" }))
    )
      .map((filepath) => path.join("dist", path.dirname(filepath)))
      .toSorted((a, b) => {
        const preferred = `dist/${pkg.name}-linux-x64`
        if (a === b) return 0
        if (a === preferred) return -1
        if (b === preferred) return 1
        return a.localeCompare(b)
      })[0]

if (!platformDir) {
  console.error("no linux x64 build found in dist/")
  console.error("run: bun run script/build.ts --single --skip-install --bundle-embedding")
  console.error(`for alpine/musl targets, build first then pass --platform=${pkg.name}-linux-x64-musl --skip-build`)
  process.exit(1)
}

const version = Script.version
const binary = path.join(platformDir, "bin", pkg.name)
const binaryVersion = (await $`${binary} --version`.text()).trim()
if (binaryVersion !== version) {
  console.error(`binary version mismatch: expected ${version}, got ${binaryVersion}`)
  console.error(
    `rebuild with: OPENCODE_VERSION=${version} OPENCODE_CHANNEL=latest OPENCODE_OFFLINE=1 bun run script/build.ts --single --skip-install --bundle-embedding`,
  )
  process.exit(1)
}

const platformPkg = await Bun.file(path.join(platformDir, "package.json")).json()
const libDir = path.join(platformDir, "lib")
const embeddingDir = path.join(platformDir, "embedding-models")
if (!fs.existsSync(libDir)) {
  console.error(`missing ${libDir}; rebuild the platform dist first`)
  process.exit(1)
}
if (!skipEmbedding && !fs.existsSync(embeddingDir)) {
  console.error(`missing ${embeddingDir}; rebuild with --bundle-embedding or provide --embedding-src=`)
  process.exit(1)
}

const standaloneDir = `dist/standalone-${pkg.name}`
await $`rm -rf ${standaloneDir}`
await $`mkdir -p ${standaloneDir}/bin`
await $`cp ${binary} ${standaloneDir}/bin/${pkg.name}`
await $`chmod +x ${standaloneDir}/bin/${pkg.name}`
await $`cp -a ${libDir} ${standaloneDir}/lib`
if (fs.existsSync(embeddingDir)) await $`cp -a ${embeddingDir} ${standaloneDir}/embedding-models`
await Bun.file(`${standaloneDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${standaloneDir}/serve.sh`).write(standaloneServeScript(pkg.name))
await $`chmod +x ${standaloneDir}/serve.sh`
const stampMatch = /^(.+)-(\d{12})$/.exec(version)
await Bun.file(`${standaloneDir}/${ONECODE_BUILD_FILE}`).write(
  JSON.stringify(
    {
      version,
      baseVersion: stampMatch?.[1] ?? pkg.version,
      stamp: stampMatch?.[2],
      stampedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
)
await Bun.file(`${standaloneDir}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      version,
      license: pkg.license,
      files: ["bin", "lib", "embedding-models", "serve.sh", "LICENSE", ONECODE_BUILD_FILE],
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      os: platformPkg.os,
      cpu: platformPkg.cpu,
      ...(platformPkg.embeddingModel ? { embeddingModel: platformPkg.embeddingModel } : {}),
    },
    null,
    2,
  ),
)

await $`chmod -R 755 .`.cwd(standaloneDir).nothrow()
await $`bun pm pack`.cwd(standaloneDir)
const packedTgz = (
  await Array.fromAsync(new Bun.Glob(`${pkg.name}-*.tgz`).scan({ cwd: standaloneDir }))
)[0]
if (!packedTgz) {
  console.error(`failed to pack standalone package in ${standaloneDir}`)
  process.exit(1)
}

const packedPath = path.join(standaloneDir, packedTgz)
const packedEntries = (await $`tar -tzf ${packedPath}`.text()).split("\n").filter(Boolean)
for (const entry of ["package/lib/", "package/serve.sh"]) {
  if (!packedEntries.some((line) => line.startsWith(entry))) {
    console.error(`packed tgz missing ${entry}; check package.json files field`)
    process.exit(1)
  }
}
if (!skipEmbedding && !packedEntries.some((line) => line.startsWith("package/embedding-models/"))) {
  console.error("packed tgz missing package/embedding-models/; rebuild with --bundle-embedding")
  process.exit(1)
}

const outputTgz = "dist/onecode-linux-x64-latest.tgz"
await $`cp ${path.join(standaloneDir, packedTgz)} ${outputTgz}`

console.log(`\nStandalone package: ${outputTgz}`)
console.log(`Platform binary: ${platformDir}`)
console.log(`\nCopy ${outputTgz} to the target Linux machine, then:`)
console.log(`  npm install -g ./${path.basename(outputTgz)}`)
console.log(`  ${pkg.name} --version`)
console.log(`  export ONECODE_PORT=<port>`)
console.log(`  ${pkg.name} serve --port "$ONECODE_PORT" --hostname 0.0.0.0 --cors "http://onescience.ai:$ONECODE_PORT"`)

function standaloneServeScript(product: string) {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="$ROOT/bin/${product}"
PORT="\${ONECODE_PORT:-}"
HOST="\${ONECODE_HOST:-0.0.0.0}"

if [[ ! -x "$BIN" ]]; then
  echo "${product} binary not found: $BIN" >&2
  exit 1
fi

if [[ -z "$PORT" ]]; then
  echo "Set ONECODE_PORT before starting." >&2
  exit 1
fi

export CATALOG_EMBEDDING_MODE="\${CATALOG_EMBEDDING_MODE:-model}"
export CATALOG_EMBEDDING_MODEL="\${CATALOG_EMBEDDING_MODEL:-Xenova/bge-small-zh-v1.5}"
if [[ -z "\${CATALOG_EMBEDDING_CACHE:-}" && -d "$ROOT/embedding-models" ]]; then
  export CATALOG_EMBEDDING_CACHE="$ROOT/embedding-models"
fi
if [[ -z "\${ONECODE_TRANSFORMERS_PATH:-}" && -f "$ROOT/lib/transformers.node.mjs" ]]; then
  export ONECODE_TRANSFORMERS_PATH="$ROOT/lib/transformers.node.mjs"
fi
if [[ -n "\${OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY:-}" ]]; then
  export OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY
fi
export NODE_PATH="$ROOT/lib/node_modules\${NODE_PATH:+:$NODE_PATH}"

exec "$BIN" serve \\
  --port "$PORT" \\
  --hostname "$HOST" \\
  --cors "\${ONECODE_CORS:-http://onescience.ai:\${PORT}}"
`
}
