# OneCode Desktop

OneCode desktop app (Electron). Workbench shell for desktop only; Web portal is unchanged.

## Development

```bash
bun install
bun run --cwd packages/desktop predev
bun run --cwd packages/desktop dev
```

## Build / package

```bash
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package:win    # NSIS Setup.exe
bun run --cwd packages/desktop package:mac    # DMG
bun run --cwd packages/desktop package:linux  # AppImage / deb / rpm
```

Artifacts land in `packages/desktop/dist/` as `onecode-desktop-*`.

Desktop packaging is **independent** of `@onescience/onecode` / `@onescience/onecode-web` npm publish and of the Linux standalone tgz job. See `oneci/onecode-desktop-pack/`.

## Desktop defaults

| Item | Value |
| --- | --- |
| Client flag | `OPENCODE_CLIENT=desktop` |
| Default projects | `~/OneCode/case` |
| Official skills | synced to `~/.agents/oneskills/` |
| Shared CLI skills | scanned from `~/.agents/skills/` |
| Default route | `/code` (skips marketing `/`) |
