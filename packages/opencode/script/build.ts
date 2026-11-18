#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

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

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const bundleEmbeddingFlag = process.argv.includes("--bundle-embedding")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")

const DEFAULT_EMBEDDING_MODEL = "Xenova/bge-small-zh-v1.5"
const DEFAULT_EMBEDDING_REV = "bundled"

function embeddingModelId() {
  return process.env.CATALOG_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL
}

function embeddingSourceArg() {
  return process.argv.find((arg) => arg.startsWith("--embedding-src="))?.split("=", 2)[1]?.trim()
}

function embeddingOnnxPath(root: string) {
  return path.join(root, "onnx/model.onnx")
}

function resolveEmbeddingFromCache(cacheRoot: string, modelId: string) {
  const slug = `models--${modelId.replaceAll("/", "--")}`
  const snapshotsDir = path.join(cacheRoot, slug, "snapshots")
  if (!fs.existsSync(snapshotsDir)) return undefined
  for (const revision of fs.readdirSync(snapshotsDir).sort()) {
    const candidate = path.join(snapshotsDir, revision)
    if (fs.existsSync(embeddingOnnxPath(candidate))) return path.resolve(candidate)
  }
  return undefined
}

function resolveEmbeddingSource() {
  const model = embeddingModelId()
  const explicit = embeddingSourceArg() || process.env.CATALOG_EMBEDDING_SRC?.trim()
  const cache = process.env.CATALOG_EMBEDDING_CACHE?.trim()
  const candidates = [
    explicit,
    path.join(dir, "embedding-models-src", ...model.split("/")),
    cache ? resolveEmbeddingFromCache(cache, model) : undefined,
    cache ? path.join(path.dirname(cache), ...model.split("/")) : undefined,
  ].filter((item): item is string => !!item)
  for (const candidate of candidates) {
    if (fs.existsSync(embeddingOnnxPath(candidate))) return path.resolve(candidate)
  }
  return undefined
}

async function bundleEmbedding(distName: string) {
  const src = resolveEmbeddingSource()
  if (!src) {
    console.error(
      [
        "Embedding model source not found for --bundle-embedding.",
        "Provide a flat Xenova/bge-small-zh-v1.5 directory containing onnx/model.onnx via:",
        "  --embedding-src=/path/to/Xenova/bge-small-zh-v1.5",
        "  CATALOG_EMBEDDING_SRC=/path/to/Xenova/bge-small-zh-v1.5",
        "  CATALOG_EMBEDDING_CACHE=/path/to/embedding-models  (HF cache or sibling Xenova/... layout)",
        `or place it at packages/opencode/embedding-models-src/Xenova/bge-small-zh-v1.5`,
      ].join("\n"),
    )
    process.exit(1)
  }

  const model = embeddingModelId()
  const cacheDir = path.join(dir, `dist/${distName}/embedding-models`)
  const slug = `models--${model.replaceAll("/", "--")}`
  const rev = process.env.CATALOG_EMBEDDING_REV?.trim() || DEFAULT_EMBEDDING_REV
  const target = path.join(cacheDir, slug, "snapshots", rev)
  await fs.promises.mkdir(target, { recursive: true })
  await $`cp -a ${src}/. ${target}/`
  await Bun.write(path.join(cacheDir, slug, "refs/main"), rev)
  console.log(`Bundled embedding model ${model} into dist/${distName}/embedding-models`)
}

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  await $`bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const entries = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await Bun.file(path.join(dist, file)).arrayBuffer()).toString("base64")
      return `  ${JSON.stringify(file)}: Buffer.from(${JSON.stringify(buffer)}, "base64"),`
    }),
  )
  return [
    `import { Buffer } from "node:buffer"`,
    `// Export embedded Web UI assets as bytes.`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

await $`rm -rf dist`

{
  const presetGptKeyLen = (process.env.ONECODE_PRESET_GPT_API_KEY ?? "").trim().length
  const presetGlmKeyLen = (process.env.ONECODE_PRESET_GLM_API_KEY ?? "").trim().length
  const presetAdminPasswordLen = (process.env.ONECODE_PRESET_ADMIN_PASSWORD ?? "").trim().length
  const smtpPassLen = (process.env.ONECODE_SMTP_PASS ?? "").trim().length
  const objectStoreMasterKeyLen = (process.env.ONECODE_OBJECT_STORE_MASTER_KEY ?? "").trim().length
  console.log(`[preset-bake] ONECODE_PRESET_GPT_API_KEY len=${presetGptKeyLen}`)
  console.log(`[preset-bake] ONECODE_PRESET_GLM_API_KEY len=${presetGlmKeyLen}`)
  console.log(`[preset-bake] ONECODE_PRESET_ADMIN_PASSWORD len=${presetAdminPasswordLen}`)
  console.log(`[preset-bake] ONECODE_SMTP_PASS len=${smtpPassLen}`)
  console.log(`[preset-bake] ONECODE_OBJECT_STORE_MASTER_KEY len=${objectStoreMasterKeyLen}`)
  if (process.env.ONECODE_PRESET_REQUIRE === "1") {
    if (presetGptKeyLen === 0 || presetAdminPasswordLen === 0 || smtpPassLen === 0) {
      throw new Error(
        "ONECODE_PRESET_REQUIRE=1 but ONECODE_PRESET_GPT_API_KEY, ONECODE_PRESET_ADMIN_PASSWORD, and/or ONECODE_SMTP_PASS is empty. " +
          "Jenkins must bind credentials into these exact env var names before packing.",
      )
    }
  }
}

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/${pkg.name}`,
      execArgv: [`--user-agent=${pkg.name}/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {},
    entrypoints: ["./src/index.ts", parserWorker, workerPath, ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : [])],
    define: {
      ONECODE_BUILTIN_OPENALEX_API_KEY: JSON.stringify((process.env.OPENALEX_API_KEY ?? "").trim()),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MIGRATIONS: JSON.stringify(migrations),
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      ONECODE_PRESET_GPT_API_KEY: JSON.stringify(process.env.ONECODE_PRESET_GPT_API_KEY ?? ""),
      ONECODE_PRESET_GLM_API_KEY: JSON.stringify(process.env.ONECODE_PRESET_GLM_API_KEY ?? ""),
      ONECODE_PRESET_ADMIN_PASSWORD: JSON.stringify(process.env.ONECODE_PRESET_ADMIN_PASSWORD ?? ""),
      ONECODE_SMTP_PASS: JSON.stringify(process.env.ONECODE_SMTP_PASS ?? ""),
      ONECODE_OBJECT_STORE_MASTER_KEY: JSON.stringify(process.env.ONECODE_OBJECT_STORE_MASTER_KEY ?? ""),
      ...(process.env.OPENCODE_OFFLINE === "1" ? { OPENCODE_DISABLE_AUTOUPDATE: `'true'` } : {}),
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/${pkg.name}`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  const transformersDist = path.join(dir, "node_modules/@huggingface/transformers/dist")
  const libDir = `dist/${name}/lib`
  await $`mkdir -p ${libDir}`
  await $`cp ${transformersDist}/transformers.node.mjs ${libDir}/`
  await $`cp ${transformersDist}/ort-wasm-simd-threaded.jsep.wasm ${libDir}/`
  await $`cp ${transformersDist}/ort-wasm-simd-threaded.jsep.mjs ${libDir}/`
  const bunStore = path.join(dir, "../../node_modules/.bun")
  const libNm = `${libDir}/node_modules`
  await $`mkdir -p ${libNm}`
  for (const pkg of ["onnxruntime-common@1.21.0", "onnxruntime-node@1.21.0", "sharp@0.33.5"] as const) {
    const source = path.join(bunStore, pkg, "node_modules")
    if (!fs.existsSync(source)) continue
    for (const entry of await fs.promises.readdir(source)) {
      await $`cp -r ${path.join(source, entry)} ${libNm}/${entry}`
    }
  }
  if (bundleEmbeddingFlag) await bundleEmbedding(name)

  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [item.os],
        cpu: [item.arch],
        ...(bundleEmbeddingFlag ? { embeddingModel: embeddingModelId() } : {}),
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      const archiveRoot = bundleEmbeddingFlag ? `dist/${key}` : `dist/${key}/bin`
      await $`tar -czf ../../${key}.tar.gz *`.cwd(archiveRoot)
    } else {
      const archiveRoot = bundleEmbeddingFlag ? `dist/${key}` : `dist/${key}/bin`
      await $`zip -r ../../${key}.zip *`.cwd(archiveRoot)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }
