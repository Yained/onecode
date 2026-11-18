# OneCode Web CDN 包

CLI 发布物仍然把 `packages/app/dist` 内嵌进 `onecode` 二进制。为了通过浏览器 CDN 分发，改为把 Web UI 作为独立的 npm 包发布，而不是把静态资源混进 CLI 包里。

源码编译、standalone 安装包构建与本地启动**不会**触发 npm 发布；只有 CI 显式调用 `publish-npm-ci.ts` 时才会发布。

## 版本号规则

| 场景 | 版本号来源 | 示例 |
| --- | --- | --- |
| 代码库 `package.json` | 入库基线版本（CI 只读不改） | `1.14.50` |
| standalone tgz / 二进制 `--version` | 代码库基线版本 | `1.14.50` |
| npm 发布（onecode + onecode-web） | 基线版本 + Asia/Shanghai 构建时间（UTC+8） | `1.14.50-202607011435` |

npm 包名：

- `@onescience/onecode-web` — Web UI 静态资源
- `@onescience/onecode` — CLI（`npm install -g` 后命令仍为 `onecode`）

同一次 CI 构建中，**时间戳小版本只生成一次**，`@onescience/onecode` 与 `@onescience/onecode-web` 必须完全相同（例如都是 `…-202607250911`），禁止 web 包再按当前时间另算一版（避免出现 `…-202607250912`）。实现上由 `OPENCODE_NPM_PUBLISH_VERSION` / `--publish-version` 冻结后复用。`latest` dist-tag 同时指向该版本。

## CI 发布（Jenkins onecode-pack）

Jenkins Job 注入 `NPM_TOKEN` 后，`run_pack_standalone.sh` 在 `pack:standalone` 之后调用：

```bash
bun ./packages/opencode/script/publish-npm-ci.ts
```

未设置 `NPM_TOKEN` 时跳过 npm 发布，standalone tgz 发版不受影响。

手动在构建节点触发（需已构建 `dist/onecode-linux-x64`）：

```bash
export NPM_TOKEN="npm_..."
cd onecode/packages/opencode
bun ./script/publish-npm-ci.ts
```

`publish-npm-ci.ts` 内部会调用 `publish-web-assets.ts` 发布 `@onescience/onecode-web`，再发布 `@onescience/onecode` launcher 包；调用时传入已冻结的 `--publish-version`，web 包不会再按时间生成新小版本。若只需单独发布 Web 资源：

```bash
export NPM_TOKEN="npm_..."
# 与 onecode 对齐时请显式传入同一版本，例如：
# export OPENCODE_NPM_PUBLISH_VERSION=1.14.50-202607250911
cd packages/opencode
bun ./script/publish-web-assets.ts --publish-version="${OPENCODE_NPM_PUBLISH_VERSION}"
```

## 本地仅打包（不发布 npm）

```bash
bun ./packages/opencode/script/publish-web-assets.ts --pack-only
```

产物目录：

```text
packages/opencode/dist/onecode-web
```

## CDN URL

部署侧先查 `latest` 对应的具体版本号，再拼固定版本 CDN URL（不要用 jsDelivr 的 `@latest`）：

```bash
ONECODE_WEB_VER=$(npm view @onescience/onecode-web@latest version)
# 例如 1.14.50-202607011435
```

```text
https://cdn.jsdelivr.net/npm/@onescience/onecode-web@1.14.50-202607011435/index.html
https://cdn.jsdelivr.net/npm/@onescience/onecode-web@1.14.50-202607011435/assets/<file>.js
```

## 启用 CDN UI 运行 OneCode 服务

Web 应用必须由 OneCode 服务来提供，不能用静态文件服务器直接托管。

```bash
ONECODE_WEB_VER=$(npm view @onescience/onecode-web@latest version)

ONECODE_STARTUP_MIGRATIONS_IN_PROCESS=1 \
ONECODE_CDN_BASE=https://cdn.jsdelivr.net/npm/@onescience/onecode-web@${ONECODE_WEB_VER}/ \
OPENCODE_DISABLE_EMBEDDED_WEB_UI=1 \
ONECODE_EXTRA_PATH=/data/guest_data \
OPENCODE_ONESCIENCE_CODE_DEFAULT_DIRECTORY=/data/guest_data/case \
./packages/opencode/dist/onecode-linux-x64/bin/onecode serve --hostname 0.0.0.0 --port 8004
```

验证：

```bash
curl -sS http://127.0.0.1:8004/ | rg "cdn.jsdelivr.net/npm/@onescience/onecode-web@"
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8004/provider
```

`/provider` 应返回 `200`。

## npm 凭据

Jenkins 将 npm token 注入为 `NPM_TOKEN`。本地手动发布示例：

```bash
read -s NPM_TOKEN
export NPM_TOKEN
npm whoami --registry=https://registry.npmjs.org/
unset NPM_TOKEN
```

发布完成后确认：

```bash
npm view @onescience/onecode-web@latest version
npm view @onescience/onecode@latest version
npm dist-tag ls @onescience/onecode-web
```

预期：两个包的 `latest` 指向相同的时间戳版本，例如 `1.14.50-202607011435`。

## Dockerfile 注意事项

草稿 Dockerfile 位于：

```text
docker/onecode-node22/Dockerfile
docker/onecode-node22/entrypoint.sh
```

完整镜像构建会拷贝整个仓库和 `node_modules`，上下文体积很大。快速验证优先使用 bind-mount `docker run` 方案。
