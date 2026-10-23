# OpenCode Parallel：Mac App 验收分支

验收目标是可安装的 macOS App：重构后的主面板、真实 OpenCode Agent、多模型/同模型多实例并行，以及应用内官方 Sign in with ChatGPT。**已在云端 macOS 26 ARM64 编译并交付安装包**；在另一台云端 Mac 挂载同一份 DMG，签名校验、App 启动、主面板、可编辑输入及 ChatGPT 连接窗口检查全部通过，页面错误为 0。**当前用户的真实登录、订阅权限与模型推理仍未验收。**

基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的默认分支 `dev`，精确上游提交 `09a1db3b088293d48d84d62e86c02b69b40ed3ee`，保留 MIT 许可证与上游来源。开发分支 `parallel-mvp`，独立项目仓库为 [DHCFE/opencode](https://github.com/DHCFE/opencode)。本分支是独立二次开发项目，与 OpenCode 上游团队无隶属关系。本项目的源码克隆、修改、依赖安装和测试在云端 Linux x86_64 工作区进行；原生 Mac 编译与启动验证在 GitHub 托管的 macOS ARM64 runner 进行。没有在用户电脑保存或构建源码，也没有向上游推送。

## 已实现的三个部分

- **认证**：复用上游官方 SIWC。首页「使用 ChatGPT 登录」打开现有 OpenAI 连接界面。模型来自授权账户的动态目录，不使用猜测模型名单；保留 API key 和其他提供商。
- **界面**：首页为暖白墨黑的极简主面板；选择 Git 项目、Agent、模型及实例数，一次提交。单屏查看各分支状态、摘要和错误，拖拽排序，展开续聊；「打开完整会话」进入上游工具执行、文件查看及权限确认界面。任务历史、分支映射与排序持久化。
- **并行 Agent**：最多 8 个实例，调度器同时运行 2 个。每个实例调用上游 worktree API 创建独立目录，再创建独立真实 session；继承正常交互权限，没有全局允许或禁用全部工具。调度器跨页面保持运行，复用 SDK、流式事件、取消及持久化会话。

隔离副本来自所选 Git 工作目录**已提交的 HEAD**，不复制未提交修改。成果保留在各分支 worktree，不自动删除或合并。非 Git 项目会明确拒绝启动并行编辑。旧版只读分支不自动升级，请创建新任务。

刷新后恢复结果与活动会话；尚未提交的排队工作标为中断，避免自动重复收费。识别 HTTP 429 或 `usage_limit_exceeded` 后，停止同一提供商尚未发出的实例，不自动重试或切换付费账单。并发 2 是本面板的上限，不代表提供商承诺额度，也不是跨窗口全局锁。

## 认证：文档、源码、实测三层事实

| 层次             | 已确认内容                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官方文档         | OSS / 本机或自托管应用支持 `dynamic_agent_client` 注册，返回用户/工作区绑定的 client ID；付费或远程托管应用另有申请入口。登录身份和订阅推理权限分开，服务端决定实际模型、授权、地区和限额。                                                                 |
| 上游源码         | 已实现 PKCE、state、nonce、JWKS/ID token 验证、稳定 host ID、issued client ID 保存与刷新，以及 `chatgpt.tokens.use.direct` scope 检查。推理使用公共 `/v1/responses`，`store:false`、`stream:true`。本分支从账户 `GET /v1/models` 返回目录，不硬编码模型名。 |
| 本轮真实后端验证 | 无 mock 启动 CLI，查询到 OpenAI 的 Sign in with ChatGPT 方法；创建 OAuth 尝试，检查 dynamic client、S256、state/nonce、direct scope、随机 loopback 回调；状态为 pending，随后成功取消。没有用户凭据。                                                       |
| 当前用户授权     | **未完成真实 ChatGPT 登录、订阅推理或额度验证**。没有读取或复制用户 Mac 的 Codex token，不能宣称用户、本项目、模型或订阅已经获准。                                                                                                                          |

Mac App 自带本分支修改后的 CLI 后端。安装后，App 和回调服务在同一台 Mac 运行，系统浏览器完成正式授权；无需额外搭建云端网站。不能把云端后端产生的 `127.0.0.1` 授权链接直接交给另一台 Mac 浏览器冒充可用登录。远程服务器连接界面会提示这一限制。API key 使用 API 账单，不等于使用订阅。

正式文档（核实于 2026-10-22）：[SIWC OSS](https://developers.openai.com/siwc/token-sharing-open-source)、[注册和登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[账户与额度](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[错误与恢复](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)、[认证说明](https://learn.chatgpt.com/docs/auth)。

## 云端 Mac 构建与安装验收

`.github/workflows/parallel-mac.yml` 在独立项目仓库的 `parallel-mvp` push 或手动启动时使用 GitHub `macos-26` ARM64 runner；明确排除上游仓库，权限仅 contents:read，不发布 Release。它将：

1. 固定 Bun 安装依赖，执行全仓检查。
2. 从本分支编译原生 ARM64 CLI 和嵌入 UI，验证 CLI 可执行。
3. 构建现有 Electron Desktop，**强制打入该修改后 CLI**，不下载上游预编译后端替代。
4. 使用独立名称/应用 ID `OpenCode Parallel` / `app.opencode.parallel` 打包 DMG 与 ZIP，不配置上游更新发布。
5. 在原生 Mac 启动打包 App，验证主面板、可编辑输入与真实连接对话框，记录截图、运行结果、精确源码 commit 和 SHA256。

工作流在 Actions artifact `opencode-parallel-mac-arm64` 中交付 DMG、原生 Mac 截图、`mac-smoke.json`、源码 commit、上游 commit 和 SHA256。ZIP 同时编译，但不重复塞入下载附件。

交付 App 的精确源码为 `49ce1bd6f59a7fb8e46cd067b8b4c5cb0c100e9a`。对应 [40003645609](https://github.com/DHCFE/opencode/actions/runs/40003645609) 的全仓检查、原生后端、桌面编译和打包均成功，UI 检查也通过，但测试进程退出挂起导致该整轮标为失败，不能称为全绿。

已在提交 `78a05205fa73221628ea7cfdf29a73a4d6c16bb4` 修复测试进程清理，随后通过 [40006226179](https://github.com/DHCFE/opencode/actions/runs/40006226179) 在新 macOS runner 下载并核对该 DMG 的来源、挂载只读镜像、执行 `codesign --verify --deep --strict`、启动同一份 App 及验证界面，**该验收工作流全部成功**。未重编译或替换产品代码；源码提交与测试脚本提交分别记录在附件内。

DMG 的 SHA256：`f9641eae38899aa84065c1950ad4bb629c87a47c05034a08d78230c7de96ef1d`。本聊天的安装 ZIP 内含这份原始 DMG、简短安装说明、上游 LICENSE 和对应校验文件，不含开发源码。

完整源码变更会触发构建工作流；仅修改原生验收脚本时，`parallel-mac-verify.yml` 复用最新构建包，核对来源后重新验证，避免重复等待全量编译。

GitHub 已按用户要求解除 Fork 网络关系，仓库元数据为 `fork:false`，代码与提交历史保留；后续为独立项目的正常提交和构建。

该配置是内部验收包，使用 ad-hoc 签名，未 Apple notarize；不冒称已获得 Developer ID 分发签名。正式无提示分发仍需发行方的 Apple 签名和公证凭据。用户电脑只需安装 App，无需克隆源码、安装 Bun 或编译。本轮安装包仅支持 Apple Silicon（ARM64），没有交付或验证 Intel 包。

安装和首次使用：

1. 下载成功构建的附件，解压后打开其中的 `opencode-parallel-mac-arm64.dmg`，将 `OpenCode Parallel.app` 拖到「应用程序」。
2. 启动 App。如果 macOS 因未公证阻止打开，先核对下载来源与附件 SHA256，再按 [Apple 官方说明](https://support.apple.com/en-au/102445) 在「系统设置 → 隐私与安全性」为该 App 选择「仍要打开」。不需要关闭全局 Gatekeeper。
3. 点击「使用 ChatGPT 登录」，在连接窗口选择 **Sign in with ChatGPT**，由系统浏览器完成官方授权。不要选择 legacy 方法冒充本轮 SIWC 验收。
4. 登录后模型来自当前账户返回的目录。若需中文，可在现有应用设置中切换语言。
5. 在「项目与会话」打开一个已有 Git 项目，再回到并行工作台，选择项目、Agent、模型及实例数，输入一次任务并运行。
6. 在分支详情独立续聊；需要查看工具、文件或批准权限时，进入「打开完整会话」。

用户账户的最后验收链路：打开 App → 使用 ChatGPT 登录 → 系统浏览器授权 → 返回后出现该账户真实模型 → 打开一个 Git 项目 → 输入任务并选多个实例 → 在总览观察真实执行 → 进入分支确认工具权限、独立续聊并检查代码成果。服务端拒绝授权/模型/额度时应展示真实错误；只有这一链路完成才算“登录即可使用”验收通过。

## 云端源码复现与检查

以下步骤仅面向云端开发环境，Bun 固定为 `1.4.4`。基于上述精确上游 commit 应用随交付保存的补丁后：

```bash
bun install --frozen-lockfile
bun run check
```

分别在对应包目录运行：

```bash
# packages/core
bun run script/test.ts test/plugin/provider-chatgpt.test.ts

# packages/app
bun test --conditions=solid --isolate --preload ../ui/test/solid-jsx.ts --preload ./happydom.ts src/parallel/queue.test.ts src/providers/connect/remote.test.ts
bun run build
PLAYWRIGHT_PORT=4311 bun run test:e2e:built -- e2e/regression/parallel.spec.ts --project chromium --workers 1

# packages/desktop
bun test electron-builder.config.test.ts --timeout 30000
```

已验证：全仓 `check` 34/34 成功；共享 App 和 Electron 主进程/渲染器构建成功（云端 Linux 编译，不等于原生 Mac 运行）；认证合同 24 项、队列 2 项、远程认证提示 7 项通过；打包配置 8 项通过且重复 10 轮共 80 项通过。6 项浏览器测试用上游内存 API/SSE 测试服务验证真实生产渲染器，包含多实例、独立目录、默认权限、完整会话入口、续聊、持久化排序、流式、停止、单分支失败、额度停止和非 Git 拒绝。`Test Alpha`/`Test Beta` 只是测试替身，不证明真实提供商授权。

云端浏览器验证使用临时 Chromium 153 可执行文件覆盖及 Google Noto Sans SC，不修改产品依赖。另行检查 E2E 类型时，8 个错误来自未改动的上游测试，新增文件未报错。真实无凭据后端 smoke 另已实际创建两个独立 Git worktree 和两个 build Agent session，目录存在且隔离，不覆盖权限、不发 prompt、不调用模型。

原生 Mac smoke 脚本 `packages/app/e2e/mac-smoke.mjs` 已在 macOS 执行。记录明确区分 `packagedAppStarted`、`parallelUI`、`providerDialog` 与尚未执行的 `accountAuthorization`、`modelInference`，不将页面打开等同于订阅推理可用。

主要源码：`packages/app/src/parallel/`；认证仍在上游 `packages/core/src/plugin/provider/chatgpt.ts`；桌面仍为 `packages/desktop`，没有第二套推理后端或平台调度系统。
