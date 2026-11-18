#!/usr/bin/env node

import path from "path"
import { fileURLToPath } from "url"
import { ensurePlatformBinary } from "./platform-bootstrap.mjs"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

try {
  // ensurePlatformBinary handles the already-installed case internally
  // (skips download, but still refreshes the bin/.onecode hardlink and the
  // .opencode/.oneskills symlinks at the launcher root). Do NOT early-exit
  // before calling it, or re-installs of the same version would skip
  // linkBundledAssets and leave the launcher without asset symlinks.
  await ensurePlatformBinary(rootDir)
} catch (error) {
  console.error(`Failed to setup onecode platform package:`, error.message)
  process.exit(1)
}
