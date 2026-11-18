# Build and Install the Current OneCode Web UI

This repo has two different web packages:

- `packages/app`: the actual OneCode Web UI that the CLI/server embeds and serves.
- `packages/web`: the Astro marketing/docs site, not the in-product Web UI.

For the current OneCode Web UI, build `packages/app` directly, or run the onecode build script so it embeds `packages/app/dist` into the binary.

## Avoid a Slow Full `bun install`

Do not start with a plain `bun install` if you only need to build the Web UI. The root `postinstall` runs `packages/opencode` native setup, and packages such as `node-pty`, `tree-sitter`, `@parcel/watcher`, and `@opentui/core` can spend a long time compiling or downloading native artifacts.

Use this first:

```sh
bun install --ignore-scripts
```

That installs and links the workspace dependencies without running native postinstall scripts. It is enough for typechecking and building the Web UI in most cases.

If a later command specifically complains about a missing native artifact, fix that package only instead of rerunning a full install.

## Prerequisites

- Bun `1.3.x`
- Node `>= 20.19` or `>= 22.12`

Vite 7 does not support Node 18. If `node --version` prints `v18.x`, install or temporarily prepend a newer Node before building:

```sh
export PATH=/path/to/node-v22.12.0-linux-x64/bin:$PATH
node --version
```

## Build Only the Web UI

From the repo root:

```sh
bun install --ignore-scripts
cd packages/app
bun typecheck
bun run build
```

The static Web UI output is written to:

```text
packages/app/dist
```

To preview it locally:

```sh
cd packages/app
bun run serve
```

## Build onecode With the Web UI Embedded

The onecode binary build calls `packages/app`'s Vite build and embeds the generated files.

From the repo root:

```sh
bun install --ignore-scripts
OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

Use `--skip-install` so the build script does not run extra platform-wide installs for `@opentui/core` and `@parcel/watcher`.

The generated binary is written under:

```text
packages/opencode/dist/onecode-<platform>-<arch>/bin/onecode
```

For example, on Linux x64:

```sh
packages/opencode/dist/onecode-linux-x64/bin/onecode --version
```

## Build Without Network Access

Model and provider metadata is no longer bundled at build time. `packages/opencode/script/generate.ts` now writes an empty `packages/core/src/models-snapshot.js`, and OneCode fetches `https://models.dev/api.json` on demand when the user opens the model/provider UI.

This means the standalone build itself does not need network access to `models.dev`. The runtime will use `OPENCODE_MODELS_URL` if set, otherwise `https://models.dev`. If the runtime fetch fails, the model catalog will be empty and the error is logged.

## Install the Built Binary Locally

After a successful binary build, put the generated `onecode` on your `PATH`.

Example:

```sh
mkdir -p ~/.local/bin
cp packages/opencode/dist/onecode-linux-x64/bin/onecode ~/.local/bin/onecode
chmod +x ~/.local/bin/onecode
onecode --version
```

If your platform is not Linux x64, replace `onecode-linux-x64` with the actual directory generated in `packages/opencode/dist`.

## Recommended Fast Path

For this repo, the shortest practical path is:

```sh
bun install --ignore-scripts
cd packages/app
bun typecheck
bun run build
cd ../..
OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

If `bun run build` fails with a Vite/Node version error, switch to Node 22 and rerun the build commands.
