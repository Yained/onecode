#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import pkg from "../package.json"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

process.env.OPENCODE_VERSION ??= pkg.version
process.env.OPENCODE_CHANNEL ??= "latest"
process.env.OPENCODE_OFFLINE ??= "1"

const { Script } = await import("@opencode-ai/script")

const skipBuild = process.argv.includes("--skip-build")
const baseline = process.argv.includes("--baseline")
const platformArg = process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1]

if (process.platform !== "linux" || process.arch !== "x64") {
  console.error("offline-pack is intended to run on linux x64 build hosts")
  process.exit(1)
}

if (!skipBuild) {
  if (baseline) await $`bun ./script/build.ts --single --baseline`
  else await $`bun ./script/build.ts --single`
}

const platformDir =
  platformArg
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
  console.error("run: bun run script/build.ts --single")
  console.error(`for alpine/musl targets, build first then pass --platform=${pkg.name}-linux-x64-musl --skip-build`)
  process.exit(1)
}

const platformName = path.basename(platformDir)
const version = Script.version

const binary = path.join(platformDir, "bin", pkg.name)
const binaryVersion = (await $`${binary} --version`.text()).trim()
if (binaryVersion !== version) {
  console.error(`binary version mismatch: expected ${version}, got ${binaryVersion}`)
  console.error(
    `rebuild with: OPENCODE_VERSION=${version} OPENCODE_CHANNEL=latest OPENCODE_OFFLINE=1 bun run script/build.ts --single`,
  )
  process.exit(1)
}

const mainPackageName = pkg.name

await $`chmod -R 755 .`.cwd(platformDir).nothrow()
await $`bun pm pack`.cwd(platformDir)
const platformTgz = (
  await Array.fromAsync(new Bun.Glob(`${platformName}-*.tgz`).scan({ cwd: platformDir }))
)[0]
if (!platformTgz) {
  console.error(`failed to pack platform package in ${platformDir}`)
  process.exit(1)
}

const mainDir = `dist/offline-${pkg.name}`
await $`rm -rf ${mainDir}`
await $`mkdir -p ${mainDir}`
await $`cp -r ./bin ${mainDir}/bin`
await $`cp ./script/postinstall.mjs ${mainDir}/postinstall.mjs`
await Bun.file(`${mainDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${mainDir}/package.json`).write(
  JSON.stringify(
    {
      name: mainPackageName,
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version,
      license: pkg.license,
      optionalDependencies: {
        [platformName]: version,
      },
    },
    null,
    2,
  ),
)

await $`chmod -R 755 .`.cwd(mainDir).nothrow()
await $`bun pm pack`.cwd(mainDir)
const mainTgz = (await Array.fromAsync(new Bun.Glob(`${mainPackageName}-*.tgz`).scan({ cwd: mainDir })))[0]
if (!mainTgz) {
  console.error(`failed to pack main package in ${mainDir}`)
  process.exit(1)
}

const bundleDir = "dist/offline-bundle"
const bundleName = `${pkg.name}-linux-x64-offline-${version}.tar.gz`
await $`rm -rf ${bundleDir}`
await $`mkdir -p ${bundleDir}`
await $`cp ${path.join(mainDir, mainTgz)} ${bundleDir}/`
await $`cp ${path.join(platformDir, platformTgz)} ${bundleDir}/`
await Bun.file(`${bundleDir}/install.sh`).write(
  `#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
npm install -g "$dir/${platformTgz}" "$dir/${mainTgz}"
echo "installed: run ${pkg.name} --version"
`,
)
await $`chmod +x ${bundleDir}/install.sh`
await $`tar -czf dist/${bundleName} -C ${bundleDir} .`

console.log(`\nOffline bundle: dist/${bundleName}`)
console.log(`Platform package: ${platformName}`)
console.log(`\nCopy dist/${bundleName} to the target Linux machine, then:`)
console.log(`  tar -xzf ${bundleName}`)
console.log(`  ./install.sh`)
console.log(`  # or: npm install -g ./${mainTgz} ./${platformTgz}`)
