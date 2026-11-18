import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const electronMirror = (() => {
  const raw = process.env.ELECTRON_MIRROR?.trim()
  if (raw) return raw.endsWith("/") ? raw : `${raw}/`
  // Default away from GitHub (CN CI / local builds). Override with ELECTRON_MIRROR if needed.
  return "https://npmmirror.com/mirrors/electron/"
})()

// NSIS / winCodeSign etc. — electron-builder reads this env; default to npmmirror when unset.
if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR?.trim()) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}
if (!process.env.ELECTRON_MIRROR?.trim()) {
  process.env.ELECTRON_MIRROR = electronMirror
}

const getBase = (): Configuration => ({
  artifactName: "onecode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  electronDownload: {
    mirror: electronMirror,
  },
  files: [
    "out/**/*",
    "resources/**/*",
    // Cross-pack from Linux must not ship host linux/darwin optional natives.
    "!**/node_modules/@lydell/node-pty-linux-*/**",
    "!**/node_modules/@lydell/node-pty-darwin-*/**",
    "!**/node_modules/@parcel/watcher-linux-*/**",
    "!**/node_modules/@parcel/watcher-darwin-*/**",
    "!**/node_modules/@msgpackr-extract/msgpackr-extract-linux-*/**",
    "!**/node_modules/@msgpackr-extract/msgpackr-extract-darwin-*/**",
  ],
  // Native watcher bindings must be unpackable outside asar on Windows.
  asarUnpack: [
    "**/*.{node,dll}",
    "**/node_modules/@parcel/watcher*/**",
    "**/node_modules/@lydell/node-pty*/**",
    "**/node_modules/@msgpackr-extract/**",
  ],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    // Window / dock icons are read from process.resourcesPath (not asar).
    {
      from: "resources/icons",
      to: "icons",
      filter: ["**/*"],
    },
    // Preset case sessions for DesktopStartup / restore — must live outside asar.
    {
      from: "../opencode/src/session/session-seed",
      to: "session-seed",
    },
    {
      from: "resources/onecode-build.json",
      to: "onecode-build.json",
    },
    // Official OneSkills (staged by CI into resources/oneskills before electron-builder).
    ...(existsSync(path.join(desktopDir, "resources/oneskills/skills"))
      ? [
          {
            from: "resources/oneskills",
            to: "oneskills",
            filter: ["**/*", "!.git/**", "!**/.git/**"],
          },
        ]
      : []),
  ],
  // Install folder / exe basename used by NSIS APP_FILENAME sanitize.
  executableName: "onecode_desktop",
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "OneCode",
    schemes: ["opencode"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    // Cursor-style assisted installer: choose install path + advanced options.
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "OneCode",
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
    // Windows Setup.exe display name (productName overridden per channel below).
    uninstallDisplayName: "OneCode",
    include: "build/installer.nsh",
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()
  const stamped = process.env.OPENCODE_VERSION?.trim()
  const withIdentity = stamped
    ? {
        ...base,
        extraMetadata: {
          ...(typeof base.extraMetadata === "object" && base.extraMetadata ? base.extraMetadata : {}),
          version: stamped,
        },
      }
    : base

  switch (channel) {
    case "dev": {
      return {
        ...withIdentity,
        appId: "ai.onescience.onecode.desktop.dev",
        productName: "OneCode Dev",
        rpm: { packageName: "onecode-dev" },
      }
    }
    case "beta": {
      return {
        ...withIdentity,
        appId: "ai.onescience.onecode.desktop.beta",
        productName: "OneCode Beta",
        protocols: { name: "OneCode Beta", schemes: ["opencode"] },
        publish: { provider: "github", owner: "onescience-ai", repo: "onecode", channel: "desktop-beta" },
        rpm: { packageName: "onecode-beta" },
      }
    }
    case "prod": {
      return {
        ...withIdentity,
        appId: "ai.onescience.onecode.desktop",
        productName: "OneCode",
        protocols: { name: "OneCode", schemes: ["opencode"] },
        publish: { provider: "github", owner: "onescience-ai", repo: "onecode", channel: "desktop" },
        rpm: { packageName: "onecode" },
      }
    }
  }
}

export default getConfig()
