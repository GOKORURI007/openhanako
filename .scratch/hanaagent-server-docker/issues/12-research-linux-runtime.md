# 12 — research: Linux server runtime 来源与 native modules 兼容性

Type: research
Status: resolved
Blocked by: (none)

## Question

`hanaagent server` 在 Linux 容器内运行所需的 runtime：

1. repo 中**是否已经存在**可用于 Linux 的 server artifact？检查 `dist-server/linux-x64/`（若存在）内容是否完整（`bundle/index.js`、`bundle/cli.js`、`hana-server`、native modules 等）
2. server bundle 在 **Node 24 + Debian bookworm glibc** 上是否能直接启动？特别是：
   - `better-sqlite3` 是否提供 prebuilt glibc wheel？
   - 是否有其他 native modules（grep `*.node` 或 `node-gyp-build` 痕迹）
   - server 启动时调起的子进程（git？浏览器后端？minGit？）在容器内是否可用
3. server 当前对 `HANA_HOME` / `HANA_ROOT` / `HANA_SERVER_ENTRY` 等 env 的实际行为
4. server bundle 是否需要 Linux 平台特有的 wrapper（参照 Windows 的 `hana-server.exe`），还是 `node` 直接跑即可

## Findings

- `D:/Projects/openhanako/dist-server/` 在本 checkout 中不存在；`dist-server-open/`、`dist-server-artifact/`、`dist-standalone/` 也都没有。`package.json:52` 的 `dist:linux` 会调 `node scripts/build-server.mjs`（无 `linux` arg）配合 `electron-builder --linux AppImage deb`。Linux build artifact 流水线在源码里全有，但**没有任何 Linux artifact 被预先产出或 checked in**。

- `scripts/build-server.mjs:73-77` 接受 `platform` + `arch` CLI args。输出到 `dist-server/{osDirName}-{arch}/`，`linux` 不被改名（`scripts/build-server.mjs:76-77`）。同一脚本接受任意 platform，无 platform guard（`scripts/build-server.mjs:223` 仅 console.log 收尾）。所以构建基础设施**原理上** Linux-capable。

- 真正 gate 的是 `prepareNodeRuntime` 的 `NODE_DIR_NAME_MAP`，显式含 `linux-x64` + `linux-arm64`（`scripts/build-server-phases.mjs:47-53`），并 pin 了 linux-x64 Node v24.15.0 tarball 的 SHA-256（`scripts/build-server-phases.mjs:43`）。

- bundle layout 跨平台一致：`bundle/index.js`（entry 是 `server/main-full.ts` 或 `server/main-open.ts`）、`bundle/cli.js`（esbuild from `cli/entry.ts`）、`bootstrap.js`（verbatim copy of `server/bootstrap.ts`）、`lib/`、`desktop/src/locales/`、`desktop/src/assets/`、`desktop/dist-renderer/`、可选 `skills2set/`、可选 `plugins/`、`package.json`、`package-lock.json`、`node_modules/`，再加 `hana-server` + `hana`（sh wrapper）或 `hana-server.cmd` + `hana.cmd`。

- Unix wrapper `hana-server`（`scripts/build-server-phases.mjs:752-766`）是 sh 脚本：设 `HANA_ROOT=$DIR`、`HANA_SERVER_ENTRY=$DIR/bundle/index.js`、抬 `ulimit -n`，然后 `exec "$DIR/node" "$DIR/bootstrap.js" "$@"`。Linux 上**没有 `.exe` 重命名**，`node` 是直接放在 `outDir/node` 的 flat binary（`scripts/build-server-phases.mjs:137-139`）。**Linux 不需要平台专属 wrapper**。

- `server/bootstrap.ts` 的 env reads 仅 `HANA_ROOT`、`HANA_SERVER_ENTRY`、`HANA_HOME`（`server/bootstrap.ts:17-21`）。Default：`hanaRoot = process.env.HANA_ROOT || import.meta.dirname`，`serverEntry = process.env.HANA_SERVER_ENTRY || path.join(hanaRoot, "bundle", "index.js")`。sh wrapper 已经填好这两个 env。

- server entry chain 全部 `process.env.*` reads（`server/main-open.ts`、`server/main-full.ts`、`server/index.ts`、`server/bootstrap.ts`、`server/routes/chat.ts`）：
  - `HANA_HOME`（read+write，`server/index.ts:253-254`）—— `shared/hana-runtime-paths.cjs:13-16` 解析为 `resolveHanakoHome(input || path.join(homedir(), ".hanako"))`
  - `HANA_TOKEN`（`server/index.ts:352`，loopback token，不设时 128-bit 随机）
  - `HANA_PORT`（`server/index.ts:353`，覆盖 `server-network.json`）
  - `HANA_CORS_ORIGIN`（`server/index.ts:583`）
  - `HANA_CREATE_STARTUP_SESSION`（`server/index.ts:840`，`"0"` 禁 startup session）
  - `HANA_DEBUG`（`server/index.ts:1164`，browser WS debug log toggle）
  - `HANA_SERVER_OWNER`（`server/index.ts:1246`，`"desktop"` 或 `"standalone"`）
  - `HANA_SERVER_OWNER_PID`（`server/index.ts:1247`）
  - `HANA_ALLOW_DATA_DOWNGRADE`（`server/index.ts:299`）
  - `HANA_INTERNAL_STANDALONE_RUNTIME_SMOKE`（`server/main-full.ts:21`，release probe）
  - `HANA_WS_DISCONNECT_ABORT_GRACE_MS`（`server/routes/chat.ts:308`，default 5min）
  - `HANA_TURN_STALL_ABORT_MS`（`server/routes/chat.ts:315`，default 20min）
  - `HANA_ROOT` / `HANA_SERVER_ENTRY`（`server/bootstrap.ts:17-18`，wrapper 设）
  - `HANA_CACHE_CONTRACT_DEBUG`（`core/session-coordinator.ts:360`）

  另外 bridge / sandbox 端被读：`HANA_BRIDGE_PUBLIC_BASE_URL`、`HANA_COMPUTER_USE_*` 全家、`HANA_PLUGIN_MARKETPLACE_*`、`HANA_SUBAGENT_TOOL_STRATEGY`、`HANA_DESKTOP_*`、`HANA_WIN32_SANDBOX_HELPER`。Linux server reachable 的只有 bridge env 与 `HANA_COMPUTER_USE_*`；mac/win 专属 `HANA_DESKTOP_*` 与 `HANA_WIN32_SANDBOX_HELPER` 因 `process.platform` gate 而**unreachable**。

- Native modules：仓库 working tree 无 `*.node` / `binding.gyp`（没装 `node_modules/`）。`package.json:67-114` 列出的 `dependencies`：
  - `better-sqlite3@^12.6.2`（line 87）—— prebuild-install 提供 Node 24 glibc / musl prebuilt
  - `node-pty@1.1.0`（line 103）—— ships `prebuilds/${platform}-${arch}/spawn-helper` + 一个 `.node` addon；build pipeline 只保留 target prebuild（`scripts/build-server-phases.mjs:670-683`）
  - `@node-rs/jieba@2.0.1`（line 78）—— napi-rs，`*-linux-x64-gnu` / `*-linux-x64-musl` / `*-linux-arm64-gnu` 等子包，作 `optionalDependencies`
  - `@firecrawl/anydoc@0.1.2`（line 74）—— napi addon，平台变体子包（`vite.config.server.js:35-40`）
  - `@silvia-odwyer/photon-node@0.3.4`（line 79）—— native，Vite external（`vite.config.server.js:47`）
  - `fsevents` —— 仅 Vite external（`vite.config.server.js:58`），不在 `package.json` deps，Linux 不安装
  - `koffi` —— `scripts/build-server-phases.mjs:655-668` 中作为 transitive dep，build 时 prune 到 target platform
  - `jsdom`、`exceljs`、`mammoth`、`proxy-agent`、`undici`、`node-telegram-bot-api`、`ws`、`hono`、`@hono/node-server`、`@hono/node-ws`、`@larksuiteoapi/node-sdk` —— pure-JS externals，无 `.node`

- Vite externals（不 bundle，全装入 packaged `node_modules`）：`vite.config.server.js:29-63`。`resolveAndInstallExternalServerDeps`（`scripts/build-server-phases.mjs:328-473`）用 target Node 跑 `npm install --omit=dev --ignore-scripts` 再 `npm rebuild` native 包。

- build-time runtime smoke（`scripts/build-server-phases.mjs:603-635`）：在 target Node 下 load `better-sqlite3` + `@node-rs/jieba` + `@firecrawl/anydoc`。**Load 失败是 hard build failure**——build 拒绝产出 `dist-server/linux-x64/`。所以一旦未来该目录存在，addon 已被验证可在 Node v24.15.0 + glibc（或 musl）上 load。

- Sandbox helpers：
  - Windows-only：`HANA_WIN32_SANDBOX_HELPER` 由 Windows wrapper 设（`scripts/build-standalone-server-artifact.mjs:99`），`lib/sandbox/win32-exec.ts` 与 `lib/sandbox/win32-sandbox-helper.ts:110` 读。helper 二进制由 `scripts/build-windows-sandbox-helper.mjs` 构建，**只** bundle 进 Windows installer（`package.json:236-238`）。这些代码在 Linux 是 dead code（`process.platform === "linux"` 时不命中）。
  - Linux sandbox：`lib/sandbox/bwrap.ts:34-39` 构造 `spawnAndStream("bwrap", [...args, "--", "/bin/bash", scriptPath], ...)`。要 `bwrap` 在 PATH 上——`checkAvailability`（`lib/sandbox/platform.ts:20-22`）用 `execFileSync("which", ["bwrap"], { stdio: "ignore" })` 检查。**无 `bwrap` 时 bash tool 返回 `sandbox.osRequired`**，host 命令不执行（`lib/sandbox/index.ts:336-345`）。PathGuard（`lib/sandbox/path-guard.ts`）独立于 OS sandbox，到处生效。
  - macOS：`lib/sandbox/seatbelt.ts`（`sandbox-exec` via `which` at `lib/sandbox/platform.ts:17-18`）。
  - **没有 Linux 等价的 `scripts/build-windows-sandbox-helper.mjs`**，无 vendored sandbox binary。Linux sandbox = host 的 `bwrap`。

- MinGit 引用全部 Windows-only：`scripts/mingit-runtime.js:8-15` 下载 `MinGit-2.55.0-64-bit.zip` 到 `vendor/mingit`，`scripts/download-mingit.js` 驱动下载。Windows standalone wrapper 把 `git/cmd;git/usr/bin;git/mingw64/bin` 加到 PATH（`scripts/build-standalone-server-artifact.mjs:100`），installer 也复制 `vendor/mingit`（`package.json:232-234`）。Linux **无 vendored git**——agent 在容器里跑 git-aware 工作时，用容器内 PATH 上的 `git`。

- Bootstrap Linux 行为：`server/index.ts:474` `engine.startWin32LegacySandboxMaintenance()` 只在 `process.platform === "win32"` 时跑。SIGBREAK handler（`server/index.ts:1341`）也是 win32-only。其余 startup logic 平台无关。`server/bootstrap.ts:32-58` spawn keepalive `worker_threads`，直接写 stdout fd 1，Linux 上 work（comment 提及 Electron-blocked main-thread，但机制 portable）。

- `shared/hana-root.ts:15` 解析 runtime project root：`process.env.HANA_ROOT || path.resolve(__dirname, "..")`。Vite bundle 后 `__dirname` 是 bundle dir，fallback 走一层到 `dist-server/<platform>-<arch>/`。sh wrapper 显式设 `HANA_ROOT`，所以 `fromRoot(...)` 可靠。

## Answer

Repo 有完整 source-level 基础设施产 Linux server artifact，但当前 working tree 没产物。`scripts/build-server.mjs linux x64` 会：下载 Node v24.15.0 linux-x64 tarball（SHA-256 pin 在 `scripts/build-server-phases.mjs:43`）、装 Vite externals（`better-sqlite3`、`node-pty`、`@node-rs/jieba`、`@firecrawl/anydoc`、`@silvia-odwyer/photon-node`、pure-JS externals）、在 target Node 下对 `better-sqlite3` / `@node-rs/jieba` / `@firecrawl/anydoc` 跑 runtime smoke、prune 到 linux-x64 prebuilds of `node-pty` / `koffi`、产 POSIX `hana-server` / `hana` sh wrapper（直接 exec `$DIR/node $DIR/bootstrap.js`）。Native modules 是否能 load，取决于宿主容器 glibc / musl 与 `npm install --omit=dev` 给 `better-sqlite3` / `@node-rs/jieba` / `@firecrawl/anydoc` / `node-pty` / `@silvia-odwyer/photon-node` 选的 prebuild 是否匹配；build script 的 in-place smoke 在 artifact emit 前就 fail，所以未来任一 `dist-server/linux-x64/bundle/index.js` 已对 build-host libc 验证 loadable。换到不同 base image（如 Debian bookworm glibc 2.36 vs Alpine musl）需要匹配 libc toolchain 或 `prebuild-install` 拉正确 prebuilt。

Server 读 12 个 `HANA_*` env：`HANA_HOME` / `HANA_TOKEN` / `HANA_PORT` / `HANA_CORS_ORIGIN` / `HANA_CREATE_STARTUP_SESSION` / `HANA_DEBUG` / `HANA_SERVER_OWNER` / `HANA_SERVER_OWNER_PID` / `HANA_ALLOW_DATA_DOWNGRADE` / `HANA_INTERNAL_STANDALONE_RUNTIME_SMOKE` / `HANA_WS_DISCONNECT_ABORT_GRACE_MS` / `HANA_TURN_STALL_ABORT_MS` + wrapper 设的 `HANA_ROOT` / `HANA_SERVER_ENTRY` + core 的 `HANA_CACHE_CONTRACT_DEBUG`。`HANA_HOME` 默认 `~/.hanako`、`HANA_TOKEN` 不设时 auto-generate 128-bit hex、`HANA_PORT` fall through 到 `server-network.json`。`HANA_DESKTOP_*` / `HANA_WIN32_SANDBOX_HELPER` / `HANA_FORCE_ANNOUNCEMENT` 在 Linux unreachable。Linux 不需要平台 wrapper 超过 sh `hana-server` / `hana` pair；无 Linux-specific sandbox helper——Linux sandbox 是 host `bwrap`，容器必须 supply；agent 的 bash tool 在 `bwrap` 缺失时 fail-closed with localized message。MinGit Windows-only——容器必须自备 PATH 上的 `git`。

## Gaps / follow-ups

- **没有 Linux artifact 在本 checkout 被实际产出 + smoke-tested**。建议 follow-up ticket：在 Linux host 跑 `node scripts/build-server.mjs linux x64`，再在 Debian-bookworm glibc 容器里跑 `HANA_HOME=/tmp/test-home node ./bundle/index.js`，验证 `better-sqlite3` 拿到与目标 glibc 匹配的 prebuild（不是 musl prebuild 或反之）。
- **Linux sandbox 契约未定**：`bwrap` 缺失时 bash / `command_exec` tool 退化到 `sandbox.osRequired`（`lib/sandbox/index.ts:336-345`）。Repo docs/policy 未明示 Docker image 是否要装 `bwrap`（很可能 `apt-get install bubblewrap` 要）或允许 Linux server artifact 不带 sandbox。需要 ticket。
- **没有 Linux 等价的 `scripts/build-standalone-server-artifact.mjs`**。当前 standalone hard-code `STANDALONE_PLATFORM = "win32"` / `STANDALONE_ARCH = "x64"`（`scripts/build-standalone-server-artifact.mjs:28-29, 79-81`）。如果 Linux 容器要 one-shot tarball，要么直接复用 `dist-server/linux-x64/` tree，要么另写一个 `buildLinuxStandaloneArtifact`——但 Linux 无 MinGit / `hana-win-sandbox.exe` 等价物，结构比 Windows artifact 简单。
- sh wrapper（`scripts/build-server-phases.mjs:752-766`）把 `ulimit -n` 抬到 65536/8192，要求容器 `ulimit -u` / `nofile` 允许抬高。runtime contract 要测。
- `engine.startWin32LegacySandboxMaintenance()`（`server/index.ts:474`）platform-gate 正确。确认 startup path 没有其他 Windows-only 假设（如 `lib/sandbox/index.ts:254` 的 PowerShell detection、`lib/sandbox/win32-runtime-cache.ts`）。
- `node-pty` native module 按 `(platform, arch)` 发 prebuild；trim step（`scripts/build-server-phases.mjs:670-683`）install 后只留 `linux-x64`。已知无问题但建议 Linux build 内 smoke test `node-pty.spawn(...)`——`node-pty` 是历史上最 libc-sensitive 的 native dep。
- `bundle/index.js` size（~750KB per `scripts/build-server.mjs:24`）platform-neutral——bundle 是平台无关 JS。平台专属字节全在 `node_modules/`。