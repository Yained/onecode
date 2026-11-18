# 智能投稿集成

能力中心新增第六项「智能投稿」，位于 oneskills 后面。固定入口：
`/workspace/capabilities?category=submission&domain=all`。

## 内容

`packages/intelligent-submission` 迁移 OneScience 当前实际使用的工作流：

1. 上传 PDF / DOCX / TXT / Markdown（最大 15 MB），提取标题、摘要和关键词。
2. 配置候选期刊数、每刊近期论文数、年份窗口和评分模型。
3. 通过 OpenAlex 发现期刊并逐刊检索近期相似论文。
4. 使用 8B / 3B / 0.6B Ranker 或 DeepSeek 对稿件和同刊论文统一评分。
5. 展示候选期刊、论文证据、分布比较与投稿判断，保留历史项目。

React 工作台通过同源 iframe 嵌入 Solid 能力中心，采用平台风格并隐藏重复侧栏。
入口、URL 解析和分类持久化都支持 submission。没有恢复原项目已经停用的旧投稿流程。

## 构建与启动

使用仓库指定的 Bun 1.3.13。投稿模块在 OneCode 主进程内运行；首次访问时自动初始化，无须单独启动 Node 网关。

```sh
bun install
bun run --cwd packages/intelligent-submission build
bun run --cwd packages/opencode script/build.ts --single --skip-install
ONECODE_PORT=8008 ./script/serve-with-submission.sh
```

也可以直接运行 OneCode 的 `serve` 命令，或使用仓库的 `bun dev`。`serve-with-submission.sh` 现在是主服务启动脚本的兼容入口，不再监听 8010。前端开发服务器仍需将 API 请求转发到运行中的 OneCode 主服务。

编译后的主程序自动定位仓库内的 `packages/intelligent-submission`，因此部署时须保留该目录、已安装的依赖、`dist`、解析工具及配置。若主程序移动到仓库之外，请用 `ONECODE_SUBMISSION_ROOT` 指定该目录的绝对路径。无需更改原来的存储目录。

内部 Express 模块使用同一 PID 的随机回环端口接入主服务，随主服务关闭，不启动子进程。浏览器仍访问主服务端口。GPU Ranker 是独立的模型推理服务，本次集成不改变其部署方式。

## 服务配置

在 `packages/intelligent-submission/.env` 设置 `.env.example` 中的服务地址与密钥。
此文件被 Git 忽略，建议权限 0600。生产服务启动前完成配置。

- `OPENALEX_API_KEY`：执行期刊和近期论文检索所需；源码启动时手动注入环境变量（见下文），不要在源码中填写真实密钥。
- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`：可选语义画像及 DeepSeek 评分。
- `RANKER_8B_SERVICE_URL`（兼容 `RANKER_SERVICE_URL`）、`RANKER_3B_SERVICE_URL`、`RANKER_06B_SERVICE_URL`：对应模型的独立服务；本模块不会启动或训练 GPU 模型。
- `RANKER_SERVICE_API_KEY`：Ranker 鉴权。
- `SUBMISSION_STORAGE_DIR`：可选项目数据目录。
- `MARKITDOWN_PYTHON`：可选 PDF 解析环境；缺失时沿用 pdf-parse 回退，并展示解析提示。

### OpenAlex 环境变量与安装包

源码启动时手动指定变量，例如：

```sh
OPENALEX_API_KEY='<你的密钥>' bun dev
# 单独启动兼容网关时：
OPENALEX_API_KEY='<你的密钥>' npm --prefix packages/intelligent-submission start
```

密钥缺失、为空或只有空白时，OpenAlex 期刊及论文检索不可用，不发出匿名请求。
其他不依赖 OpenAlex 的功能保持可用。不要提交真实密钥或包含密钥的 `.env` 文件。

GitHub Actions 从仓库 Secret `OPENALEX_API_KEY` 注入 CLI Build 和桌面 Prepare / Build 步骤。
`packages/opencode/script/build.ts`（独立二进制）和 `build-node.ts`（桌面后端）在构建时读取此变量，
只将它写入服务端构建产物，不注入 Vite 前端。未设置 Secret 时仍可构建，但不会内置 OpenAlex 服务凭据。
Jenkins 或其他 CI 需将 Secret Text 凭据绑定为同名环境变量；若在容器内构建，还需用
`docker run --env OPENALEX_API_KEY ...` 传入容器。真实值不得写入流水线源码或打印到日志。

主程序在加载投稿模块之前注入内置值。运行时显式设置的 `OPENALEX_API_KEY` 优先，
包括空字符串：`OPENALEX_API_KEY=''` 可禁用安装包的 OpenAlex 检索。
本地 `.env` 仍支持其他服务的配置；已有 `.env` 中的 OpenAlex 配置应迁移到启动环境变量。

编译内置不是加密：安装包持有者可能提取密钥。此方案避免将密钥提交到开源源码，
如需对客户端保密，应改用服务端代理。

## 登录和数据

所有投稿 API 每次通过原平台 `/platform/auth/session` 校验登录会话。没有账号或会话过期时返回 401；认证上游不可用时返回 503。客户端提供的账号 ID 不被采用。

项目按已验证账号 ID 的 SHA-256 目录隔离；并发写入按账号串行化、原子落盘。投稿原文仅保存在服务进程内存；元数据、摘要和结果会持久化。历史单机项目和本地密钥不随源码复制。浏览器不会取得服务 API 密钥。

## 验证

```sh
cd packages/app
bun typecheck
bun test --preload ./happydom.ts ./src/workbench/capabilities/catalog.test.ts ./src/workbench/capabilities/center.test.ts ./src/workbench/capabilities/selection.test.ts ./src/workbench/capabilities/submission.test.ts ./src/workbench/routes.test.ts
cd ../intelligent-submission
node --test test/*.test.mjs
```

集成测试通过本地协议夹具验证：上传 → 关键词 → 三本候选期刊 → 每刊两篇近期论文 → 每刊一次批量评分 → 基线判断 → 历史结果读取，同时验证跨账号访问隔离、失效登录和并发保存。夹具验证协议与业务编排，不代表已经完成真实外部期刊检索或 GPU 推理。

模型选择会优先使用已可用的评分器。若只有 DeepSeek 配置可用，新项目默认选择 DeepSeek。规则降级分会明确标注，且不参与论文质量基线判断；检索不到候选期刊时返回明确错误。

## 主服务入口（2026-10-10 集成）

`/intelligent-submission` 及其子路径由 OneCode 转发给同进程内的投稿模块。上游认证地址取自主服务实际监听地址，不采用浏览器传入的 Host，也不依赖 `ONECODE_UPSTREAM` 或固定端口 8010。

Host、Origin、Authorization、查询参数及 multipart 上传正文保持转发；页面和静态资源可公开加载，项目 API 校验平台登录并按账号隔离。初始化或请求失败返回 503 JSON。显式设置 `ONECODE_SUBMISSION_URL` 可保留旧的外部服务接入，仅供兼容；正常集成部署不要设置它。

验证：`cd packages/opencode && bun typecheck && bun test test/server/httpapi-ui.test.ts test/server/submission.test.ts`。
投稿完整流程在同进程适配器上的测试：`cd packages/intelligent-submission && SUBMISSION_TEST_EMBEDDED=1 bun test test/integration.test.mjs`。

## 2026-09-29 登录、导航恢复与主题修复

投稿入口和 API 客户端统一读取 platformAuthToken，避免通用服务凭据缓存覆盖平台会话。鉴权上游异常返回 503，真正的无效会话返回 401。

投稿工作区按账号保存在平台窗口中；切换栏目、离开工作台再返回时保留选中文件、上传输入、项目、参数、阶段和进行中的请求。请求由平台窗口发起，移除 iframe 不会中断上传或评分。非文件草稿保存在 sessionStorage，文件仅驻留内存；整页刷新或关闭标签后未上传的文件需要重新选择。退出登录和账号切换由平台级监听清理旧工作区，迟到结果不能写回已清理状态。

阶段导航与内容背景统一使用淡红色。验证：47 项投稿测试、16 项能力中心测试、app typecheck、构建 smoke test；隔离浏览器验证失效通用凭据、文件和输入保留、上传/评分途中导航、参数和第四阶段恢复、淡红色背景、卸载后的退出清理。浏览器夹具只使用测试数据和回环端口，未调用外部付费模型。

## Rebuttal：评审意见驱动的论文修订

第五阶段为 Rebuttal 修改建议。已有论文的项目可以直接进入，无需先运行选刊评分。每条意见用空行分隔，每次最多 20 条、20,000 字符。生成结果包含原始意见、优先级、修改位置、可逐字核对的论文引文、修改动作、待补充证据和回应思路，可下载 Markdown。

接口：`POST /intelligent-submission/api/projects/:id/rebuttal`，接收 `comments` 和可选的 `paper`（multipart）；不重新上传时也支持 JSON。论文原文仅在内存使用，历史原文不可用时返回 422 并要求重新上传。修订稿缓存与原选刊流程的论文缓存分开。模型使用现有 DeepSeek 配置；未配置返回 503，不生成伪造结果。长论文最多提供开头 40,000 和结尾 20,000 字符，并显示覆盖限制。

结果保存在账号所属项目的 `rebuttal` 字段中；生成失败保留原结果。页面草稿和进行中的请求沿用平台窗口的状态恢复机制，论文文件不写入浏览器持久存储。此功能只提出建议，不自动修改论文，也不将待做实验写成已完成结果。

验证命令（在 packages/intelligent-submission 中）：`npm test`、`npm run build`、`node test/browser-rebuttal.mjs`。浏览器测试使用 app 已安装的 Playwright 和隔离的模型响应，可用 CHROME_PATH 指定 Chromium；所有测试数据及服务均与真实项目隔离。


### 跟随平台对话模型

嵌入式智能投稿通过 `POST /provider/submission` 调用平台 Provider 服务，复用启动参数中的预设 API 密钥和平台已连接的提供方配置。密钥不传到浏览器，也不复制到投稿环境变量。论文分析、检索规划、大模型评分及 Rebuttal 共用此入口。

同一个浏览器标签页内，按账号保存最近一次对话实际选中的 provider、model、variant 和工作目录；投稿每次请求读取该选择。切换模型后新请求使用新模型，已经开始的任务保持原模型。尚未进入对话选择模型时提示先选择，不回退到独立 DeepSeek。不同提供方使用各自在平台配置的凭据，并非把 OneScience 密钥发给其他提供方。历史项目的 `deepseek` 评分器标识保留用于兼容，界面显示“系统对话模型”。

临时 Mac 代理需允许系统模型服务地址（当前为 rehdasu.cn:443）。其他提供方仍依赖其服务地址的网络可达性。

### 目标投稿语言（2026-10-04）

关键词阶段新增“目标投稿语言”：中文、英文、不限。中文论文默认中文，英文论文默认英文，无法可靠识别时默认不限；用户可覆盖默认值。切换页面后保留选择，运行流程时将其保存到项目，并记录在结果参数中。已有项目会根据论文信息补充默认值；旧检索结果需重新运行才应用新筛选。

中文检索同时使用中文主题与英文译词；候选期刊必须匹配本地 CCF 中文期刊目录中经身份核验的期刊，并具有近期相关论文证据。已核对的 ISSN 及来源保存在 server/data/journal-identities.mjs。身份有歧义时不猜测。OpenAlex 的 language 表示标题/摘要元数据语言，不能直接视为期刊投稿语言，因此允许已核验中文期刊的英文译题/摘要证据。英文检索使用英文论文元数据，排除已知中文期刊；未核验的投稿语种在页面标注待核实。

中文目录当前主要覆盖计算机与信息领域，并受 OpenAlex 收录和论文证据数量限制；结果不足不会用英文期刊或无证据的目录条目补齐。不限模式不施加语言筛选。页面展示目标语言、覆盖说明和期刊语种依据。

验证：65 项服务与集成测试，包括语言默认值、手动覆盖、OpenAlex 语言过滤、同名期刊排除、中文期刊英文元数据及有证据才入选。浏览器验证中文默认、切换语言、导航恢复及实际请求参数。

### 中文候选不足时分批扩展

中文补充检索接收目标 k 和已有合格候选，已有数量足够时不再发起目录请求。先查前 8 本目录期刊；不足时扩大到最多 32 本，并依据论文关键词/检索计划中已有概念展开中英文同义词。每批最多 3 本，批次结束后重新核对数量；达到目标即停止，最多补查 120 秒。期刊身份查询在一次流程中复用，已找到证据的期刊不重复补查。每本仍必须有相关论文证据，原有收录量筛选继续生效。

进度显示当前批次和已找到数量；结果保存并显示实际数量、补查目录数量和停止原因。后续近期论文检索优先使用该期刊已命中的检索词，保证扩展所得证据能继续用于评分。目录耗尽或时间上限时返回可用候选，不承诺凑足 k。

验证：68 项测试通过，包含前 8 本以外的期刊、翻译同义词、已有候选充足时跳过、按批停止、身份查询复用、无关同义词排除和时间预算。

### 参考摘要不足时继续流程

近期论文检索在相关结果中优先选取有有效摘要的记录。进入批量评分前同时检查稿件摘要和至少一篇参考论文摘要；空白摘要不计入。无有效参考摘要时保留期刊和论文信息，显示未评分、原因与不足的比较状态，不调用单篇批量评分接口、不生成代替模型分数，也不中断其他期刊。模型服务连接错误仍按原规则报告，不被数据不足分支掩盖。

验证：69 项测试和浏览器回归通过；集成测试覆盖无近期论文、空白摘要、正常期刊混合存在时仅正常期刊调用平台模型，并成功保存完整候选报告。

### Rebuttal 意见覆盖修复

每批最多处理 5 条意见，保留原始全局编号。按编号合并响应，兼容纯数字字符串编号；不按返回位置猜测对应关系，不接受重复编号或空建议。已成功条目保留，仅对本批缺失/无效项自动补试一次。仍不完整时报告缺失编号，不保存部分结果，已有完整报告保持不变。全部调用共享 600 秒预算，逐字证据验证与截断提示不变，批次调用记录保存在 batchTraces。

验证：72 项测试及浏览器回归通过，包含遗漏补试、数字字符串编号、乱序结果、额外编号、12 条意见分批以及持续遗漏的有限重试。

### 长流程的主服务代理超时

8008 转发 `/intelligent-submission` 时，通过 Effect FetchHttpClient.RequestInit 设置 Bun 的 `timeout: false`，避免单条等待最终 JSON 的连接被默认空闲超时提前切断。进度轮询是独立 HTTP 请求，无法重置评分请求的空闲计时。流程仍由投稿后台的逐模型/整流程截止时间和客户端断开信号控制，并未取消这些保护。

验证：主服务类型检查与 19 项 UI/代理路由测试通过。

### 私有论文知识库（2026-10-08）

智能投稿新增“投稿流程 / 私有知识库”入口。用户上传的待审论文会自动保存解析正文与元数据；也可单独向知识库上传论文、全文检索、查看、删除。仅保存解析后的文本，不保存原始 PDF/DOCX 二进制。内容指纹去重，历史元数据记录重新上传同名同标题论文后补全文。演示论文不自动入库。

知识库沿用已验证账号的 AsyncLocalStorage 隔离，保存在 `SUBMISSION_STORAGE_DIR/<账号哈希>/knowledge.json`，目录权限 0700、文件 0600，按账号串行原子写入。所有 API 复用平台登录与同源检查，不接受客户端指定账号；未登录返回 401，跨账号读取/删除条目返回 404。历史项目首次检索时自动导入元数据；已导入项目留下标记，删除后不会从历史记录重新出现。新上传会主动重新入库。原文不在内存的历史项目只能作为元数据来源，须重新上传补全文。

API：GET/POST `/api/knowledge`、GET/DELETE `/api/knowledge/:id`、POST `/api/projects/:id/knowledge-analysis`。检索只在当前账号中进行，使用分段关键词匹配（中英文词与中文双字词），排除当前稿件，最多提供 3 篇各 2 段、每段 1200 字符。当前版本未使用向量嵌入。独立分析仍跟随系统对话模型。

上传时的语义画像增加独立的带出处 knowledge_notes；检索规划可参考相关私有片段解释当前稿件已有术语。关键词阶段和投稿判断阶段显示来源、原文片段、建议关键词及相关工作补充，并支持“结合知识库分析”刷新。模型建议必须含有效来源 id 与可逐字核对的引用，无法核对的建议不展示。历史论文不作为当前稿件的成果，也不进入稿件/期刊基准评分批次。无匹配或模型未配置时仅显示检索状态，不虚构联系。

删除后不再参与后续检索；历史报告中的引用快照保留。界面明确提示解析正文的持久化和相关片段会发送给当前系统模型。

验证：74 项测试通过，涵盖账号隔离、并发去重、文件权限、历史元数据补全文、删除后不回流、自我匹配排除和引用校验。浏览器验证自动入库、知识库单独上传、模型辅助分析、删除、导航恢复以及桌面/移动端布局。测试使用隔离账号、存储和模型夹具。

### 生产升级保持登录数据库（2026-10-10）

OneCode 默认数据库文件名取决于构建 channel。将 `0.0.0-main-*` 改为正式版本号，会使默认文件由 `opencode-main.db` 切换成 `opencode.db`，表现为浏览器仍有登录缓存、服务器却查不到会话。升级必须保留原 channel，并显式指定现有 `OPENCODE_DB`；不要新建账号或迁移空库来处理此问题。

当前 4090 生产服务沿用 `OPENCODE_CHANNEL=main`，运行时固定 `OPENCODE_DB=/data1/biandixing/workspace/.local/share/opencode/opencode-main.db`。后续启动应保留此环境变量。原账号、会话和工作区数据不变。

回归测试：`cd packages/opencode && bun test test/server/submission-auth.test.ts`，使用隔离账号验证真实平台会话、非法会话拒绝，以及主服务重启后复用已有会话。


## 本地 Ranker 一键安装

新评分流程默认选择系统对话模型 API（`deepseek` 是兼容已有存储的内部 ID），不自动选择可用的 Ranker。
历史流程显式选择的评分模型仍保留。未配置 API 时提示配置，不静默切换评分方法。

评分选择栏提供“系统对话模型”和“添加其他模型”。选择后者打开模型窗口，展示 0.6B / 3B / 8B Ranker 的基座、用途、体积、环境要求与许可；阅读许可后点击“一键下载安装并启用”。
窗口中显示安装阶段与已下载字节数，关闭窗口不影响后台下载。下载完成后可点击“测试连通性”检查本地服务，再点击“使用此模型评分”选用。连通性测试检查服务可访问性，不替代真实评分质量验证。
下载发生在 OneCode 后端机器，远程浏览器不会下载权重到客户端。
安装器创建隔离 Python 环境，从魔搭下载固定提交的基座和适配器，校验适配器清单与每个文件，
然后启动仅监听 127.0.0.1 随机端口、使用随机 Bearer 密钥的推理进程。
适配器保留原评分头与 validation 校准文件；推理使用项目自带代码，不执行下载仓库中的 Python 脚本。

当前推理支持 Linux / Windows x64 + NVIDIA CUDA，需要可用 NVIDIA 驱动。
优先复用 Python 3.10–3.12；没有兼容 Python 或 venv 不可用时，自动使用经过 SHA-256 校验的固定版本 uv 创建独立 Python 3.11 环境，不修改系统 Python 或 shell 配置。
自动环境安装需要访问 GitHub，依赖安装需要访问 PyPI 和 PyTorch 下载站。磁盘不足、驱动不可用、下载或加载失败时，界面显示原因并可重试。
macOS / CPU 推理尚不支持；可继续使用默认 API。
模型约为 1.6 / 6.3 / 16.2 GB，首次安装连同依赖建议分别预留 16 / 22 / 32 GB。
下载中可以离开页面，返回后继续显示服务端状态；失败后重试复用下载缓存。
重启 OneCode 后保留模型文件，点击“启用本地模型”或执行已选本地模型的评分时重新加载。
本地模型已安装时优先使用本地进程，不静默转发到远程 Ranker。

- `ONECODE_RANKER_HOME`：模型与环境目录，默认 `~/.cache/onecode/rankers`。
- `ONECODE_RANKER_PYTHON`：可选 Python 可执行文件路径。
- `ONECODE_RANKER_DEVICE`：推理 GPU，默认 `cuda:0`，多卡环境可指定 `cuda:1`。
- `ONECODE_RANKER_INSTALL_DISABLED=1`：共享部署管理员可禁用安装入口。
- 原 `RANKER_*_SERVICE_URL` 保留，用于已部署的独立推理服务。

下载和环境由同一系统用户共享；安装 API 复用 OneCode 登录与同源写入校验，
仅接受三个固定模型 ID，不接受任意下载 URL、路径或 shell 命令。
全局安装锁防止并发修改推理环境，模型状态不包含服务密钥。
Qwen2.5-3B 使用 Qwen Research License，Llama 3 使用其社区许可；请按模型页条款使用。
