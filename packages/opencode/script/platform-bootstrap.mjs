#!/usr/bin/env node
/**
 * Install-time platform bootstrap for @onescience/onecode.
 * npm optionalDependencies fetch the platform tgz; this script links the binary
 * and falls back to a direct download when optional install failed (e.g. TLS).
 */

import fs from "fs"
import path from "path"
import os from "os"
import https from "https"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const product = "onecode"
const DEFAULT_TGZ_BASE = "https://218.90.133.98:4443/onecode_tgz"

function detectPlatformAndArch() {
  let platform
  switch (os.platform()) {
    case "darwin":
      platform = "darwin"
      break
    case "linux":
      platform = "linux"
      break
    case "win32":
      platform = "windows"
      break
    default:
      platform = os.platform()
      break
  }

  let arch
  switch (os.arch()) {
    case "x64":
      arch = "x64"
      break
    case "arm64":
      arch = "arm64"
      break
    case "arm":
      arch = "arm"
      break
    default:
      arch = os.arch()
  }

  return { platform, arch }
}

function ownVersion(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version
}

function platformPackageName() {
  const { platform, arch } = detectPlatformAndArch()
  return `${product}-${platform}-${arch}`
}

export function platformInstallStampPath(rootDir) {
  return path.join(rootDir, ".platform-version")
}

function readInstallStamp(rootDir) {
  const stampPath = platformInstallStampPath(rootDir)
  if (!fs.existsSync(stampPath)) return null
  return fs.readFileSync(stampPath, "utf8").trim()
}

export function writePlatformInstallStamp(rootDir) {
  fs.writeFileSync(platformInstallStampPath(rootDir), ownVersion(rootDir))
}

export function findPlatformBinary(rootDir) {
  const packageName = platformPackageName()
  const binaryName = detectPlatformAndArch().platform === "windows" ? `${product}.exe` : product
  const binaryPath = path.join(rootDir, "node_modules", packageName, "bin", binaryName)
  if (!fs.existsSync(binaryPath)) return null
  return { binaryPath, binaryName, packageName }
}

/** True when this npm package version already has a platform binary installed. */
export function isPlatformInstalledForVersion(rootDir) {
  const version = ownVersion(rootDir)
  if (readInstallStamp(rootDir) !== version) return false
  return findPlatformBinary(rootDir) !== null
}

function platformTgzUrl(version) {
  const base = (process.env.ONECODE_TGZ_DOWNLOAD_BASE || DEFAULT_TGZ_BASE).replace(/\/$/, "")
  const dir = encodeURIComponent(`onecode-${version}`)
  const file = encodeURIComponent(`onecode-linux-x64-${version}.tgz`)
  return `${base}/${dir}/${file}`
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const req = https.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        fs.unlinkSync(dest)
        downloadFile(res.headers.location, dest).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      res.pipe(file)
      file.on("finish", () => file.close(resolve))
    })
    req.on("error", (err) => {
      file.close()
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })
  })
}

function moveDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  try {
    fs.renameSync(src, dest)
  } catch (err) {
    if (err?.code !== "EXDEV") throw err
    fs.cpSync(src, dest, { recursive: true })
    fs.rmSync(src, { recursive: true, force: true })
  }
}

export function linkCachedBinary(rootDir, result) {
  const target = path.join(rootDir, "bin", `.${product}`)
  if (fs.existsSync(target)) fs.unlinkSync(target)
  try {
    fs.linkSync(result.binaryPath, target)
  } catch {
    fs.copyFileSync(result.binaryPath, target)
  }
  fs.chmodSync(target, 0o755)
  return result.binaryPath
}

// Bundled assets shipped inside the platform package (.opencode/session-seed,
// .opencode/oneskills, .oneskills/install-state) are discovered at runtime by
// the platform binary via parent-directory climbing from process.execPath,
// which is the bin/.onecode hardlink in the launcher package root. That climb
// never reaches node_modules/onecode-linux-x64/, so mirror the asset dirs into
// the launcher package root via symlinks. This keeps discovery purely
// filesystem-based — no env-var contract between the launcher and the child.
const BUNDLED_ASSET_DIRS = [".opencode", ".oneskills"]

export function linkBundledAssets(rootDir, result) {
  const platformPkgDir = path.join(rootDir, "node_modules", result.packageName)
  for (const name of BUNDLED_ASSET_DIRS) {
    const target = path.join(platformPkgDir, name)
    if (!fs.existsSync(target)) continue
    const link = path.join(rootDir, name)
    fs.rmSync(link, { recursive: true, force: true })
    const rel = path.relative(rootDir, target)
    try {
      // "junction" is Windows-only and ignored on posix; on posix a regular
      // symlink is created. Using a relative target keeps the link valid when
      // the install dir is relocated.
      fs.symlinkSync(rel, link, "junction")
    } catch {
      try {
        fs.symlinkSync(rel, link)
      } catch {
        // best-effort: ignore so install still succeeds without the mirror
      }
    }
  }
}

function removeStalePlatformPackage(rootDir) {
  const packageName = platformPackageName()
  fs.rmSync(path.join(rootDir, "node_modules", packageName), { recursive: true, force: true })
}

async function downloadAndExtractPlatformPackage(rootDir) {
  const packageName = platformPackageName()
  const version = ownVersion(rootDir)
  const url = platformTgzUrl(version)
  const nodeModulesDir = path.join(rootDir, "node_modules")
  const targetDir = path.join(nodeModulesDir, packageName)
  const workDir = path.join(rootDir, ".platform-bootstrap-work")
  const tmpTgz = path.join(workDir, `${packageName}-${version}.tgz`)
  const tmpExtract = path.join(workDir, "extract")

  console.log(`Downloading ${packageName} from ${url}`)
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })
  await downloadFile(url, tmpTgz)
  console.log(`Downloaded ${path.basename(tmpTgz)} (${(fs.statSync(tmpTgz).size / 1024 / 1024).toFixed(1)} MB)`)

  fs.mkdirSync(tmpExtract, { recursive: true })
  execSync(`tar -xzf "${tmpTgz}"`, { cwd: tmpExtract, stdio: "pipe" })

  const extractedRoot = path.join(tmpExtract, "package")
  if (!fs.existsSync(extractedRoot)) {
    throw new Error(`Expected package/ inside tgz downloaded from ${url}`)
  }

  fs.mkdirSync(nodeModulesDir, { recursive: true })
  moveDir(extractedRoot, targetDir)
  fs.rmSync(workDir, { recursive: true, force: true })

  const binaryName = detectPlatformAndArch().platform === "windows" ? `${product}.exe` : product
  const binaryPath = path.join(targetDir, "bin", binaryName)
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found at ${binaryPath} after extraction`)
  }
  fs.chmodSync(binaryPath, 0o755)

  return { binaryPath, binaryName, packageName }
}

/**
 * Ensure platform binary is present for the current npm package version.
 * Skips work when stamp + binary already match (re-install of same version).
 */
export async function ensurePlatformBinary(rootDir) {
  if (os.platform() === "win32") {
    return null
  }

  if (isPlatformInstalledForVersion(rootDir)) {
    const existing = findPlatformBinary(rootDir)
    console.log("onecode platform package already installed for this version, refreshing launcher links")
    linkCachedBinary(rootDir, existing)
    linkBundledAssets(rootDir, existing)
    return existing.binaryPath
  }

  const version = ownVersion(rootDir)
  const stamp = readInstallStamp(rootDir)
  if (stamp && stamp !== version) {
    removeStalePlatformPackage(rootDir)
  }

  let result = findPlatformBinary(rootDir)
  if (!result) {
    result = await downloadAndExtractPlatformPackage(rootDir)
  }

  linkCachedBinary(rootDir, result)
  linkBundledAssets(rootDir, result)
  writePlatformInstallStamp(rootDir)
  return result.binaryPath
}
