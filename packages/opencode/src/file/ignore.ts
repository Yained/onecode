import { Glob } from "@opencode-ai/core/util/glob"

const FOLDERS = new Set([
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  ".conda",
  "conda-meta",
  "site-packages",
  ".history",
  ".gradle",
  "checkpoints",
  "weights",
])

const FILES = [
  "**/*.swp",
  "**/*.swo",

  "**/*.pyc",

  // OS
  "**/.DS_Store",
  "**/Thumbs.db",

  // Logs & temp
  "**/logs/**",
  "**/tmp/**",
  "**/temp/**",
  "**/*.log",

  // Coverage/test outputs
  "**/coverage/**",
  "**/.nyc_output/**",

  // Scientific / ML binaries & large artifacts (common on shared HPC home dirs)
  "**/*.h5",
  "**/*.hdf5",
  "**/*.npy",
  "**/*.npz",
  "**/*.ckpt",
  "**/*.pt",
  "**/*.pth",
  "**/*.safetensors",
  "**/*.onnx",
  "**/*.pb",
  "**/*.whl",
  "**/*.egg",
  "**/*.pdb",
  "**/*.cif",
  "**/*.mrc",
  "**/*.map",
  "**/*.dcd",
  "**/*.xtc",
  "**/*.trr",
  "**/*.xlsx",
  "**/*.xls",
  "**/*.parquet",
]

export const PATTERNS = [...FILES, ...FOLDERS]

/** Ripgrep `--glob=!...` excludes for file indexing (not watcher ignore syntax). */
export function ripgrepExcludeGlobs() {
  const globs: string[] = []
  for (const folder of FOLDERS) {
    globs.push(`!${folder}/**`)
    globs.push(`!**/${folder}/**`)
  }
  for (const file of FILES) {
    globs.push(`!${file.startsWith("**/") ? file.slice(3) : file}`)
    if (!file.startsWith("**/")) globs.push(`!**/${file}`)
    else globs.push(`!${file}`)
  }
  return globs
}

export function match(
  filepath: string,
  opts?: {
    extra?: string[]
    whitelist?: string[]
  },
) {
  for (const pattern of opts?.whitelist || []) {
    if (Glob.match(pattern, filepath)) return false
  }

  const parts = filepath.split(/[/\\]/)
  for (let i = 0; i < parts.length; i++) {
    if (FOLDERS.has(parts[i])) return true
  }

  const extra = opts?.extra || []
  for (const pattern of [...FILES, ...extra]) {
    if (Glob.match(pattern, filepath)) return true
  }

  return false
}

export * as FileIgnore from "./ignore"
