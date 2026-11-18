---
name: build-onecode-opencode
description: Use when building or verifying /root/opencode/onecode, installing dependencies, type-checking packages, rebuilding the embedded onecode binary, starting the server-hosted OneScience UI on port 8006, configuring the default /code project directory, or troubleshooting this repo's build pipeline.
---

# Build OneCode OpenCode

## Overview

Use this skill for the `/root/opencode/onecode` repository. Prefer the repo's existing Bun/Node 22 build path and avoid a slow full `bun install` unless dependencies are actually missing.

For detailed commands and recovery notes, read `references/build-process.md`.

## Workflow

1. Work from `/root/opencode/onecode`.
2. Check current state with `git status --short` and preserve unrelated user changes.
3. Use Node 22 first by prefixing commands with `env PATH=/tmp/node22/bin:$PATH`.
4. Install dependencies only when needed. Prefer:

```bash
bun install --ignore-scripts
```

5. Type-check the web app from `packages/app`:

```bash
bun typecheck
```

6. Build the web app from `packages/app`:

```bash
env PATH=/tmp/node22/bin:$PATH bun run build
```

7. Rebuild the embedded single binary from the repo root:

```bash
env PATH=/tmp/node22/bin:$PATH OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

This command needs network access to `https://models.dev/api.json`; if sandbox networking blocks it, rerun with escalation.

8. Verify the binary:

```bash
packages/opencode/dist/onecode-linux-x64/bin/onecode --version
```

## OneScience Embedded Server

For the current OneScience deployment flow, prefer a single onecode server that serves the embedded OneScience frontend. Do **not** start only the Vite frontend when the user asks to start the OneScience service; the server must host the frontend itself.

1. Rebuild the web app and embed it into the local single binary from the repo root:

```bash
env PATH=/tmp/node22/bin:$PATH OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

The build runs `packages/app` Vite build and then compiles `packages/opencode/dist/onecode-linux-x64/bin/onecode`. It may need network access to `https://models.dev/api.json`; if sandbox networking blocks it, rerun with escalation.

2. Start the server-hosted OneScience UI on port `8006`:

```bash
packages/opencode/dist/onecode-linux-x64/bin/onecode serve --port 8006 --hostname 0.0.0.0 --cors http://onescience.ai:8006
```

3. Configure the default `/code` project directory with an environment variable when needed:

```bash
OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY=/data/app/onescience packages/opencode/dist/onecode-linux-x64/bin/onecode serve --port 8006 --hostname 0.0.0.0 --cors http://onescience.ai:8006
```

If the variable is omitted, the app fallback is `/data/app/onescience`. The default project is only chosen when visiting `/code`; an existing `/code/<dir>/session` URL keeps its encoded directory.

4. Verify the hosted UI is OneScience and the default project meta is injected:

```bash
curl -4 -s http://127.0.0.1:8006/ | rg 'onescience-code-default-directory|<title>OneScience</title>'
```

Expected output includes `<title>OneScience</title>` and `content="/data/app/onescience"` unless `OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY` overrides it.

If port `8006` is in use, diagnose first:

```bash
ss -ltnp 'sport = :8006'
```

Do not kill unknown processes. If restarting a running OneScience/OneCode server, stop only the matching old `onecode ... serve --port 8006` process, then rerun the command above.

## Split Development Servers

Use split servers only for local UI development where hot reload is needed. These do not represent the current deployed OneScience service shape.

- Web/Vite app: `0.0.0.0:8004`
- onecode server: `0.0.0.0:8005` or repo script default

Start them from `/root/opencode/onecode`:

```bash
env PATH=/tmp/node22/bin:$PATH bun run dev
env PATH=/tmp/node22/bin:$PATH bun run dev:web
```

Verify split services with:

```bash
curl -I http://localhost:8004/skills
curl -I http://localhost:8005/
```

## Installation

When the user asks to install the compiled binary, copy from:

```text
packages/opencode/dist/onecode-linux-x64/bin/onecode
```

to:

```text
/root/.opencode/bin/onecode
```

Back up the old binary first if it exists. Do not replace unrelated files.
