# OneScience 单端口部署

这种部署模式会把 OneScience Web UI 构建进 `onecode` 二进制。部署机器只需要编译后的二进制，不需要 Bun、Node，也不需要源码树。

最终服务只监听一个端口：

```text
0.0.0.0:8004
```

Web UI 和服务端 API 都从同一个端口提供。

## 运行时系统依赖（Linux 网页多用户）

若启用平台账号登录，Linux 裸机无 GPU/DCU 时，终端优先使用 **bubblewrap（`bwrap`）** 做用户目录隔离（默认 **复用主机网络**，可 SSH / 访问外网）；有加速器时优先 **docker**（隔离 + GPU/DCU 透传），docker 不可用则用 **native**，避免隔离影响算力设备。

隔离前置条件不满足时（未安装 `bwrap`、命名空间不可用、docker 不可用等），会**自动降级为 native 共用终端**，不再阻断打开终端。需要强制隔离时请安装依赖并确保探测通过。

推荐在多租户机器上安装 bubblewrap：

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y bubblewrap

# RHEL / CentOS / Rocky / AlmaLinux
sudo dnf install -y bubblewrap
```

仅安装不够：`bwrap` 还需要能创建用户命名空间。源码 / 本机二进制直启时，在**同一台机器、同一用户**下用与 OneCode 一致的探测（需 bind `/usr` `/bin`，并用绝对路径的 `true`）：

```bash
bwrap --unshare-all --share-net --die-with-parent --new-session \
  --proc /proc --dev /dev \
  --ro-bind-try /usr /usr --ro-bind-try /bin /bin \
  --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
  --tmpfs /tmp -- /usr/bin/true
echo "exit:$?"
cat /proc/sys/kernel/unprivileged_userns_clone
cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true
```

注意：若省略 `/usr` `/bin` 绑定，会出现 `execvp true: No such file or directory`，这不代表命名空间坏了。

若 `exit` 非 0 且与命名空间相关（Ubuntu 常见），临时开启：

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

然后**重启 OneCode 并重新登录**。也可显式指定：`export ONECODE_TERMINAL_ISOLATION=native`（共用）或 `bubblewrap` / `docker`。

bubblewrap 默认带 `--share-net`（目录隔离 + 主机网络）。若需连网络一并隔离（终端内无法 SSH / 访问外网），可设 `ONECODE_TERMINAL_SANDBOX_SHARE_NET=0`。

Windows 桌面版不需要。可用 `ONECODE_TERMINAL_ISOLATION` / `ONECODE_BWRAP_PATH` 覆盖默认行为。

## 大工作区 / 科研数据目录（避免打开会话卡死）

科研项目常有数 GB 的数据文件。打开会话时不要对整个目录做全量 file watch / 索引。

`onecode serve` / `web` **默认不再**对工作区启用 `@parcel/watcher`（`OPENCODE_EXPERIMENTAL_FILEWATCHER`）。文件搜索索引改为按需构建，并忽略常见科学二进制与缓存目录；可用 `ONECODE_FILE_INDEX_MAX`（默认 20000）限制索引条目。

若仍卡顿，启动时显式关闭监视：

```bash
export OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER=true
# 可选：进一步限制索引规模
export ONECODE_FILE_INDEX_MAX=5000
```

也可在项目根 `.gitignore` / `.ignore` 中排除 `data/`、`results/`、`*.h5` 等大目录。

## 构建主机要求

在一台具备本仓库工具链的构建机上，从仓库根目录开始构建：

```bash
cd /root/opencode/onecode
```

在这台机器上，建议使用 `/tmp/node22/bin` 下的 Node 22：

```bash
export PATH=/tmp/node22/bin:$PATH
```

依赖应当已经存在。如果缺失，只在构建主机上安装：

```bash
bun install --ignore-scripts
```

## 构建部署二进制

执行：

```bash
cd /root/opencode/onecode
env PATH=/tmp/node22/bin:$PATH OPENCODE_CHANNEL=dev ./packages/opencode/script/build.ts --single --skip-install
```

该命令会做以下事情：

- 从 `packages/opencode/migration` 加载 SQL schema 迁移
- 生成 `packages/core/src/models-snapshot.js`
- 从 `packages/app` 构建 OneScience Web UI
- 把 `packages/app/dist` 内嵌进 `opencode-web-ui.gen.ts`
- 编译当前平台的二进制
- 用 `onecode --version` 跑一次冒烟测试

预期输出包含：

```text
Generated models-snapshot.js
Loaded 22 migrations
Building Web UI to embed in the binary
vite v7.1.4 building for production...
✓ built in ...
building onecode-linux-x64
Running smoke test: dist/onecode-linux-x64/bin/onecode --version
Smoke test passed: ...
```

产物二进制位置：

```text
/root/opencode/onecode/packages/opencode/dist/onecode-linux-x64/bin/onecode
```

验证：

```bash
/root/opencode/onecode/packages/opencode/dist/onecode-linux-x64/bin/onecode --version
```

## 需要部署的文件

对于普通的 Linux x64 部署，把下面这个文件拷贝到目标服务器：

```text
packages/opencode/dist/onecode-linux-x64/bin/onecode
```

目标路径示例：

```text
/opt/onecode/onecode
```

赋予可执行权限：

```bash
chmod +x /opt/onecode/onecode
```

使用这种内嵌二进制时，运行时服务器上不需要 `bun`、`node_modules`、`packages/app/dist`，也不需要仓库源码文件。

## 数据与迁移

运行时数据存放在用户的 opencode 数据目录下。对于 root 用户，SQLite 数据库路径通常是：

```text
/root/.local/share/opencode/opencode-local.db
```

在目标服务器上确认实际路径：

```bash
/opt/onecode/onecode db path
```

全新部署或升级后，启动服务之前先执行一次迁移：

```bash
/opt/onecode/onecode db migrate
/opt/onecode/onecode db migrate-onescience
```

迁移行为：

- `db migrate` 在存在遗留 JSON 数据时，将其迁移进 SQLite。
- SQL schema 迁移已经打包进二进制，数据库打开时会自动应用。
- `db migrate-onescience` 会初始化或更新 SQLite 中的 OneScience 资源目录。
- 在没有旧数据的全新服务器上，`db migrate` 通常很快，甚至是 no-op。

升级已有服务器前，建议先备份：

```bash
mkdir -p /opt/onecode/backups
cp /root/.local/share/opencode/opencode-local.db /opt/onecode/backups/opencode-local.db.$(date +%Y%m%d%H%M%S)
```

如果数据库尚不存在，跳过备份命令。

## 手动启动

启动单端口服务：

```bash
/opt/onecode/onecode serve --port 8004 --hostname 0.0.0.0 --cors http://onescience.ai:8004
```

如果是本地或基于 IP 访问，请把 CORS origin 改成你实际使用的浏览器来源，例如：

```bash
/opt/onecode/onecode serve --port 8004 --hostname 0.0.0.0 --cors http://SERVER_IP:8004
```

Web 访问由平台账号登录（`onescience-platform-auth-required`）控制。`serve` / `web` 已下线 workspace HTTP gate：即便传入 `--token` / `--password` 或设置 `OPENCODE_SERVER_PASSWORD`，也会被忽略（不报错、不生效），请改用平台账号登录。远程部署请依赖反向代理 TLS 与平台鉴权。

## systemd 服务

创建 `/etc/systemd/system/onecode.service`：

```ini
[Unit]
Description=OneScience OneCode
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/onecode
ExecStartPre=/opt/onecode/onecode db migrate
ExecStartPre=/opt/onecode/onecode db migrate-onescience
ExecStart=/opt/onecode/onecode serve --port 8004 --hostname 0.0.0.0 --cors http://onescience.ai:8004
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
systemctl daemon-reload
systemctl enable --now onecode
systemctl status onecode
```

## 验证

确认只占用了单端口：

```bash
ss -ltnp 'sport = :8004 or sport = :4096'
```

预期：

```text
0.0.0.0:8004 ... onecode
```

不应有监听 `4096` 的进程。

检查服务健康状态：

```bash
curl -sS http://127.0.0.1:8004/global/health
```

预期：

```json
{"healthy":true,"version":"..."}
```

检查内嵌的 OneScience Web UI：

```bash
curl -sS http://127.0.0.1:8004/ | grep '<title>OneScience</title>'
```

检查 OneScience 资源：

```bash
curl -I http://127.0.0.1:8004/assets/onescience-logo-D7_Hw5dM.png
```

预期：

```text
HTTP/1.1 200 OK
Content-Type: image/png
```

## 本次构建示例

本次构建在本机成功完成，输出为：

```text
Loaded 22 migrations
Smoke test passed: 0.0.0-dev-202605200343
```

用于验证的运行命令是：

```bash
/root/opencode/onecode/packages/opencode/dist/onecode-linux-x64/bin/onecode serve --port 8004 --hostname 0.0.0.0 --cors http://onescience.ai:8004
```
